/* Simulation core: robot config, drivetrain physics, collisions, sensors, coroutine scheduler, recording. */
(function (G) {
'use strict';
const FTC = (G.FTC = G.FTC || {});

const DT = 0.005;           // physics step (s)
const RECORD_EVERY = 2;     // record a frame every N steps (100 Hz)
const FIELD_HALF = 70.5;    // inside of the perimeter walls, inches

const MOTORS = {
  'gobilda-6000': { label: 'goBILDA 5203 · 6000 RPM (1:1)', tpr: 28, rpm: 6000 },
  'gobilda-1620': { label: 'goBILDA 5203 · 1620 RPM', tpr: 103.8, rpm: 1620 },
  'gobilda-1150': { label: 'goBILDA 5203 · 1150 RPM', tpr: 145.1, rpm: 1150 },
  'gobilda-435': { label: 'goBILDA 5203 · 435 RPM', tpr: 384.5, rpm: 435 },
  'gobilda-312': { label: 'goBILDA 5203 · 312 RPM', tpr: 537.7, rpm: 312 },
  'gobilda-223': { label: 'goBILDA 5203 · 223 RPM', tpr: 751.8, rpm: 223 },
  'gobilda-117': { label: 'goBILDA 5203 · 117 RPM', tpr: 1425.1, rpm: 117 },
  'gobilda-84': { label: 'goBILDA 5203 · 84 RPM', tpr: 1993.6, rpm: 84 },
  'gobilda-60': { label: 'goBILDA 5203 · 60 RPM', tpr: 2786.2, rpm: 60 },
  'gobilda-43': { label: 'goBILDA 5203 · 43 RPM', tpr: 3895.9, rpm: 43 },
  'gobilda-30': { label: 'goBILDA 5203 · 30 RPM', tpr: 5281.1, rpm: 30 },
  'rev-hd-20': { label: 'REV HD Hex · 20:1', tpr: 560, rpm: 300 },
  'rev-hd-40': { label: 'REV HD Hex · 40:1', tpr: 1120, rpm: 150 },
  'rev-ultra-3': { label: 'REV UltraPlanetary · 3:1', tpr: 84, rpm: 2000 },
  'rev-ultra-4': { label: 'REV UltraPlanetary · 4:1', tpr: 112, rpm: 1500 },
  'rev-ultra-5': { label: 'REV UltraPlanetary · 5:1', tpr: 140, rpm: 1200 },
  'rev-ultra-12': { label: 'REV UltraPlanetary · 12:1', tpr: 336, rpm: 500 },
  'rev-ultra-20': { label: 'REV UltraPlanetary · 20:1', tpr: 560, rpm: 300 },
  'rev-core-hex': { label: 'REV Core Hex', tpr: 288, rpm: 125 },
};
const ROLES = ['FL', 'FR', 'BL', 'BR', 'L', 'R'];

/* BIOBUZZ (2026-27) field elements, in inches. Field center is (0, 0); +X points to the BLUE
   alliance wall, +Y points away from the audience. Tiles: columns A-F run from the red wall (-X)
   to the blue wall (+X); rows 1-6 run from the audience wall (-Y) to the far wall (+Y).
   Sizes come from the BIOBUZZ Competition Manual section 9 and the Event Field Setup Guide.
   Values marked APPROX are not given as numbers there and are estimated from the figures. */
const BIOBUZZ = (() => {
  const T = 24, H = 72;
  const tileCenter = (col, row) => [-H + T * ('ABCDEF'.indexOf(col)) + T / 2, -H + T * (row - 1) + T / 2];
  const lzRed = tileCenter('A', 5), lzBlue = tileCenter('F', 2);
  const gRed = tileCenter('A', 1), gBlue = tileCenter('F', 6);
  const RED = [0.85, 0.16, 0.18], BLUE = [0.16, 0.36, 0.86];
  const def = {
    frame: { w: 49.46, d: 38.95, pivotZ: 43.95 },          // center frame base footprint and pivot height
    cell: { w: 20, h: 14, d: 12, gap: 18.8 },              // CELL opening; gap between a HIVE's two CELLs
    hiveTiltDeg: 25,                                       // APPROX: how far a HIVE tips to raise one CELL
    hives: [
      { alliance: 'red', x: -12.75, upEnd: -1 },           // red CELL up on the audience side at the start
      { alliance: 'blue', x: 12.75, upEnd: 1 },            // blue CELL up on the scoring (far) side
    ],
    flower: { topZ: 21.5, openD: 4, outerD: 5, backstop: 1.25, pollenD: 2.75 },
    flowers: [                                             // APPROX positions along the walls
      { x: -24, y: -69.5, wall: -1 }, { x: 24, y: -69.5, wall: -1 },
      { x: -24, y: 69.5, wall: 1 }, { x: 24, y: 69.5, wall: 1 },
    ],
    // LOADING ZONES (park here): 23 in along the wall x 11 in deep, on tiles A5 (red) and F2 (blue)
    loadingZones: [
      { alliance: 'red', x: -H + 5.5, y: lzRed[1], w: 11, d: 23, wallSide: -1 },
      { alliance: 'blue', x: H - 5.5, y: lzBlue[1], w: 11, d: 23, wallSide: 1 },
    ],
    // GARDENS: 23 x 2 in strips in opposite corners (A1 red, F6 blue); APPROX placement along the alliance wall
    gardens: [
      { alliance: 'red', x: -H + 1, y: gRed[1], w: 2, d: 23 },
      { alliance: 'blue', x: H - 1, y: gBlue[1], w: 2, d: 23 },
    ],
    tapeW: 2,
  };
  // solid things the robot and distance sensors hit. The FLOWERS are drawn but not solid,
  // because their positions along the walls are estimates; a wrong guess would block real paths.
  // The center frame is two A-frames joined at the top. Only their floor rails and legs (along Y at
  // each end of the frame) are solid: robots can drive under the HIVES and between their CELLS.
  const fx = def.frame.w / 2 - 0.75;
  def.obstacles = [-1, 1].map(sx => ({ x: sx * fx, y: 0, w: 2, d: def.frame.d, h: 1.5, field: true, name: 'frame rail' }));
  // The lowest point of a tipped-down CELL is about 22 in above the TILES, so only taller robots hit them.
  def.cellClearance = 22;
  def.cellBlocks = def.hives.flatMap(h => [-1, 1].map(e => ({ x: h.x, y: e * (def.cell.gap / 2 + def.cell.d / 2 - 1), w: def.cell.w, d: def.cell.d + 4, h: 14, field: true, name: 'CELL' })));
  // tape lines a color sensor can see
  const tw = def.tapeW, tapes = [];
  for (const z of def.loadingZones) {
    const rgb = z.alliance === 'red' ? RED : BLUE;
    const inner = z.x - z.wallSide * (z.w / 2 - tw / 2);
    tapes.push({ x: z.x, y: z.y - z.d / 2 + tw / 2, w: z.w, d: tw, rgb }, { x: z.x, y: z.y + z.d / 2 - tw / 2, w: z.w, d: tw, rgb }, { x: inner, y: z.y, w: tw, d: z.d, rgb });
  }
  for (const g of def.gardens) tapes.push({ x: g.x, y: g.y, w: g.w, d: g.d, rgb: g.alliance === 'red' ? RED : BLUE });
  def.tapes = tapes;
  def.RED = RED; def.BLUE = BLUE;
  return def;
})();

function defaultConfig() {
  return {
    drive: 'auto',             // auto | mecanum | tank
    robotLength: 18, robotWidth: 18, robotHeight: 14,
    trackWidth: 14.5, wheelBase: 12.5,
    wheelDiameter: 3.78,       // 96 mm goBILDA mecanum
    driveMotor: 'gobilda-312',
    mirrorLeft: true,          // left-side motors mounted mirrored (standard): left needs REVERSE
    strafeEff: 1.0, speedEff: 0.85, accelTime: 0.3,
    battery: 12.8,
    start: { x: -36, y: -61, h: 90 },
    autoSeconds: 30, enforceAutoTimer: true, startDelay: 1.0,
    devices: {},               // name -> { role, motor, viz, mount, min, max, ... }
    obstacles: [],
    field: 'biobuzz',          // biobuzz | empty
    launchDeg: 55, exitSpeed: 280, shotModel: 2, preload: 4, capacity: 4,
  };
}

function guessRole(name) {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const has = (...w) => w.some(x => n.includes(x));
  const left = has('left') || /^(l|lf|lb|fl|bl|lr|rl)(motor|drive|wheel|\d|$)/.test(n);
  const right = has('right') || /^(r|rf|rb|fr|br|rr)(motor|drive|wheel|\d|$)/.test(n);
  const front = has('front') || /^(fl|fr|lf|rf)(motor|drive|wheel|\d|$)/.test(n);
  const back = has('back', 'rear') || /^(bl|br|lb|rb|lr|rl|rr)(motor|drive|wheel|\d|$)/.test(n);
  if (left && !right) return front ? 'FL' : back ? 'BL' : 'L';
  if (right && !left) return front ? 'FR' : back ? 'BR' : 'R';
  return 'none';
}
function guessViz(name, kind) {
  const n = name.toLowerCase();
  if (kind === 'servo') return /claw|grip|grab|pinch|hand|finger/.test(n) ? 'claw' : 'servo';
  if (kind === 'crservo') return 'spin';
  if (/lift|slide|elevator|extend|linear|vertical|horizontal/.test(n)) return 'lift';
  if (/arm|shoulder|elbow|pivot|wrist|tilt/.test(n)) return 'arm';
  if (/intake|roller|spin|fly|shoot|launch|outtake|sweep|feed|wheel|belt/.test(n)) return 'spin';
  return 'spin';
}
function guessSensorMount(name) {
  const n = name.toLowerCase();
  if (/back|rear/.test(n)) return 'back';
  if (/left/.test(n)) return 'left';
  if (/right/.test(n)) return 'right';
  return 'front';
}

/* scan the source for hardware names so the device table can be filled before running */
function prescanDevices(src) {
  const found = new Map();
  const add = (name, type) => { if (!found.has(name)) found.set(name, type); };
  const re1 = /hardwareMap\s*\.\s*get\s*\(\s*([A-Za-z0-9_.]+)\s*\.\s*class\s*,\s*"([^"]+)"/g;
  let m;
  while ((m = re1.exec(src))) add(m[2], m[1].split('.').pop());
  const re2 = /hardwareMap\s*\.\s*(dcMotor|servo|crservo|touchSensor|colorSensor|digitalChannel|analogInput)\s*\.\s*get\s*\(\s*"([^"]+)"/g;
  const map2 = { dcMotor: 'DcMotor', servo: 'Servo', crservo: 'CRServo', touchSensor: 'TouchSensor', colorSensor: 'ColorSensor', digitalChannel: 'DigitalChannel', analogInput: 'AnalogInput' };
  while ((m = re2.exec(src))) add(m[2], map2[m[1]]);
  const re3 = /hardwareMap\s*\.\s*get\s*\(\s*"([^"]+)"\s*\)/g;
  while ((m = re3.exec(src))) add(m[1], 'Unknown');
  return [...found].map(([name, type]) => ({ name, type }));
}
function kindOfType(t) {
  if (/^(DcMotor|DcMotorEx|DcMotorSimple|DcMotorImplEx|DcMotorImpl)$/.test(t)) return 'motor';
  if (/^(Servo|ServoImplEx|ServoImpl)$/.test(t)) return 'servo';
  if (/^CRServo/.test(t)) return 'crservo';
  if (/IMU/.test(t)) return 'imu';
  if (/Distance|Color|Touch|Digital|Analog|Optical|Light/.test(t)) return 'sensor';
  if (/Pinpoint|OTOS/.test(t)) return 'odometry';
  return 'other';
}
function ensureDevice(cfg, name, type) {
  const kind = kindOfType(type);
  let d = cfg.devices[name];
  if (!d) {
    d = cfg.devices[name] = { type, kind };
    if (kind === 'motor') { d.role = guessRole(name); d.motor = d.role === 'none' ? 'gobilda-312' : cfg.driveMotor; d.viz = guessViz(name, 'motor'); d.min = null; d.max = null; }
    if (kind === 'servo' || kind === 'crservo') { d.viz = guessViz(name, kind); d.start = 0.5; d.rate = 1.6; }
    if (kind === 'sensor') { d.mount = guessSensorMount(name); }
  } else if (d.kind !== kind && kind !== 'other') { d.type = type; d.kind = kind; }
  if (d.job === undefined && FTC.guessJob && (kind === 'motor' || kind === 'servo' || kind === 'crservo')) d.job = ROLES.includes(d.role) ? 'none' : FTC.guessJob(name, kind);
  return d;
}
/* Decide mecanum vs tank from the motors the CURRENT program uses (names), not every motor
   ever saved in this browser's settings. Four corner roles always means mecanum. */
