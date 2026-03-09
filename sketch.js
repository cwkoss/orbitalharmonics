// sketch.js — p5.js sketch for Orbital audiovisual composition

// ─── Globals ─────────────────────────────────────────────────────────────────

let balls = [];
let poly, comp, lim, audioRecorder, spaceReverb;
let currentSynthNodes = [];
let state = {
  playing: false,
  simFrame: 0,
  audioReady: false,
  recordPhase: null,       // null | 'video' | 'audio'
};

// p5.dom UI elements
let btnPlay, btnReset, btnRecord, selScale, selPreset, selToneDir, selSynth;
let btnAltDir, btnSonar, btnGlow, btnFling, btnPeriodTrail, inpTrailLen, inpBallSize;
let selColorMode, btnTriggerBright, btnRipple, btnStrobe, btnConstellation, inpConstellationThresh;
let btnGravity, inpGravityX, inpGravityY, inpGravityStrength, divGravityControls;
let btnAfterglow, inpAfterglowFade, divAfterglowControls;
let inpSpace;
let btnModeH, btnModeP, btnModeF, inpBalls, inpLoop;
let inpCenterNote, lblLoNote, lblHiNote;
let divRecordProgress, barRecordFill, lblRecordStatus, lblRecordCmd;

let sonarRings = []; // { x, y, r, age, hue } all in native px

// Derived scale constants (set in initBalls)
const TWO_PI = Math.PI * 2;

// ─── Settings persistence ─────────────────────────────────────────────────────

const SETTINGS_KEY = 'orbital_config';

function saveSettings() {
  try {
    const { PREVIEW_SCALE, NATIVE_W, NATIVE_H, ...toSave } = CONFIG; // never persist render constants
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(toSave));
  } catch (e) {}
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      delete saved.PREVIEW_SCALE; // scrub any stale value from old exports
      delete saved.NATIVE_W;
      delete saved.NATIVE_H;
      Object.assign(CONFIG, saved);
    }
  } catch (e) {}
}

function syncToggleButtons() {
  setToggleActive(btnAltDir,        CONFIG.ALT_DIRECTION);
  setToggleActive(btnTriggerBright, CONFIG.TRIGGER_BRIGHT);
  setToggleActive(btnRipple,        CONFIG.RIPPLE_ENABLED);
  setToggleActive(btnStrobe,        CONFIG.STROBE_ENABLED);
  setToggleActive(btnSonar,         CONFIG.SONAR_ENABLED);
  setToggleActive(btnGlow,          CONFIG.GLOW_ENABLED);
  setToggleActive(btnFling,         CONFIG.TRAIL_FLING);
  setToggleActive(btnPeriodTrail,   CONFIG.PERIOD_TRAIL);
  setToggleActive(btnConstellation, CONFIG.CONSTELLATION_ENABLED);
  setToggleActive(btnAfterglow,     CONFIG.AFTERGLOW_ENABLED);
  setToggleActive(btnGravity,       CONFIG.GRAVITY_ENABLED);
  divGravityControls.style('display',   CONFIG.GRAVITY_ENABLED   ? 'block' : 'none');
  divAfterglowControls.style('display', CONFIG.AFTERGLOW_ENABLED ? 'block' : 'none');
}

// ─── Note utilities ───────────────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteToMidi(noteName) {
  // e.g. "C3" → 48, "C#3" → 49; Hz number → float MIDI
  if (typeof noteName === 'number') return 12 * Math.log2(noteName / 440) + 69;
  const match = noteName.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return 60;
  const pitch = NOTE_NAMES.indexOf(match[1]);
  const octave = parseInt(match[2]);
  return (octave + 1) * 12 + pitch;
}

function midiToNote(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const pitch = midi % 12;
  return NOTE_NAMES[pitch] + octave;
}

function midiToNoteOrHz(midi) {
  // Returns a note name string for true semitones, or Hz number for microtones.
  // Both are accepted by Tone.js triggerAttackRelease.
  return Number.isInteger(midi) ? midiToNote(midi) : midiToHz(midi);
}

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function formatNoteLabel(midi) {
  const hz = Math.round(midiToHz(midi));
  if (Number.isInteger(midi)) return `${hz} Hz (${midiToNote(midi)})`;
  return `${hz} Hz`;
}

function buildNoteListCentered(centerNote, scaleName, N) {
  const intervals = SCALES[scaleName]; // always starts with 0 (root)
  const centerMidi = noteToMidi(centerNote);

  // All scale notes in MIDI range 0–127 treating centerNote as root (interval 0).
  // Each octave offset adds/subtracts 12 from centerMidi; intervals fill within.
  const pool = new Set();
  for (let oct = -12; oct <= 12; oct++) {
    for (const iv of intervals) {
      const m = centerMidi + oct * 12 + iv;
      if (m >= 0 && m <= 127) pool.add(m);
    }
  }
  const sorted = Array.from(pool).sort((a, b) => a - b);

  // Find the center note's position in the sorted pool.
  // centerMidi is always present because intervals[0]=0 → oct=0 → centerMidi+0+0.
  const ci = sorted.indexOf(centerMidi);

  // Build alternating list: center, +1 step, −1 step, +2 steps, −2 steps, …
  const result = [];
  let up = ci;       // next to take from ≥ center (starts at center itself)
  let down = ci - 1; // next to take from < center

  for (let i = 0; i < N; i++) {
    if (i % 2 === 0) {
      if (up < sorted.length)      result.push(midiToNoteOrHz(sorted[up++]));
      else if (down >= 0)          result.push(midiToNoteOrHz(sorted[down--]));
    } else {
      if (down >= 0)               result.push(midiToNoteOrHz(sorted[down--]));
      else if (up < sorted.length) result.push(midiToNoteOrHz(sorted[up++]));
    }
  }
  // If N exceeds available unique notes, cycle from the beginning
  while (result.length < N) result.push(result[result.length % sorted.length]);
  return result; // [center, +1, −1, +2, −2, …]
}

// ─── Audio initialization ─────────────────────────────────────────────────────

function initAudio() {
  // Persistent chain — survives preset changes
  comp = new Tone.Compressor({
    threshold: CONFIG.COMPRESSOR_THRESHOLD,
    ratio:     CONFIG.COMPRESSOR_RATIO,
    attack:    0.003,
    release:   0.25,
  });
  lim = new Tone.Limiter(CONFIG.LIMITER_CEILING);
  comp.connect(lim);
  lim.toDestination();

  audioRecorder = new Tone.Recorder();
  lim.connect(audioRecorder);

  // Persistent space reverb — sits between preset output and comp
  spaceReverb = new Tone.Reverb({ decay: CONFIG.SPACE_REVERB_DECAY, wet: CONFIG.SPACE_WET });
  spaceReverb.connect(comp);

  // Synth chain (poly + per-preset effects) → spaceReverb → comp
  applySynthPreset(CONFIG.SYNTH_PRESET);
}

function applySynthPreset(key) {
  if (poly) poly.dispose();
  currentSynthNodes.forEach(n => n.dispose());

  CONFIG.SYNTH_PRESET = key;
  const built = SYNTH_PRESETS[key].build();
  poly             = built.poly;
  currentSynthNodes = built.nodes;
  built.output.connect(spaceReverb);
}

// ─── Period computation ───────────────────────────────────────────────────────

