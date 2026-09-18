#!/usr/bin/env node

/**
 * Aideo Music Player — NotebookLM MCP Authentication Helper
 *
 * Launches a persistent browser session pointing directly to your Aideo notebook.
 * Captures session cookies and state so the agent can query NotebookLM via MCP.
 */

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import readline from 'node:readline';

const TARGET_NOTEBOOK_URL =
  process.argv[2] ||
  process.env.NOTEBOOKLM_URL ||
  'https://notebook.google.com/';

async function main() {
  console.log('🔍 Locating notebooklm-mcp installation...');

  const npxCacheDir = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx')
    : path.join(process.env.HOME || '', '.npm', '_npx');

  function findMcpPackage(dir) {
    if (!fs.existsSync(dir)) return null;
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const candidate = path.join(dir, entry, 'node_modules', 'notebooklm-mcp');
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  let pkgDir = findMcpPackage(npxCacheDir);

  if (!pkgDir) {
    console.log('📦 Fetching notebooklm-mcp via npx...');
    execSync('npx -y notebooklm-mcp@latest --help', { stdio: 'ignore' });
    pkgDir = findMcpPackage(npxCacheDir);
  }

  if (!pkgDir) {
    console.error('❌ Could not locate notebooklm-mcp. Please ensure npx is working.');
    process.exit(1);
  }

  const pkgRequire = createRequire(path.join(pkgDir, 'package.json'));
  const authManagerPath = path.join(pkgDir, 'dist', 'auth', 'auth-manager.js');
  const configPath = path.join(pkgDir, 'dist', 'config.js');
  const patchrightPath = pkgRequire.resolve('patchright');

  const { AuthManager } = await import(pathToFileURL(authManagerPath).href);
  const { CONFIG, ensureDirectories } = await import(pathToFileURL(configPath).href);
  const patchrightModule = await import(pathToFileURL(patchrightPath).href);
  const patchright = patchrightModule.default || patchrightModule;
  const chromium = patchright.chromium || patchright.default?.chromium;

  ensureDirectories();
  const authManager = new AuthManager();

  console.log('\n================================================================');
  console.log('🌐 Launching Chrome to authenticate for your Aideo Notebook...');
  console.log(`📍 Target Notebook: ${TARGET_NOTEBOOK_URL}`);
  console.log('👉 Please log into your Google Account in the opened window.');
  console.log('⚠️  IMPORTANT: DO NOT CLOSE THE BROWSER MANUALLY!');
  console.log('   The script will automatically detect your login, save your session,');
  console.log('   and close the window for you.');
  console.log('================================================================\n');

  const baseLaunchOptions = {
    headless: false,
    viewport: CONFIG.viewport,
    locale: 'en-US',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  };

  let context;
  try {
    context = await chromium.launchPersistentContext(CONFIG.chromeProfileDir, {
      ...baseLaunchOptions,
      channel: 'chrome'
    });
  } catch {
    context = await chromium.launchPersistentContext(CONFIG.chromeProfileDir, baseLaunchOptions);
  }

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  // Navigate directly to the notebook (Google will redirect to login if not signed in)
  await page.goto(TARGET_NOTEBOOK_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

  // Manual [ENTER] trigger
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const saveAndExit = async (reason) => {
    if (isSaved) return;
    isSaved = true;
    rl.close();

    console.log(`\n💾 ${reason}. Saving session state...`);
    try {
      await authManager.saveBrowserState(context, page);
      console.log('✅ Authentication cookies & state successfully saved!');
      console.log(`📁 Profile directory: ${CONFIG.chromeProfileDir}`);
    } catch (err) {
      console.error('⚠️ Warning while saving state:', err);
    }

    try {
      await context.close();
    } catch {
      // ignore
    }

    console.log('\n🎉 Setup complete! The agent can now query your notebook autonomously.');
    process.exit(0);
  };

  rl.on('line', () => {
    saveAndExit('User confirmed via Enter').catch((err) => {
      console.error('⚠️ Error during save:', err);
      process.exit(1);
    });
  });

  // Polling loop
  const startTime = Date.now();
  const maxWaitMs = 10 * 60 * 1000; // 10 minutes

  while (!isSaved && Date.now() - startTime < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 1500));
    if (isSaved) break;

    try {
      if (context.pages().length === 0 || page.isClosed()) {
        console.error('❌ The browser window was closed before login could be saved.');
        process.exit(1);
      }

      const currentUrl = page.url();
      const isAccountsPage = currentUrl.includes('accounts.google.com');

      // Auto-detect when we reach the notebook or notebooklm app
      if (
        !isAccountsPage &&
        (currentUrl.includes('/notebook/') ||
         currentUrl.includes('notebook.google') ||
         currentUrl.includes('notebooklm.google'))
      ) {
        console.log(`\n🎯 Successfully landed on NotebookLM: ${currentUrl}`);
        console.log('⏳ Allowing 3 seconds for session cookies to settle...');
        await new Promise((r) => setTimeout(r, 3000));
        await saveAndExit('NotebookLM session detected');
        break;
      }
    } catch (err) {
      // Ignore intermediate navigation errors
    }
  }

  if (!isSaved) {
    console.log('\n⏰ Timed out waiting for login.');
    rl.close();
    await context.close().catch(() => {});
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
