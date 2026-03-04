// config.js — All tunable constants for Orbital audiovisual composition

// ─── Orbit presets ────────────────────────────────────────────────────────────
// Each preset fills { mode, balls?, loop } in the Orbits UI section.
// 'balls' is omitted for 'factors' mode — derived from loop's divisors at runtime.
//
// Modes:
//   harmonic — T_i = loop/i for i=1..balls  (all sync at t=loop)
//   pendulum — T_i = loop/(balls+i) for i=0..balls-1  (tight cluster, wave patterns)
//   factors  — periods = divisors of (loop×10), each ÷10, keeping ≥0.5s  (balls derived)

const PRESETS = {
  harmonic_24:  { label: 'Harmonic 24',  mode: 'harmonic', balls: 24,  loop: 24  },
  harmonic_32:  { label: 'Harmonic 32',  mode: 'harmonic', balls: 32,  loop: 32  },
  harmonic_48:  { label: 'Harmonic 48',  mode: 'harmonic', balls: 48,  loop: 120 },
  harmonic_60:  { label: 'Harmonic 60',  mode: 'harmonic', balls: 60,  loop: 60  },
  harmonic_120: { label: 'Harmonic 120', mode: 'harmonic', balls: 120, loop: 120 },
  pendulum_51:  { label: 'Pendulum 51',  mode: 'pendulum', balls: 51,  loop: 60  },
  original:     { label: 'Original',     mode: 'factors',               loop: 240 },
  factors_5040: { label: 'Factors 5040', mode: 'factors',               loop: 504 },
};

// ─── Synth preset definitions ────────────────────────────────────────────────
// Each preset's build() returns { poly, output, nodes }
//   poly   — the PolySynth to call triggerAttackRelease on
//   output — the last audio node in the preset's chain (connected → comp)
//   nodes  — disposable effect nodes (excludes poly, which is disposed separately)

const SYNTH_PRESETS = {
  sine_pluck: {
    label: 'Sine Pluck',
    noteDuration: '8n',
    build() {
      const poly = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.005, decay: 0.3, sustain: 0.0, release: 0.5 },
        maxPolyphony: 128,
      });
      return { poly, output: poly, nodes: [] };
    },
  },

  glass_bell: {
    label: 'Glass Bell',
    noteDuration: '8n',
    // Triangle wave with long reverb tail — ethereal, overlapping, cathedral-like
    build() {
      const poly = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.001, decay: 2.5, sustain: 0.0, release: 2.0 },
        maxPolyphony: 128,
      });
      const reverb = new Tone.Reverb({ decay: 5.0, wet: 0.45 });
      poly.connect(reverb);
      return { poly, output: reverb, nodes: [reverb] };
    },
  },

  fm_chime: {
    label: 'FM Chime',
    noteDuration: '8n',
    // FM synthesis with bell-like harmonics — metallic, bright, harmonic-rich
    build() {
      const poly = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.01,
        modulationIndex: 14,
        envelope: { attack: 0.001, decay: 0.5, sustain: 0.0, release: 0.8 },
        modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0.0, release: 0.5 },
        maxPolyphony: 64,
      });
      return { poly, output: poly, nodes: [] };
    },
  },

  warm_organ: {
    label: 'Warm Organ',
    noteDuration: '4n',
    // Square wave + chorus + sustain — warm, full-bodied, church-like
    build() {
      const poly = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'square' },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.4 },
        maxPolyphony: 64,
      });
      const chorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.5, wet: 0.5 }).start();
      poly.connect(chorus);
      return { poly, output: chorus, nodes: [chorus] };
    },
  },

  kalimba: {
    label: 'Kalimba',
    noteDuration: '8n',
    // AM synthesis — woody thumb-piano timbre with short percussive decay
    build() {
      const poly = new Tone.PolySynth(Tone.AMSynth, {
        harmonicity: 3.0,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.4, sustain: 0.0, release: 0.1 },
        modulation: { type: 'square' },
        modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0.0, release: 0.1 },
        maxPolyphony: 64,
      });
      return { poly, output: poly, nodes: [] };
    },
  },

  cosmic_pad: {
    label: 'Cosmic Pad',
    noteDuration: '2n',
    // Sine + ping-pong delay + long reverb — spacey, drifting, immersive
    build() {
      const poly = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.1, decay: 1.0, sustain: 0.3, release: 3.0 },
        maxPolyphony: 64,
      });
      const delay  = new Tone.PingPongDelay({ delayTime: '8n', feedback: 0.4, wet: 0.3 });
      const reverb = new Tone.Reverb({ decay: 8.0, wet: 0.6 });
      poly.connect(delay);
      delay.connect(reverb);
      return { poly, output: reverb, nodes: [delay, reverb] };
    },
  },
};

// ─── Main config ─────────────────────────────────────────────────────────────

