/* FTC SDK emulation. createRuntime(sim) builds the $rt object for one run. */
(function (G) {
'use strict';
const FTC = (G.FTC = G.FTC || {});
const R = FTC.runtimeCore;
const { EXC, dstr, fstr, jformat, str, isGen, single, runInline, JEnum, makeEnum, JList, Direction, RunMode, ZeroPowerBehavior,
  ServoDirection, AngleUnit, DistanceUnit, CurrentUnit, TimeUnit, Resolution, anything, GUARD_LIMIT, HW_READ_COST } = R;

const clip = (v, a, b) => Math.min(Math.max(v, a), b);
const BNO_AngleUnit = makeEnum('BNO055IMU.AngleUnit', ['DEGREES', 'RADIANS']);
const AxesReference = makeEnum('AxesReference', ['EXTRINSIC', 'INTRINSIC']);
const AxesOrder = makeEnum('AxesOrder', ['XZX', 'XYX', 'YXY', 'YZY', 'ZYZ', 'ZXZ', 'XZY', 'XYZ', 'YXZ', 'YZX', 'ZYX', 'ZXY']);
const BulkCachingMode = makeEnum('LynxModule.BulkCachingMode', ['OFF', 'AUTO', 'MANUAL']);
const DigitalMode = makeEnum('DigitalChannel.Mode', ['INPUT', 'OUTPUT']);
const LogoFacing = makeEnum('RevHubOrientationOnRobot.LogoFacingDirection', ['UP', 'DOWN', 'FORWARD', 'BACKWARD', 'LEFT', 'RIGHT']);
const UsbFacing = makeEnum('RevHubOrientationOnRobot.UsbFacingDirection', ['UP', 'DOWN', 'FORWARD', 'BACKWARD', 'LEFT', 'RIGHT']);
const PodType = makeEnum('GoBildaPinpointDriver.GoBildaOdometryPods', ['goBILDA_SWINGARM_POD', 'goBILDA_4_BAR_POD']);
const EncDir = makeEnum('GoBildaPinpointDriver.EncoderDirection', ['FORWARD', 'REVERSED']);
const PinStatus = makeEnum('GoBildaPinpointDriver.DeviceStatus', ['NOT_READY', 'READY', 'CALIBRATING', 'FAULT_X_POD_NOT_DETECTED', 'FAULT_Y_POD_NOT_DETECTED', 'FAULT_NO_PODS_DETECTED', 'FAULT_IMU_RUNAWAY', 'FAULT_BAD_READ']);
const ReadData = makeEnum('GoBildaPinpointDriver.ReadData', ['ONLY_UPDATE_HEADING']);
const GamepadType = makeEnum('Gamepad.Type', ['UNKNOWN', 'LOGITECH_F310', 'XBOX_360', 'SONY_PS4', 'SONY_PS4_SUPPORTED_BY_KERNEL']);

const GP_BUTTONS = ['a', 'b', 'x', 'y', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'left_bumper', 'right_bumper',
  'left_stick_button', 'right_stick_button', 'start', 'back', 'guide', 'touchpad'];
const GP_ALIAS = { cross: 'a', circle: 'b', square: 'x', triangle: 'y', options: 'start', share: 'back', ps: 'guide' };
const camel = s => s.replace(/_([a-z])/g, (m, c) => c.toUpperCase());

class PIDFCoefficients {
  constructor(p = 0, i = 0, d = 0, f = 0, alg) { if (p instanceof PIDFCoefficients) { this.p = p.p; this.i = p.i; this.d = p.d; this.f = p.f; } else { this.p = p; this.i = i; this.d = d; this.f = f; } this.algorithm = alg || null; }
  toString() { return `PIDFCoefficients(p=${this.p} i=${this.i} d=${this.d} f=${this.f})`; }
}
class PIDCoefficients { constructor(p = 0, i = 0, d = 0) { this.p = p; this.i = i; this.d = d; } }

class Pose2D {
  constructor(du, x, y, au, h) { this.du = du; this.x = x; this.y = y; this.au = au; this.h = h; }
  getX(u) { return (u || this.du).fromInches(this.du.toInches(this.x)); }
  getY(u) { return (u || this.du).fromInches(this.du.toInches(this.y)); }
  getHeading(u) { return (u || this.au).fromRadians(this.au.toRadians(this.h)); }
  toString() { return `(${this.x.toFixed(3)}${this.du.$name.toLowerCase()} ${this.y.toFixed(3)}${this.du.$name.toLowerCase()} ${this.h.toFixed(3)}${this.au.$name.toLowerCase()})`; }
}

/* 2D transforms for odometry readouts: pose = {x, y, h} */
const compose = (a, b) => ({ x: a.x + b.x * Math.cos(a.h) - b.y * Math.sin(a.h), y: a.y + b.x * Math.sin(a.h) + b.y * Math.cos(a.h), h: a.h + b.h });
const invert = a => ({ x: -a.x * Math.cos(a.h) - a.y * Math.sin(a.h), y: a.x * Math.sin(a.h) - a.y * Math.cos(a.h), h: -a.h });
const wrapPi = r => { r = ((r % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; return r; };

function createRuntime(sim) {
  R.setSim(sim);
  const hw = (cost = HW_READ_COST) => { sim.guardCount += cost; };

  /* ---------------- helpers used by generated code */
  const h = {
    $sync: x => (isGen(x) ? runInline(x) : x),
    $y: x => (isGen(x) ? x : single(x)),
    $g: () => { if (++sim.guardCount >= GUARD_LIMIT) { sim.guardCount = 0; sim.spun = true; return true; } return false; },
    $gs: () => { if (++sim.syncGuard > 2e7) { const e = new Error('A loop ran 20 million times without pausing. This looks like an infinite loop inside a lambda or constructor.'); e.$fatal = true; throw e; } },
    $idiv: (a, b) => { if (b === 0) throw new EXC.ArithmeticException('/ by zero'); return Math.trunc(a / b); },
    $toInt: x => { if (typeof x !== 'number') x = Number(x); if (Number.isNaN(x)) return 0; if (x >= 2147483647) return 2147483647; if (x <= -2147483648) return -2147483648; return Math.trunc(x); },
    $dstr: dstr, $fstr: fstr, $str: str, $eq: R.eq,
    $eqi: (a, b) => R.eq(a, a) && b != null && String(a).toLowerCase() === String(b).toLowerCase(),
    $len: x => { if (x == null) throw new EXC.NullPointerException('Cannot call length() on null'); return typeof x === 'string' ? x.length : x.length(); },
    $isEmpty: x => { if (x == null) throw new EXC.NullPointerException('Cannot call isEmpty() on null'); return typeof x === 'string' ? x.length === 0 : x.isEmpty(); },
    $contains: (x, y) => { if (x == null) throw new EXC.NullPointerException('Cannot call contains() on null'); return typeof x === 'string' ? x.includes(typeof y === 'number' ? String.fromCharCode(y) : str(y)) : x.contains(y); },
    $cmp: (a, b) => { if (typeof a === 'string') return a < b ? -1 : a > b ? 1 : 0; if (typeof a === 'number') return a < b ? -1 : a > b ? 1 : 0; return a.compareTo(b); },
    $charAt: (s, i) => { if (typeof s !== 'string') return s.charAt(i); if (i < 0 || i >= s.length) throw new EXC.IndexOutOfBoundsException(`Index ${i} out of bounds for length ${s.length}`); return s.charCodeAt(i); },
    $hash: R.hash,
    $split: (s, re) => { const parts = s.split(new RegExp(re)); while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop(); return parts; },
    $replace: (s, a, b) => { if (typeof s !== 'string') return s.replace(a, b); const A = typeof a === 'number' ? String.fromCharCode(a) : String(a), B = typeof b === 'number' ? String.fromCharCode(b) : String(b); return s.split(A).join(B); },
    $replaceAll: (s, a, b) => s.replace(new RegExp(a, 'g'), String(b).replace(/\$(\d)/g, '$$$1')),
    $matches: (s, re) => new RegExp('^(?:' + re + ')$').test(s),
    $getClass: x => { const n = x == null ? 'null' : typeof x === 'string' ? 'String' : typeof x === 'number' ? 'Double' : (x.constructor.$simple || x.constructor.name); return { getSimpleName: () => n, getName: () => n, toString: () => 'class ' + n }; },
    $wrap: e => {
      if (e && e.$fatal) throw e;
      if (e instanceof EXC.Throwable) return e;
      if (e instanceof TypeError) { const w = new EXC.NullPointerException(npeMessage(e.message)); w.$js = e; return w; }
      if (e instanceof RangeError && /call stack/i.test(e.message)) return new EXC.StackOverflowError(e.message);
      const w = new EXC.RuntimeException(e && e.message ? e.message : String(e)); w.$js = e; return w;
    },
    $inst: (e, ...names) => { const n = R.excNames(e); return names.some(x => n.includes(x)); },
    $is: (x, t) => {
      if (x == null) return false;
      if (t === 'String' || t === 'CharSequence') return typeof x === 'string';
      if (t === 'Integer' || t === 'Long' || t === 'Short' || t === 'Byte') return typeof x === 'number' && Number.isInteger(x);
      if (t === 'Double' || t === 'Float' || t === 'Number') return typeof x === 'number';
      if (t === 'Boolean') return typeof x === 'boolean';
      if (t === 'Object') return true;
      if (/^(List|ArrayList|LinkedList|Collection|Iterable)$/.test(t)) return x instanceof JList;
      if (/Map$/.test(t)) return x instanceof R.JMap;
      if (/Set$/.test(t)) return x instanceof R.JSet;
      if (x instanceof EXC.Throwable) return R.excNames(x).includes(t);
      const names = x.constructor && x.constructor.$names;
      return !!names && names.includes(t);
    },
    $lam: f => new Proxy(Object.assign(f, LAMBDA_METHODS(f)), { get: (t, p) => (p in t || typeof p !== 'string' || p === 'then' || p.startsWith('$') ? t[p] : (...a) => t(...a)) }),
    $newArr: function newArr(dims, def) { const n = dims[0]; if (n < 0) throw new EXC.IllegalArgumentException('Negative array size: ' + n); const a = new Array(n); for (let i = 0; i < n; i++) a[i] = dims.length > 1 ? newArr(dims.slice(1), def) : def; return a; },
    $it: R.it,
    $mixin: (C, I) => { for (const k of Object.getOwnPropertyNames(I.prototype)) if (k !== 'constructor' && !(k in C.prototype)) Object.defineProperty(C.prototype, k, Object.getOwnPropertyDescriptor(I.prototype, k)); },
    $Enum: JEnum,
    $base: C => { if (C && C.$unsupported) throw new SimUnsupported(C.$unsupported); return typeof C === 'function' ? C : class {}; },
    $unsupported: n => { throw new SimUnsupported(n); },
    $nn: (x, m) => { if (x == null) throw new EXC.NullPointerException(`Cannot invoke "${m}()" because the value is null`); return x; },
  };
  function LAMBDA_METHODS(f) {
    const m = {};
    for (const k of ['run', 'apply', 'accept', 'get', 'test', 'compare', 'applyAsDouble', 'applyAsInt', 'applyAsLong', 'getAsDouble', 'getAsInt', 'getAsBoolean', 'getAsLong', 'value', 'execute', 'update', 'invoke'])
      m[k] = (...a) => f(...a);
    return m;
  }
  h.$lamg = g => { const f = (...a) => runInline(g(...a)); f.$gen = g; return h.$lam(f); };
  function npeMessage(m) {
    const r = /Cannot read propert(?:y|ies) of (null|undefined) \(reading '([^']+)'\)/.exec(m || '');
    if (r) return `Cannot use '${r[2]}' because the object is null. A variable was used before it was set (often a hardwareMap.get(...) that hasn't run yet).`;
    const s = /(\S+) is not a function/.exec(m || '');
    if (s) return `${s[1]} is not a method the simulator knows about.`;
    return m;
  }
  class SimUnsupported extends Error {
    constructor(name) {
      super(`'${name}' isn't available in this simulator. ` + (UNSUPPORTED_HINT[name] || 'Only the core FTC SDK (motors, servos, IMU, common sensors, telemetry, gamepads) and goBILDA Pinpoint / SparkFun OTOS odometry are simulated.'));
      this.name = 'SimUnsupported'; this.$fatal = true;
    }
  }
  const UNSUPPORTED_HINT = {
    MecanumDrive: 'Road Runner drive classes live in your own project files. Paste plain SDK code (setPower, RUN_TO_POSITION, IMU turns) to simulate.',
    SampleMecanumDrive: 'Road Runner isn\'t simulated. Paste plain SDK drive code instead.',
    Pose2d: 'Road Runner (com.acmerobotics.roadrunner) isn\'t simulated.',
    Follower: 'Pedro Pathing isn\'t simulated.',
  };

  /* ---------------- Telemetry */
  class Telemetry {
    constructor(sink) { this.$sink = sink; this.$items = []; this.$auto = true; this.$sep = ' : '; this.$log = null; }
    addData(caption, ...a) {
      let value;
      if (a.length >= 2 && typeof a[0] === 'string') value = { fmt: a[0], args: a.slice(1) };
      else if (a.length === 1 && typeof a[0] === 'function' && !a[0].$jname) value = { fn: a[0] };
      else value = { v: a[0] };
      const item = new TelemetryItem(this, String(caption), value);
      this.$items.push(item);
      return item;
    }
    addLine(s) { const item = new TelemetryItem(this, s == null ? '' : String(s), null); item.$line = true; this.$items.push(item); return item; }
    removeItem(i) { const k = this.$items.indexOf(i); if (k >= 0) { this.$items.splice(k, 1); return true; } return false; }
    removeLine(i) { return this.removeItem(i); }
    update() {
      hw(HW_READ_COST / 4);
      const lines = this.$items.map(i => i.render());
      if (this.$sink) this.$sink(lines);
      if (this.$auto) this.$items = this.$items.filter(i => i.$retained);
      return true;
    }
    clear() { this.$items = this.$items.filter(i => i.$retained); }
    clearAll() { this.$items = []; if (this.$log) this.$log.clear(); }
    setAutoClear(b) { this.$auto = !!b; }
    isAutoClear() { return this.$auto; }
    getMsTransmissionInterval() { return 250; }
    setMsTransmissionInterval() {}
    getCaptionValueSeparator() { return this.$sep; }
    setCaptionValueSeparator(s) { this.$sep = s; }
    getItemSeparator() { return ' | '; }
    setItemSeparator() {}
    setDisplayFormat() {}
    setNumDecimalPlaces() {}
    speak() {}
    addAction(r) { return r; }
    removeAction() { return true; }
    log() {
      if (!this.$log) {
        const lines = [];
        this.$log = {
          add: (fmt, ...args) => { const s = args.length ? jformat(fmt, args) : str(fmt); lines.push(s); sim.log('telemetry', s); },
          clear: () => { lines.length = 0; }, setCapacity() {}, getCapacity: () => 9, setDisplayOrder() {}, getDisplayOrder: () => null, $lines: lines,
        };
      }
      return this.$log;
    }
  }
  class TelemetryItem {
    constructor(t, caption, value) { this.t = t; this.caption = caption; this.value = value; this.$retained = false; this.$sub = []; }
    setCaption(c) { this.caption = String(c); return this; }
    getCaption() { return this.caption; }
    setValue(...a) { this.value = a.length >= 2 && typeof a[0] === 'string' ? { fmt: a[0], args: a.slice(1) } : { v: a[0] }; return this; }
    setRetained(b) { this.$retained = b == null ? true : !!b; return this; }
    isRetained() { return this.$retained; }
    addData(c, ...a) { const it = this.t.addData(c, ...a); this.t.$items.pop(); this.$sub.push(it); return it; }
    render() {
      if (this.$line) return [this.caption + this.$sub.map(s => ' ' + s.render()[0]).join(''), null];
      return [this.caption, this.renderValue()];
    }
    renderValue() {
      const v = this.value;
      if (!v) return '';
      if (v.fmt !== undefined) return jformat(v.fmt, v.args);
      if (v.fn) { const r = v.fn(); return fmtVal(isGen(r) ? runInline(r) : r); }
      return fmtVal(v.v);
    }
  }
  const fmtVal = x => (typeof x === 'number' ? (Number.isInteger(x) ? String(x) : dstr(x)) : str(x));
  const nullTelemetry = () => new Telemetry(null);

  /* ---------------- Devices */
  const names = (...n) => n;
  class HardwareDevice {
    getDeviceName() { return this.constructor.$deviceName || 'Device'; }
    getConnectionInfo() { return 'simulated; port ' + (this.$port || 0); }
    getManufacturer() { return 'Other'; }
    getVersion() { return 1; }
    resetDeviceConfigurationForOpMode() {}
    close() {}
    getPortNumber() { return this.$port || 0; }
    getController() { return anything('Controller'); }
    toString() { return this.$name; }
  }

  class Motor extends HardwareDevice {
    constructor(name, port) {
      super();
      this.$name = name; this.$port = port; this.$cfg = sim.motorCfg(name);
      this.physPos = 0; this.physVel = 0; this.offset = 0; this.power = 0; this.dir = Direction.FORWARD; this.mode = RunMode.RUN_WITHOUT_ENCODER;
      this.zpb = ZeroPowerBehavior.BRAKE; this.target = 0; this.hasTarget = false; this.tol = 10; this.velTarget = null; this.enabled = true; this.$current = 0;
    }
    get $ds() { return this.dir === Direction.REVERSE ? -1 : 1; }
    get $vmax() { const c = this.$cfg; return c.rpm / 60 * c.tpr * c.eff; }
    setPower(p) {
      p = Number(p);
      if (Number.isNaN(p)) throw new EXC.IllegalArgumentException(`setPower(NaN) on motor "${this.$name}". A calculation divided by zero or used an unset value.`);
      this.power = clip(p, -1, 1);
      this.velTarget = null;
    }
    getPower() { return this.mode === RunMode.STOP_AND_RESET_ENCODER ? 0 : this.power; }
    setDirection(d) { if (!d) throw new EXC.NullPointerException('setDirection(null)'); this.dir = d.$name === 'REVERSE' ? Direction.REVERSE : Direction.FORWARD; }
    getDirection() { return this.dir; }
    setMode(m) {
      if (!m) throw new EXC.NullPointerException('setMode(null)');
      if (m === RunMode.RESET_ENCODERS) m = RunMode.STOP_AND_RESET_ENCODER;
      if (m === RunMode.RUN_USING_ENCODERS) m = RunMode.RUN_USING_ENCODER;
      if (m === RunMode.RUN_WITHOUT_ENCODERS) m = RunMode.RUN_WITHOUT_ENCODER;
      if (m === RunMode.RUN_TO_POSITION && !this.hasTarget)
        throw new EXC.TargetPositionNotSetException(`Failed to enable motor "${this.$name}". You must set a target position before switching to RUN_TO_POSITION mode`);
      if (m === RunMode.STOP_AND_RESET_ENCODER) { this.offset = this.physPos; this.power = 0; this.velTarget = null; }
      if (m !== this.mode) sim.event('mode', `${this.$name} → ${m.$name}`);
      this.mode = m;
    }
    getMode() { return this.mode; }
    getCurrentPosition() { hw(); return Math.round(this.$ds * (this.physPos - this.offset)); }
    setTargetPosition(t) { t = Number(t); if (!Number.isFinite(t)) throw new EXC.IllegalArgumentException(`setTargetPosition(${t}) on motor "${this.$name}"`); this.target = Math.trunc(t); this.hasTarget = true; }
    getTargetPosition() { return this.target; }
    setTargetPositionTolerance(t) { this.tol = Math.max(0, Math.trunc(t)); }
    getTargetPositionTolerance() { return this.tol; }
    isBusy() { hw(); return this.mode === RunMode.RUN_TO_POSITION && Math.abs(this.$err()) > this.tol; }
    $err() { return this.offset + this.$ds * this.target - this.physPos; }
    setZeroPowerBehavior(z) { if (z) this.zpb = z; }
    getZeroPowerBehavior() { return this.zpb; }
    setPowerFloat() { this.zpb = ZeroPowerBehavior.FLOAT; this.power = 0; }
    getPowerFloat() { return this.zpb === ZeroPowerBehavior.FLOAT && this.power === 0; }
    setVelocity(v, unit) {
      v = Number(v);
      if (unit) v = unit.toRadians(v) / (2 * Math.PI) * this.$cfg.tpr;
      this.velTarget = v; this.power = clip(v / this.$vmax, -1, 1);
    }
    getVelocity(unit) {
      hw();
      const tps = this.$ds * this.physVel;
      return unit ? unit.fromRadians(tps / this.$cfg.tpr * 2 * Math.PI) : tps;
    }
    getCurrent(u) { hw(); return (u || CurrentUnit.AMPS) === CurrentUnit.MILLIAMPS ? this.$current * 1000 : this.$current; }
    getCurrentAlert() { return 7.5; }
    setCurrentAlert() {}
    isOverCurrent() { return this.$current > 7.5; }
    setMotorEnable() { this.enabled = true; }
    setMotorDisable() { this.enabled = false; }
    isMotorEnabled() { return this.enabled; }
    setPIDFCoefficients() {}
    setVelocityPIDFCoefficients() {}
    setPositionPIDFCoefficients() {}
    setPIDCoefficients() {}
    getPIDFCoefficients() { return new PIDFCoefficients(10, 3, 0, 0); }
    getPIDCoefficients() { return new PIDCoefficients(10, 3, 0); }
    getMotorType() {
      const c = this.$cfg;
      return { getTicksPerRev: () => c.tpr, getMaxRPM: () => c.rpm, getAchieveableMaxRPMFraction: () => c.eff, getAchieveableMaxTicksPerSecond: () => this.$vmax, getGearing: () => c.tpr / 28, clone() { return this; }, setAchieveableMaxRPMFraction() {}, toString: () => `${c.rpm} RPM, ${c.tpr} ticks/rev` };
    }
    setMotorType() {}
    $step(dt) {
      const c = this.$cfg;
      const vmax = this.$vmax;
      const aDrive = vmax / c.accelTime;
      let tv, a = aDrive, coast = false;
      if (!this.enabled || this.mode === RunMode.STOP_AND_RESET_ENCODER) { tv = 0; a = vmax / c.brakeTime; }
      else if (this.mode === RunMode.RUN_TO_POSITION) {
        const err = this.$err();
        const lim = Math.abs(this.power) * vmax;
        if (Math.abs(err) <= this.tol * 0.5 || lim === 0) { tv = 0; a = vmax / c.brakeTime; }
        else {
          const prof = Math.sqrt(2 * aDrive * 0.8 * Math.abs(err));
          tv = Math.sign(err) * Math.min(lim, prof, 12 * Math.abs(err) + 30);
        }
      } else if (this.velTarget !== null && this.mode === RunMode.RUN_USING_ENCODER) {
        tv = clip(this.$ds * this.velTarget, -vmax / c.eff, vmax / c.eff);
      } else if (this.power === 0) {
        if (this.zpb === ZeroPowerBehavior.FLOAT) coast = true;
        else { tv = 0; a = vmax / c.brakeTime; }
      } else tv = this.$ds * this.power * vmax;
      if (coast) {
        const d = vmax / c.coastTime * dt;
        this.physVel = Math.abs(this.physVel) <= d ? 0 : this.physVel - Math.sign(this.physVel) * d;
      } else {
        const dv = tv - this.physVel;
        this.physVel += clip(dv, -a * dt, a * dt);
      }
      // gravity on arms/lifts: drift down slowly under FLOAT/disabled
      this.physPos += this.physVel * dt;
      if (c.min != null && this.physPos < c.min) { this.physPos = c.min; if (this.physVel < 0) this.physVel = 0; }
      if (c.max != null && this.physPos > c.max) { this.physPos = c.max; if (this.physVel > 0) this.physVel = 0; }
      const cmd = coast ? 0 : (tv || 0) / (vmax || 1);
      this.$current = 0.25 + 9 * Math.min(1, Math.abs(cmd - this.physVel / (vmax || 1)) + 0.08 * Math.abs(cmd));
    }
    $state() { return [this.physPos, Math.round(this.$ds * (this.physPos - this.offset)), this.mode === RunMode.STOP_AND_RESET_ENCODER ? 0 : this.power]; }
  }
  Motor.$names = names('DcMotor', 'DcMotorEx', 'DcMotorSimple', 'DcMotorImplEx', 'DcMotorImpl', 'HardwareDevice');
  Motor.$kind = 'motor';
  Motor.$deviceName = 'Motor';
  Object.assign(Motor, { RunMode, Direction, ZeroPowerBehavior });

  class Servo extends HardwareDevice {
    constructor(name, port) {
      super();
      this.$name = name; this.$port = port; this.$cfg = sim.servoCfg(name);
      this.cmd = NaN; this.dir = ServoDirection.FORWARD; this.lo = 0; this.hi = 1; this.act = this.$cfg.start; this.pwm = false; this.target = this.act;
    }
    setPosition(p) {
      p = Number(p);
      if (Number.isNaN(p)) throw new EXC.IllegalArgumentException(`setPosition(NaN) on servo "${this.$name}"`);
      p = clip(p, 0, 1);
      this.cmd = p; this.pwm = true;
      let q = this.dir === ServoDirection.REVERSE ? 1 - p : p;
      this.target = this.lo + q * (this.hi - this.lo);
    }
    getPosition() { return this.cmd; }
    setDirection(d) { this.dir = d && d.$name === 'REVERSE' ? ServoDirection.REVERSE : ServoDirection.FORWARD; if (!Number.isNaN(this.cmd)) this.setPosition(this.cmd); }
    getDirection() { return this.dir; }
    scaleRange(a, b) { if (!(a >= 0 && b <= 1 && a < b)) throw new EXC.IllegalArgumentException(`scaleRange(${a}, ${b}) needs 0 <= min < max <= 1`); this.lo = a; this.hi = b; if (!Number.isNaN(this.cmd)) this.setPosition(this.cmd); }
    setPwmEnable() { this.pwm = true; }
    setPwmDisable() { this.pwm = false; }
    isPwmEnabled() { return this.pwm; }
    setPwmRange() {}
    getPwmRange() { return { usPulseLower: 500, usPulseUpper: 2500 }; }
    $step(dt) {
      if (!this.pwm) return;
      const r = this.$cfg.rate * dt;
      const d = this.target - this.act;
      this.act += clip(d, -r, r);
    }
    $state() { return [this.act, this.pwm ? 1 : 0, Number.isNaN(this.cmd) ? -1 : this.cmd]; }
  }
  Servo.$names = names('Servo', 'ServoImplEx', 'ServoImpl', 'PwmControl', 'HardwareDevice');
  Servo.$kind = 'servo';
  Servo.$deviceName = 'Servo';
  Object.assign(Servo, { Direction: ServoDirection, MIN_POSITION: 0, MAX_POSITION: 1 });

  class CRServo extends HardwareDevice {
    constructor(name, port) { super(); this.$name = name; this.$port = port; this.$cfg = sim.servoCfg(name); this.power = 0; this.dir = Direction.FORWARD; this.angle = 0; this.vel = 0; }
    setPower(p) { p = Number(p); if (Number.isNaN(p)) throw new EXC.IllegalArgumentException(`setPower(NaN) on CR servo "${this.$name}"`); this.power = clip(p, -1, 1); }
    getPower() { return this.power; }
    setDirection(d) { this.dir = d && d.$name === 'REVERSE' ? Direction.REVERSE : Direction.FORWARD; }
    getDirection() { return this.dir; }
    setPwmEnable() {} setPwmDisable() { this.power = 0; } isPwmEnabled() { return true; } setPwmRange() {}
    $step(dt) { const tv = (this.dir === Direction.REVERSE ? -1 : 1) * this.power * 2 * Math.PI * 1.5; this.vel += clip(tv - this.vel, -60 * dt, 60 * dt); this.angle += this.vel * dt; }
    $state() { return [this.angle, this.vel, this.power]; }
  }
  CRServo.$names = names('CRServo', 'CRServoImplEx', 'CRServoImpl', 'DcMotorSimple', 'HardwareDevice');
  CRServo.$kind = 'crservo';
  CRServo.Direction = Direction;

  class YawPitchRollAngles {
    constructor(unit, yaw, pitch, roll, t) { this.unit = unit; this.yaw = yaw; this.pitch = pitch; this.roll = roll; this.t = t; }
    getYaw(u) { return u ? u.fromUnit(this.unit, this.yaw) : this.yaw; }
    getPitch(u) { return u ? u.fromUnit(this.unit, this.pitch) : this.pitch; }
    getRoll(u) { return u ? u.fromUnit(this.unit, this.roll) : this.roll; }
    getAngleUnit() { return this.unit; }
    getAcquisitionTime() { return Math.round(this.t * 1e9); }
    toString() { return `{yaw=${this.yaw.toFixed(3)}, pitch=${this.pitch.toFixed(3)}, roll=${this.roll.toFixed(3)}}`; }
  }
  class Orientation {
    constructor(ref, order, unit, a = 0, b = 0, c = 0, t = 0) { this.axesReference = ref; this.axesOrder = order; this.angleUnit = unit; this.firstAngle = a; this.secondAngle = b; this.thirdAngle = c; this.acquisitionTime = t; }
    toAngleUnit(u) { if (u === this.angleUnit) return this; const f = x => u.fromUnit(this.angleUnit, x); return new Orientation(this.axesReference, this.axesOrder, u, f(this.firstAngle), f(this.secondAngle), f(this.thirdAngle), this.acquisitionTime); }
    toAxesOrder() { return this; }
    toString() { return `{${this.firstAngle.toFixed(3)} ${this.secondAngle.toFixed(3)} ${this.thirdAngle.toFixed(3)}}`; }
  }
  const unitOf = u => (u && (u === AngleUnit.RADIANS || u.$name === 'RADIANS') ? AngleUnit.RADIANS : AngleUnit.DEGREES);
  class IMUDevice extends HardwareDevice {
    constructor(name) { super(); this.$name = name; this.yawOffset = 0; this.params = null; this.bnoUnit = AngleUnit.RADIANS; this.initialized = false; }
    initialize(p) { this.params = p || null; this.initialized = true; if (p && p.angleUnit) this.bnoUnit = unitOf(p.angleUnit); this.yawOffset = 0; sim.event('imu', `${this.$name} initialized`); return true; }
    $yawRad() { hw(); return wrapPi(sim.robot.h - sim.startPose.h - this.yawOffset); }
    resetYaw() { this.yawOffset = sim.robot.h - sim.startPose.h; }
    getRobotYawPitchRollAngles() { return new YawPitchRollAngles(AngleUnit.DEGREES, this.$yawRad() * 180 / Math.PI, 0, 0, sim.t); }
    getRobotOrientation(ref, order, unit) {
      unit = unitOf(unit);
      const y = unit.fromRadians(this.$yawRad());
      const o = order ? order.$name : 'ZYX';
      const ang = [0, 0, 0]; ang[o.indexOf('Z')] = y;
      return new Orientation(ref, order, unit, ang[0], ang[1], ang[2], Math.round(sim.t * 1e9));
    }
    getRobotAngularVelocity(unit) { hw(); unit = unitOf(unit); const z = unit.fromRadians(sim.robot.w); return { xRotationRate: 0, yRotationRate: 0, zRotationRate: z, unit, acquisitionTime: Math.round(sim.t * 1e9) }; }
    getAngularOrientation(ref, order, unit) { return this.getRobotOrientation(ref || AxesReference.INTRINSIC, order || AxesOrder.ZYX, unit || this.bnoUnit); }
    getAngularVelocity(unit) { return this.getRobotAngularVelocity(unit || this.bnoUnit); }
    isGyroCalibrated() { return true; }
    isSystemCalibrated() { return true; }
    isAccelerometerCalibrated() { return true; }
    isMagnetometerCalibrated() { return true; }
    getCalibrationStatus() { return { toString: () => 's3 g3 a3 m3' }; }
    getSystemStatus() { return { toString: () => 'RUNNING_FUSION' }; }
    getGravity() { return { xAccel: 0, yAccel: 0, zAccel: 9.81, toString: () => '(0, 0, 9.81)' }; }
    getLinearAcceleration() { return { xAccel: 0, yAccel: 0, zAccel: 0 }; }
    getPosition() { return { x: 0, y: 0, z: 0 }; }
    getVelocity() { return { xVeloc: 0, yVeloc: 0, zVeloc: 0 }; }
    startAccelerationIntegration() {}
    stopAccelerationIntegration() {}
    getParameters() { return this.params; }
  }
  IMUDevice.$names = names('IMU', 'BNO055IMU', 'BHI260IMU', 'BNO055IMUNew', 'HardwareDevice');
  IMUDevice.$kind = 'imu';
  IMUDevice.Parameters = class { constructor(o) { this.imuOrientationOnRobot = o; this.angleUnit = BNO_AngleUnit.RADIANS; this.accelUnit = null; this.calibrationDataFile = ''; this.loggingEnabled = false; this.loggingTag = ''; this.accelerationIntegrationAlgorithm = null; this.mode = null; } };
  IMUDevice.AngleUnit = BNO_AngleUnit;
  IMUDevice.AccelUnit = makeEnum('BNO055IMU.AccelUnit', ['METERS_PERSEC_PERSEC', 'MILLI_EARTH_GRAVITY']);
  IMUDevice.SensorMode = makeEnum('BNO055IMU.SensorMode', ['IMU', 'NDOF', 'COMPASS', 'GYRONLY', 'ACCONLY']);

  class RangeSensor extends HardwareDevice {
    constructor(name, port, kind) { super(); this.$name = name; this.$port = port; this.$cfg = sim.sensorCfg(name, kind); this.led = true; this.gain = 1; }
    getDistance(unit) { hw(); const d = sim.raycast(this.$cfg); return d > this.$cfg.range ? DistanceUnit.infinity : (unit || DistanceUnit.CM).fromInches(d); }
    // color sensing reads the floor tile under the sensor
    $rgb() { hw(); return sim.floorColor(this.$cfg); }
    red() { return Math.round(this.$rgb()[0] * 1200); }
    green() { return Math.round(this.$rgb()[1] * 1200); }
    blue() { return Math.round(this.$rgb()[2] * 1200); }
    alpha() { const c = this.$rgb(); return Math.round((c[0] + c[1] + c[2]) / 3 * 1200); }
    argb() { const c = this.$rgb().map(x => Math.round(x * 255)); return ((255 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]) | 0; }
    getNormalizedColors() { const c = this.$rgb().map(x => clip(x * this.gain * 0.25, 0, 1)); return { red: c[0], green: c[1], blue: c[2], alpha: clip((c[0] + c[1] + c[2]) / 3, 0, 1), toColor: () => ((255 << 24) | (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255)) | 0 }; }
    setGain(g) { this.gain = g; }
    getGain() { return this.gain; }
    enableLed(b) { this.led = !!b; }
    getLightDetected() { return this.alpha() / 1200; }
    getRawLightDetected() { return this.alpha(); }
    // touch / limit switch: the mount side is pressed against something
    $pressed() { hw(); return sim.raycast(this.$cfg) < 0.6; }
    isPressed() { return this.$pressed(); }
    getValue() { return this.$pressed() ? 1 : 0; }
    getState() { return !this.$pressed(); }
    setMode(m) { this.mode = m; }
    getMode() { return this.mode || DigitalMode.INPUT; }
    setState() {}
    getVoltage() { return 0; }
    getMaxVoltage() { return 3.3; }
    $state() { return [0, 0, 0]; }
  }
  RangeSensor.$names = names('DistanceSensor', 'Rev2mDistanceSensor', 'ColorRangeSensor', 'RevColorSensorV3', 'ColorSensor', 'NormalizedColorSensor', 'TouchSensor', 'DigitalChannel', 'AnalogInput', 'OpticalDistanceSensor', 'LightSensor', 'HardwareDevice');
  RangeSensor.$kind = 'sensor';
  RangeSensor.distanceOutOfRange = DistanceUnit.infinity;

  class VoltageSensor extends HardwareDevice { constructor(name) { super(); this.$name = name; } getVoltage() { hw(); return sim.cfg.battery - 0.004 * sim.totalCurrent(); } }
  VoltageSensor.$names = names('VoltageSensor', 'HardwareDevice');
  VoltageSensor.$kind = 'voltage';
  class LynxModule extends HardwareDevice {
    constructor(name) { super(); this.$name = name; this.mode = BulkCachingMode.OFF; }
    setBulkCachingMode(m) { this.mode = m; } getBulkCachingMode() { return this.mode; } clearBulkCache() {}
    getInputVoltage(u) { const v = sim.cfg.battery; return u && u.$name === 'MILLIVOLTS' ? v * 1000 : v; }
    getCurrent(u) { const c = sim.totalCurrent(); return u === CurrentUnit.MILLIAMPS ? c * 1000 : c; }
    setConstant() {} setPattern() {} isParent() { return true; } getSerialNumber() { return 1; } getDeviceName() { return 'REV Expansion Hub'; }
  }
  LynxModule.$names = names('LynxModule', 'HardwareDevice');
  LynxModule.$kind = 'lynx';
  LynxModule.BulkCachingMode = BulkCachingMode;

  class Pinpoint extends HardwareDevice {
    constructor(name) { super(); this.$name = name; this.$resetAt(); this.snap = { x: 0, y: 0, h: 0, vx: 0, vy: 0, w: 0 }; }
    $resetAt(reading) { this.refWorld = { x: sim.robot.x, y: sim.robot.y, h: sim.robot.h }; this.refRead = reading || { x: 0, y: 0, h: 0 }; }
    $read() {
      const rel = compose(invert(this.refWorld), { x: sim.robot.x, y: sim.robot.y, h: sim.robot.h });
      const p = compose(this.refRead, rel);
      return { x: p.x, y: p.y, h: wrapPi(p.h) };
    }
    update() {
      hw();
      const p = this.$read();
      const c = Math.cos(sim.robot.h), s = Math.sin(sim.robot.h);
      this.snap = { x: p.x, y: p.y, h: p.h, vx: sim.robot.vx * c + sim.robot.vy * s, vy: -sim.robot.vx * s + sim.robot.vy * c, w: sim.robot.w };
      return true;
    }
    getPosition() { return new Pose2D(DistanceUnit.MM, this.snap.x * 25.4, this.snap.y * 25.4, AngleUnit.RADIANS, this.snap.h); }
    setPosition(p) { this.$resetAt({ x: p.getX(DistanceUnit.INCH), y: p.getY(DistanceUnit.INCH), h: p.getHeading(AngleUnit.RADIANS) }); this.update(); }
    getPosX(u) { return u ? u.fromInches(this.snap.x) : this.snap.x * 25.4; }
    getPosY(u) { return u ? u.fromInches(this.snap.y) : this.snap.y * 25.4; }
    getHeading(u) { return u ? u.fromRadians(this.snap.h) : this.snap.h; }
    getVelX(u) { return u ? u.fromInches(this.snap.vx) : this.snap.vx * 25.4; }
    getVelY(u) { return u ? u.fromInches(this.snap.vy) : this.snap.vy * 25.4; }
    getHeadingVelocity(u) { return u && u.fromRadians ? u.fromRadians(this.snap.w) : this.snap.w; }
    getVelocity() { return new Pose2D(DistanceUnit.MM, this.snap.vx * 25.4, this.snap.vy * 25.4, AngleUnit.RADIANS, this.snap.w); }
    getEncoderX() { return Math.round(this.snap.x * 25.4 * 19.894); }
    getEncoderY() { return Math.round(this.snap.y * 25.4 * 19.894); }
    resetPosAndIMU() { this.$resetAt(); this.snap = { x: 0, y: 0, h: 0, vx: 0, vy: 0, w: 0 }; }
    recalibrateIMU() {}
    setHeading(hd, u) { const cur = this.$read(); this.$resetAt({ x: cur.x, y: cur.y, h: u ? u.toRadians(hd) : hd }); }
    setOffsets() {} setEncoderResolution() {} setEncoderDirections() {} setYawScalar() {} setBulkReadScope() {} setErrorDetectionType() {}
    getDeviceStatus() { return PinStatus.READY; } getLoopTime() { return 667; } getFrequency() { return 1500; } getDeviceVersion() { return 2; } getDeviceID() { return 2; } getYawScalar() { return 1; }
    getXOffset(u) { return 0; } getYOffset(u) { return 0; }
  }
  Pinpoint.$names = names('GoBildaPinpointDriver', 'HardwareDevice');
  Pinpoint.$kind = 'odometry';
  Object.assign(Pinpoint, { GoBildaOdometryPods: PodType, EncoderDirection: EncDir, DeviceStatus: PinStatus, ReadData });

  class OTOSPose { constructor(x = 0, y = 0, h = 0) { if (x instanceof OTOSPose) { this.x = x.x; this.y = x.y; this.h = x.h; } else { this.x = x; this.y = y; this.h = h; } } set(p) { this.x = p.x; this.y = p.y; this.h = p.h; } toString() { return `(${this.x}, ${this.y}, ${this.h})`; } }
  class OTOS extends HardwareDevice {
    constructor(name) { super(); this.$name = name; this.lu = DistanceUnit.INCH; this.au = AngleUnit.DEGREES; this.ls = 1; this.as = 1; this.$pp = new Pinpoint(name); }
    begin() { return true; } isConnected() { return true; } selfTest() { return true; } calibrateImu() { return true; } getImuCalibrationProgress() { return 0; }
    setLinearUnit(u) { this.lu = u; } getLinearUnit() { return this.lu; } setAngularUnit(u) { this.au = u; } getAngularUnit() { return this.au; }
    setLinearScalar(s) { this.ls = s; return true; } getLinearScalar() { return this.ls; } setAngularScalar(s) { this.as = s; return true; } getAngularScalar() { return this.as; }
    setOffset() {} getOffset() { return new OTOSPose(); } resetTracking() { this.$pp.resetPosAndIMU(); }
    setPosition(p) { this.$pp.$resetAt({ x: this.lu.toInches(p.x), y: this.lu.toInches(p.y), h: this.au.toRadians(p.h) }); }
    getPosition() { this.$pp.update(); const s = this.$pp.snap; return new OTOSPose(this.lu.fromInches(s.x * this.ls), this.lu.fromInches(s.y * this.ls), this.au.fromRadians(s.h * this.as)); }
    getVelocity() { this.$pp.update(); const s = this.$pp.snap; return new OTOSPose(this.lu.fromInches(s.vx), this.lu.fromInches(s.vy), this.au.fromRadians(s.w)); }
    getAcceleration() { return new OTOSPose(); }
    getVersionInfo() { return [{ major: 1, minor: 0 }, { major: 1, minor: 0 }]; }
    getStatus() { return { warnTiltAngle: false, warnOpticalTracking: false, errorPaa: false, errorLsm: false }; }
    setSignalProcessConfig() {} getSignalProcessConfig() { return anything('SignalProcessConfig'); }
  }
  OTOS.$names = names('SparkFunOTOS', 'HardwareDevice');
  OTOS.$kind = 'odometry';
  OTOS.Pose2D = OTOSPose;

  /* ---------------- HardwareMap */
  const CLASS_KIND = new Map();
  const reg = (C, ...n) => n.forEach(x => CLASS_KIND.set(x, C));
  reg(Motor, 'DcMotor', 'DcMotorEx', 'DcMotorSimple', 'DcMotorImplEx', 'DcMotorImpl');
  reg(Servo, 'Servo', 'ServoImplEx', 'ServoImpl', 'PwmControl');
  reg(CRServo, 'CRServo', 'CRServoImplEx', 'CRServoImpl');
  reg(IMUDevice, 'IMU', 'BNO055IMU', 'BHI260IMU', 'BNO055IMUNew');
  reg(RangeSensor, 'DistanceSensor', 'Rev2mDistanceSensor', 'ColorRangeSensor', 'RevColorSensorV3', 'ColorSensor', 'NormalizedColorSensor', 'TouchSensor', 'DigitalChannel', 'AnalogInput', 'OpticalDistanceSensor', 'LightSensor', 'RevTouchSensor');
  reg(VoltageSensor, 'VoltageSensor');
  reg(LynxModule, 'LynxModule');
  reg(Pinpoint, 'GoBildaPinpointDriver');
  reg(OTOS, 'SparkFunOTOS');
  const SENSOR_KIND = { DistanceSensor: 'distance', Rev2mDistanceSensor: 'distance', ColorRangeSensor: 'color', RevColorSensorV3: 'color', ColorSensor: 'color', NormalizedColorSensor: 'color', TouchSensor: 'touch', RevTouchSensor: 'touch', DigitalChannel: 'touch', AnalogInput: 'analog', OpticalDistanceSensor: 'color', LightSensor: 'color' };

  class HardwareMap {
    constructor() {
      this.devices = new Map();
      this.port = { motor: 0, servo: 0 };
      const cat = cls => ({ get: n => this.get(cls, n), size: () => [...this.devices.values()].filter(d => d instanceof cls).length, iterator: () => new JList([...this.devices.values()].filter(d => d instanceof cls)).iterator(), entrySet: () => new R.JSet(), [Symbol.iterator]: () => [...this.devices.values()].filter(d => d instanceof cls)[Symbol.iterator]() });
      this.dcMotor = cat(S.DcMotor); this.servo = cat(S.Servo); this.crservo = cat(S.CRServo);
      this.touchSensor = cat(S.TouchSensor); this.colorSensor = cat(S.ColorSensor); this.digitalChannel = cat(S.DigitalChannel);
      this.analogInput = cat(S.AnalogInput); this.opticalDistanceSensor = cat(S.OpticalDistanceSensor);
      const vs = this.$voltage = new VoltageSensor('Control Hub');
      this.voltageSensor = { get: () => vs, iterator: () => new JList([vs]).iterator(), size: () => 1, [Symbol.iterator]: () => [vs][Symbol.iterator](), entrySet: () => new R.JSet() };
      this.appContext = anything('appContext');
      this.$hubs = [new LynxModule('Control Hub'), new LynxModule('Expansion Hub 2')];
    }
    get(cls, name) {
      if (typeof cls === 'string' && name === undefined) {
        const d = this.devices.get(cls);
        if (!d) throw new EXC.IllegalArgumentException(`Unable to find a hardware device with name "${cls}". In the simulator, ask for a specific type, like hardwareMap.get(DcMotor.class, "${cls}").`);
        return d;
      }
      if (name == null) throw new EXC.IllegalArgumentException('hardwareMap.get needs a device name');
      name = String(name);
      const jn = cls && (cls.$jclass || (cls.$names && cls.$names[0]));
      const C = CLASS_KIND.get(jn) || (cls && cls.$kind ? cls : null);
      if (!C) throw new SimUnsupported(jn || String(cls));
      const existing = this.devices.get(name);
      if (existing) {
        if (!(existing instanceof C)) throw new EXC.IllegalArgumentException(`Unable to find a hardware device with name "${name}" and type ${jn}. "${name}" is already used as a ${existing.constructor.$names[0]}.`);
        return existing;
      }
      let dev;
      if (C === Motor) dev = new Motor(name, this.port.motor++);
      else if (C === Servo || C === CRServo) dev = new C(name, this.port.servo++);
      else if (C === RangeSensor) dev = new RangeSensor(name, 0, SENSOR_KIND[jn] || 'distance');
      else dev = new C(name);
      dev.$jtype = jn;
      this.devices.set(name, dev);
      sim.registerDevice(name, dev, jn);
      return dev;
    }
    tryGet(cls, name) { try { return this.get(cls, name); } catch (e) { return null; } }
    getAll(cls) { const jn = cls && cls.$names && cls.$names[0]; if (jn === 'LynxModule') return new JList(this.$hubs); return new JList([...this.devices.values()].filter(d => d instanceof (CLASS_KIND.get(jn) || Object))); }
    getAllNames(cls) { return new R.JSet([...this.devices.keys()]); }
    getNamesOf(d) { return new R.JSet([d.$name]); }
    contains(n) { return this.devices.has(n); }
    size() { return this.devices.size; }
    iterator() { return new JList([...this.devices.values()]).iterator(); }
    logDevices() {}
  }

  /* ---------------- Gamepad */
  const clamp01 = v => Math.max(0, Math.min(1, +v || 0));
  class Gamepad {
    constructor(user) {
      this.$user = user;
      for (const b of GP_BUTTONS) this[b] = false;
      this.left_stick_x = 0; this.left_stick_y = 0; this.right_stick_x = 0; this.right_stick_y = 0; this.left_trigger = 0; this.right_trigger = 0;
      this.touchpad_finger_1 = false; this.touchpad_finger_2 = false; this.touchpad_finger_1_x = 0; this.touchpad_finger_1_y = 0; this.touchpad_finger_2_x = 0; this.touchpad_finger_2_y = 0;
      this.id = user; this.type = GamepadType.LOGITECH_F310; this.timestamp = 0;
      this.$press = {}; this.$release = {}; this.$rumbleUntil = 0;
      this.$syncAliases();
    }
    $syncAliases() { for (const k in GP_ALIAS) this[k] = this[GP_ALIAS[k]]; this.left_bumper_alias = this.left_bumper; }
    $apply(st) {
      for (const b of GP_BUTTONS) {
        const v = !!st[b];
        if (v && !this[b]) this.$press[b] = true;
        if (!v && this[b]) this.$release[b] = true;
        this[b] = v;
      }
      const dz = 0.06;
      const ax = v => (Math.abs(v || 0) < dz ? 0 : Math.fround(clip(v || 0, -1, 1)));
      this.left_stick_x = ax(st.left_stick_x); this.left_stick_y = ax(st.left_stick_y);
      this.right_stick_x = ax(st.right_stick_x); this.right_stick_y = ax(st.right_stick_y);
      this.left_trigger = Math.fround(clip(st.left_trigger || 0, 0, 1)); this.right_trigger = Math.fround(clip(st.right_trigger || 0, 0, 1));
      this.timestamp = Math.round(sim.t * 1e9);
      this.$syncAliases();
    }
    copy(g) {
      for (const b of GP_BUTTONS) this[b] = g[b];
      for (const k of ['left_stick_x', 'left_stick_y', 'right_stick_x', 'right_stick_y', 'left_trigger', 'right_trigger', 'timestamp']) this[k] = g[k];
      this.$syncAliases();
    }
    fromByteArray() {} toByteArray() { return []; }
    atRest() { return this.left_stick_x === 0 && this.left_stick_y === 0 && this.right_stick_x === 0 && this.right_stick_y === 0 && this.left_trigger === 0 && this.right_trigger === 0; }
    getUser() { return this.$user === 1 ? 'ONE' : 'TWO'; }
    getGamepadId() { return this.$user; }
    /* Rumble, like the FTC SDK. Each call replaces what was playing. $rumble is a list of steps in
       sim time: {t0, t1, l, r} with l/r the left (strong) and right (weak) motor strength, 0..1. */
    $playSteps(steps, label) {
      let t = sim.t; this.$rumble = [];
      for (const st of steps) {
        const ms = st.ms < 0 ? 3600e3 : st.ms;
        this.$rumble.push({ t0: t, t1: t + ms / 1000, l: clamp01(st.l), r: clamp01(st.r) });
        t += ms / 1000;
      }
      this.$rumbleUntil = t;
      sim.event('rumble', `gamepad${this.$user} ${label}`);
    }
    rumble(a, b, c) {
      if (c === undefined) this.$playSteps([{ l: 1, r: 1, ms: a }], a < 0 ? 'rumble (until stopped)' : `rumble ${a} ms`);
      else this.$playSteps([{ l: a, r: b, ms: c }], `rumble L${(+a).toFixed(2)} R${(+b).toFixed(2)} ${c < 0 ? 'until stopped' : c + ' ms'}`);
    }
    rumbleBlips(n) {
      const steps = [];
      for (let i = 0; i < n; i++) steps.push({ l: 0, r: 1, ms: 120 }, { l: 0, r: 0, ms: 120 });   // the SDK's blip: short, weak motor
      this.$playSteps(steps, `${n} blip${n === 1 ? '' : 's'}`);
    }
    runRumbleEffect(effect) {
      const steps = effect && effect.$steps ? effect.$steps : [{ l: 1, r: 1, ms: 500 }];
      this.$playSteps(steps, `rumble effect (${steps.length} step${steps.length === 1 ? '' : 's'})`);
    }
    isRumbling() { return sim.t < this.$rumbleUntil; }
    $rumbleNow() { return this.$rumbleAt(sim.t); }
    stopRumble() { this.$rumble = []; this.$rumbleUntil = 0; }
    /* strength of each rumble motor at sim time t */
    $rumbleAt(t) {
      for (const st of this.$rumble || []) if (t >= st.t0 && t < st.t1) return { l: st.l, r: st.r };
      return { l: 0, r: 0 };
    }
    setLedColor(r, g, b) { this.$led = [r, g, b]; sim.event('led', `gamepad${this.$user} LED ${[r, g, b].map(x => Math.round(x * 255)).join(',')}`); }
    runLedEffect() {}
    toString() { return `ID: ${this.$user} user: ${this.$user} lx: ${this.left_stick_x.toFixed(2)} ly: ${this.left_stick_y.toFixed(2)} rx: ${this.right_stick_x.toFixed(2)} ry: ${this.right_stick_y.toFixed(2)}`; }
  }
  for (const b of GP_BUTTONS) {
    const base = camel(b);
    Gamepad.prototype[base + 'WasPressed'] = function () { const v = !!this.$press[b]; this.$press[b] = false; return v; };
    Gamepad.prototype[base + 'WasReleased'] = function () { const v = !!this.$release[b]; this.$release[b] = false; return v; };
  }
  for (const [alias, b] of Object.entries(GP_ALIAS)) {
    Gamepad.prototype[alias + 'WasPressed'] = Gamepad.prototype[camel(b) + 'WasPressed'];
    Gamepad.prototype[alias + 'WasReleased'] = Gamepad.prototype[camel(b) + 'WasReleased'];
  }
  Gamepad.$names = ['Gamepad'];
  Gamepad.Type = GamepadType;
  // new Gamepad.RumbleEffect.Builder().addStep(1.0, 0.0, 300).addStep(0, 0, 100).build()
  class RumbleEffectBuilder {
    constructor() { this.$steps = []; }
    addStep(l, r, ms) { this.$steps.push({ l: +l, r: +r, ms: +ms }); return this; }
    build() { return { $steps: this.$steps.slice(), $names: ['RumbleEffect'] }; }
  }
  RumbleEffectBuilder.$names = ['RumbleEffect.Builder'];
  Gamepad.RumbleEffect = { Builder: RumbleEffectBuilder, $names: ['Gamepad.RumbleEffect'] };
  Gamepad.RUMBLE_DURATION_CONTINUOUS = -1;
  Gamepad.LedEffect = anything('Gamepad.LedEffect');
  Gamepad.ID_UNASSOCIATED = -1;

  /* ---------------- OpModes */
  class OpModeBase {
    constructor() {
      this.telemetry = null; this.hardwareMap = null; this.gamepad1 = null; this.gamepad2 = null; this.time = 0;
      this.msStuckDetectInit = 5000; this.msStuckDetectLoop = 5000; this.msStuckDetectStart = 5000; this.msStuckDetectStop = 900; this.msStuckDetectInitLoop = 5000;
      this.$t0 = 0;
    }
    getRuntime() { return sim.t - this.$t0; }
    resetRuntime() { this.$t0 = sim.t; }
    requestOpModeStop() { sim.requestStop('requestOpModeStop() was called'); }
    terminateOpModeNow() { sim.requestStop('terminateOpModeNow() was called'); const e = new Error('terminated'); e.$fatal = true; e.$terminate = true; throw e; }
    updateTelemetry(t) { (t || this.telemetry).update(); }
    internalPostInitLoop() {} internalPostLoop() {}
  }
  class LinearOpMode extends OpModeBase {
    *runOpMode() {}
    *waitForStart() { while (!sim.started && !sim.stopRequested) yield 0; }
    *sleep(ms) { ms = Number(ms); if (ms > 0) yield ms / 1000; else yield 0; }
    *idle() { yield 0; }
    *opModeIsActive() { yield 0; return sim.started && !sim.stopRequested; }
    *opModeInInit() { yield 0; return !sim.started && !sim.stopRequested; }
    *isStopRequested() { yield 0; return sim.stopRequested; }
    *isStarted() { yield 0; return sim.started; }
    *waitOneFullHardwareCycle() { yield 0.01; }
  }
  LinearOpMode.$names = ['LinearOpMode', 'OpMode'];
  class OpMode extends OpModeBase {
    *init() {} *init_loop() {} *start() {} *loop() {} *stop() {}
  }
  OpMode.$names = ['OpMode'];

  /* ---------------- misc SDK utility classes */
  class ElapsedTime {
    constructor(a, b) {
      this.res = a instanceof JEnum ? a : Resolution.SECONDS;
      this.st = typeof a === 'number' ? a / 1e9 : sim.t;
      if (typeof b === 'number') this.st = b;
    }
    reset() { this.st = sim.t; }
    $e() { hw(HW_READ_COST / 20); return sim.t - this.st; }
    seconds() { return this.$e(); }
    milliseconds() { return this.$e() * 1000; }
    nanoseconds() { return Math.round(this.$e() * 1e9); }
    time(u) { if (u && u.$name && TimeUnit.$scale && TimeUnit.$scale[u.$name]) return Math.trunc(this.$e() / TimeUnit.$scale[u.$name]); return this.res === Resolution.MILLISECONDS ? this.milliseconds() : this.seconds(); }
    now(u) { return u ? Math.trunc(sim.t / TimeUnit.$scale[u.$name]) : (this.res === Resolution.MILLISECONDS ? sim.t * 1000 : sim.t); }
    startTime() { return this.res === Resolution.MILLISECONDS ? this.st * 1000 : this.st; }
    startTimeNanoseconds() { return Math.round(this.st * 1e9); }
    getResolution() { return this.res; }
    log(label) { sim.log('info', `${label}: ${this.toString()}`); }
    toString() { return `${this.time().toFixed(4)} ${this.res === Resolution.MILLISECONDS ? 'milliseconds' : 'seconds'}`; }
  }
  ElapsedTime.$names = ['ElapsedTime'];
  ElapsedTime.Resolution = Resolution;
  ElapsedTime.SECOND_IN_NANO = 1e9; ElapsedTime.MILLIS_IN_NANO = 1e6;
  const Range = {
    clip: (v, a, b) => (v < a ? a : v > b ? b : v),
    scale: (n, x1, x2, y1, y2) => { const a = (y1 - y2) / (x1 - x2); return a * n + (y1 - x1 * a); },
    throwIfRangeIsInvalid: (n, a, b) => { if (n < a || n > b) throw new EXC.IllegalArgumentException(`number ${n} is invalid; valid ranges are ${a}..${b}`); },
  };
  const logFn = lvl => (tag, fmt, ...a) => { const msg = fmt === undefined ? str(tag) : (a.length ? jformat(fmt, a) : str(fmt)); sim.log(lvl, (fmt === undefined ? '' : `[${tag}] `) + msg); };
  const RobotLog = { d: logFn('debug'), dd: logFn('debug'), v: logFn('debug'), vv: logFn('debug'), i: logFn('info'), ii: logFn('info'), w: logFn('warn'), ww: logFn('warn'), e: logFn('error'), ee: logFn('error'), a: logFn('info'), aa: logFn('info'), addGlobalWarningMessage: m => sim.log('warn', m), setGlobalErrorMsg: m => sim.log('error', m) };
  const out = lvl => ({
    println: (...a) => sim.log(lvl, a.length ? (typeof a[0] === 'number' && !Number.isInteger(a[0]) ? dstr(a[0]) : str(a[0])) : ''),
    print: x => sim.log(lvl, str(x)),
    printf: (f, ...a) => sim.log(lvl, jformat(f, a)), format: (f, ...a) => sim.log(lvl, jformat(f, a)), flush() {},
  });
  const JSystem = {
    out: out('stdout'), err: out('stderr'),
    currentTimeMillis: () => Math.round(sim.epochMs + sim.t * 1000), nanoTime: () => Math.round(sim.t * 1e9),
    exit: () => sim.requestStop('System.exit()'), lineSeparator: () => '\n', getProperty: () => null, gc() {},
  };
  class JThread {
    constructor(r) { this.r = r; this.alive = false; this.$interrupted = false; }
    start() {
      const r = this.r || this;
      let g = null;
      if (r && r.$gen) g = r.$gen();
      else if (r && typeof r.run === 'function') { const x = r.run(); g = isGen(x) ? x : null; }
      if (g) { this.alive = true; sim.spawn(g, 'thread', () => { this.alive = false; }); }
    }
    *run() {}
    interrupt() { this.$interrupted = true; }
    isInterrupted() { return this.$interrupted; }
    isAlive() { return this.alive; }
    join() {}
    setDaemon() {} setName(n) { this.name = n; } getName() { return this.name || 'Thread'; } setPriority() {}
    static *sleep(ms) { ms = Number(ms); if (ms > 0) yield ms / 1000; else yield 0; }
    static currentThread() { return CUR_THREAD; }
    static interrupted() { return false; }
    static yield() {}
    static onSpinWait() {}
  }
  const CUR_THREAD = { isInterrupted: () => false, interrupt() {}, getName: () => 'OpModeThread', getId: () => 1 };
  JThread.$names = ['Thread', 'Runnable'];
  class MultipleTelemetry {
    constructor(...ts) { const real = ts.find(t => t && t.$sink); return real || ts[0] || nullTelemetry(); }
  }
  const dashboard = { getTelemetry: () => nullTelemetry(), sendTelemetryPacket() {}, startCameraStream() {}, stopCameraStream() {}, clearTelemetry() {}, setTelemetryTransmissionInterval() {}, isEnabled: () => false, withConfigRoot() {}, updateConfig() {} };
  class TelemetryPacket {
    constructor() { this.data = new Map(); this.$overlay = anything('Canvas'); }
    put(k, v) { this.data.set(k, v); } putAll() {} addLine() {} clearLines() {}
    fieldOverlay() { return this.$overlay; }
  }

  /* ---------------- class registry */
  const S = {
    LinearOpMode, OpMode, Telemetry, Gamepad, HardwareMap, ElapsedTime, Range, RobotLog,
    DcMotor: Motor, DcMotorEx: Motor, DcMotorSimple: Motor, DcMotorImplEx: Motor, DcMotorImpl: Motor,
    Servo, ServoImplEx: Servo, ServoImpl: Servo, PwmControl: Servo, CRServo, CRServoImplEx: CRServo, CRServoImpl: CRServo,
    IMU: IMUDevice, BNO055IMU: IMUDevice, BHI260IMU: IMUDevice, BNO055IMUNew: IMUDevice,
    DistanceSensor: RangeSensor, Rev2mDistanceSensor: RangeSensor, ColorRangeSensor: RangeSensor, RevColorSensorV3: RangeSensor,
    ColorSensor: RangeSensor, NormalizedColorSensor: RangeSensor, TouchSensor: RangeSensor, RevTouchSensor: RangeSensor, DigitalChannel: RangeSensor,
    AnalogInput: RangeSensor, OpticalDistanceSensor: RangeSensor, LightSensor: RangeSensor,
    VoltageSensor, LynxModule, GoBildaPinpointDriver: Pinpoint, SparkFunOTOS: OTOS, Pose2D,
    YawPitchRollAngles, Orientation, AxesReference, AxesOrder, AngleUnit, DistanceUnit, CurrentUnit, TimeUnit,
    UnnormalizedAngleUnit: AngleUnit, PIDFCoefficients, PIDCoefficients,
    RevHubOrientationOnRobot: Object.assign(class { constructor(a, b) { this.logo = a; this.usb = b; } }, { LogoFacingDirection: LogoFacing, UsbFacingDirection: UsbFacing }),
    MultipleTelemetry, FtcDashboard: { getInstance: () => dashboard }, TelemetryPacket,
    Math: R.JMath, String: R.JString, Integer: R.Integer, Double: R.Double, Float: R.JFloat, Long: R.JLong, Short: R.Integer, Byte: R.Integer,
    Boolean: R.JBoolean, Character: R.Character, Number: R.Double, Arrays: R.Arrays, Collections: R.Collections, Objects: R.Objects, Locale: R.Locale,
    System: JSystem, Thread: JThread, StringBuilder: R.StringBuilder, StringBuffer: R.StringBuilder, Random: R.JRandom,
    ArrayList: R.JList, LinkedList: R.JList, List: Object.assign(class extends R.JList {}, { of: (...a) => new R.JList(a) }), ArrayDeque: R.JList, Stack: R.JList, Vector: R.JList, Queue: R.JList, Deque: R.JList,
    HashMap: R.JMap, TreeMap: R.JMap, LinkedHashMap: R.JMap, Map: Object.assign(class extends R.JMap {}, { of: (...a) => { const m = new R.JMap(); for (let i = 0; i + 1 < a.length; i += 2) m.put(a[i], a[i + 1]); return m; } }), EnumMap: R.JMap,
    HashSet: R.JSet, TreeSet: R.JSet, LinkedHashSet: R.JSet, Set: Object.assign(class extends R.JSet {}, { of: (...a) => new R.JSet(a) }),
    Runnable: class {}, Comparator: class {}, Callable: class {}, Supplier: class {}, Consumer: class {}, Function: class {}, Predicate: class {}, BiFunction: class {}, Iterable: class {}, Comparable: class {},
    Object: class { equals(o) { return this === o; } hashCode() { return R.hash(this); } toString() { return str(this); } },
    WebcamName: anything('WebcamName'), VisionPortal: anything('VisionPortal'), AprilTagProcessor: anything('AprilTagProcessor'), AprilTagLibrary: anything('AprilTagLibrary'),
    AprilTagGameDatabase: anything('AprilTagGameDatabase'), AprilTagDetection: anything('AprilTagDetection'), ColorBlobLocatorProcessor: anything('ColorBlobLocatorProcessor'),
    PredominantColorProcessor: anything('PredominantColorProcessor'), ImageRegion: anything('ImageRegion'), ColorRange: anything('ColorRange'), ExposureControl: anything('ExposureControl'),
    GainControl: anything('GainControl'), BuiltinCameraDirection: anything('BuiltinCameraDirection'), Size: anything('Size'), OpenCvCamera: anything('OpenCvCamera'), OpenCvCameraFactory: anything('OpenCvCameraFactory'),
    OpenCvCameraRotation: anything('OpenCvCameraRotation'), ClassFactory: anything('ClassFactory'), VuforiaLocalizer: anything('VuforiaLocalizer'), Limelight3A: null,
    Position: class { constructor(u, x, y, z) { this.unit = u; this.x = x; this.y = y; this.z = z; } }, AngularVelocity: class {}, Acceleration: class {}, Velocity: class {}, Quaternion: class {},
    JavaUtil: { averageOfList: l => [...l].reduce((s, x) => s + x, 0) / l.size(), formatNumber: (x, d) => x.toFixed(d), inListGet: (l, i) => l.get(i) },
  };
  for (const n of Object.keys(EXC)) S[n] = EXC[n];
  for (const [k, v] of Object.entries(S)) if (typeof v === 'function' && !v.$jclass && /^[A-Z]/.test(k) && v !== Pose2D) { if (!Object.prototype.hasOwnProperty.call(v, '$jclass')) { try { v.$jclass = v.$names ? v.$names[0] : k; } catch (e) { /* proxies */ } } }
  // hardwareMap.get(X.class, ...) needs the exact requested class name
  const classRefs = new Map();
  function cls(name) {
    if (classRefs.has(name)) return classRefs.get(name);
    let C = Object.prototype.hasOwnProperty.call(S, name) ? S[name] : undefined;
    if (C === undefined || C === null) C = unsupportedClass(name);
    else if (CLASS_KIND.has(name)) {
      // a per-name subclass so DcMotorEx.class and DcMotor.class stay distinguishable
      const Base = C;
      C = new Proxy(Base, { get: (t, p) => (p === '$jclass' ? name : t[p]) });
    }
    classRefs.set(name, C);
    return C;
  }
  function unsupportedClass(name) {
    const fail = () => { throw new SimUnsupported(name); };
    return new Proxy(function () {}, {
      get: (t, p) => (p === '$unsupported' ? name : p === Symbol.toPrimitive || p === 'toString' ? () => name : p === Symbol.hasInstance ? () => false : fail()),
      construct: fail, apply: fail,
    });
  }

  return { h, cls, S, Telemetry, HardwareMap, Gamepad, LinearOpMode, OpMode, SimUnsupported, nullTelemetry };
}

FTC.createRuntime = createRuntime;
if (typeof module !== 'undefined' && module.exports) module.exports = FTC;
})(typeof globalThis !== 'undefined' ? globalThis : window);