function effectiveDrive(cfg, names) {
  if (cfg.drive !== 'auto') return cfg.drive;
  const use = names ? new Set(names) : null;
  const roles = Object.entries(cfg.devices).filter(([n, d]) => d.kind === 'motor' && (!use || use.has(n))).map(([, d]) => d.role);
  const corners = ['FL', 'FR', 'BL', 'BR'].filter(r => roles.includes(r)).length;
  if (corners >= 3) return 'mecanum';
  if (roles.includes('L') || roles.includes('R')) return 'tank';
  return corners ? 'mecanum' : 'tank';
}

class Sim {
  constructor(cfg) {
    this.cfg = cfg;
    this.t = 0; this.steps = 0;
    this.started = false; this.stopRequested = false; this.finished = false;
    this.cos = []; this.guardCount = 0; this.syncGuard = 0;
    this.frames = []; this.tele = []; this.logs = []; this.errors = [];
    this.devOrder = []; this.devices = new Map();
    this.epochMs = 1761955200000;
    this.startPose = { x: cfg.start.x, y: cfg.start.y, h: cfg.start.h * Math.PI / 180 };
    this.robot = { x: this.startPose.x, y: this.startPose.y, h: this.startPose.h, vx: 0, vy: 0, w: 0, bump: 0 };
    this.trail = [];
    this.stopReason = null; this.startT = null; this.endT = null;
    this.input = null; // () => {gamepad1: state, gamepad2: state}
    this.drive = effectiveDrive(cfg, []);
    this.lastTele = [];
    this.gameFrames = [];
    this.game = cfg.field === 'biobuzz' && FTC.Game ? new FTC.Game(this) : null;
  }

