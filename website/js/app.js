/**
 * Aideo Music Player — Interactive Website Core
 * Features: Ballistic Audio Visualizer, Tabbed Showcase, FAQ Accordion,
 * Mobile Navigation, and Comprehensive GDPR/CCPA Cookie Consent Manager.
 */

document.addEventListener('DOMContentLoaded', () => {
  initMobileNav();
  initVisualizer();
  initFeatureTabs();
  initFaqAccordion();
  initCookieConsent();
});

/* ==========================================================================
   1. Mobile Navigation Drawer
   ========================================================================== */
function initMobileNav() {
  const toggleBtn = document.querySelector('.mobile-toggle');
  const navIsland = document.querySelector('.nav-island');
  const navLinks = document.querySelectorAll('.nav-links a');

  if (!toggleBtn || !navIsland) return;

  toggleBtn.addEventListener('click', () => {
    const isOpen = navIsland.classList.toggle('is-mobile-open');
    toggleBtn.classList.toggle('is-active', isOpen);
    toggleBtn.setAttribute('aria-expanded', String(isOpen));
  });

  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      navIsland.classList.remove('is-mobile-open');
      toggleBtn.classList.remove('is-active');
      toggleBtn.setAttribute('aria-expanded', 'false');
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navIsland.classList.contains('is-mobile-open')) {
      navIsland.classList.remove('is-mobile-open');
      toggleBtn.classList.remove('is-active');
      toggleBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

/* ==========================================================================
   2. Real-Time Ballistic Audio Visualizer Simulation
   ========================================================================== */
function initVisualizer() {
  const canvas = document.getElementById('visualizerCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const modeButtons = document.querySelectorAll('.mode-btn');
  const playToggleBtn = document.getElementById('visPlayToggle');
  const rateDisplay = document.getElementById('visSampleRate');

  let currentMode = 'peak-decay';
  let isPlaying = true;
  let animationFrameId = null;

  // Visualizer simulation parameters
  const barCount = 48;
  const bars = [];
  const peakCaps = [];

  for (let i = 0; i < barCount; i++) {
    bars.push(Math.random() * 0.3);
    peakCaps.push({ y: 0, vel: 0, hold: 0 });
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // Mode switching
  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      modeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMode = btn.dataset.mode;
    });
  });

  // Play/Pause simulation
  if (playToggleBtn) {
    playToggleBtn.addEventListener('click', () => {
      isPlaying = !isPlaying;
      playToggleBtn.textContent = isPlaying ? 'Simulate: Running' : 'Simulate: Paused';
      if (rateDisplay) {
        rateDisplay.textContent = isPlaying ? '96.0 kHz / 24-bit WASAPI' : 'Paused (0.0% CPU)';
      }
    });
  }

  let time = 0;

  function render() {
    const width = canvas.getBoundingClientRect().width;
    const height = canvas.getBoundingClientRect().height;

    ctx.clearRect(0, 0, width, height);

    time += 0.035;

    // Update synthetic frequencies
    for (let i = 0; i < barCount; i++) {
      if (isPlaying) {
        const bassBias = Math.exp(-i / 14);
        const wave = Math.sin(time * 3 + i * 0.25) * 0.35 + 0.45;
        const noise = Math.sin(time * 7 + i * 0.8) * 0.2;
        const target = Math.max(0.05, Math.min(0.95, (wave + noise) * (0.4 + bassBias * 0.6)));
        bars[i] += (target - bars[i]) * 0.18;
      } else {
        // Subtle resting idle breathing waveform when paused
        const idleWave = (Math.sin(time * 1.5 + i * 0.15) * 0.04 + 0.05);
        bars[i] += (idleWave - bars[i]) * 0.1;
      }

      // Ballistic Peak caps physics
      const barH = bars[i] * (height - 40);
      const targetCapY = height - barH - 8;

      if (targetCapY <= peakCaps[i].y) {
        peakCaps[i].y = targetCapY;
        peakCaps[i].vel = 0;
        peakCaps[i].hold = 12; // hold for 12 frames
      } else {
        if (peakCaps[i].hold > 0) {
          peakCaps[i].hold--;
        } else {
          peakCaps[i].vel += 0.38; // gravity
          peakCaps[i].y += peakCaps[i].vel;
          if (peakCaps[i].y > height - 8) {
            peakCaps[i].y = height - 8;
            peakCaps[i].vel = 0;
          }
        }
      }
    }

    // Render modes
    if (currentMode === 'peak-decay') {
      drawPeakDecay(width, height);
    } else if (currentMode === 'bilateral') {
      drawBilateralMirror(width, height);
    } else if (currentMode === 'oscilloscope') {
      drawOscilloscope(width, height);
    } else if (currentMode === 'radial') {
      drawRadialOrbit(width, height);
    } else if (currentMode === 'matrix') {
      drawPhosphorMatrix(width, height);
    }

    animationFrameId = requestAnimationFrame(render);
  }

  // 1. Peak Decay Mode
  function drawPeakDecay(w, h) {
    const gap = 3;
    const barW = (w - (barCount - 1) * gap - 32) / barCount;
    const startX = 16;

    for (let i = 0; i < barCount; i++) {
      const x = startX + i * (barW + gap);
      const barH = bars[i] * (h - 40);
      const y = h - 16 - barH;

      // Frequency bar
      const grad = ctx.createLinearGradient(0, y, 0, h - 16);
      grad.addColorStop(0, '#00e5ff');
      grad.addColorStop(0.7, '#00b8d4');
      grad.addColorStop(1, '#005566');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, [2, 2, 0, 0]);
      ctx.fill();

      // Amber ballistic peak cap
      ctx.fillStyle = '#e28c30';
      ctx.fillRect(x, peakCaps[i].y - 8, barW, 2.5);
    }
  }

  // 2. Bilateral Mirror Mode
  function drawBilateralMirror(w, h) {
    const centerY = h / 2;
    const gap = 3;
    const halfCount = Math.floor(barCount / 2);
    const barW = (w - (barCount - 1) * gap - 32) / barCount;
    const startX = 16;

    for (let i = 0; i < barCount; i++) {
      const x = startX + i * (barW + gap);
      const barH = (bars[i] * (h - 40)) / 2;

      ctx.fillStyle = '#00b8d4';
      // Upper half
      ctx.fillRect(x, centerY - barH, barW, barH);
      // Lower mirror
      ctx.fillStyle = '#007a8c';
      ctx.fillRect(x, centerY, barW, barH);
    }

    // Center divider rule
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, centerY);
    ctx.lineTo(w - 16, centerY);
    ctx.stroke();
  }

  // 3. Oscilloscope Wave Ribbon
  function drawOscilloscope(w, h) {
    const centerY = h / 2;

    // Background wave glow
    ctx.beginPath();
    ctx.moveTo(16, centerY);
    for (let i = 0; i < barCount; i++) {
      const x = 16 + (i / (barCount - 1)) * (w - 32);
      const wave = Math.sin(time * 4 + i * 0.3) * bars[i] * (h * 0.38);
      ctx.lineTo(x, centerY + wave);
    }
    ctx.strokeStyle = 'rgba(0, 184, 212, 0.3)';
    ctx.lineWidth = 6;
    ctx.stroke();

    // Foreground wave
    ctx.beginPath();
    ctx.moveTo(16, centerY);
    for (let i = 0; i < barCount; i++) {
      const x = 16 + (i / (barCount - 1)) * (w - 32);
      const wave = Math.sin(time * 4 + i * 0.3) * bars[i] * (h * 0.38);
      ctx.lineTo(x, centerY + wave);
    }
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // 4. Radial Orbit
  function drawRadialOrbit(w, h) {
    const centerX = w / 2;
    const centerY = h / 2;
    const baseRadius = Math.min(w, h) * 0.22;

    ctx.save();
    ctx.translate(centerX, centerY);

    for (let i = 0; i < barCount; i++) {
      const angle = (i / barCount) * Math.PI * 2;
      const barLen = bars[i] * 65;

      const x1 = Math.cos(angle) * baseRadius;
      const y1 = Math.sin(angle) * baseRadius;
      const x2 = Math.cos(angle) * (baseRadius + barLen);
      const y2 = Math.sin(angle) * (baseRadius + barLen);

      ctx.strokeStyle = '#00b8d4';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Center Core
    ctx.fillStyle = '#161a1f';
    ctx.strokeStyle = '#e28c30';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, baseRadius - 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  // 5. Phosphor LED Matrix
  function drawPhosphorMatrix(w, h) {
    const rows = 12;
    const gap = 4;
    const barW = (w - (barCount - 1) * gap - 32) / barCount;
    const dotH = (h - 40 - (rows - 1) * gap) / rows;
    const startX = 16;

    for (let col = 0; col < barCount; col++) {
      const x = startX + col * (barW + gap);
      const activeRows = Math.round(bars[col] * rows);

      for (let row = 0; row < rows; row++) {
        const y = h - 20 - (row + 1) * (dotH + gap);
        const isActive = row < activeRows;

        if (isActive) {
          ctx.fillStyle = row > 9 ? '#e28c30' : (row > 6 ? '#00e5ff' : '#00b8d4');
        } else {
          ctx.fillStyle = 'rgba(38, 46, 55, 0.4)';
        }

        ctx.fillRect(x, y, barW, dotH);
      }
    }
  }

  render();
}

/* ==========================================================================
   3. Interactive Feature Tabs
   ========================================================================== */
function initFeatureTabs() {
  const tabButtons = document.querySelectorAll('.tab-nav-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  if (!tabButtons.length) return;

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.tab;

      tabButtons.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      tabPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      const targetPanel = document.getElementById(targetId);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }
    });
  });
}

