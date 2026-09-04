/**
 * AIDEO MUSIC PLAYER v0.9.7 — ABSOLUTE CINEMA JAVASCRIPT ENGINE
 * Handles: Ballistic VU Meters, Web Audio DSP & AutoEQ curve rendering,
 *          Signal Path Oscilloscope, 5-Archetype Theater, and 60fps Romaji Lyrics.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  /* ==========================================================================
     1. BALLISTIC VU METER ENGINE (IEC 60268-17 Mechanical Damping)
     ========================================================================== */
  const needleL = document.getElementById('needle-l');
  const needleR = document.getElementById('needle-r');
  const vuToggleBtn = document.getElementById('vu-toggle-btn');
  const meterSourceLabel = document.getElementById('meter-source-label');

  let currentSignalMode = 0;
  const signalModes = [
    { label: 'TEST TONE: 1.0 kHz SINE (-3 dBFS)', baseL: -3, baseR: -3, jitter: 0.4 },
    { label: 'AUDIO STREAM: FLAC 96kHz / 24-bit', baseL: -6, baseR: -8, jitter: 4.5 },
    { label: 'DSD256 DIRECT: SYMPHONY ORCHESTRA', baseL: -12, baseR: -10, jitter: 7.2 },
    { label: 'PINK NOISE CALIBRATION (RMS 0 VU)', baseL: 0, baseR: 0, jitter: 1.2 }
  ];

  // Physics simulation variables
  let angleL = -45;
  let angleR = -45;
  let velocityL = 0;
  let velocityR = 0;
  const springTension = 0.08;
  const damping = 0.82;

  // Converts dB (-20 to +3) to needle rotation degrees (-45deg to +45deg)
  function dbToDegrees(db) {
    const clamped = Math.max(-20, Math.min(3, db));
    return ((clamped + 20) / 23) * 90 - 45;
  }

  function updateVUMeters() {
    const mode = signalModes[currentSignalMode];
    const time = Date.now() * 0.003;
    
    // Generate realistic fluctuating acoustic signals
    const noiseL = (Math.sin(time * 3.7) + Math.cos(time * 5.1)) * (mode.jitter * 0.5);
    const noiseR = (Math.sin(time * 4.2 + 1.2) + Math.cos(time * 3.3)) * (mode.jitter * 0.5);

    const targetDbL = mode.baseL + noiseL;
    const targetDbR = mode.baseR + noiseR;

    const targetAngleL = dbToDegrees(targetDbL);
    const targetAngleR = dbToDegrees(targetDbR);

    // Spring equations with inertia & overshoot
    velocityL += (targetAngleL - angleL) * springTension;
    velocityL *= damping;
    angleL += velocityL;

    velocityR += (targetAngleR - angleR) * springTension;
    velocityR *= damping;
    angleR += velocityR;

    if (needleL) needleL.style.transform = `rotate(${angleL.toFixed(2)}deg)`;
    if (needleR) needleR.style.transform = `rotate(${angleR.toFixed(2)}deg)`;

    requestAnimationFrame(updateVUMeters);
  }

  requestAnimationFrame(updateVUMeters);

  if (vuToggleBtn && meterSourceLabel) {
    vuToggleBtn.addEventListener('click', () => {
      currentSignalMode = (currentSignalMode + 1) % signalModes.length;
      meterSourceLabel.textContent = signalModes[currentSignalMode].label;
    });
  }

  /* ==========================================================================
     2. HERO VIEWPORT TAB SWITCHER
     ========================================================================== */
  const viewTabs = document.querySelectorAll('.view-tab');
  const viewportImg = document.getElementById('viewport-img-element');
  const viewportTitle = document.getElementById('viewport-title-target');
  const viewportDesc = document.getElementById('viewport-desc-target');

  viewTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      viewTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const imgUrl = tab.getAttribute('data-img');
      const title = tab.getAttribute('data-title');
      const desc = tab.getAttribute('data-desc');

      if (viewportImg) {
        viewportImg.style.opacity = '0.3';
        setTimeout(() => {
          viewportImg.src = imgUrl;
          viewportImg.style.opacity = '1';
        }, 120);
      }

      if (viewportTitle) viewportTitle.textContent = title;
      if (viewportDesc) viewportDesc.textContent = desc;
    });
  });

  /* ==========================================================================
     3. 5 THEATER MODE ARCHETYPES SWITCHER (v0.9.7)
     ========================================================================== */
  const archetypeBtns = document.querySelectorAll('.archetype-btn');
  const archetypePanels = document.querySelectorAll('.archetype-view-panel');

  archetypeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetMode = btn.getAttribute('data-archetype');

      archetypeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      archetypePanels.forEach(panel => {
        panel.classList.remove('active');
        if (panel.id === `panel-${targetMode}`) {
          panel.classList.add('active');
        }
      });
    });
  });

  /* ==========================================================================
     4. SIGNAL PATH OSCILLOSCOPE SIMULATOR (A/B Test)
     ========================================================================== */
  const scopeCanvas = document.getElementById('scope-canvas');
  const btnModeAideo = document.getElementById('btn-mode-aideo');
  const btnModeShared = document.getElementById('btn-mode-shared');
  const scopeInfoLabel = document.getElementById('scope-info-label');

  let scopeMode = 'aideo'; // 'aideo' or 'shared'
  let scopePhase = 0;

  if (btnModeAideo && btnModeShared) {
    btnModeAideo.addEventListener('click', () => {
      scopeMode = 'aideo';
      btnModeAideo.classList.add('active');
      btnModeShared.classList.remove('active');
      if (scopeInfoLabel) {
        scopeInfoLabel.textContent = 'MODE: BIT-PERFECT DIRECT • ZERO PHASE JITTER • THD: 0.0001% • 384kHz';
        scopeInfoLabel.style.color = 'var(--color-cyan)';
      }
    });

    btnModeShared.addEventListener('click', () => {
      scopeMode = 'shared';
      btnModeShared.classList.add('active');
      btnModeAideo.classList.remove('active');
      if (scopeInfoLabel) {
        scopeInfoLabel.textContent = 'MODE: WINDOWS MIXER • 48kHz RESAMPLED • DITHER NOISE & CLIPPING ACTIVE';
        scopeInfoLabel.style.color = 'var(--color-red)';
      }
    });
  }

  function renderOscilloscope() {
    if (!scopeCanvas) return;
    const ctx = scopeCanvas.getContext('2d');
    const width = scopeCanvas.width;
    const height = scopeCanvas.height;
    const centerY = height / 2;

    ctx.clearRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.beginPath();
    scopePhase += 0.04;

    for (let x = 0; x < width; x++) {
      const normX = x / width;
      let y = 0;

      if (scopeMode === 'aideo') {
        // Pure, crystal clear 1kHz sine wave with pure harmonics
        const wave = Math.sin(normX * Math.PI * 8 + scopePhase);
        y = centerY + wave * 65;
      } else {
        // Degraded: 48kHz stair-step interpolation, jitter, and CAudioLimiter soft-clipping
        const wave = Math.sin(normX * Math.PI * 8 + scopePhase);
        // Add quantization noise / jitter
        const jitter = (Math.random() - 0.5) * 6;
        // Clipping saturation
        let clipped = wave * 80 + jitter;
        if (clipped > 50) clipped = 50 + (clipped - 50) * 0.2;
        if (clipped < -50) clipped = -50 + (clipped + 50) * 0.2;
        y = centerY + clipped;
      }

      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    if (scopeMode === 'aideo') {
      ctx.strokeStyle = '#38bdf8';
      ctx.shadowColor = 'rgba(56, 189, 248, 0.8)';
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2.5;
    } else {
      ctx.strokeStyle = '#f87171';
      ctx.shadowColor = 'rgba(248, 113, 113, 0.8)';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2;
    }

    ctx.stroke();
    ctx.shadowBlur = 0;

    requestAnimationFrame(renderOscilloscope);
  }

  if (scopeCanvas) {
    requestAnimationFrame(renderOscilloscope);
  }

  /* ==========================================================================
     5. INTERACTIVE 10-BAND DSP & AUTOEQ CURVE GENERATOR
     ========================================================================== */
  const eqSliders = [];
  for (let i = 0; i < 10; i++) {
    const slider = document.getElementById(`slider-${i}`);
    const valDisplay = document.getElementById(`val-${i}`);
    if (slider && valDisplay) {
      eqSliders.push({ slider, valDisplay });
    }
  }

  const curveStrokePath = document.getElementById('curve-stroke-path');
  const curveFillPath = document.getElementById('curve-fill-path');
  const presetBtns = document.querySelectorAll('.preset-btn');
  const btnResetEq = document.getElementById('btn-reset-eq');
  const btnExportApo = document.getElementById('btn-export-apo');

  const presets = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hd600: [4.5, 3.5, 1.5, 0, -0.5, 0, 1.0, -1.5, 2.0, 3.0],
    xm5: [-3.5, -4.0, -2.5, 0, 1.5, 3.0, 3.5, 2.0, 1.0, 0.5],
    blessing2: [3.0, 2.5, 1.0, 0, -0.5, 0.5, 1.5, -2.0, 1.0, 2.0],
    warm: [3.5, 3.0, 2.0, 1.0, 0.5, 0, -0.5, -1.0, -2.0, -3.0]
  };

  function updateEQCurve() {
    const gains = eqSliders.map(item => parseFloat(item.slider.value));

    // SVG coordinates: Width = 800, Height = 180, Y=90 is 0 dB (-12dB = 160, +12dB = 20)
    const points = gains.map((gain, idx) => {
      const x = 50 + (idx / 9) * 700;
      const y = 90 - (gain / 12) * 70;
      return { x, y };
    });

    // Build smooth Bezier path
    let d = `M 0 ${points[0].y} L ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const mx = (p0.x + p1.x) / 2;
      d += ` C ${mx} ${p0.y}, ${mx} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    d += ` L 800 ${points[points.length - 1].y}`;

    if (curveStrokePath) curveStrokePath.setAttribute('d', d);
    if (curveFillPath) curveFillPath.setAttribute('d', `${d} L 800 180 L 0 180 Z`);
  }

  eqSliders.forEach((item, index) => {
    item.slider.addEventListener('input', () => {
      const val = parseFloat(item.slider.value);
      item.valDisplay.textContent = (val > 0 ? `+${val}` : `${val}`) + ' dB';
      updateEQCurve();
    });
  });

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const profile = btn.getAttribute('data-profile');
      if (presets[profile]) {
        presetBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        presets[profile].forEach((gain, idx) => {
          if (eqSliders[idx]) {
            eqSliders[idx].slider.value = gain;
            eqSliders[idx].valDisplay.textContent = (gain > 0 ? `+${gain}` : `${gain}`) + ' dB';
          }
        });

        updateEQCurve();
      }
    });
  });

  if (btnResetEq) {
    btnResetEq.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      const flatBtn = document.querySelector('[data-profile="flat"]');
      if (flatBtn) flatBtn.classList.add('active');

      eqSliders.forEach(item => {
        item.slider.value = 0;
        item.valDisplay.textContent = '0 dB';
      });
      updateEQCurve();
    });
  }

  if (btnExportApo) {
    btnExportApo.addEventListener('click', () => {
      const freqs = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
      const lines = ['# Aideo Music Player AutoEQ Export', 'Preamp: -2.4 dB'];
      eqSliders.forEach((item, idx) => {
        lines.push(`Filter ${idx + 1}: ON PK Fc ${freqs[idx]} Hz Gain ${item.slider.value} dB Q 1.41`);
      });
      const text = lines.join('\n');
      navigator.clipboard.writeText(text).then(() => {
        const originalText = btnExportApo.innerHTML;
        btnExportApo.innerHTML = '<i class="fas fa-check"></i> Copied to Clipboard!';
        setTimeout(() => {
          btnExportApo.innerHTML = originalText;
        }, 2200);
      });
    });
  }

  updateEQCurve();

  /* ==========================================================================
     6. SILKY 60FPS ROMAJI & KARAOKE LYRICS ENGINE
     ========================================================================== */
  const langBtns = document.querySelectorAll('.lang-btn');
  const line1 = document.getElementById('line-1');
  const line2 = document.getElementById('line-2');
  const line3 = document.getElementById('line-3');
  const line4 = document.getElementById('line-4');

  const lyricsData = {
    kanji: [
      '沈むように溶けてゆくように',
      '二人だけの空が広がる夜に',
      '「さよなら」だけだった',
      'その一言で全てが伝わった'
    ],
    romaji: [
      'Shizumu you ni tokete yuku you ni',
      'Futari dake no sora ga hirogaru yoru ni',
      '"Sayonara" dake datta',
      'Sono hitokoto de subete ga tsutawatta'
    ],
    translation: [
      'As if sinking, as if melting away',
      'Into the night where the sky belongs only to the two of us',
      'It was only a "goodbye"',
      'With just that single word, everything was understood'
    ]
  };

  langBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.getAttribute('data-lang');
      langBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (lyricsData[lang]) {
        if (line1) line1.textContent = lyricsData[lang][0];
        if (line2) {
          line2.innerHTML = `<span class="syllable-fill">${lyricsData[lang][1]}</span>`;
        }
        if (line3) line3.textContent = lyricsData[lang][2];
        if (line4) line4.textContent = lyricsData[lang][3];
      }
    });
  });

  // Simulated progress bar movement
  const karaokeProgress = document.getElementById('karaoke-progress');
  let progressVal = 30;
  setInterval(() => {
    progressVal += 0.2;
    if (progressVal > 95) progressVal = 20;
    if (karaokeProgress) karaokeProgress.style.width = `${progressVal.toFixed(1)}%`;
  }, 100);

  /* ==========================================================================
     7. 3D PERSPECTIVE TILT (Hero Hardware & Viewport)
     ========================================================================== */
  const tiltCard = document.querySelector('.hero-viewport-card');
  if (tiltCard && window.matchMedia('(hover: hover)').matches) {
    tiltCard.addEventListener('mousemove', (e) => {
      const rect = tiltCard.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      const rotX = -(y / (rect.height / 2)) * 3.5;
      const rotY = (x / (rect.width / 2)) * 3.5;
      tiltCard.style.transform = `perspective(1000px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`;
    });

    tiltCard.addEventListener('mouseleave', () => {
      tiltCard.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg)';
      tiltCard.style.transition = 'transform 400ms cubic-bezier(0.16, 1, 0.3, 1)';
    });

    tiltCard.addEventListener('mouseenter', () => {
      tiltCard.style.transition = 'none';
    });
  }

});