  /* ---- config lookups for devices */
  motorCfg(name) {
    const d = ensureDevice(this.cfg, name, 'DcMotor');
    const m = MOTORS[d.motor] || MOTORS['gobilda-312'];
    const isDrive = ROLES.includes(d.role);
    return {
      tpr: m.tpr, rpm: m.rpm, eff: this.cfg.speedEff, role: d.role, isDrive, viz: d.viz,
      accelTime: isDrive ? this.cfg.accelTime : 0.08, brakeTime: isDrive ? 0.16 : 0.05, coastTime: isDrive ? 1.4 : 0.6,
      min: d.min == null || d.min === '' ? null : Number(d.min), max: d.max == null || d.max === '' ? null : Number(d.max),
    };
  }
  servoCfg(name) {
    const d = this.cfg.devices[name] || ensureDevice(this.cfg, name, 'Servo');
    return { start: d.start == null ? 0.5 : d.start, rate: d.rate || 1.6, viz: d.viz };
  }
  sensorCfg(name, kind) {
    const d = ensureDevice(this.cfg, name, kind === 'distance' ? 'DistanceSensor' : kind === 'color' ? 'ColorSensor' : kind === 'touch' ? 'TouchSensor' : 'AnalogInput');
    d.sensorKind = kind;
    const sim = this;
    return {
      kind,
      get mount() { return d.mount || 'front'; },
      range: kind === 'distance' ? 78.74 : 1e9,
      sim,
    };
  }
  registerDevice(name, dev, jtype) {
    ensureDevice(this.cfg, name, jtype);
    this.devices.set(name, dev);
    if (dev.$state && (dev.$step)) this.devOrder.push(name);
    if (dev.$cfg && dev.$cfg.isDrive !== undefined) this.drive = effectiveDrive(this.cfg, [...this.devices.keys()]);
  }
  totalCurrent() { let c = 0; for (const d of this.devices.values()) if (d.$current) c += d.$current; return c; }