/* ==========================================================================
   4. Interactive FAQ Accordion
   ========================================================================== */
function initFaqAccordion() {
  const faqTriggers = document.querySelectorAll('.faq-trigger');

  faqTriggers.forEach(trigger => {
    trigger.addEventListener('click', () => {
      const item = trigger.closest('.faq-item');
      const isExpanded = trigger.getAttribute('aria-expanded') === 'true';

      // Toggle current item
      trigger.setAttribute('aria-expanded', String(!isExpanded));
      item.classList.toggle('is-open', !isExpanded);
    });
  });
}

/* ==========================================================================
   5. GDPR & CCPA Legal Cookie Consent Manager
   ========================================================================== */
function initCookieConsent() {
  const banner = document.getElementById('cookieBanner');
  const modalBackdrop = document.getElementById('cookieModalBackdrop');
  
  const acceptAllBtn = document.getElementById('cookieAcceptAll');
  const essentialOnlyBtn = document.getElementById('cookieEssentialOnly');
  const customizeBtn = document.getElementById('cookieCustomize');
  const savePreferencesBtn = document.getElementById('cookieSavePreferences');
  const closeModalBtn = document.getElementById('cookieCloseModal');
  const openSettingsFooterBtn = document.getElementById('openCookieSettings');

  const prefFunctionalCheckbox = document.getElementById('prefFunctional');
  const prefAnalyticsCheckbox = document.getElementById('prefAnalytics');

  const STORAGE_KEY = 'aideo_cookie_consent_v1';

  // Check saved state
  const savedConsent = localStorage.getItem(STORAGE_KEY);

  if (!savedConsent && banner) {
    // Show banner after brief delay
    setTimeout(() => {
      banner.classList.add('is-visible');
    }, 700);
  } else if (savedConsent) {
    try {
      const parsed = JSON.parse(savedConsent);
      if (prefFunctionalCheckbox) prefFunctionalCheckbox.checked = !!parsed.functional;
      if (prefAnalyticsCheckbox) prefAnalyticsCheckbox.checked = !!parsed.analytics;
    } catch {
      // invalid JSON, ignore
    }
  }

  function saveConsent(preferences) {
    const payload = {
      necessary: true, // Always required
      functional: !!preferences.functional,
      analytics: !!preferences.analytics,
      timestamp: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

    if (banner) banner.classList.remove('is-visible');
    if (modalBackdrop) modalBackdrop.classList.remove('is-open');
  }

  if (acceptAllBtn) {
    acceptAllBtn.addEventListener('click', () => {
      saveConsent({ functional: true, analytics: false }); // Analytics remains false as Aideo has zero tracking
    });
  }

  if (essentialOnlyBtn) {
    essentialOnlyBtn.addEventListener('click', () => {
      saveConsent({ functional: false, analytics: false });
    });
  }

  if (customizeBtn) {
    customizeBtn.addEventListener('click', () => {
      if (modalBackdrop) modalBackdrop.classList.add('is-open');
    });
  }

  if (closeModalBtn && modalBackdrop) {
    closeModalBtn.addEventListener('click', () => {
      modalBackdrop.classList.remove('is-open');
    });
  }

  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) {
        modalBackdrop.classList.remove('is-open');
      }
    });
  }

  if (savePreferencesBtn) {
    savePreferencesBtn.addEventListener('click', () => {
      const functional = prefFunctionalCheckbox ? prefFunctionalCheckbox.checked : false;
      const analytics = prefAnalyticsCheckbox ? prefAnalyticsCheckbox.checked : false;
      saveConsent({ functional, analytics });
    });
  }

  if (openSettingsFooterBtn) {
    openSettingsFooterBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (modalBackdrop) modalBackdrop.classList.add('is-open');
    });
  }
}