function computePeriods(mode, balls, loop) {
  if (mode === 'harmonic') {
    // T_i = loop/i for i=1..balls — each ball completes i full orbits per loop
    const arr = [];
    for (let i = 1; i <= balls; i++) arr.push(loop / i);
    return arr.sort((a, b) => a - b);
  }
  if (mode === 'pendulum') {
    // T_i = loop/(balls+i) for i=0..balls-1
    // Slowest completes exactly `balls` orbits, fastest completes 2×balls−1.
    // The tight frequency cluster creates spreading/collapsing wave patterns.
    const arr = [];
    for (let i = 0; i < balls; i++) arr.push(loop / (balls + i));
    return arr.sort((a, b) => a - b);
  }
  if (mode === 'factors') {
    // Periods = divisors of (loop×10), each divided by 10, keeping ≥ 0.5s
    // Ball count is derived — not a free parameter in this mode.
    const base = Math.round(loop * 10);
    const arr = [];
    for (let d = 1; d <= base; d++) {
      if (base % d === 0) {
        const period = d / 10;
        if (period >= 0.5) arr.push(period);
      }
    }
    return arr.sort((a, b) => a - b);
  }
  return [];
}

// ─── Ball initialization ──────────────────────────────────────────────────────

function initBalls() {
  balls = [];
  const periods = computePeriods(CONFIG.ORBIT_MODE, CONFIG.ORBIT_BALLS, CONFIG.ORBIT_LOOP);
  CONFIG.ORBIT_BALLS = periods.length; // sync — matters for 'factors' mode (derived N)
  const N = periods.length;
  const scaleName = CONFIG.SCALE;

  // Select notes from center outward, then sort by pitch for assignment
  const noteList = buildNoteListCentered(CONFIG.CENTER_NOTE, scaleName, N);
  const sortedNotes = [...noteList].sort((a, b) => noteToMidi(a) - noteToMidi(b));

  for (let i = 0; i < N; i++) {
    const T = periods[i];
    const r = CONFIG.MIN_RADIUS_PX +
              (CONFIG.MAX_RADIUS_PX - CONFIG.MIN_RADIUS_PX) * i / (N - 1);
    const hue = 240 * i / (N - 1);
    // Tone direction: 'low_outside' → inner=high, outer=low (default)
    //                'low_inside'  → inner=low, outer=high
    const noteName = CONFIG.TONE_DIRECTION === 'low_inside'
      ? sortedNotes[i]
      : sortedNotes[N - 1 - i];

    const sign = (CONFIG.ALT_DIRECTION && i % 2 === 1) ? -1 : 1;
    balls.push({
      index:            i,
      period:           T,
      radius:           r,
      omega:            sign * TWO_PI / T,
      theta:            0,
      prevTheta:        0,
      noteName:         noteName,
      hue:              hue,
      trailPos:         [],
      lastTriggerFrame: -9999,
    });
  }
  if (lblLoNote) syncNoteRangeUI(); // update range display after balls are built
}

// ─── p5.js setup ─────────────────────────────────────────────────────────────

function setup() {
  const S = CONFIG.PREVIEW_SCALE;
  pixelDensity(1); // force 1x — prevents odd canvas dimensions on high-DPI displays
  const cnv = createCanvas(CONFIG.NATIVE_W * S, CONFIG.NATIVE_H * S);
  cnv.parent('canvas-container');
  frameRate(CONFIG.FPS);
  colorMode(HSL, 360, 100, 100, 1);
  textFont('monospace');

  loadSettings();
  initBalls();
  buildUI();
  syncToggleButtons();
}

// ─── UI construction ──────────────────────────────────────────────────────────