  /* ---- logging */
  log(level, msg) { if (this.logs.length < 6000) this.logs.push({ t: this.t, level, msg: String(msg) }); }
  event(kind, msg) { if (this.logs.length < 6000) this.logs.push({ t: this.t, level: 'event', kind, msg }); }
  pushTelemetry(lines) {
    this.lastTele = lines;
    const last = this.tele[this.tele.length - 1];
    const key = JSON.stringify(lines);
    if (last && last.key === key) return;
    if (this.tele.length < 40000) this.tele.push({ t: this.t, lines, key });
  }

  /* ---- program lifecycle */
  /* Full match: end the current program and start another on the same robot and field.
     Like the SDK between OpModes, motors stop and go back to FORWARD / RUN_WITHOUT_ENCODER;
     encoder counts and servo positions are kept. */
  switchProgram(compiled, opInfo) {
    if (!this.finished) this.finishOpMode('Switched to ' + opInfo.name);
    const RC = FTC.runtimeCore;
    for (const d of this.devices.values()) {
      const k = d.constructor && d.constructor.$kind;
      if (k === 'motor') { d.power = 0; d.velTarget = null; d.dir = RC.Direction.FORWARD; d.mode = RC.RunMode.RUN_WITHOUT_ENCODER; d.zpb = RC.ZeroPowerBehavior.BRAKE; d.offset = d.offset; }
      if (k === 'crservo') { d.power = 0; d.dir = RC.Direction.FORWARD; }
    }
    this.cos = []; this.started = false; this.stopRequested = false; this.finished = false;
    this.stopReason = null; this.startT = null; this.endT = null; this.stopT = null;
    return this.load(compiled, opInfo, true);
  }
  load(compiled, opInfo, keepHardware) {
    this.rt = FTC.createRuntime(this);
    FTC.$rand = new FTC.runtimeCore.JRandom(12345);
    let prog;
    try {
      prog = new Function('$rt', compiled.code)(this.rt);
      this.program = prog;
      prog.init();
    } catch (e) {
      if (e instanceof SyntaxError) { const w = new Error(`The simulator could not translate this code (${e.message}). Try simplifying the line it points to.`); w.$fatal = true; this.fail(w, 'while loading the program'); }
      else this.fail(e, 'while loading the program');
      return false;
    }
    const Cls = prog.classes[opInfo.className];
    this.opInfo = opInfo;
    if (!keepHardware || !this.hardwareMap) {
      this.telemetry = new this.rt.Telemetry(lines => this.pushTelemetry(lines));
      this.hardwareMap = new this.rt.HardwareMap();
      this.gamepad1 = new this.rt.Gamepad(1);
      this.gamepad2 = new this.rt.Gamepad(2);
    }
    try {
      this.op = new Cls();
    } catch (e) { this.fail(e, 'while creating the OpMode'); return false; }
    Object.assign(this.op, { telemetry: this.telemetry, hardwareMap: this.hardwareMap, gamepad1: this.gamepad1, gamepad2: this.gamepad2 });
    this.op.$t0 = 0;
    const self = this;
    const op = this.op;
    const $y = this.rt.h.$y;
    let main;
    if (opInfo.kind === 'linear') {
      main = (function* () { yield* $y(op.runOpMode()); })();
    } else {
      main = (function* () {
        yield* $y(op.init());
        self.telemetry.update();
        while (!self.started && !self.stopRequested) {
          yield 0;
          if (self.stopRequested) break;
          if (!self.started) { yield* $y(op.init_loop()); self.telemetry.update(); }
        }
        if (self.stopRequested && !self.started) return;
        yield* $y(op.start());
        self.telemetry.update();
        while (!self.stopRequested) {
          op.time = op.getRuntime();
          yield* $y(op.loop());
          self.telemetry.update();
          yield 0;
        }
      })();
    }
    this.spawn(main, 'main', () => this.onMainDone());
    if (!keepHardware) this.record(true);
    this.event('program', `Loaded ${opInfo.name}`);
    return true;
  }
  spawn(gen, name, onDone) { this.cos.push({ gen, name, wake: this.t, done: false, onDone, value: undefined }); }
  start() {
    if (this.started || this.finished) return;
    this.started = true;
    this.startT = this.t;
    if (this.op) this.op.$t0 = this.t;
    this.event('start', 'START pressed');
  }
  requestStop(reason) {
    if (this.stopRequested) return;
    this.stopRequested = true;
    this.stopT = this.t;
    if (!this.stopReason) this.stopReason = reason || 'STOP pressed';
    this.event('stop', this.stopReason);
  }
  onMainDone() {
    if (this.opInfo && this.opInfo.kind === 'iterative' && this.started && this.stopRequested) {
      // iterative OpMode: stop() after loop ends
    }
    this.finishOpMode(this.stopReason || 'OpMode finished');
  }
  finishOpMode(reason) {
    if (this.finished) return;
    this.finished = true;
    this.endT = this.t;
    if (!this.stopReason) this.stopReason = reason;
    for (const c of this.cos) if (!c.done) { try { c.gen.return(); } catch (e) { /* ignore */ } c.done = true; }
    // the SDK stops motors and CR servos when an OpMode ends
    for (const d of this.devices.values()) {
      if (d.constructor && d.constructor.$kind === 'motor') { d.power = 0; d.velTarget = null; if (d.mode && d.mode.$name === 'RUN_TO_POSITION') d.mode = FTC.runtimeCore.RunMode.RUN_USING_ENCODER; }
      if (d.constructor && d.constructor.$kind === 'crservo') d.power = 0;
    }
    this.event('end', this.stopReason);
  }
  fail(e, where) {
    const line = this.program && this.program.line ? this.program.line() : null;
    const ex = e && e.$fatal ? e : (this.rt ? this.rt.h.$wrap.call(null, e && e.$fatal ? null : e) : e);
    let jtype = ex && ex.constructor && ex.constructor.$jname ? ex.constructor.$jname : (e && e.name) || 'Error';
    let msg = ex && (ex.getMessage ? ex.getMessage() : ex.message);
    if (e && e.name === 'SimUnsupported') { jtype = 'Not simulated'; msg = e.message; }
    const err = { t: this.t, line, type: jtype, message: msg || '', where: where || '', js: e && e.stack };
    this.errors.push(err);
    this.log('error', `${jtype}${msg ? ': ' + msg : ''}${line ? ` (line ${line})` : ''}`);
    if (!this.stopRequested) this.stopRequested = true;
    this.stopReason = `Stopped by an error${line ? ' on line ' + line : ''}`;
    this.finishOpMode(this.stopReason);
  }

