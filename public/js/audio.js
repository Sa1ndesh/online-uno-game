/* ==========================================================================
   UNO AUDIO SYNTHESIZER - WEB AUDIO API
   ========================================================================== */

const UnoAudio = {
  enabled: true,
  ctx: null,

  init() {
    // Lazy initialize audio context on first user interaction
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Load enabled preference
    const saved = localStorage.getItem('uno_sound_enabled');
    this.enabled = saved !== null ? saved === 'true' : true;
    return this.enabled;
  },

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('uno_sound_enabled', this.enabled);
    return this.enabled;
  },

  createOscillator(type, freq, duration, gainStart, sweepEndFreq = null) {
    if (!this.enabled) return;
    this.init();

    // Resume context if suspended (browser security)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

    if (sweepEndFreq !== null) {
      osc.frequency.exponentialRampToValueAtTime(sweepEndFreq, this.ctx.currentTime + duration);
    }

    gainNode.gain.setValueAtTime(gainStart, this.ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);

    osc.connect(gainNode);
    gainNode.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  },

  playSlide() {
    // Card slide/deal sound
    this.createOscillator('triangle', 350, 0.12, 0.3, 700);
  },

  playDraw() {
    // Card draw sound (soft sweep down)
    this.createOscillator('triangle', 600, 0.15, 0.25, 300);
  },

  playSkip() {
    // Double high beep skips turn
    const now = this.ctx ? this.ctx.currentTime : 0;
    this.createOscillator('sine', 880, 0.08, 0.15);
    setTimeout(() => {
      this.createOscillator('sine', 1200, 0.1, 0.15);
    }, 90);
  },

  playReverse() {
    // Laser whoosh sound for reverse direction
    this.createOscillator('sine', 900, 0.25, 0.2, 150);
  },

  playWild() {
    // Dreamy rising arpeggio for Wilds
    const notes = [440, 554, 659, 880];
    notes.forEach((freq, idx) => {
      setTimeout(() => {
        this.createOscillator('triangle', freq, 0.18, 0.2);
      }, idx * 60);
    });
  },

  playUnoAlert() {
    // High alert horn chime
    const now = this.ctx ? this.ctx.currentTime : 0;
    this.createOscillator('sawtooth', 750, 0.15, 0.18);
    this.createOscillator('sine', 1000, 0.15, 0.12);
    
    setTimeout(() => {
      this.createOscillator('sawtooth', 750, 0.2, 0.18);
      this.createOscillator('sine', 1000, 0.2, 0.12);
    }, 120);
  },

  playChallengeChime() {
    // High alert whistle
    this.createOscillator('sine', 1320, 0.1, 0.2, 2200);
    setTimeout(() => {
      this.createOscillator('sine', 2200, 0.15, 0.2, 1320);
    }, 80);
  },

  playWin() {
    // Beautiful happy C-Major arpeggio celebration fanfare
    const arpeggio = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50];
    arpeggio.forEach((freq, idx) => {
      setTimeout(() => {
        this.createOscillator('sine', freq, 0.35, 0.2);
      }, idx * 100);
    });

    // Chord hold at the end
    setTimeout(() => {
      this.createOscillator('triangle', 523.25, 0.8, 0.15);
      this.createOscillator('sine', 659.25, 0.8, 0.12);
      this.createOscillator('sine', 1046.50, 0.8, 0.1);
    }, 800);
  },

  playLose() {
    // Sad tragic trombone slide down
    this.createOscillator('sawtooth', 293.66, 0.4, 0.2, 196.00); // D4 to G3
    setTimeout(() => {
      this.createOscillator('sawtooth', 277.18, 0.45, 0.2, 185.00); // C#4 to F#3
    }, 380);
    setTimeout(() => {
      this.createOscillator('sawtooth', 261.63, 0.7, 0.25, 130.81); // C4 to C3
    }, 800);
  }
};