function buildUI() {
  const panel = select('#panel');

  // ── CONTROLS ────────────────────────────────────────────────────────────────
  const ctrlBody = makeSection('Controls', panel);

  const ctrlBtns = makeRow(ctrlBody);
  btnPlay = createButton('Play'); styleBtn(btnPlay); btnPlay.mousePressed(togglePlay); btnPlay.parent(ctrlBtns);
  btnReset = createButton('Reset'); styleBtn(btnReset); btnReset.mousePressed(resetSim); btnReset.parent(ctrlBtns);

  btnRecord = createButton('Export'); styleBtn(btnRecord); btnRecord.mousePressed(onRecordClick);
  btnRecord.style('width', '100%'); btnRecord.parent(ctrlBody);

  // Recording progress bar (hidden until recording)
  divRecordProgress = createDiv(''); divRecordProgress.parent(ctrlBody);
  divRecordProgress.style('display', 'none'); divRecordProgress.style('margin-top', '4px');
  lblRecordStatus = createDiv(''); lblRecordStatus.parent(divRecordProgress);
  lblRecordStatus.style('color', '#aaa'); lblRecordStatus.style('font-size', '10px');
  lblRecordStatus.style('margin-bottom', '3px');
  const barTrack = createDiv(''); barTrack.parent(divRecordProgress);
  barTrack.style('background', '#111'); barTrack.style('border', '1px solid #333');
  barTrack.style('height', '6px'); barTrack.style('border-radius', '3px');
  barTrack.style('overflow', 'hidden');
  barRecordFill = createDiv(''); barRecordFill.parent(barTrack);
  barRecordFill.style('height', '100%'); barRecordFill.style('width', '0%');
  barRecordFill.style('border-radius', '3px'); barRecordFill.style('transition', 'width 0.3s');
  lblRecordCmd = createDiv(''); lblRecordCmd.parent(divRecordProgress);
  lblRecordCmd.style('display', 'none'); lblRecordCmd.style('margin-top', '5px');
  lblRecordCmd.style('color', '#8f8'); lblRecordCmd.style('font-size', '9px');
  lblRecordCmd.style('word-break', 'break-all'); lblRecordCmd.style('user-select', 'all');

  // ── ORBITS ──────────────────────────────────────────────────────────────────
  const orbBody = makeSection('Orbits', panel);

  selPreset = createSelect(); styleSelect(selPreset);
  selPreset.option('─ Custom ─', '');
  Object.entries(PRESETS).forEach(([k, p]) => selPreset.option(p.label, k));
  selPreset.selected('harmonic_48');
  selPreset.changed(onPresetChange);
  addLabeledFull('Preset', selPreset, orbBody);

  const modeWrap = createDiv(''); modeWrap.parent(orbBody); modeWrap.style('margin-bottom', '8px');
  makePanelLabel('Mode').parent(modeWrap);
  btnModeH = createButton('Harmonic'); styleModeBtn(btnModeH); btnModeH.parent(modeWrap); btnModeH.mousePressed(() => setOrbitMode('harmonic'));
  btnModeP = createButton('Pendulum'); styleModeBtn(btnModeP); btnModeP.parent(modeWrap); btnModeP.mousePressed(() => setOrbitMode('pendulum'));
  btnModeF = createButton('Factors');  styleModeBtn(btnModeF); btnModeF.parent(modeWrap); btnModeF.mousePressed(() => setOrbitMode('factors'));
  updateModeButtons();

  inpBalls = createElement('input'); inpBalls.attribute('type', 'number');
  inpBalls.attribute('min', '1'); inpBalls.attribute('max', '500');
  inpBalls.value(CONFIG.ORBIT_BALLS); styleNumberInput(inpBalls); inpBalls.input(onOrbitParamChange);
  addLabeledFull('Balls', inpBalls, orbBody);

  inpLoop = createElement('input'); inpLoop.attribute('type', 'number'); inpLoop.attribute('min', '1');
  inpLoop.value(CONFIG.ORBIT_LOOP); styleNumberInput(inpLoop); inpLoop.input(onOrbitParamChange);
  addLabeledFull('Loop (s)', inpLoop, orbBody);

  btnAltDir = createButton('Off'); styleBtn(btnAltDir); btnAltDir.mousePressed(onAltDirToggle);
  addToggleRow('Alt Dir', btnAltDir, orbBody);

  // ── AUDIO ────────────────────────────────────────────────────────────────────
  const audioBody = makeSection('Audio', panel);

  selScale = createSelect(); styleSelect(selScale);
  Object.keys(SCALES).forEach(s => selScale.option(s));
  selScale.selected(CONFIG.SCALE); selScale.changed(onScaleChange);
  addLabeledFull('Scale', selScale, audioBody);

  selToneDir = createSelect(); styleSelect(selToneDir);
  selToneDir.option('Low outside', 'low_outside');
  selToneDir.option('Low inside',  'low_inside');
  selToneDir.selected(CONFIG.TONE_DIRECTION); selToneDir.changed(onToneDirChange);
  addLabeledFull('Direction', selToneDir, audioBody);

  selSynth = createSelect(); styleSelect(selSynth);
  Object.entries(SYNTH_PRESETS).forEach(([k, p]) => selSynth.option(p.label, k));
  selSynth.selected(CONFIG.SYNTH_PRESET); selSynth.changed(onSynthChange);
  addLabeledFull('Sound', selSynth, audioBody);

  inpSpace = createElement('input'); inpSpace.attribute('type', 'range');
  inpSpace.attribute('min', '0'); inpSpace.attribute('max', '1'); inpSpace.attribute('step', '0.01');
  inpSpace.value(CONFIG.SPACE_WET); inpSpace.style('width', '100%'); inpSpace.style('cursor', 'pointer');
  inpSpace.input(onSpaceChange);
  addLabeledFull('Space', inpSpace, audioBody);

  inpCenterNote = createElement('input'); inpCenterNote.attribute('type', 'text');
  inpCenterNote.attribute('placeholder', 'e.g. C4'); inpCenterNote.value(CONFIG.CENTER_NOTE);
  styleTextInput(inpCenterNote); inpCenterNote.input(onCenterNoteChange);
  addLabeledFull('Center Note', inpCenterNote, audioBody);

  // Lowest / Highest note display (side by side)
  const rangeRow = createDiv(''); rangeRow.parent(audioBody);
  rangeRow.style('display', 'flex'); rangeRow.style('gap', '8px'); rangeRow.style('margin-bottom', '4px');

  const loWrap = createDiv(''); loWrap.parent(rangeRow); loWrap.style('flex', '1');
  makePanelLabel('Lowest').parent(loWrap);
  lblLoNote = createSpan('—'); lblLoNote.parent(loWrap);
  lblLoNote.style('font-family', 'monospace'); lblLoNote.style('font-size', '12px');

  const hiWrap = createDiv(''); hiWrap.parent(rangeRow); hiWrap.style('flex', '1');
  makePanelLabel('Highest').parent(hiWrap);
  lblHiNote = createSpan('—'); lblHiNote.parent(hiWrap);
  lblHiNote.style('font-family', 'monospace'); lblHiNote.style('font-size', '12px');

  // ── VISUAL ───────────────────────────────────────────────────────────────────
  const visBody = makeSection('Visual', panel);

  selColorMode = createSelect(); styleSelect(selColorMode);
  selColorMode.option('Index',    'index');
  selColorMode.option('Inverse',  'inverse');
  selColorMode.option('Cycle',    'cycle');
  selColorMode.option('Sunset',   'sunset');
  selColorMode.option('Candy',    'candy');
  selColorMode.option('Plasma',   'plasma');
  selColorMode.option('Zebra',    'zebra');
  selColorMode.option('Galaxy',   'galaxy');
  selColorMode.option('Phase',    'phase');
  selColorMode.option('Aurora',   'aurora');
  selColorMode.option('Harmonic', 'harmonic');
  if (CONFIG.COLOR_MODE === 'trigger' || CONFIG.COLOR_MODE === 'velocity') CONFIG.COLOR_MODE = 'index'; // migrate old saved values
  selColorMode.selected(CONFIG.COLOR_MODE); selColorMode.changed(onColorModeChange);
  addLabeledFull('Color Mode', selColorMode, visBody);

  btnTriggerBright = createButton('Off'); styleBtn(btnTriggerBright); btnTriggerBright.mousePressed(onTriggerBrightToggle);
  addToggleRow('Trigger Bright', btnTriggerBright, visBody);

  btnRipple = createButton('Off'); styleBtn(btnRipple); btnRipple.mousePressed(onRippleToggle);
  addToggleRow('Ripple', btnRipple, visBody);

  btnStrobe = createButton('Off'); styleBtn(btnStrobe); btnStrobe.mousePressed(onStrobeToggle);
  addToggleRow('Strobe', btnStrobe, visBody);


  btnSonar = createButton('Off'); styleBtn(btnSonar); btnSonar.mousePressed(onSonarToggle);
  addToggleRow('Sonar', btnSonar, visBody);

  btnGlow = createButton('Off'); styleBtn(btnGlow); btnGlow.mousePressed(onGlowToggle);
  addToggleRow('Glow', btnGlow, visBody);

  btnFling = createButton('Off'); styleBtn(btnFling); btnFling.mousePressed(onFlingToggle);
  addToggleRow('Fling', btnFling, visBody);

  inpBallSize = createElement('input'); inpBallSize.attribute('type', 'number');
  inpBallSize.attribute('min', '1'); inpBallSize.attribute('max', '100');
  inpBallSize.value(CONFIG.BALL_SIZE_PX); styleNumberInput(inpBallSize);
  inpBallSize.input(() => { const v = parseInt(inpBallSize.value()); if (v >= 1 && v <= 100) CONFIG.BALL_SIZE_PX = v; });
  addLabeledFull('Ball Size', inpBallSize, visBody);

  inpTrailLen = createElement('input'); inpTrailLen.attribute('type', 'number');
  inpTrailLen.attribute('min', '1'); inpTrailLen.attribute('max', '1000');
  inpTrailLen.value(CONFIG.TRAIL_LENGTH); styleNumberInput(inpTrailLen);
  inpTrailLen.input(onTrailLenChange);
  addLabeledFull('Trail Len', inpTrailLen, visBody);

  btnPeriodTrail = createButton('Off'); styleBtn(btnPeriodTrail); btnPeriodTrail.mousePressed(onPeriodTrailToggle);
  addToggleRow('Period Trail', btnPeriodTrail, visBody);

  btnConstellation = createButton('Off'); styleBtn(btnConstellation); btnConstellation.mousePressed(onConstellationToggle);
  addToggleRow('Constellation', btnConstellation, visBody);

  inpConstellationThresh = createElement('input'); inpConstellationThresh.attribute('type', 'range');
  inpConstellationThresh.attribute('min', '0.01'); inpConstellationThresh.attribute('max', '0.5'); inpConstellationThresh.attribute('step', '0.01');
  inpConstellationThresh.value(CONFIG.CONSTELLATION_PHASE_THRESH);
  inpConstellationThresh.style('width', '100%'); inpConstellationThresh.style('cursor', 'pointer');
  inpConstellationThresh.input(() => { CONFIG.CONSTELLATION_PHASE_THRESH = parseFloat(inpConstellationThresh.value()); });
  addLabeledFull('Phase Thresh', inpConstellationThresh, visBody);

  btnAfterglow = createButton('Off'); styleBtn(btnAfterglow); btnAfterglow.mousePressed(onAfterglowToggle);
  addToggleRow('Afterglow', btnAfterglow, visBody);

  divAfterglowControls = createDiv(''); divAfterglowControls.parent(visBody);
  divAfterglowControls.style('display', 'none');

  inpAfterglowFade = createElement('input'); inpAfterglowFade.attribute('type', 'range');
  inpAfterglowFade.attribute('min', '0'); inpAfterglowFade.attribute('max', '0.3'); inpAfterglowFade.attribute('step', '0.005');
  inpAfterglowFade.value(CONFIG.AFTERGLOW_FADE); inpAfterglowFade.style('width', '100%'); inpAfterglowFade.style('cursor', 'pointer');
  inpAfterglowFade.input(() => { CONFIG.AFTERGLOW_FADE = parseFloat(inpAfterglowFade.value()); });
  addLabeledFull('Fade', inpAfterglowFade, divAfterglowControls);

  btnGravity = createButton('Off'); styleBtn(btnGravity); btnGravity.mousePressed(onGravityToggle);
  addToggleRow('Gravity Well', btnGravity, visBody);

  divGravityControls = createDiv(''); divGravityControls.parent(visBody);
  divGravityControls.style('display', 'none');

  inpGravityX = createElement('input'); inpGravityX.attribute('type', 'range');
  inpGravityX.attribute('min', '0'); inpGravityX.attribute('max', '1'); inpGravityX.attribute('step', '0.01');
  inpGravityX.value(CONFIG.GRAVITY_X); inpGravityX.style('width', '100%'); inpGravityX.style('cursor', 'pointer');
  inpGravityX.input(() => { CONFIG.GRAVITY_X = parseFloat(inpGravityX.value()); });
  addLabeledFull('Well X', inpGravityX, divGravityControls);

  inpGravityY = createElement('input'); inpGravityY.attribute('type', 'range');
  inpGravityY.attribute('min', '0'); inpGravityY.attribute('max', '1'); inpGravityY.attribute('step', '0.01');
  inpGravityY.value(CONFIG.GRAVITY_Y); inpGravityY.style('width', '100%'); inpGravityY.style('cursor', 'pointer');
  inpGravityY.input(() => { CONFIG.GRAVITY_Y = parseFloat(inpGravityY.value()); });
  addLabeledFull('Well Y', inpGravityY, divGravityControls);

  inpGravityStrength = createElement('input'); inpGravityStrength.attribute('type', 'range');
  inpGravityStrength.attribute('min', '0'); inpGravityStrength.attribute('max', '1'); inpGravityStrength.attribute('step', '0.01');
  inpGravityStrength.value(CONFIG.GRAVITY_STRENGTH); inpGravityStrength.style('width', '100%'); inpGravityStrength.style('cursor', 'pointer');
  inpGravityStrength.input(() => { CONFIG.GRAVITY_STRENGTH = parseFloat(inpGravityStrength.value()); });
  addLabeledFull('Well Strength', inpGravityStrength, divGravityControls);

  // ── RESTORE DEFAULTS ─────────────────────────────────────────────────────────
  const resetWrap = createDiv(''); resetWrap.parent(panel);
  resetWrap.style('padding', '14px');
  const btnDefaults = createButton('Restore Defaults'); styleBtn(btnDefaults);
  btnDefaults.style('width', '100%'); btnDefaults.style('color', '#888');
  btnDefaults.parent(resetWrap);
  btnDefaults.mousePressed(() => { localStorage.removeItem(SETTINGS_KEY); location.reload(); });
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function makeSection(title, parentEl) {
  const sec = createDiv('');
  sec.parent(parentEl);
  sec.style('padding', '12px 14px 14px');
  sec.style('border-bottom', '1px solid #181818');
  const hdr = createDiv(title.toUpperCase());
  hdr.parent(sec);
  hdr.style('color', '#3a3a3a');
  hdr.style('font-size', '9px');
  hdr.style('letter-spacing', '0.15em');
  hdr.style('font-family', 'monospace');
  hdr.style('margin-bottom', '10px');
  const body = createDiv('');
  body.parent(sec);
  return body;
}

function makeRow(parent) {
  const row = createDiv('');
  row.parent(parent);
  row.style('display', 'flex');
  row.style('gap', '6px');
  row.style('margin-bottom', '6px');
  return row;
}

function makePanelLabel(text) {
  const lbl = createDiv(text.toUpperCase());
  lbl.style('color', '#555');
  lbl.style('font-size', '10px');
  lbl.style('letter-spacing', '0.08em');
  lbl.style('font-family', 'monospace');
  lbl.style('margin-bottom', '4px');
  return lbl;
}

function addLabeledFull(labelText, el, parentDiv) {
  const wrap = createDiv('');
  wrap.parent(parentDiv);
  wrap.style('margin-bottom', '8px');
  makePanelLabel(labelText).parent(wrap);
  el.parent(wrap);
  el.style('width', '100%');
  el.style('box-sizing', 'border-box');
}

function addToggleRow(labelText, btn, parentDiv) {
  const row = createDiv('');
  row.parent(parentDiv);
  row.style('display', 'flex');
  row.style('justify-content', 'space-between');
  row.style('align-items', 'center');
  row.style('margin-bottom', '6px');
  const lbl = createSpan(labelText);
  lbl.style('color', '#777');
  lbl.style('font-size', '11px');
  lbl.style('font-family', 'monospace');
  lbl.parent(row);
  btn.parent(row);
  btn.style('min-width', '40px');
}

function styleBtn(btn) {
  btn.style('background', '#111');
  btn.style('color', '#fff');
  btn.style('border', '1px solid #444');
  btn.style('padding', '6px 12px');
  btn.style('font-family', 'monospace');
  btn.style('font-size', '12px');
  btn.style('cursor', 'pointer');
}

function styleModeBtn(btn) {
  btn.style('background', '#111');
  btn.style('color', '#555');
  btn.style('border', '1px solid #2a2a2a');
  btn.style('padding', '5px 10px');
  btn.style('font-family', 'monospace');
  btn.style('font-size', '11px');
  btn.style('cursor', 'pointer');
  btn.style('width', '100%');
  btn.style('text-align', 'left');
  btn.style('display', 'block');
  btn.style('margin-bottom', '3px');
}

function styleNumberInput(inp) {
  inp.style('background', '#111');
  inp.style('color', '#fff');
  inp.style('border', '1px solid #444');
  inp.style('padding', '6px 8px');
  inp.style('font-family', 'monospace');
  inp.style('font-size', '12px');
}

function styleTextInput(inp) {
  inp.style('background', '#111');
  inp.style('color', '#fff');
  inp.style('border', '1px solid #444');
  inp.style('padding', '6px 8px');
  inp.style('font-family', 'monospace');
  inp.style('font-size', '12px');
}

function styleSelect(sel) {
  sel.style('background', '#111');
  sel.style('color', '#fff');
  sel.style('border', '1px solid #444');
  sel.style('padding', '6px 8px');
  sel.style('font-family', 'monospace');
  sel.style('font-size', '12px');
  sel.style('cursor', 'pointer');
}

function updateModeButtons() {
  [[btnModeH, 'harmonic'], [btnModeP, 'pendulum'], [btnModeF, 'factors']].forEach(([btn, m]) => {
    const active = CONFIG.ORBIT_MODE === m;
    btn.style('color',        active ? '#fff'   : '#555');
    btn.style('border-color', active ? '#888'   : '#2a2a2a');
    btn.style('background',   active ? '#1c1c1c' : '#111');
  });
}

// ─── Main draw loop ───────────────────────────────────────────────────────────

function draw() {
  const S = CONFIG.PREVIEW_SCALE;
  if (CONFIG.AFTERGLOW_ENABLED && state.playing) {
    noStroke(); fill(0, 0, 5, CONFIG.AFTERGLOW_FADE);
    rect(0, 0, width, height);
  } else {
    background(0, 0, 5);
  }

  if (state.playing) {
    updateBalls();
    if (CONFIG.SONAR_ENABLED) updateSonarRings();
    state.simFrame++;
  }

  drawTriggerLine(S);
  drawOrbits(S);
  drawGravityWell(S);
  drawConstellations(S);
  drawSonarRings(S);
  drawBalls(S);
  if (!state.recordPhase) drawHUD(S);

  // Persist settings every ~5 seconds
  if (frameCount % 300 === 0 && !state.recordPhase) saveSettings();

}

// ─── Physics update ───────────────────────────────────────────────────────────

function updateBalls() {
  for (const ball of balls) {
    ball.prevTheta = ball.theta;
    ball.theta = ((ball.theta + ball.omega / CONFIG.FPS) % TWO_PI + TWO_PI) % TWO_PI;
    if (CONFIG.TRAIL_FLING) advanceTrails(ball);
    checkTrigger(ball);
    pushTrail(ball);
  }
}

function checkTrigger(ball) {
  const { prevTheta, theta } = ball;
  // Direction-agnostic wraparound: any per-frame step is << π, so a jump > π means 0/2π crossing
  const crossed = Math.abs(theta - prevTheta) > Math.PI;
  // Debounce = 40% of period in frames; handles even the fastest ball (0.5s → 12 frames).
  const debounceOk = (state.simFrame - ball.lastTriggerFrame) > ball.period * CONFIG.FPS * 0.4;

  if (crossed && debounceOk && state.audioReady) {
    poly.triggerAttackRelease(ball.noteName, SYNTH_PRESETS[CONFIG.SYNTH_PRESET].noteDuration);
    ball.lastTriggerFrame = state.simFrame;
    if (CONFIG.SONAR_ENABLED) {
      sonarRings.push({
        x: CONFIG.NATIVE_W / 2,
        y: CONFIG.NATIVE_H / 2 - ball.radius,
        r: CONFIG.BALL_SIZE_PX / 2,
        age: 0,
        hue: ball.hue,
      });
    }
  }
}

function ballTrailMax(ball) {
  if (!CONFIG.PERIOD_TRAIL || balls.length === 0) return CONFIG.TRAIL_LENGTH;
  return Math.max(1, Math.round(CONFIG.TRAIL_LENGTH * ball.period / balls[0].period));
}

function pushTrail(ball) {
  const CX = CONFIG.NATIVE_W / 2;
  const CY = CONFIG.NATIVE_H / 2;
  const x = CX + ball.radius * Math.sin(ball.theta);
  const y = CY - ball.radius * Math.cos(ball.theta);
  // Tangential velocity in native px/frame — used when TRAIL_FLING is enabled
  const dTheta = ball.omega / CONFIG.FPS;
  const vx = ball.radius * Math.cos(ball.theta) * dTheta;
  const vy = ball.radius * Math.sin(ball.theta) * dTheta;
  ball.trailPos.unshift({ x, y, vx, vy }); // newest first
  if (ball.trailPos.length > ballTrailMax(ball)) {
    ball.trailPos.pop();
  }
}

function advanceTrails(ball) {
  for (const pt of ball.trailPos) {
    pt.x += pt.vx;
    pt.y += pt.vy;
  }
}

// ─── Color / display helpers ─────────────────────────────────────────────────

function getBallDisplayColor(ball) {
  const mode = CONFIG.COLOR_MODE;
  const t = ball.index / Math.max(1, balls.length - 1); // 0=innermost, 1=outermost
  let hsl;

  switch (mode) {
    case 'inverse':
      hsl = [240 - ball.hue, 90, 80]; // blue inner → red outer
      break;
    case 'cycle':
      hsl = [(ball.hue * 4) % 360, 90, 80]; // 4 full red→blue cycles across the set
      break;
    case 'sunset': {
      // yellow-white (inner) → orange → red → deep purple (outer)
      const hue = (60 - t * 120 + 360) % 360;
      hsl = [hue, 90, 90 - 50 * t];
      break;
    }
    case 'candy':
      hsl = [360 * t, 85, 85]; // full 360° rainbow, bright pastels
      break;
    case 'plasma': {
      // magenta (inner) → white (mid) → cyan (outer)
      const hue = 300 - t * 120;
      const sat = Math.pow(Math.abs(t * 2 - 1), 0.6) * 85;
      const lit = 50 + (1 - Math.abs(t * 2 - 1)) * 45;
      hsl = [hue, sat, lit];
      break;
    }
    case 'zebra': {
      // adjacent balls are complementary — dense alternating texture
      const hue = (ball.hue + (ball.index % 2) * 180) % 360;
      hsl = [hue, 90, 80];
      break;
    }
    case 'galaxy': {
      // blue-white (hot inner stars) → amber-red (cool outer giants)
      const hue = 225 * Math.pow(1 - t, 1.2);
      const sat = 20 + 80 * t;
      const lit = 90 - 50 * t;
      hsl = [hue, sat, lit];
      break;
    }
    case 'phase': {
      // hue = current orbital angle — animates as balls orbit
      hsl = [(ball.theta / TWO_PI * 360 + 360) % 360, 90, 80];
      break;
    }
    case 'aurora': {
      // slow sine wave of teal/green/blue hues drifting across the index axis
      const hue = 160 + 40 * Math.sin(state.simFrame * 0.008 + t * Math.PI * 3);
      const sat = 75 + 20 * Math.sin(state.simFrame * 0.011 + t * Math.PI * 2);
      const lit = 65 + 15 * Math.cos(state.simFrame * 0.006 + t * Math.PI * 4);
      hsl = [hue, sat, lit];
      break;
    }
    case 'harmonic': {
      const ratio = ball.period / balls[0].period;
      const nearInt = Math.round(ratio);
      hsl = Math.abs(ratio - nearInt) < 0.05
        ? [(nearInt * 137.508) % 360, 85, 72]
        : [0, 0, 35];
      break;
    }
    default: // 'index'
      hsl = [ball.hue, 90, 80];
  }

  // Ripple: animated rainbow wave flowing outward from center
  if (CONFIG.RIPPLE_ENABLED) {
    const offset = (t * 360 - state.simFrame * 0.8 + 3600) % 360;
    hsl = [(hsl[0] + offset) % 360, hsl[1], hsl[2]];
  }

  // Strobe: hue flips to complement on trigger, decays back over TRIGGER_COOL_FRAMES
  if (CONFIG.STROBE_ENABLED) {
    const st = Math.max(0, 1 - (state.simFrame - ball.lastTriggerFrame) / CONFIG.TRIGGER_COOL_FRAMES);
    hsl = [(hsl[0] + 180 * st) % 360, hsl[1], hsl[2]];
  }

  // Trigger bright: boost lightness + saturation on crossing
  if (CONFIG.TRIGGER_BRIGHT) {
    const bt = Math.max(0, 1 - (state.simFrame - ball.lastTriggerFrame) / CONFIG.TRIGGER_COOL_FRAMES);
    hsl = [hsl[0], Math.min(100, hsl[1] + 10 * bt), Math.min(100, hsl[2] + 20 * bt)];
  }

  return hsl;
}

function gravityDisplace(nx, ny) {
  // Returns {dx, dy} in native px to apply before scaling; pure visual, no physics
  if (!CONFIG.GRAVITY_ENABLED) return { dx: 0, dy: 0 };
  const gx = CONFIG.GRAVITY_X * CONFIG.NATIVE_W;
  const gy = CONFIG.GRAVITY_Y * CONFIG.NATIVE_H;
  const dx = gx - nx;
  const dy = gy - ny;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const safeDist = Math.max(dist, 20);
  const force = (CONFIG.GRAVITY_STRENGTH * 400) / (safeDist * 0.003 + 1);
  return { dx: (dx / safeDist) * force, dy: (dy / safeDist) * force };
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function drawTriggerLine(S) {
  const CX = CONFIG.NATIVE_W / 2 * S;
  const CY = CONFIG.NATIVE_H / 2 * S;
  const alpha = CONFIG.TRIGGER_LINE_ALPHA;
  const lw    = CONFIG.TRIGGER_LINE_WIDTH;

  stroke(0, 0, 100, alpha);
  strokeWeight(lw * S);
  line(CX, 0, CX, CY); // from top edge to center
}

function drawOrbits(S) {
  if (CONFIG.AFTERGLOW_ENABLED) return; // orbits would accumulate before balls travel there
  const CX = CONFIG.NATIVE_W / 2 * S;
  const CY = CONFIG.NATIVE_H / 2 * S;
  noFill();
  for (const ball of balls) {
    const [h] = getBallDisplayColor(ball);
    stroke(h, 60, 50, 0.08);
    strokeWeight(1 * S);
    circle(CX, CY, ball.radius * 2 * S);
  }
}

function drawBalls(S) {
  const CX = CONFIG.NATIVE_W / 2;
  const CY = CONFIG.NATIVE_H / 2;

  for (const ball of balls) {
    const { trailPos, radius, theta } = ball;
    const [h, sat, lit] = getBallDisplayColor(ball);

    // Draw trail oldest→newest (index 0 = newest, last index = oldest)
    noStroke();
    const trailMax = ballTrailMax(ball);
    const decay = Math.pow(CONFIG.TRAIL_DECAY, CONFIG.TRAIL_LENGTH / trailMax);
    for (let n = trailPos.length - 1; n >= 0; n--) {
      const age = n;
      const alpha = Math.pow(decay, age) * 0.8;
      fill(h, sat * 0.9, lit * 0.8, alpha);
      const { dx, dy } = gravityDisplace(trailPos[n].x, trailPos[n].y);
      const px = (trailPos[n].x + dx) * S;
      const py = (trailPos[n].y + dy) * S;
      const d = (CONFIG.BALL_SIZE_PX * S) * (0.4 + 0.6 * (1 - age / trailMax));
      circle(px, py, d);
    }

    // Draw ball dot
    const nx = CX + radius * Math.sin(theta);
    const ny = CY - radius * Math.cos(theta);
    const { dx, dy } = gravityDisplace(nx, ny);
    const bx = (nx + dx) * S;
    const by = (ny + dy) * S;
    noStroke();
    if (CONFIG.GLOW_ENABLED) drawBallGlow(bx, by, h, CONFIG.GLOW_RADIUS_PX * S);
    fill(h, sat, lit, 1.0);
    circle(bx, by, CONFIG.BALL_SIZE_PX * S);
  }
}

function drawConstellations(S) {
  if (!CONFIG.CONSTELLATION_ENABLED || balls.length < 2) return;
  const CX = CONFIG.NATIVE_W / 2;
  const CY = CONFIG.NATIVE_H / 2;
  const thresh = CONFIG.CONSTELLATION_PHASE_THRESH;
  noFill();
  for (let i = 0; i < balls.length - 1; i++) {
    const a = balls[i];
    const anx = CX + a.radius * Math.sin(a.theta);
    const any = CY - a.radius * Math.cos(a.theta);
    const { dx: adx, dy: ady } = gravityDisplace(anx, any);
    const ax = (anx + adx) * S;
    const ay = (any + ady) * S;
    const [aHue] = getBallDisplayColor(a);
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j];
      let diff = Math.abs(a.theta - b.theta);
      if (diff > Math.PI) diff = TWO_PI - diff;
      if (diff > thresh) continue;
      const t = 1 - diff / thresh;
      const alpha = t * t * CONFIG.CONSTELLATION_ALPHA_MAX;
      const [bHue] = getBallDisplayColor(b);
      const bnx = CX + b.radius * Math.sin(b.theta);
      const bny = CY - b.radius * Math.cos(b.theta);
      const { dx: bdx, dy: bdy } = gravityDisplace(bnx, bny);
      const bx = (bnx + bdx) * S;
      const by = (bny + bdy) * S;
      stroke((aHue + bHue) / 2, 70, 80, alpha);
      strokeWeight(CONFIG.CONSTELLATION_LINE_WIDTH * S);
      line(ax, ay, bx, by);
    }
  }
}