  /* ---- scheduler */
  runCoroutines() {
    for (let i = 0; i < this.cos.length; i++) {
      const c = this.cos[i];
      if (c.done || this.t + 1e-9 < c.wake) continue;
      let r;
      FTC.runtimeCore.setSim(this);
      try { r = c.gen.next(); }
      catch (e) {
        c.done = true;
        if (e && e.$terminate) { this.finishOpMode('terminateOpModeNow() was called'); return; }
        this.fail(e, c.name === 'main' ? '' : 'in a background thread');
        return;
      }
      if (r.done) { c.done = true; if (c.onDone) c.onDone(); if (this.finished) return; continue; }
      const v = typeof r.value === 'number' && r.value > 0 ? r.value : 0;
      c.wake = this.t + Math.max(v, 1e-6);
    }
    if (this.cos.length > 8 && this.cos.every(c => c.done)) this.cos = [];
  }
  /* blocking call from a context that can't yield (constructor, lambda, field init) */
  advanceInline(sec) {
    const n = Math.max(1, Math.round(sec / DT));
    for (let i = 0; i < n; i++) this.physicsStep();
  }
  step() {
    if (this.spun) { this.spinSteps = (this.spinSteps || 0) + 1; this.spun = false; } else this.spinSteps = 0;
    if (this.spinSteps === 400) { this.spinSteps = 401; this.log('warn', 'Your code has been looping for 2 s without sleep(), idle(), or opModeIsActive(). On a real robot this loop still runs, but it never gives other code a chance to run.'); }
    this.guardCount = 0; this.syncGuard = 0;
    if (this.input && !this.finished) {
      const st = this.input();
      if (st) { this.gamepad1.$apply(st.gamepad1 || {}); this.gamepad2.$apply(st.gamepad2 || {}); }
    }
    if (!this.finished) this.runCoroutines();
    // stop handling: give the code 1 s to exit after stop is requested
    if (this.stopRequested && !this.finished && this.t - this.stopT > 1.0) this.finishOpMode(this.stopReason + ' (forced after 1 s)');
    // match timer for autonomous
    if (this.started && !this.stopRequested && this.opInfo && this.opInfo.type === 'Autonomous' && this.cfg.enforceAutoTimer && this.t - this.startT >= this.cfg.autoSeconds - 1e-9) {
      this.requestStop(`Autonomous period ended (${this.cfg.autoSeconds} s)`);
    }
    this.physicsStep();
  }
  physicsStep() {
    for (const name of this.devOrder) this.devices.get(name).$step(DT);
    this.integrateRobot(DT);
    if (this.game) this.game.step(DT);
    this.steps++;
    this.t = Math.round(this.steps * DT * 1e6) / 1e6;
    if (this.steps % RECORD_EVERY === 0) this.record(false);
  }