const CONFIG = {
  // Active orbit configuration — set by Orbits UI
  ORBIT_MODE:  'harmonic',   // 'harmonic' | 'pendulum' | 'factors'
  ORBIT_BALLS: 48,           // target ball count (ignored in 'factors' mode — derived)
  ORBIT_LOOP:  120,          // loop duration in seconds (= record duration)

  // Active synth preset — changed at runtime by UI dropdown
  SYNTH_PRESET: 'sine_pluck',

  // Resolution
  NATIVE_W: 1080,
  NATIVE_H: 1920,
  PREVIEW_SCALE: 0.25,   // browser preview at 1/4 res; change to 1.0 for export

  // Orbits
  MIN_RADIUS_PX: 80,
  MAX_RADIUS_PX: 520,

  // Visuals
  BALL_SIZE_PX: 8,       // diameter at native res
  TRAIL_LENGTH: 20,      // frames of position history
  TRAIL_DECAY: 0.9,      // alpha multiplier per frame

  // Trigger line
  TRIGGER_LINE_ALPHA_IDLE: 0.4,
  TRIGGER_LINE_ALPHA_PULSE: 1.0,
  TRIGGER_LINE_WIDTH_IDLE: 2,
  TRIGGER_LINE_WIDTH_PULSE: 4,
  TRIGGER_PULSE_FRAMES: 3,

  // Physics
  FPS: 60,
  TRIGGER_THRESHOLD_RAD: 0.05,

  // Music
  TONE_DIRECTION: 'low_inside',   // 'low_inside' = center note inner, 'low_outside' = center note outer
  SCALE: 'chromatic',
  CENTER_NOTE: 'C4',              // pivot note — scale spreads alternating up/down from here
  SYNTH_VOICES: 128,

  // Audio chain (persistent — not per-preset)
  COMPRESSOR_THRESHOLD: -24,
  COMPRESSOR_RATIO: 12,
  LIMITER_CEILING: -1,

  // Trigger line flash
  TRIGGER_FLASH: false,

  // Alternating direction mode
  ALT_DIRECTION: false,

  // Sonar rings
  SONAR_ENABLED: false,
  SONAR_RING_SPEED: 2,   // native px/frame expansion
  SONAR_MAX_AGE: 60,     // frames before fade-out
  SONAR_RING_WIDTH: 2,   // native px stroke weight

  // Ball glow
  GLOW_ENABLED: false,
  GLOW_RADIUS_PX: 16,   // native px
  GLOW_ALPHA: 0.3,

  // Trail fling — trails fly off as straight vectors instead of following the arc
  TRAIL_FLING: false,

  // Period-proportional trail length — longer trails for longer-period balls
  PERIOD_TRAIL: false,
};

const SCALES = {
  // ── Pentatonics ───────────────────────────────────────────────────────────
  pentatonic_major:  [0, 2, 4, 7, 9],           // bright, open — no semitone tension
  pentatonic_minor:  [0, 3, 5, 7, 10],           // soulful, slightly dark
  hirajoshi:         [0, 2, 3, 7, 8],            // Japanese — stark contrast, eerie
  blues:             [0, 3, 5, 6, 7, 10],        // hexatonic blues — gritty

  // ── Church modes ──────────────────────────────────────────────────────────
  major:             [0, 2, 4, 5, 7, 9, 11],    // Ionian — bright, resolved
  dorian:            [0, 2, 3, 5, 7, 9, 10],    // minor + raised 6 — modal jazz, hopeful dark
  phrygian:          [0, 1, 3, 5, 7, 8, 10],    // flat 2 — Spanish, tense
  lydian:            [0, 2, 4, 6, 7, 9, 11],    // raised 4 — dreamy, floating, film music
  mixolydian:        [0, 2, 4, 5, 7, 9, 10],    // flat 7 — folk, bluesy major

  // ── Minor variants ────────────────────────────────────────────────────────
  harmonic_minor:    [0, 2, 3, 5, 7, 8, 11],    // raised 7 — classical tension, exotic
  melodic_minor:     [0, 2, 3, 5, 7, 9, 11],    // jazz minor — smooth, versatile
  phrygian_dominant: [0, 1, 4, 5, 7, 8, 10],    // 5th mode of harmonic minor — flamenco, Middle Eastern
  hungarian_minor:   [0, 2, 3, 6, 7, 8, 11],    // two augmented 2nds — Romani, dramatic

  // ── Symmetric ─────────────────────────────────────────────────────────────
  whole_tone:        [0, 2, 4, 6, 8, 10],        // 6 equal steps — Debussy, ambiguous, hovering
  diminished:        [0, 2, 3, 5, 6, 8, 9, 11],  // whole-half alternating — 8 notes, tense symmetry
  chromatic:         [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  quarter_tone:      [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5], // 24-TET microtonal
};