function drawGravityWell(S) {
  if (!CONFIG.GRAVITY_ENABLED) return;
  const gx = CONFIG.GRAVITY_X * CONFIG.NATIVE_W * S;
  const gy = CONFIG.GRAVITY_Y * CONFIG.NATIVE_H * S;
  const r = 6 * S;
  noFill();
  stroke(0, 0, 80, 0.25);
  strokeWeight(1 * S);
  circle(gx, gy, r * 2);
  line(gx - r * 1.5, gy, gx + r * 1.5, gy);
  line(gx, gy - r * 1.5, gx, gy + r * 1.5);
}

function drawHUD(S) {
  const elapsed = state.simFrame / CONFIG.FPS;
  const mins = Math.floor(elapsed / 60);
  const secs = (elapsed % 60).toFixed(1).padStart(4, '0');
  const timeStr = `${mins}:${secs}`;

  noStroke();
  fill(0, 0, 80, 0.7);
  textSize(14 * S);
  textAlign(LEFT, TOP);
  text(timeStr + ' / ' + CONFIG.ORBIT_LOOP + 's', 8 * S, 8 * S);

  // Title
  fill(0, 0, 100, 0.15);
  textSize(22 * S);
  textAlign(CENTER, CENTER);
  text('ORBITAL', CONFIG.NATIVE_W / 2 * S, CONFIG.NATIVE_H / 2 * S);

  // Recording phase indicator with progress
  if (state.recordPhase) {
    const pct = state.recordTotalFrames > 0 ? Math.round(state.simFrame / state.recordTotalFrames * 100) : 0;
    const label = state.recordPhase === 'video' ? `● VIDEO ${pct}%` : `● AUDIO ${pct}%`;
    fill(state.recordPhase === 'video' ? 0 : 120, 90, 70, 0.9);
    textSize(11 * S);
    textAlign(RIGHT, TOP);
    text(label, (CONFIG.NATIVE_W - 8) * S, 8 * S);
  }
}