  /* ---- drivetrain */
  wheelRoll() {
    const c = this.cfg;
    const circ = Math.PI * c.wheelDiameter;
    const w = { FL: [], FR: [], BL: [], BR: [], L: [], R: [] };
    for (const [name, dev] of this.devices) {
      if (!(dev.$cfg && dev.$cfg.isDrive)) continue;
      const role = dev.$cfg.role;
      const left = role === 'FL' || role === 'BL' || role === 'L';
      const side = left && c.mirrorLeft ? -1 : 1;
      w[role].push(side * dev.physVel / dev.$cfg.tpr * circ);
    }
    const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
    return { FL: avg(w.FL), FR: avg(w.FR), BL: avg(w.BL), BR: avg(w.BR), L: avg(w.L), R: avg(w.R) };
  }
  integrateRobot(dt) {
    const c = this.cfg, r = this.robot;
    const W = this.wheelRoll();
    let vx = 0, vy = 0, w = 0;
    const drive = this.drive;
    if (drive === 'mecanum') {
      const fl = W.FL ?? W.L ?? 0, bl = W.BL ?? W.L ?? 0, fr = W.FR ?? W.R ?? 0, br = W.BR ?? W.R ?? 0;
      const k = (c.trackWidth + c.wheelBase) / 2;
      vx = (fl + fr + bl + br) / 4;
      vy = (-fl + fr + bl - br) / 4 * c.strafeEff;
      w = (-fl + fr - bl + br) / (4 * k);
    } else {
      const ls = [W.FL, W.BL, W.L].filter(x => x !== null), rs = [W.FR, W.BR, W.R].filter(x => x !== null);
      const l = ls.length ? ls.reduce((a, b) => a + b) / ls.length : 0;
      const rr = rs.length ? rs.reduce((a, b) => a + b) / rs.length : 0;
      vx = (l + rr) / 2;
      w = (rr - l) / c.trackWidth;
    }
    const ch = Math.cos(r.h), sh = Math.sin(r.h);
    r.vx = vx * ch - vy * sh;
    r.vy = vx * sh + vy * ch;
    r.w = w;
    r.x += r.vx * dt; r.y += r.vy * dt; r.h += w * dt;
    r.bump = Math.max(0, r.bump - dt);
    this.collide();
  }
  corners(x, y, h) {
    const L = this.cfg.robotLength / 2, Wd = this.cfg.robotWidth / 2;
    const c = Math.cos(h), s = Math.sin(h);
    return [[L, Wd], [L, -Wd], [-L, -Wd], [-L, Wd]].map(([a, b]) => [x + a * c - b * s, y + a * s + b * c]);
  }
  collide() {
    const r = this.robot;
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      const cs = this.corners(r.x, r.y, r.h);
      let dx = 0, dy = 0;
      for (const [x, y] of cs) {
        if (x > FIELD_HALF) dx = Math.min(dx, FIELD_HALF - x);
        if (x < -FIELD_HALF) dx = Math.max(dx, -FIELD_HALF - x);
        if (y > FIELD_HALF) dy = Math.min(dy, FIELD_HALF - y);
        if (y < -FIELD_HALF) dy = Math.max(dy, -FIELD_HALF - y);
      }
      for (const o of this.allObstacles()) {
        const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, y0 = o.y - o.d / 2, y1 = o.y + o.d / 2;
        for (const [x, y] of cs) {
          if (x > x0 && x < x1 && y > y0 && y < y1) {
            const opts = [[x0 - x, 0], [x1 - x, 0], [0, y0 - y], [0, y1 - y]];
            opts.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
            const [px, py] = opts[0];
            if (Math.abs(px) > Math.abs(dx)) dx = px;
            if (Math.abs(py) > Math.abs(dy)) dy = py;
          }
        }
        // obstacle corners inside the robot
        const c = Math.cos(-r.h), s = Math.sin(-r.h);
        const L = this.cfg.robotLength / 2, Wd = this.cfg.robotWidth / 2;
        for (const [ox, oy] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) {
          const lx = (ox - r.x) * c - (oy - r.y) * s, ly = (ox - r.x) * s + (oy - r.y) * c;
          if (Math.abs(lx) < L && Math.abs(ly) < Wd) {
            const penX = L - Math.abs(lx), penY = Wd - Math.abs(ly);
            let mx = 0, my = 0;
            if (penX < penY) mx = -Math.sign(lx) * penX; else my = -Math.sign(ly) * penY;
            const ch = Math.cos(r.h), sh = Math.sin(r.h);
            const wx = mx * ch - my * sh, wy = mx * sh + my * ch;
            if (Math.abs(wx) > Math.abs(dx)) dx = wx;
            if (Math.abs(wy) > Math.abs(dy)) dy = wy;
          }
        }
      }
      if (!dx && !dy) break;
      hit = true;
      r.x += dx; r.y += dy;
      if (dx && Math.sign(r.vx) === -Math.sign(dx)) r.vx = 0;
      if (dy && Math.sign(r.vy) === -Math.sign(dy)) r.vy = 0;
    }
    if (hit) { if (r.bump <= 0) this.event('bump', 'Robot hit a wall or obstacle'); r.bump = 0.3; }
  }

  allObstacles() {
    const user = this.cfg.obstacles || [];
    if (this.cfg.field !== 'biobuzz') return user;
    const tall = (this.cfg.robotHeight || 14) > BIOBUZZ.cellClearance;
    return BIOBUZZ.obstacles.concat(tall ? BIOBUZZ.cellBlocks : [], user);
  }

  /* ---- sensors */
  sensorPose(cfg) {
    const r = this.robot, L = this.cfg.robotLength / 2, Wd = this.cfg.robotWidth / 2;
    const m = cfg.mount;
    const local = { front: [L, 0, 0], back: [-L, 0, Math.PI], left: [0, Wd, Math.PI / 2], right: [0, -Wd, -Math.PI / 2], down: [L * 0.6, 0, 0] }[m] || [L, 0, 0];
    const c = Math.cos(r.h), s = Math.sin(r.h);
    return { x: r.x + local[0] * c - local[1] * s, y: r.y + local[0] * s + local[1] * c, a: r.h + local[2] };
  }
  raycast(cfg) {
    const p = this.sensorPose(cfg);
    const dx = Math.cos(p.a), dy = Math.sin(p.a);
    let best = Infinity;
    const H = FIELD_HALF;
    if (dx > 1e-9) best = Math.min(best, (H - p.x) / dx);
    if (dx < -1e-9) best = Math.min(best, (-H - p.x) / dx);
    if (dy > 1e-9) best = Math.min(best, (H - p.y) / dy);
    if (dy < -1e-9) best = Math.min(best, (-H - p.y) / dy);
    for (const o of this.allObstacles()) {
      const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, y0 = o.y - o.d / 2, y1 = o.y + o.d / 2;
      let tmin = -Infinity, tmax = Infinity;
      for (const [pp, d, a, b] of [[p.x, dx, x0, x1], [p.y, dy, y0, y1]]) {
        if (Math.abs(d) < 1e-9) { if (pp < a || pp > b) { tmin = Infinity; break; } }
        else { let t1 = (a - pp) / d, t2 = (b - pp) / d; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); }
      }
      if (tmin <= tmax && tmax >= 0) best = Math.min(best, Math.max(0, tmin));
    }
    return Math.max(0, best);
  }
  floorColor(cfg) {
    const p = this.sensorPose(Object.assign({}, cfg, { mount: 'down' }));
    for (const tp of (this.cfg.tapes || []).concat(this.cfg.field === 'biobuzz' ? BIOBUZZ.tapes : [])) {
      if (Math.abs(p.x - tp.x) <= tp.w / 2 && Math.abs(p.y - tp.y) <= tp.d / 2) return tp.rgb;
    }
    return [0.21, 0.22, 0.24];
  }

  /* ---- recording */
  record(force) {
    const r = this.robot;
    const f = [this.t, r.x, r.y, r.h];
    for (const name of this.devOrder) { const s = this.devices.get(name).$state(); f.push(s[0], s[1], s[2]); }
    this.frames.push({ f: Float64Array.from(f), n: this.devOrder.length });
    if (force) this.frameDevs = this.devOrder.slice();
    if (this.game && (force || this.frames.length % 5 === 0)) this.gameFrames.push(Object.assign({ t: this.t }, this.game.snapshot()));
  }

  /* ---- run modes */
  runFast(opts = {}) {
    const maxT = opts.maxT || (this.cfg.autoSeconds + this.cfg.startDelay + 3);
    const wallLimit = opts.wallLimit || 20000;
    const w0 = Date.now();
    let settle = 0;
    while (this.t < maxT) {
      if (!this.started && !this.finished && this.t >= this.cfg.startDelay) this.start();
      this.step();
      if (this.finished) { settle += DT; if (settle > 1.0) break; }
      if (this.steps % 200 === 0 && Date.now() - w0 > wallLimit) {
        const e = new Error(`The simulation took longer than ${Math.round(wallLimit / 1000)} s of real time. A loop may be running without sleep(), idle(), or opModeIsActive().`);
        e.$fatal = true;
        this.fail(e, '');
        break;
      }
    }
    if (!this.finished) { this.requestStop('Simulation time limit reached'); this.finishOpMode('Simulation time limit reached'); }
    this.record(true);
  }
  advanceRealtime(sec, maxSteps = 40) {
    this.acc = (this.acc || 0) + sec;
    let n = 0;
    while (this.acc >= DT && n < maxSteps) { this.step(); this.acc -= DT; n++; }
    if (n >= maxSteps) this.acc = 0;
    return n;
  }
}

FTC.Sim = Sim;
FTC.SIM_DT = DT;
FTC.FIELD_HALF = FIELD_HALF;
FTC.MOTORS = MOTORS;
FTC.defaultConfig = defaultConfig;
FTC.BIOBUZZ = BIOBUZZ;
FTC.prescanDevices = prescanDevices;
FTC.ensureDevice = ensureDevice;
FTC.kindOfType = kindOfType;
FTC.effectiveDrive = effectiveDrive;
FTC.guessRole = guessRole;
if (typeof module !== 'undefined' && module.exports) module.exports = FTC;
})(typeof globalThis !== 'undefined' ? globalThis : window);
