/*
 * Block Color Puzzle - feel layer
 * -------------------------------
 * Sound, haptics and confetti. No audio or image assets: every sound is
 * synthesised with WebAudio and the confetti is drawn on a canvas.
 *
 * Exposes window.BCPFX.
 */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------------- sound ---------------- */

  let ctx = null;
  let master = null;

  const sound = {
    enabled: true,

    // The context can only start inside a user gesture, so build it lazily.
    ready() {
      if (!this.enabled) return false;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;

      if (!ctx) {
        try { ctx = new AC(); } catch { return false; }
        master = ctx.createGain();
        master.gain.value = 0.32;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx.state !== 'closed';
    },

    tone({ freq, type = 'triangle', dur = 0.09, gain = 0.6, delay = 0, sweep = 0 }) {
      if (!this.ready()) return;
      const t0 = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t0 + dur);

      // Fast attack, exponential tail - reads as a percussive click rather than a beep.
      amp.gain.setValueAtTime(0.0001, t0);
      amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(amp);
      amp.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },

    // Sliding a longer run sounds higher and brighter.
    slide(run = 1) {
      const n = Math.min(run, 5);
      this.tone({ freq: 300 + n * 55, type: 'triangle', dur: 0.075, gain: 0.5, sweep: 90 });
      if (n > 1) this.tone({ freq: 420 + n * 70, type: 'sine', dur: 0.06, gain: 0.22, delay: 0.035 });
    },

    bump() {
      this.tone({ freq: 150, type: 'sawtooth', dur: 0.13, gain: 0.35, sweep: -70 });
    },

    click() {
      this.tone({ freq: 520, type: 'sine', dur: 0.05, gain: 0.3 });
    },

    win() {
      [0, 4, 7, 12].forEach((semi, i) => {
        this.tone({
          freq: 392 * Math.pow(2, semi / 12),
          type: 'triangle',
          dur: 0.32,
          gain: 0.45,
          delay: i * 0.1
        });
      });
    }
  };

  /* ---------------- haptics ---------------- */

  const haptics = {
    enabled: true,
    supported: typeof navigator.vibrate === 'function',

    buzz(pattern) {
      if (!this.enabled || !this.supported) return;
      try { navigator.vibrate(pattern); } catch { /* not permitted */ }
    },

    slide(run = 1) { this.buzz(Math.min(6 + run * 3, 22)); },
    bump()         { this.buzz([14, 40, 14]); },
    win()          { this.buzz([0, 45, 70, 45, 70, 110]); }
  };

  /* ---------------- confetti ---------------- */

  const confetti = {
    canvas: null,
    ctx2d: null,
    parts: [],
    raf: 0,

    attach(canvas) {
      this.canvas = canvas;
      this.ctx2d = canvas.getContext('2d');
    },

    resize() {
      if (!this.canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = this.canvas.getBoundingClientRect();
      this.canvas.width = Math.round(r.width * dpr);
      this.canvas.height = Math.round(r.height * dpr);
      this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      return r;
    },

    burst(colors) {
      if (!this.canvas || reduceMotion.matches) return;
      const r = this.resize();
      if (!r || !r.width) return;

      const originX = r.width / 2;
      const originY = r.height * 0.42;
      this.parts = [];

      for (let i = 0; i < 110; i++) {
        // Fan the burst upward and outward from the middle of the board.
        const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 2.2;
        const speed = 3.2 + Math.random() * 5.4;
        this.parts.push({
          x: originX + (Math.random() - 0.5) * r.width * 0.35,
          y: originY + (Math.random() - 0.5) * 24,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          w: 5 + Math.random() * 6,
          h: 8 + Math.random() * 8,
          spin: (Math.random() - 0.5) * 0.34,
          rot: Math.random() * Math.PI,
          colour: colors[i % colors.length],
          life: 1
        });
      }

      cancelAnimationFrame(this.raf);
      this.tick();
    },

    tick() {
      const c = this.ctx2d;
      const r = this.canvas.getBoundingClientRect();
      c.clearRect(0, 0, r.width, r.height);

      const alive = [];
      for (const p of this.parts) {
        p.vy += 0.16;          // gravity
        p.vx *= 0.995;         // air drag
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.spin;
        if (p.y > r.height * 0.55) p.life -= 0.016;
        if (p.life <= 0 || p.y > r.height + 40) continue;

        alive.push(p);
        c.save();
        c.globalAlpha = Math.max(0, p.life);
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.fillStyle = p.colour;
        c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        c.restore();
      }

      this.parts = alive;
      if (alive.length > 0) this.raf = requestAnimationFrame(() => this.tick());
      else c.clearRect(0, 0, r.width, r.height);
    },

    clear() {
      cancelAnimationFrame(this.raf);
      this.parts = [];
      if (this.ctx2d && this.canvas) {
        const r = this.canvas.getBoundingClientRect();
        this.ctx2d.clearRect(0, 0, r.width, r.height);
      }
    }
  };

  window.BCPFX = { sound, haptics, confetti, reduceMotion };
})();