function updateSonarRings() {
  for (const ring of sonarRings) { ring.r += CONFIG.SONAR_RING_SPEED; ring.age++; }
  for (let i = sonarRings.length - 1; i >= 0; i--) {
    if (sonarRings[i].age >= CONFIG.SONAR_MAX_AGE) sonarRings.splice(i, 1);
  }
}

function drawSonarRings(S) {
  noFill();
  for (const ring of sonarRings) {
    const alpha = 1 - ring.age / CONFIG.SONAR_MAX_AGE;
    stroke(ring.hue, 80, 70, alpha);
    strokeWeight(CONFIG.SONAR_RING_WIDTH * S);
    circle(ring.x * S, ring.y * S, ring.r * 2 * S);
  }
}

function drawBallGlow(x, y, hue, r) {
  const ctx = drawingContext;
  ctx.save();
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, `hsla(${hue}, 80%, 70%, ${CONFIG.GLOW_ALPHA})`);
  grad.addColorStop(1, `hsla(${hue}, 80%, 70%, 0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ─── Controls ─────────────────────────────────────────────────────────────────

async function togglePlay() {
  if (!state.audioReady) {
    initAudio();
    await Tone.start();
    state.audioReady = true;
    fireBigBang();
  }
  state.playing = !state.playing;
  btnPlay.html(state.playing ? 'Pause' : 'Play');
}

function resetSim() {
  state.simFrame = 0;
  for (const ball of balls) {
    ball.theta = 0;
    ball.prevTheta = 0;
    ball.trailPos = [];
    ball.lastTriggerFrame = -9999;
  }
  if (state.audioReady) {
    fireBigBang();
  }
}

function fireBigBang() {
  const allNotes = balls.map(b => b.noteName);
  poly.triggerAttackRelease(allNotes, SYNTH_PRESETS[CONFIG.SYNTH_PRESET].noteDuration);
}

// ─── Note range ───────────────────────────────────────────────────────────────

const AUDIBLE_LOW  = 12;  // C0  ≈ 16 Hz  — below this is subsonic
const AUDIBLE_HIGH = 120; // C10 ≈ 16744 Hz — above this is ultrasonic

function syncNoteRangeUI() {
  if (!lblLoNote || !lblHiNote || balls.length === 0) return;
  const midis = balls.map(b => noteToMidi(b.noteName));
  const loMidi = Math.min(...midis);
  const hiMidi = Math.max(...midis);
  lblLoNote.html(formatNoteLabel(loMidi));
  lblHiNote.html(formatNoteLabel(hiMidi));
  lblLoNote.style('color', loMidi < AUDIBLE_LOW  ? '#f44' : '#aaa');
  lblHiNote.style('color', hiMidi > AUDIBLE_HIGH ? '#f44' : '#aaa');
}

function onCenterNoteChange() {
  const raw = inpCenterNote.value().trim().toUpperCase();
  if (/^[A-G]#?\d+$/.test(raw)) {
    CONFIG.CENTER_NOTE = raw;
    inpCenterNote.style('border-color', '#444');
    initBalls(); // syncNoteRangeUI called at end of initBalls
  } else {
    inpCenterNote.style('border-color', '#f44');
  }
}

// ─── Orbit handlers ───────────────────────────────────────────────────────────

function onPresetChange() {
  const key = selPreset.value();
  if (!key) return; // '─ Custom ─' selected, nothing to do
  const p = PRESETS[key];
  CONFIG.ORBIT_MODE  = p.mode;
  CONFIG.ORBIT_LOOP  = p.loop;
  if (p.mode !== 'factors') CONFIG.ORBIT_BALLS = p.balls;
  reinitOrbits();
}

function setOrbitMode(mode) {
  CONFIG.ORBIT_MODE = mode;
  selPreset.selected(''); // deselect preset → custom
  reinitOrbits();
}

function onOrbitParamChange() {
  const b = parseInt(inpBalls.value());
  const l = parseFloat(inpLoop.value());
  if (CONFIG.ORBIT_MODE !== 'factors' && b >= 1) CONFIG.ORBIT_BALLS = b;
  if (l >= 1) CONFIG.ORBIT_LOOP = l;
  selPreset.selected('');
  reinitOrbits();
}

function reinitOrbits() {
  initBalls();   // derives ORBIT_BALLS from periods.length (matters for factors)
  resetSim();
  syncOrbitUI();
}

function syncOrbitUI() {
  updateModeButtons();
  const isFactors = CONFIG.ORBIT_MODE === 'factors';
  inpBalls.elt.disabled = isFactors;
  inpBalls.style('opacity', isFactors ? '0.4' : '1');
  inpBalls.value(CONFIG.ORBIT_BALLS); // always sync — shows derived N for factors
  inpLoop.value(CONFIG.ORBIT_LOOP);
}

function onSynthChange() {
  applySynthPreset(selSynth.value());
}

function onToneDirChange() {
  CONFIG.TONE_DIRECTION = selToneDir.value();
  initBalls();
  resetSim();
}

function onScaleChange() {
  CONFIG.SCALE = selScale.value();
  initBalls();
  resetSim();
}

function setToggleActive(btn, active) {
  btn.html(active ? 'On' : 'Off');
  btn.style('border-color', active ? '#fff' : '#444');
  btn.style('color', active ? '#fff' : '#aaa');
}

function onAltDirToggle() {
  CONFIG.ALT_DIRECTION = !CONFIG.ALT_DIRECTION;
  setToggleActive(btnAltDir, CONFIG.ALT_DIRECTION);
  balls.forEach((ball, i) => { if (i % 2 === 1) ball.omega = -ball.omega; });
}

function onSonarToggle() {
  CONFIG.SONAR_ENABLED = !CONFIG.SONAR_ENABLED;
  setToggleActive(btnSonar, CONFIG.SONAR_ENABLED);
  if (!CONFIG.SONAR_ENABLED) sonarRings = [];
}

function onGlowToggle() {
  CONFIG.GLOW_ENABLED = !CONFIG.GLOW_ENABLED;
  setToggleActive(btnGlow, CONFIG.GLOW_ENABLED);
}

function onFlingToggle() {
  CONFIG.TRAIL_FLING = !CONFIG.TRAIL_FLING;
  setToggleActive(btnFling, CONFIG.TRAIL_FLING);
  // Clear trails so old gravity-following points don't persist into fling mode
  for (const ball of balls) ball.trailPos = [];
}

function onTrailLenChange() {
  const v = parseInt(inpTrailLen.value());
  if (v >= 1 && v <= 1000) CONFIG.TRAIL_LENGTH = v;
}

function onPeriodTrailToggle() {
  CONFIG.PERIOD_TRAIL = !CONFIG.PERIOD_TRAIL;
  setToggleActive(btnPeriodTrail, CONFIG.PERIOD_TRAIL);
}

function onColorModeChange() {
  CONFIG.COLOR_MODE = selColorMode.value();
}

function onTriggerBrightToggle() {
  CONFIG.TRIGGER_BRIGHT = !CONFIG.TRIGGER_BRIGHT;
  setToggleActive(btnTriggerBright, CONFIG.TRIGGER_BRIGHT);
}

function onRippleToggle() {
  CONFIG.RIPPLE_ENABLED = !CONFIG.RIPPLE_ENABLED;
  setToggleActive(btnRipple, CONFIG.RIPPLE_ENABLED);
}

function onStrobeToggle() {
  CONFIG.STROBE_ENABLED = !CONFIG.STROBE_ENABLED;
  setToggleActive(btnStrobe, CONFIG.STROBE_ENABLED);
}

function onSpaceChange() {
  const v = parseFloat(inpSpace.value());
  CONFIG.SPACE_WET = v;
  if (spaceReverb) spaceReverb.wet.value = v;
}

function onConstellationToggle() {
  CONFIG.CONSTELLATION_ENABLED = !CONFIG.CONSTELLATION_ENABLED;
  setToggleActive(btnConstellation, CONFIG.CONSTELLATION_ENABLED);
}

function onAfterglowToggle() {
  CONFIG.AFTERGLOW_ENABLED = !CONFIG.AFTERGLOW_ENABLED;
  setToggleActive(btnAfterglow, CONFIG.AFTERGLOW_ENABLED);
  divAfterglowControls.style('display', CONFIG.AFTERGLOW_ENABLED ? 'block' : 'none');
}

function onGravityToggle() {
  CONFIG.GRAVITY_ENABLED = !CONFIG.GRAVITY_ENABLED;
  setToggleActive(btnGravity, CONFIG.GRAVITY_ENABLED);
  divGravityControls.style('display', CONFIG.GRAVITY_ENABLED ? 'block' : 'none');
}

// ─── Recording ────────────────────────────────────────────────────────────────

function updateRecordProgress(phase, frac) {
  const pct = Math.min(100, Math.round(frac * 100));
  lblRecordStatus.html(`${phase} — ${pct}%`);
  barRecordFill.style('width', pct + '%');
  barRecordFill.style('background', phase === 'VIDEO' ? '#c04040' : '#40a060');
}

function onRecordClick() {
  if (state.recordPhase) {
    cancelRecording();
  } else {
    startRecording();
  }
}

async function startRecording() {
  try {
    if (!state.audioReady) {
      initAudio();
      await Tone.start();
      state.audioReady = true;
    }
    btnRecord.html('Stop');
    divRecordProgress.style('display', 'block');
    lblRecordCmd.style('display', 'none');
    updateRecordProgress('VIDEO', 0);
    await doVideoPass();
    if (!state.recordPhase) return; // cancelled mid-video
    await doAudioPass();
  } catch (err) {
    console.error('Recording failed:', err);
    lblRecordStatus.html('Error: ' + err.message);
    barRecordFill.style('background', '#c00');
    cancelRecording();
    divRecordProgress.style('display', 'block'); // keep visible so user sees error
    return;
  }
  lblRecordStatus.html('Complete! Try:');
  barRecordFill.style('width', '100%');
  barRecordFill.style('background', '#40a060');
  lblRecordCmd.html(`ffmpeg -i orbital_video.mp4 -i orbital_audio.wav -c:v copy -c:a aac orbital_final.mp4`);
  lblRecordCmd.style('display', 'block');
  btnRecord.html('Export');
}

async function doVideoPass() {
  resetSim();
  state.playing = true;
  state.recordPhase = 'video';
  const totalFrames = Math.ceil(CONFIG.ORBIT_LOOP * CONFIG.FPS);
  Tone.Destination.volume.value = -Infinity;

  if (typeof VideoEncoder === 'undefined') throw new Error('VideoEncoder not available — use Chrome 94+ or Edge 94+');
  const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5/+esm');

  // Scale up to native resolution for export
  const prevScale = CONFIG.PREVIEW_SCALE;
  CONFIG.PREVIEW_SCALE = 1.0;
  resizeCanvas(CONFIG.NATIVE_W, CONFIG.NATIVE_H, true);
  select('#canvas-container').style('visibility', 'hidden');

  const canvas = drawingContext.canvas; // now 1080×1920

  // Intermediate CPU-readable canvas — Chrome GPU-accelerates large canvases and
  // VideoEncoder can't read GPU textures directly ("Can't readback frame textures").
  const readback = document.createElement('canvas');
  readback.width = canvas.width;
  readback.height = canvas.height;
  const readbackCtx = readback.getContext('2d');

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: canvas.width, height: canvas.height, frameRate: CONFIG.FPS },
    fastStart: 'in-memory',
  });

  let encoderError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => { encoderError = e; },
  });
  encoder.configure({
    codec: 'avc1.640032',   // H.264 High profile, Level 5.0 — handles 1080×1920@60
    width: canvas.width,
    height: canvas.height,
    bitrate: 15_000_000,    // 15 Mbps for full-res
    framerate: CONFIG.FPS,
  });

  noLoop();
  try {
    for (let f = 0; f < totalFrames; f++) {
      if (!state.recordPhase) break;
      if (encoderError) throw encoderError;
      // Backpressure: let encoder drain before submitting more frames
      while (encoder.encodeQueueSize > 10) {
        await new Promise(r => setTimeout(r, 16));
        if (encoderError) throw encoderError;
      }
      redraw();
      readbackCtx.drawImage(canvas, 0, 0); // force GPU→CPU copy
      const frame = new VideoFrame(readback, { timestamp: Math.round(f * 1_000_000 / CONFIG.FPS) });
      encoder.encode(frame, { keyFrame: f % 60 === 0 });
      frame.close();
      if (f % 30 === 0) {
        updateRecordProgress('VIDEO', f / totalFrames);
        await new Promise(r => setTimeout(r, 0));
      }
    }
  } finally {
    loop();
    Tone.Destination.volume.value = 0;
    CONFIG.PREVIEW_SCALE = prevScale;
    resizeCanvas(CONFIG.NATIVE_W * prevScale, CONFIG.NATIVE_H * prevScale);
    select('#canvas-container').style('visibility', 'visible');
  }

  if (!state.recordPhase) { encoder.close(); return; }

  updateRecordProgress('VIDEO', 1);
  noLoop(); // suppress p5 draw loop during CPU-intensive flush
  try {
    const initialQueue = encoder.encodeQueueSize;
    const flushPromise = encoder.flush();
    if (initialQueue > 0) {
      while (encoder.encodeQueueSize > 0) {
        if (encoderError) throw encoderError;
        const frac = 1 - encoder.encodeQueueSize / initialQueue;
        lblRecordStatus.html(`VIDEO — encoding ${Math.round(frac * 100)}%`);
        await new Promise(r => setTimeout(r, 100));
      }
    }
    await flushPromise;
  } finally {
    loop();
  }
  encoder.close();
  muxer.finalize();
  downloadBlob(new Blob([target.buffer], { type: 'video/mp4' }), 'orbital_video.mp4');
}

async function doAudioPass() {
  state.recordPhase = 'audio';
  lblRecordStatus.html('AUDIO — rendering offline…');
  barRecordFill.style('width', '60%');
  barRecordFill.style('background', '#40a060');

  noLoop(); // free browser resources for offline render — no frames needed
  try {
    // Precompute exact trigger times from ball periods — matches video frame-by-frame
    const noteDuration = SYNTH_PRESETS[CONFIG.SYNTH_PRESET].noteDuration;
    const byTime = new Map();
    const addNote = (t, note) => {
      const key = t.toFixed(6);
      if (!byTime.has(key)) byTime.set(key, { time: t, notes: [] });
      byTime.get(key).notes.push(note);
    };
    for (const ball of balls) {
      for (let k = 0; k * ball.period <= CONFIG.ORBIT_LOOP + 1e-9; k++) {
        addNote(k * ball.period, ball.noteName);
      }
    }

    const tailSec = Math.min(CONFIG.SPACE_WET > 0 ? CONFIG.SPACE_REVERB_DECAY * 3 : 0, 8);
    const buffer = await Tone.Offline(async () => {
      const offlineComp = new Tone.Compressor({ threshold: CONFIG.COMPRESSOR_THRESHOLD, ratio: CONFIG.COMPRESSOR_RATIO, attack: 0.003, release: 0.25 });
      const offlineLim  = new Tone.Limiter(CONFIG.LIMITER_CEILING);
      const offlineRev  = new Tone.Reverb({ decay: CONFIG.SPACE_REVERB_DECAY, wet: CONFIG.SPACE_WET });
      offlineRev.connect(offlineComp);
      offlineComp.connect(offlineLim);
      offlineLim.toDestination();
      const built = SYNTH_PRESETS[CONFIG.SYNTH_PRESET].build();
      built.output.connect(offlineRev);
      await offlineRev.ready;
      for (const { time, notes } of byTime.values()) {
        built.poly.triggerAttackRelease(notes, noteDuration, time);
      }
    }, CONFIG.ORBIT_LOOP + tailSec);

    if (!state.recordPhase) return; // cancelled — discard
    downloadBlob(audioBufferToWav(buffer, CONFIG.ORBIT_LOOP), 'orbital_audio.wav');
    state.recordPhase = null;
  } finally {
    loop(); // restore p5 rendering
  }
}

function audioBufferToWav(buffer, trimSecs) {
  const nCh = buffer.numberOfChannels;
  const sr  = buffer.sampleRate;
  const nSamples = trimSecs ? Math.min(Math.floor(trimSecs * sr), buffer.length) : buffer.length;
  const ab = new ArrayBuffer(44 + nSamples * nCh * 4);
  const v  = new DataView(ab);
  const ws = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + nSamples * nCh * 4, true);
  ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 3, true); // IEEE float
  v.setUint16(22, nCh, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * nCh * 4, true); v.setUint16(32, nCh * 4, true); v.setUint16(34, 32, true);
  ws(36, 'data'); v.setUint32(40, nSamples * nCh * 4, true);
  const ch = Array.from({ length: nCh }, (_, c) => buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < nSamples; i++) for (let c = 0; c < nCh; c++) { v.setFloat32(off, ch[c][i] || 0, true); off += 4; }
  return new Blob([ab], { type: 'audio/wav' });
}

function cancelRecording() {
  const wasPhase = state.recordPhase;
  state.recordPhase = null;
  state.playing = false;
  Tone.Destination.volume.value = 0;
  loop(); // restore p5 loop in case we were in noLoop() during video pass
  divRecordProgress.style('display', 'none');
  lblRecordCmd.style('display', 'none');
  btnRecord.html('Export');
  btnPlay.html('Play');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
