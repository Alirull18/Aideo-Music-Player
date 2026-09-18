# 🚀 Aideo Music Player — Distribution & SEO Playbook

This playbook contains exact, ready-to-use instructions to get **Aideo Music Player** indexed, backlinked, and ranked at the top of Google for **"Aideo"**, **"music player windows"**, and related queries.

---

## 1. 🔍 Google Search Console (Fastest Indexing)

Since the website is already live at `https://alirull18.github.io/Aideo-Music-Player/` and contains the verification code:

1. Open [Google Search Console](https://search.google.com/search-console).
2. Add Property: `https://alirull18.github.io/Aideo-Music-Player/` (URL prefix).
3. Verify via HTML file or tag (already included in `docs/index.html`).
4. In the left sidebar, click **Sitemaps**:
   - Submit: `sitemap.xml`
5. At the top search bar, paste: `https://alirull18.github.io/Aideo-Music-Player/`
6. Click **"Request Indexing"**. This forces Googlebot to crawl the landing page within 24–48 hours instead of waiting weeks.

---

## 2. 📦 Microsoft Winget Submission (Instant Windows Authority)

Submitting to Microsoft's official package repository creates high-trust Microsoft directory pages indexed by Google, and allows any Windows user to install via command line.

### Quick Submission using `wingetcreate`:
In PowerShell, run:
```powershell
# 1. Install Microsoft's Winget Create tool
winget install Microsoft.WingetCreate

# 2. Automatically generate the package manifest from your latest release
wingetcreate new https://github.com/Alirul/Aideo-Music-Player/releases/download/v0.9.9/Aideo_0.9.9_x64-setup.exe
```

When prompted:
- **PackageIdentifier**: `Alirul.Aideo`
- **PackageName**: `Aideo Music Player`
- **Publisher**: `Alirul`
- **ShortDescription**: `Modern, lightweight Windows desktop music player with studio sound and synchronized lyrics.`
- **Tags**: `music, player, audio, lyrics, karaoke, flac, wasapi, webstream`
- **License**: `GPL-3.0-or-later`

WingetCreate will automatically open a GitHub Pull Request to `microsoft/winget-pkgs`. Once merged, users can install via:
```powershell
winget install Alirul.Aideo
```

---

## 3. 🌐 AlternativeTo.net Listing (Dominates "Music Player Windows" Queries)

AlternativeTo is one of the highest-ranking websites globally for search queries like *"best music player windows"* and *"alternative to foobar2000"*.

1. Visit [AlternativeTo - Suggest an App](https://alternativeto.net/software/create/).
2. Fill out the application details:
   - **Name**: `Aideo Music Player`
   - **Website**: `https://alirull18.github.io/Aideo-Music-Player/`
   - **License**: `Open Source (GPL v3)`
   - **Platforms**: `Windows`
   - **Short description**: `A modern, lightweight desktop music player for Windows with bit-perfect WASAPI Exclusive audio, AutoEQ headphone calibrations, and real-time karaoke lyrics.`
   - **Tags**: `Audio Player, Music Player, Lyrics, Equalizer, Open Source`
   - **Alternatives**: Tag Aideo as an alternative to:
     - *MusicBee*
     - *foobar2000*
     - *AIMP*
     - *Dopamine*
     - *Tidal Desktop*

---

## 4. 💽 Free Software Portals (High-DA Do-Follow Backlinks)

Submit your latest `.exe` installer to reputable software directories:
- **Softpedia**: [Submit Software](https://www.softpedia.com/developer/submit-software.php)
- **MajorGeeks**: [Submit File](https://www.majorgeeks.com/content/page/contact_us.html)
- **FileHorse**: [Submit Application](https://www.filehorse.com/contact/)

---

## 5. 🐙 GitHub Awesome Lists (Developer Backlinks)

Submit a Pull Request adding Aideo Music Player to:
1. [awesome-tauri](https://github.com/tauri-apps/awesome-tauri):
   - Category: *Audio / Media*
   - Entry: `[Aideo Music Player](https://github.com/Alirul/Aideo-Music-Player) - Modern, lightweight desktop music player for Windows with bit-perfect WASAPI audio and synchronized lyrics.`
2. [awesome-rust](https://github.com/rust-unofficial/awesome-rust):
   - Category: *Applications » Audio & Music*

---

## 6. 💬 Reddit & Forum Showcases

Google frequently places Reddit threads at the very top of results for *"best music player windows"*. Post a launch update in:
- `r/windows`
- `r/windowsapps`
- `r/software`
- `r/audiophile`
- `r/opensource`

**Recommended Title Format**:
> *Showcase: Aideo Music Player — Open-source Windows desktop player with bit-perfect WASAPI, 4000+ AutoEQ profiles, and live karaoke lyrics*
