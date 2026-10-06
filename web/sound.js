/* ============================================================================
   TPSound — satisfying UI sounds (buttons, typing, toggles, toasts)
   ----------------------------------------------------------------------------
   Everything is synthesized with the Web Audio API: no asset files, no network.
   The AudioContext is created lazily on the first user gesture (autoplay rules),
   and every sound is short, quiet and low-latency so it feels like a soft
   mechanical keyboard rather than a beep-fest.

   Mute state lives in localStorage ('tp.sound.muted') and the status-bar
   #sound-toggle button reflects it. Public API: globalThis.TPSound.
   ========================================================================== */
(function () {
  'use strict';

  var MUTE_KEY = 'tp.sound.muted';
  var TYPE_THROTTLE_MS = 28;

  var ctx = null;
  var master = null;
  var noiseBuf = null;
  var lastType = 0;
  var muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* private mode */ }

  /* ---- low-level ---------------------------------------------------------- */

  function ensureCtx() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    return ctx;
  }

  function noiseBuffer(c) {
    if (noiseBuf) return noiseBuf;
    var len = Math.floor(c.sampleRate * 0.12);
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    var data = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  /** Short filtered noise burst — the "body" of a key press. */
  function burst(freq, dur, vol, q) {
    var c = ensureCtx(); if (!c) return;
    var t = c.currentTime;
    var src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    var bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q || 1.1;
    var g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.05);
    src.stop(t + dur + 0.02);
  }

  /** Pitched tone with an exponential frequency glide — the "thock". */
  function tone(f0, f1, dur, vol, type, delay) {
    var c = ensureCtx(); if (!c) return;
    var t = c.currentTime + (delay || 0);
    var osc = c.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  /* ---- sound recipes ------------------------------------------------------ */

  var recipes = {
    /* Soft mechanical "thock": low pitch drop + a crisp top-end tick. */
    click: function () {
      tone(260, 120, 0.055, 0.30, 'sine');
      burst(1900, 0.012, 0.16, 1.3);
    },
    /* Lighter, higher tick for individual keystrokes. */
    type: function () {
      tone(430, 260, 0.030, 0.13, 'sine');
      burst(3000, 0.007, 0.10, 1.6);
    },
    /* Two-note upward pop for checkboxes / switches. */
    toggle: function () {
      tone(620, 660, 0.045, 0.16, 'triangle', 0);
      tone(880, 940, 0.055, 0.14, 'triangle', 0.042);
    },
    /* Quiet three-note chime for success toasts. */
    ok: function () {
      tone(660, 662, 0.09, 0.10, 'sine', 0);
      tone(880, 882, 0.09, 0.10, 'sine', 0.07);
      tone(1174, 1176, 0.14, 0.09, 'sine', 0.14);
    },
    /* Low double-thud for errors. */
    err: function () {
      tone(220, 150, 0.10, 0.22, 'triangle', 0);
      tone(180, 120, 0.14, 0.20, 'triangle', 0.10);
    },
    /* Mid warning blip. */
    warn: function () {
      tone(520, 470, 0.12, 0.16, 'triangle');
    }
  };

  function play(kind) {
    if (muted) return;
    var fn = recipes[kind] || recipes.click;
    try {
      // Sound functions call ensureCtx() themselves; a missing/gesture-blocked
      // context simply results in silence — never an exception.
      fn();
    } catch (e) { /* audio unavailable */ }
  }

  /* ---- public API --------------------------------------------------------- */

  function setMuted(next) {
    muted = !!next;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* quota */ }
    paintToggle();
  }

  function paintToggle() {
    var btn = document.getElementById('sound-toggle');
    if (!btn) return;
    btn.innerHTML = muted
      ? '<i data-lucide="volume-x" class="w-3.5 h-3.5"></i>'
      : '<i data-lucide="volume-2" class="w-3.5 h-3.5"></i>';
    btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    btn.title = muted ? 'Sounds are off — click to enable' : 'Sounds are on — click to mute';
    if (window.lucide && typeof lucide.createIcons === 'function') {
      try { lucide.createIcons(); } catch (e) { /* icons optional */ }
    }
  }

  globalThis.TPSound = {
    play: play,
    toast: function (kind) { play(kind === 'err' ? 'err' : kind === 'warn' ? 'warn' : 'ok'); },
    isMuted: function () { return muted; },
    setMuted: setMuted,
    toggleMute: function () {
      setMuted(!muted);
      if (!muted) play('toggle'); // audition the sound you just re-enabled
    }
  };

  /* ---- global hooks ------------------------------------------------------- */

  function isToggleEl(el) {
    return !!(
      el.closest('input[type="checkbox"]') ||
      el.closest('[role="switch"]') ||
      el.closest('.tick') ||
      el.closest('.chip')
    );
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#sound-toggle')) return; // handled by its own wiring
    var interactive = t.closest('button, a[href], [role="button"], .tab-btn, .stepper-btn, select, input[type="radio"]');
    if (!interactive) return;
    if (interactive.disabled) return;
    play(isToggleEl(t) ? 'toggle' : 'click');
  }, { passive: true });

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (!t || !t.matches) return;
    var typing = t.matches('input, textarea, [contenteditable="true"]');
    if (!typing) return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].indexOf(e.key) !== -1) return;
    var now = Date.now();
    if (now - lastType < TYPE_THROTTLE_MS) return;
    lastType = now;
    play('type');
  }, { passive: true });

  /* First gesture also unlocks the AudioContext so the very first click
     already makes a sound instead of being swallowed. */
  document.addEventListener('pointerdown', function once() {
    ensureCtx();
    document.removeEventListener('pointerdown', once);
  }, { passive: true });

  /* ---- wire the status-bar mute button ------------------------------------ */
  function wireToggle() {
    var btn = document.getElementById('sound-toggle');
    if (!btn) return false;
    btn.addEventListener('click', function () { globalThis.TPSound.toggleMute(); });
    paintToggle();
    return true;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { wireToggle(); });
  } else {
    wireToggle();
  }
})();
