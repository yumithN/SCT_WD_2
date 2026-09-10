/**
 * Chronos Stopwatch — Core Logic & Interactive Controller
 * Precision timing, Web Audio API synthesis, lap tracking, and export utilities.
 */

(() => {
  'use strict';

  // ==========================================
  // DOM Elements
  // ==========================================
  const hoursDisplay = document.getElementById('hours-display');
  const minutesDisplay = document.getElementById('minutes-display');
  const secondsDisplay = document.getElementById('seconds-display');
  const millisecondsDisplay = document.getElementById('milliseconds-display');
  const currentLapTimeDisplay = document.getElementById('current-lap-time');
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');

  const startBtn = document.getElementById('start-btn');
  const startBtnLabel = document.getElementById('start-btn-label');
  const iconPlay = document.querySelector('.icon-play');
  const iconPause = document.querySelector('.icon-pause');
  const lapBtn = document.getElementById('lap-btn');
  const resetBtn = document.getElementById('reset-btn');

  const ringProgress = document.getElementById('ring-progress');
  const dialTicksGroup = document.getElementById('dial-ticks');

  const lapList = document.getElementById('lap-list');
  const emptyState = document.getElementById('empty-state');
  const lapCounter = document.getElementById('lap-counter');
  const copyLapsBtn = document.getElementById('copy-laps-btn');
  const exportCsvBtn = document.getElementById('export-csv-btn');

  const statFastest = document.getElementById('stat-fastest');
  const statSlowest = document.getElementById('stat-slowest');
  const statAverage = document.getElementById('stat-average');

  const soundToggleBtn = document.getElementById('sound-toggle-btn');
  const soundOnIcon = document.querySelector('.sound-on');
  const soundOffIcon = document.querySelector('.sound-off');

  const shortcutsBtn = document.getElementById('shortcuts-toggle-btn');
  const shortcutsModal = document.getElementById('shortcuts-modal');
  const modalCloseBtn = document.getElementById('modal-close-btn');

  const themeSelector = document.getElementById('theme-selector');
  const toastContainer = document.getElementById('toast-container');

  // ==========================================
  // Constants & State Variables
  // ==========================================
  const CIRCUMFERENCE = 2 * Math.PI * 140; // r = 140 => ~879.6459
  ringProgress.style.strokeDasharray = `${CIRCUMFERENCE}`;
  ringProgress.style.strokeDashoffset = `${CIRCUMFERENCE}`;

  // Stopwatch States
  const STATES = {
    STOPPED: 'STOPPED',
    RUNNING: 'RUNNING',
    PAUSED: 'PAUSED'
  };

  let currentState = STATES.STOPPED;
  let startTime = 0;
  let accumulatedTime = 0;
  let lastLapTimestamp = 0;
  let animationFrameId = null;
  let intervalFallbackId = null;

  // Recorded Laps: array of { id, splitTime, overallTime }
  let laps = [];

  // Sound AudioContext
  let soundEnabled = true;
  let audioCtx = null;

  // ==========================================
  // Web Audio Synthesizer
  // ==========================================
  function initAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function playTone(freq, type = 'sine', duration = 0.08, gainVal = 0.15) {
    if (!soundEnabled) return;
    try {
      initAudioContext();
      if (!audioCtx) return;

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

      gain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
      console.warn('Audio playback error:', e);
    }
  }

  function soundStart() {
    playTone(587.33, 'sine', 0.09, 0.15); // D5
    setTimeout(() => playTone(880, 'sine', 0.12, 0.18), 70); // A5
  }

  function soundPause() {
    playTone(659.25, 'triangle', 0.08, 0.15); // E5
    setTimeout(() => playTone(440, 'triangle', 0.12, 0.15), 60); // A4
  }

  function soundLap() {
    playTone(1046.5, 'sine', 0.06, 0.2); // C6
  }

  function soundReset() {
    playTone(392, 'sine', 0.08, 0.12);
    setTimeout(() => playTone(261.63, 'sine', 0.14, 0.12), 60);
  }

  // ==========================================
  // Render Dial Ticks
  // ==========================================
  function generateDialTicks() {
    const totalTicks = 60;
    const center = 160;
    const radius = 140;
    let ticksHtml = '';

    for (let i = 0; i < totalTicks; i++) {
      const angleDeg = (i * 360) / totalTicks - 90; // Start at 12 o'clock
      const angleRad = (angleDeg * Math.PI) / 180;
      const isMajor = i % 5 === 0;
      const tickLength = isMajor ? 10 : 5;

      const x1 = center + (radius - 12) * Math.cos(angleRad);
      const y1 = center + (radius - 12) * Math.sin(angleRad);
      const x2 = center + (radius - 12 - tickLength) * Math.cos(angleRad);
      const y2 = center + (radius - 12 - tickLength) * Math.sin(angleRad);

      const className = isMajor ? 'dial-tick major' : 'dial-tick';
      ticksHtml += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" class="${className}" />`;
    }

    dialTicksGroup.innerHTML = ticksHtml;
  }

  // ==========================================
  // High-Precision Time Utilities
  // ==========================================
  function formatTime(totalMilliseconds) {
    const totalSeconds = Math.floor(totalMilliseconds / 1000);
    const ms = Math.floor((totalMilliseconds % 1000) / 10); // Centiseconds (0-99)
    const secs = totalSeconds % 60;
    const mins = Math.floor(totalSeconds / 60) % 60;
    const hrs = Math.floor(totalSeconds / 3600);

    const pad = (n) => String(n).padStart(2, '0');

    return {
      hrs: pad(hrs),
      mins: pad(mins),
      secs: pad(secs),
      ms: pad(ms),
      totalMs: totalMilliseconds,
      formatted: `${hrs > 0 ? pad(hrs) + ':' : ''}${pad(mins)}:${pad(secs)}.${pad(ms)}`,
      fullFormatted: `${pad(hrs)}:${pad(mins)}:${pad(secs)}.${pad(ms)}`
    };
  }

  function getElapsedTime() {
    if (currentState === STATES.RUNNING) {
      return accumulatedTime + (performance.now() - startTime);
    }
    return accumulatedTime;
  }

  // ==========================================
  // Display & UI Updates
  // ==========================================
  function updateTimerUI(elapsedMs) {
    const t = formatTime(elapsedMs);

    hoursDisplay.textContent = t.hrs;
    minutesDisplay.textContent = t.mins;
    secondsDisplay.textContent = t.secs;
    millisecondsDisplay.textContent = t.ms;

    // Update Current Lap Time
    const currentLapMs = elapsedMs - lastLapTimestamp;
    const lapT = formatTime(currentLapMs);
    currentLapTimeDisplay.textContent = lapT.fullFormatted;

    // Circular Progress Ring (60-second cycle)
    const secondsCycle = (elapsedMs % 60000) / 60000;
    const offset = CIRCUMFERENCE * (1 - secondsCycle);
    ringProgress.style.strokeDashoffset = `${offset}`;
  }

  function tick() {
    if (currentState === STATES.RUNNING) {
      const elapsed = getElapsedTime();
      updateTimerUI(elapsed);
      animationFrameId = requestAnimationFrame(tick);
    }
  }

  function updateStatusUI() {
    statusIndicator.className = 'status-indicator';

    if (currentState === STATES.STOPPED) {
      statusIndicator.classList.add('stopped');
      statusText.textContent = 'READY';

      startBtnLabel.textContent = 'Start';
      iconPlay.classList.remove('hidden');
      iconPause.classList.add('hidden');
      startBtn.classList.remove('paused-state');

      lapBtn.disabled = true;
      resetBtn.disabled = true;
    } else if (currentState === STATES.RUNNING) {
      statusIndicator.classList.add('running');
      statusText.textContent = 'RUNNING';

      startBtnLabel.textContent = 'Pause';
      iconPlay.classList.add('hidden');
      iconPause.classList.remove('hidden');
      startBtn.classList.remove('paused-state');

      lapBtn.disabled = false;
      resetBtn.disabled = true;
    } else if (currentState === STATES.PAUSED) {
      statusIndicator.classList.add('paused');
      statusText.textContent = 'PAUSED';

      startBtnLabel.textContent = 'Resume';
      iconPlay.classList.remove('hidden');
      iconPause.classList.add('hidden');
      startBtn.classList.add('paused-state');

      lapBtn.disabled = true;
      resetBtn.disabled = false;
    }
  }

  // ==========================================
  // Core Stopwatch Actions
  // ==========================================
  function startStopwatch() {
    if (currentState === STATES.RUNNING) return;

    initAudioContext();
    soundStart();

    startTime = performance.now();
    currentState = STATES.RUNNING;
    updateStatusUI();

    animationFrameId = requestAnimationFrame(tick);

    // Backup interval for background tab throttling
    if (!intervalFallbackId) {
      intervalFallbackId = setInterval(() => {
        if (currentState === STATES.RUNNING) {
          updateTimerUI(getElapsedTime());
        }
      }, 100);
    }
  }

  function pauseStopwatch() {
    if (currentState !== STATES.RUNNING) return;

    soundPause();

    accumulatedTime += performance.now() - startTime;
    currentState = STATES.PAUSED;
    updateStatusUI();

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (intervalFallbackId) {
      clearInterval(intervalFallbackId);
      intervalFallbackId = null;
    }

    updateTimerUI(accumulatedTime);
  }

  function toggleStartPause() {
    if (currentState === STATES.RUNNING) {
      pauseStopwatch();
    } else {
      startStopwatch();
    }
  }

  function resetStopwatch() {
    if (currentState === STATES.RUNNING) return;

    soundReset();

    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (intervalFallbackId) clearInterval(intervalFallbackId);

    currentState = STATES.STOPPED;
    startTime = 0;
    accumulatedTime = 0;
    lastLapTimestamp = 0;
    laps = [];

    updateTimerUI(0);
    updateStatusUI();
    renderLaps();
    updateLapStatistics();

    ringProgress.style.strokeDashoffset = `${CIRCUMFERENCE}`;
    showToast('Stopwatch reset to zero');
  }

  function recordLap() {
    if (currentState !== STATES.RUNNING) return;

    soundLap();

    const currentTotalMs = getElapsedTime();
    const splitMs = currentTotalMs - lastLapTimestamp;
    lastLapTimestamp = currentTotalMs;

    const newLap = {
      id: laps.length + 1,
      splitTime: splitMs,
      overallTime: currentTotalMs
    };

    laps.unshift(newLap); // Insert newest at the top
    renderLaps();
    updateLapStatistics();
  }

  // ==========================================
  // Lap Rendering & Analytics
  // ==========================================
  function updateLapStatistics() {
    const count = laps.length;
    lapCounter.textContent = `${count} Lap${count === 1 ? '' : 's'}`;

    copyLapsBtn.disabled = count === 0;
    exportCsvBtn.disabled = count === 0;

    if (count === 0) {
      statFastest.textContent = '--:--.--';
      statSlowest.textContent = '--:--.--';
      statAverage.textContent = '--:--.--';
      return;
    }

    let minSplit = Infinity;
    let maxSplit = -Infinity;
    let totalSplit = 0;

    laps.forEach(lap => {
      if (lap.splitTime < minSplit) minSplit = lap.splitTime;
      if (lap.splitTime > maxSplit) maxSplit = lap.splitTime;
      totalSplit += lap.splitTime;
    });

    const avgSplit = totalSplit / count;

    statFastest.textContent = formatTime(minSplit).formatted;
    statSlowest.textContent = formatTime(maxSplit).formatted;
    statAverage.textContent = formatTime(avgSplit).formatted;
  }

  function renderLaps() {
    if (laps.length === 0) {
      emptyState.classList.remove('hidden');
      lapList.innerHTML = '';
      return;
    }

    emptyState.classList.add('hidden');

    // Determine min and max split for badges (only when 2+ laps)
    let minSplit = Infinity;
    let maxSplit = -Infinity;

    if (laps.length >= 2) {
      laps.forEach(lap => {
        if (lap.splitTime < minSplit) minSplit = lap.splitTime;
        if (lap.splitTime > maxSplit) maxSplit = lap.splitTime;
      });
    }

    lapList.innerHTML = laps.map(lap => {
      const isFastest = laps.length >= 2 && lap.splitTime === minSplit;
      const isSlowest = laps.length >= 2 && lap.splitTime === maxSplit;

      let badgeHtml = '';
      let rowClass = 'lap-item';

      if (isFastest) {
        rowClass += ' fastest';
        badgeHtml = '<span class="lap-badge fastest-badge">Fast</span>';
      } else if (isSlowest) {
        rowClass += ' slowest';
        badgeHtml = '<span class="lap-badge slowest-badge">Slow</span>';
      }

      const splitFormatted = formatTime(lap.splitTime).fullFormatted;
      const totalFormatted = formatTime(lap.overallTime).fullFormatted;

      return `
        <li class="${rowClass}">
          <div class="lap-num-wrap">
            <span class="lap-num">#${String(lap.id).padStart(2, '0')}</span>
            ${badgeHtml}
          </div>
          <span class="lap-split">+${splitFormatted}</span>
          <span class="lap-total">${totalFormatted}</span>
        </li>
      `;
    }).join('');
  }

  // ==========================================
  // Data Export & Copy Utilities
  // ==========================================
  function copyLapsToClipboard() {
    if (laps.length === 0) return;

    let minSplit = Infinity;
    let maxSplit = -Infinity;
    if (laps.length >= 2) {
      laps.forEach(l => {
        if (l.splitTime < minSplit) minSplit = l.splitTime;
        if (l.splitTime > maxSplit) maxSplit = l.splitTime;
      });
    }

    const sortedChronological = [...laps].sort((a, b) => a.id - b.id);

    let text = `CHRONOS STOPWATCH — LAP REPORT\n`;
    text += `Recorded: ${new Date().toLocaleString()}\n`;
    text += `Total Laps: ${laps.length}\n`;
    text += `--------------------------------------------------\n`;
    text += `Lap #   | Split Time      | Overall Time    | Note\n`;
    text += `--------------------------------------------------\n`;

    sortedChronological.forEach(lap => {
      const isFastest = laps.length >= 2 && lap.splitTime === minSplit;
      const isSlowest = laps.length >= 2 && lap.splitTime === maxSplit;
      const note = isFastest ? '[FASTEST]' : isSlowest ? '[SLOWEST]' : '';
      const splitFmt = formatTime(lap.splitTime).fullFormatted;
      const totalFmt = formatTime(lap.overallTime).fullFormatted;

      text += `Lap ${String(lap.id).padStart(2, ' ')}  | +${splitFmt} | ${totalFmt} | ${note}\n`;
    });

    text += `--------------------------------------------------\n`;
    text += `Fastest: ${statFastest.textContent} | Slowest: ${statSlowest.textContent} | Average: ${statAverage.textContent}\n`;

    navigator.clipboard.writeText(text).then(() => {
      showToast('Lap records copied to clipboard!');
    }).catch(err => {
      console.error('Clipboard copy failed:', err);
      showToast('Could not copy to clipboard');
    });
  }

  function exportLapsToCsv() {
    if (laps.length === 0) return;

    const sortedChronological = [...laps].sort((a, b) => a.id - b.id);
    let csv = 'Lap Number,Split Time (Formatted),Overall Time (Formatted),Split Time (ms),Overall Time (ms)\n';

    sortedChronological.forEach(lap => {
      const splitFmt = formatTime(lap.splitTime).fullFormatted;
      const totalFmt = formatTime(lap.overallTime).fullFormatted;
      csv += `${lap.id},"${splitFmt}","${totalFmt}",${lap.splitTime.toFixed(2)},${lap.overallTime.toFixed(2)}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    link.setAttribute('href', url);
    link.setAttribute('download', `chronos-stopwatch-laps-${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('CSV export downloaded!');
  }

  // ==========================================
  // Toast Notification System
  // ==========================================
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
      <span>${message}</span>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-out');
      toast.addEventListener('animationend', () => toast.remove());
    }, 2500);
  }

  // ==========================================
  // Themes & Preferences
  // ==========================================
  const themes = ['cyan', 'emerald', 'purple', 'amber'];
  let currentThemeIndex = 0;

  function setTheme(themeName) {
    document.documentElement.setAttribute('data-theme', themeName);
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === themeName);
    });
    currentThemeIndex = themes.indexOf(themeName);
    if (currentThemeIndex === -1) currentThemeIndex = 0;
  }

  function cycleTheme() {
    currentThemeIndex = (currentThemeIndex + 1) % themes.length;
    const nextTheme = themes[currentThemeIndex];
    setTheme(nextTheme);
    showToast(`Theme changed to ${nextTheme.charAt(0).toUpperCase() + nextTheme.slice(1)}`);
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    soundOnIcon.classList.toggle('hidden', !soundEnabled);
    soundOffIcon.classList.toggle('hidden', soundEnabled);
    showToast(soundEnabled ? 'Sound feedback enabled' : 'Sound feedback muted');
  }

  // ==========================================
  // Keyboard Shortcuts Handler
  // ==========================================
  function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Ignore keystrokes inside modals or input fields if any exist
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault(); // Prevent accidental scroll
        toggleStartPause();
      } else if (e.code === 'KeyL') {
        e.preventDefault();
        if (currentState === STATES.RUNNING) {
          recordLap();
        }
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        if (currentState === STATES.PAUSED || (currentState === STATES.STOPPED && accumulatedTime > 0)) {
          resetStopwatch();
        }
      } else if (e.code === 'KeyT') {
        e.preventDefault();
        cycleTheme();
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        toggleSound();
      } else if (e.code === 'Escape') {
        if (!shortcutsModal.classList.contains('hidden')) {
          shortcutsModal.classList.add('hidden');
        }
      }
    });
  }

  // ==========================================
  // Event Listeners Setup
  // ==========================================
  function initEventListeners() {
    startBtn.addEventListener('click', toggleStartPause);
    lapBtn.addEventListener('click', recordLap);
    resetBtn.addEventListener('click', resetStopwatch);

    copyLapsBtn.addEventListener('click', copyLapsToClipboard);
    exportCsvBtn.addEventListener('click', exportLapsToCsv);

    soundToggleBtn.addEventListener('click', toggleSound);

    // Theme selector buttons
    themeSelector.addEventListener('click', (e) => {
      const btn = e.target.closest('.theme-btn');
      if (btn && btn.dataset.color) {
        setTheme(btn.dataset.color);
      }
    });

    // Shortcuts modal open/close
    shortcutsBtn.addEventListener('click', () => {
      shortcutsModal.classList.remove('hidden');
    });

    modalCloseBtn.addEventListener('click', () => {
      shortcutsModal.classList.add('hidden');
    });

    shortcutsModal.addEventListener('click', (e) => {
      if (e.target === shortcutsModal) {
        shortcutsModal.classList.add('hidden');
      }
    });

    setupKeyboardShortcuts();
  }

  // ==========================================
  // Initialization
  // ==========================================
  function init() {
    generateDialTicks();
    updateTimerUI(0);
    updateStatusUI();
    initEventListeners();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
