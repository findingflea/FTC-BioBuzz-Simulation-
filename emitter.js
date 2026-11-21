/* Java AST -> JavaScript generator code. User methods become generator functions so
   blocking calls (sleep, opModeIsActive, waitForStart, ...) can pause on a virtual clock. */
(function (G) {
'use strict';
const FTC = (G.FTC = G.FTC || {});

class CompileError extends Error {
  constructor(msg, line) { super(msg); this.name = 'CompileError'; this.line = line; }
}

const INTEGRAL = new Set(['byte', 'short', 'char', 'int', 'long']);
const RANK = { byte: 1, short: 2, char: 2, int: 3, long: 4, float: 5, double: 6 };
const BOXED = { Integer: 'int', Double: 'double', Float: 'float', Long: 'long', Short: 'short', Byte: 'byte', Character: 'char', Boolean: 'boolean' };
const JS_BAD = new Set(['arguments', 'eval', 'function', 'var', 'let', 'yield', 'await', 'delete', 'in', 'of', 'typeof', 'with', 'export', 'async', 'undefined', 'NaN', 'Infinity', 'debugger', 'Object', 'Array', 'Symbol', 'Error', 'Math', 'JSON', 'Promise', 'Function', 'Number']);
const JS_CLASH = new Set(['Math', 'Array', 'Object', 'Error', 'Symbol', 'Number', 'String', 'Map', 'Set', 'Date', 'JSON', 'Promise', 'Function', 'Boolean', 'RegExp']);
const BLOCKING = new Set(['sleep', 'waitForStart', 'idle', 'opModeIsActive', 'opModeInInit', 'isStopRequested', 'isStarted', 'waitOneFullHardwareCycle']);
const CHAR_AS_STRING = new Set(['append', 'print', 'println', 'insert', 'indexOf', 'lastIndexOf', 'addLine', 'add', 'contains', 'startsWith', 'endsWith', 'split']);
const SYNC_METHODS = new Set(['toString', 'equals', 'hashCode', 'compareTo', 'compare']);
const OPMODE_FIELDS = { telemetry: 'Telemetry', hardwareMap: 'HardwareMap', gamepad1: 'Gamepad', gamepad2: 'Gamepad', time: 'double', msStuckDetectInit: 'int', msStuckDetectLoop: 'int', msStuckDetectStart: 'int', msStuckDetectStop: 'int', msStuckDetectInitLoop: 'int' };
const GAMEPAD_FLOATS = new Set(['left_stick_x', 'left_stick_y', 'right_stick_x', 'right_stick_y', 'left_trigger', 'right_trigger', 'touchpad_finger_1_x', 'touchpad_finger_1_y', 'touchpad_finger_2_x', 'touchpad_finger_2_y']);
const SDK_RET = {
  getCurrentPosition: 'int', getTargetPosition: 'int', getTargetPositionTolerance: 'int', getPortNumber: 'int',
  getPower: 'double', getVelocity: 'double', getPosition: 'double', isBusy: 'boolean', getDistance: 'double',
  getRuntime: 'double', seconds: 'double', milliseconds: 'double', nanoseconds: 'long', time: 'double', startTime: 'double',
  getYaw: 'double', getPitch: 'double', getRoll: 'double', getVoltage: 'double', getMaxVoltage: 'double', getHeading: 'double',
  red: 'int', green: 'int', blue: 'int', alpha: 'int', argb: 'int', isPressed: 'boolean', getState: 'boolean', getLightDetected: 'double',
  size: 'int', indexOf: 'int', lastIndexOf: 'int', nextInt: 'int', nextDouble: 'double', nextBoolean: 'boolean',
  currentTimeMillis: 'long', nanoTime: 'long', parseInt: 'int', parseDouble: 'double', parseFloat: 'float', parseLong: 'long', parseBoolean: 'boolean',
  round: 'long', floor: 'double', ceil: 'double', sqrt: 'double', pow: 'double', sin: 'double', cos: 'double', tan: 'double',
  atan: 'double', atan2: 'double', asin: 'double', acos: 'double', toRadians: 'double', toDegrees: 'double', hypot: 'double',
  exp: 'double', log: 'double', log10: 'double', random: 'double', signum: 'double', cbrt: 'double', rint: 'double',
  floorMod: 'int', floorDiv: 'int', normalizeDegrees: 'double', normalizeRadians: 'double', scale: 'double',
  format: 'String', getMessage: 'String', getDeviceName: 'String', getConnectionInfo: 'String', name: 'String', ordinal: 'int',
  substring: 'String', trim: 'String', toUpperCase: 'String', toLowerCase: 'String', join: 'String', getSimpleName: 'String',
  intValue: 'int', doubleValue: 'double', longValue: 'long', floatValue: 'float', booleanValue: 'boolean', getCurrent: 'double',
  wasPressed: 'boolean', atRest: 'boolean', isConnected: 'boolean', getPositionAndVelocity: null,
};
const STR_REWRITE = {
  'equals/1': (r, a) => `$eq(${r}, ${a[0]})`,
  'equalsIgnoreCase/1': (r, a) => `$eqi(${r}, ${a[0]})`,
  'length/0': r => `$len(${r})`,
  'isEmpty/0': r => `$isEmpty(${r})`,
  'contains/1': (r, a) => `$contains(${r}, ${a[0]})`,
  'compareTo/1': (r, a) => `$cmp(${r}, ${a[0]})`,
  'charAt/1': (r, a) => `$charAt(${r}, ${a[0]})`,
  'toString/0': r => `$str($nn(${r}, 'toString'))`,
  'hashCode/0': r => `$hash(${r})`,
  'split/1': (r, a) => `$split(${r}, ${a[0]})`,
  'replace/2': (r, a) => `$replace(${r}, ${a[0]}, ${a[1]})`,
  'replaceAll/2': (r, a) => `$replaceAll(${r}, ${a[0]}, ${a[1]})`,
  'matches/1': (r, a) => `$matches(${r}, ${a[0]})`,
  'intValue/0': r => `Math.trunc(${r})`, 'longValue/0': r => `Math.trunc(${r})`,
  'doubleValue/0': r => `(${r})`, 'floatValue/0': r => `(${r})`, 'booleanValue/0': r => `(${r})`,
  'getClass/0': r => `$getClass(${r})`,
};
const HELPERS = ['$sync', '$y', '$g', '$gs', '$idiv', '$toInt', '$dstr', '$fstr', '$str', '$eq', '$eqi', '$len', '$isEmpty', '$contains', '$cmp', '$charAt', '$hash', '$split', '$replace', '$replaceAll', '$matches', '$getClass', '$wrap', '$inst', '$is', '$lam', '$lamg', '$newArr', '$it', '$mixin', '$Enum', '$base', '$unsupported', '$nn'];

function isIntegral(t) { return t && INTEGRAL.has(t); }
function numT(t) { if (!t) return null; if (RANK[t]) return t; if (BOXED[t] && RANK[BOXED[t]]) return BOXED[t]; return null; }
function promote(a, b) {
  a = numT(a); b = numT(b);
  if (!a || !b) return (a === 'double' || b === 'double') ? 'double' : null;
  const r = Math.max(RANK[a], RANK[b], 3);
  return r === 6 ? 'double' : r === 5 ? 'float' : r === 4 ? 'long' : 'int';
}
function typeName(t) {
  if (!t) return null;
  const segs = t.n.split('.');
  let i = 0;
  while (i < segs.length - 1 && /^[a-z]/.test(segs[i])) i++;
  let n = segs.slice(i).join('.');
  if (n === 'var') n = null;
  return n ? n + '[]'.repeat(t.dims || 0) : null;
}
function safeId(n) { return JS_BAD.has(n) ? n + '_' : n; }

class Emitter {
  constructor(unit) {
    this.unit = unit;
    this.classes = new Map();
    this.order = [];
    this.userMethodNames = new Set();
    this.usedSdk = new Set();
    this.warnings = [];
    this.staticImports = new Map();
    this.starStatics = [];
    this.enumConstOwners = new Map();
    this.scopes = [];
    this.sync = false;
    this.isStatic = false;
    this.anonCount = 0;
    this.curCls = null;
    for (const im of unit.imports) {
      if (!im.static) continue;
      const parts = im.name.split('.');
      const last = parts.pop();
      const cls = parts.filter(s => /^[A-Z]/.test(s)).join('.');
      if (last === '*') this.starStatics.push(cls); else this.staticImports.set(last, cls);
    }
  }

  err(msg, line) { throw new CompileError(msg, line); }

  /* ---------- class registry */
  register(decl, outer) {
    const name = decl.name;
    if (this.classes.has(name)) this.err(`Duplicate class name '${name}'`, decl.line);
    const info = {
      decl, name, js: JS_CLASH.has(name) ? 'U_' + name : name, outer, kind: decl.kind,
      isStatic: decl.mods.has('static') || decl.kind !== 'class' || !outer || (outer && outer.kind === 'interface'),
      ext: decl.ext ? typeName(decl.ext) : (decl.kind === 'enum' ? null : null),
      impl: decl.impl.map(typeName), fields: new Map(), methods: new Map(), ctors: [],
    };
    this.classes.set(name, info);
    this.order.push(info);
    for (const m of decl.members) {
      if (m.k === 'field') for (const d of m.decls) {
        info.fields.set(d.name, { type: typeName(m.type) + '[]'.repeat(d.dims), static: m.mods.has('static') || decl.kind === 'interface' });
      } else if (m.k === 'method') {
        if (!info.methods.has(m.name)) info.methods.set(m.name, []);
        info.methods.get(m.name).push({ ret: typeName(m.ret), params: m.params, static: m.mods.has('static'), decl: m });
        this.userMethodNames.add(m.name);
      } else if (m.k === 'ctor') info.ctors.push(m);
      else if (m.k === 'class') this.register(m, info);
    }
    for (const c of decl.consts || []) {
      info.fields.set(c.name, { type: name, static: true });
      if (!this.enumConstOwners.has(c.name)) this.enumConstOwners.set(c.name, []);
      this.enumConstOwners.get(c.name).push(name);
    }
  }
  userClass(n) {
    if (!n) return null;
    const base = n.replace(/\[\]$/g, '');
    if (this.classes.has(base)) return this.classes.get(base);
    const last = base.split('.').pop();
    return this.classes.get(last) || null;
  }
  superOf(info) { return info && info.ext ? this.userClass(info.ext) : null; }
  sdkRoot(info) {
    let c = info, guard = 0;
    while (c && guard++ < 50) {
      if (!c.ext) return null;
      const u = this.userClass(c.ext);
      if (!u) return c.ext;
      c = u;
    }
    return null;
  }
  isOpModeLike(info) { const r = this.sdkRoot(info); return r === 'LinearOpMode' || r === 'OpMode'; }
  findField(info, id) {
    for (let c = info, g = 0; c && g < 50; c = this.superOf(c), g++) {
      if (c.fields.has(id)) return Object.assign({ owner: c }, c.fields.get(id));
    }
    for (const iname of info.impl || []) {
      const ic = this.userClass(iname);
      if (ic && ic.fields.has(id)) return Object.assign({ owner: ic }, ic.fields.get(id));
    }
    return null;
  }
  findMethod(info, id) {
    for (let c = info, g = 0; c && g < 50; c = this.superOf(c), g++) {
      if (c.methods.has(id)) return { owner: c, list: c.methods.get(id) };
    }
    for (const iname of info.impl || []) {
      const ic = this.userClass(iname);
      if (ic && ic.methods.has(id)) return { owner: ic, list: ic.methods.get(id) };
    }
    return null;
  }
  sdk(name) {
    const root = name.split('.')[0].replace(/\[\]/g, '');
    this.usedSdk.add(root);
    return 'S_' + root + name.slice(root.length);
  }
  classRef(name) {
    const u = this.userClass(name);
    if (u) return u.js;
    return this.sdk(name);
  }

  /* ---------- scopes */
  pushScope(barrier) { this.scopes.push({ vars: new Map(), barrier: barrier || null }); }
  popScope() { this.scopes.pop(); }
  declare(name, type) {
    const js = safeId(name);
    this.scopes[this.scopes.length - 1].vars.set(name, { c: js, t: type });
    return js;
  }
  thisPrefix(hops) { return 'this' + '.$outer'.repeat(hops); }
  resolveName(id, line) {
    let hops = 0;
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const s = this.scopes[i];
      if (s.vars.has(id)) return s.vars.get(id);
      if (s.barrier) {
        const f = this.findField(s.barrier, id);
        if (f) {
          if (f.static) return { c: `${f.owner.js}.${id}`, t: f.type };
          return { c: `${this.thisPrefix(hops)}.${id}`, t: f.type };
        }
        if (this.isOpModeLike(s.barrier) && OPMODE_FIELDS[id]) return { c: `${this.thisPrefix(hops)}.${id}`, t: OPMODE_FIELDS[id] };
        if (s.barrier.isStatic && s.barrier.outer && !s.barrier.anon) {
          // static nested class: only outer statics are visible
          for (let o = s.barrier.outer; o; o = o.outer) {
            const of = this.findField(o, id);
            if (of && of.static) return { c: `${of.owner.js}.${id}`, t: of.type };
          }
          break;
        }
        hops++;
      }
    }
    if (this.staticImports.has(id)) return { c: `${this.classRef(this.staticImports.get(id))}.${id}`, t: null };
    if (this.userClass(id)) return { c: this.userClass(id).js, t: '$class:' + id, cls: id };
    if (/^[A-Z]/.test(id)) return { c: this.sdk(id), t: '$class:' + id, cls: id };
    if (this.starStatics.length) return { c: `${this.classRef(this.starStatics[0])}.${id}`, t: null };
    this.err(`Cannot find symbol '${id}'. Is it declared, or spelled differently?`, line);
  }
  resolveMethod(name) {
    let hops = 0;
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const s = this.scopes[i];
      if (!s.barrier) continue;
      const m = this.findMethod(s.barrier, name);
      if (m) {
        const isSt = m.list.every(x => x.static);
        return { recv: isSt ? m.owner.js : this.thisPrefix(hops), user: true, ret: m.list[0].ret, sync: SYNC_METHODS.has(name) };
      }
      if (this.sdkRoot(s.barrier)) return { recv: this.thisPrefix(hops), user: false };
      if (s.barrier.isStatic && s.barrier.outer && !s.barrier.anon) {
        for (let o = s.barrier.outer; o; o = o.outer) {
          const om = this.findMethod(o, name);
          if (om && om.list.every(x => x.static)) return { recv: om.owner.js, user: true, ret: om.list[0].ret, sync: SYNC_METHODS.has(name) };
        }
        break;
      }
      hops++;
    }
    if (this.staticImports.has(name)) return { recv: this.classRef(this.staticImports.get(name)), user: false };
    return null;
  }
  wrapYield(code) { return this.sync ? `$sync(${code})` : `(yield* ${code})`; }

  /* ---------- expressions: return {c, t} */
  ex(n) {
    switch (n.k) {
      case 'lit': return this.exLit(n);
      case 'paren': { const e = this.ex(n.e); return { c: `(${e.c})`, t: e.t, cls: e.cls }; }
      case 'name': return this.resolveName(n.id, n.line);
      case 'this': return { c: 'this', t: this.curCls ? this.curCls.name : null };
      case 'outerthis': {
        const target = n.e.k === 'name' ? n.e.id : null;
        let hops = 0;
        for (let i = this.scopes.length - 1; i >= 0; i--) {
          const s = this.scopes[i];
          if (!s.barrier) continue;
          if (s.barrier.name === target) return { c: this.thisPrefix(hops), t: target };
          hops++;
        }
        return { c: 'this', t: target };
      }
      case 'field': return this.exField(n);
      case 'call': return this.exCall(n);
      case 'new': return this.exNew(n);
      case 'newarr': return this.exNewArr(n);
      case 'arrlit': return { c: '[' + n.elems.map(e => this.ex(e).c).join(', ') + ']', t: null };
      case 'index': {
        const o = this.ex(n.obj), i = this.ex(n.idx);
        const t = o.t && o.t.endsWith('[]') ? o.t.slice(0, -2) : null;
        return { c: `${o.c}[${i.c}]`, t };
      }
      case 'unary': {
        const e = this.ex(n.e);
        if (n.op === '!') return { c: `!${e.c}`, t: 'boolean' };
        if (n.op === '~') return { c: `~${e.c}`, t: e.t };
        const t = numT(e.t);
        return { c: `${n.op}${e.c.startsWith(n.op) ? ' ' : ''}${e.c}`, t: t && RANK[t] < 3 ? 'int' : (t || e.t) };
      }
      case 'incdec': {
        const e = this.ex(n.e);
        return { c: n.prefix ? `${n.op}${e.c}` : `${e.c}${n.op}`, t: e.t };
      }
      case 'bin': return this.exBin(n);
      case 'assign': return this.exAssign(n);
      case 'cond': {
        const c = this.ex(n.c), a = this.ex(n.a), b = this.ex(n.b);
        let t = a.t === b.t ? a.t : promote(a.t, b.t) || (a.t === 'null' ? b.t : a.t);
        return { c: `(${c.c} ? ${a.c} : ${b.c})`, t };
      }
      case 'cast': return this.exCast(n);
      case 'instanceof': {
        if (n.bind) this.err('Pattern matching with instanceof (x instanceof Foo f) is not supported yet. Cast on the next line instead.', n.line);
        const e = this.ex(n.e);
        const tn = typeName(n.type);
        const u = this.userClass(tn);
        if (u) return { c: `(${e.c} instanceof ${u.js})`, t: 'boolean' };
        return { c: `$is(${e.c}, ${JSON.stringify(tn)})`, t: 'boolean' };
      }
      case 'classlit': {
        const name = n.name || (n.e.k === 'name' ? n.e.id : (n.e.k === 'field' ? this.flatName(n.e) : null));
        if (!name) this.err('Unsupported class literal', n.line);
        return { c: this.classRef(name), t: 'Class' };
      }
      case 'lambda': return this.exLambda(n);
      case 'mref': return this.exMref(n);
      case 'switchexpr': return this.exSwitchExpr(n);
      case 'super': return { c: 'super', t: this.curCls && this.curCls.ext };
    }
    this.err(`Unsupported expression '${n.k}'`, n.line);
  }
  flatName(n) {
    if (n.k === 'name') return n.id;
    if (n.k === 'field') { const o = this.flatName(n.obj); return o ? o + '.' + n.name : null; }
    return null;
  }
  exLit(n) {
    if (n.t === 'String') return { c: JSON.stringify(n.v), t: 'String' };
    if (n.t === 'null') return { c: 'null', t: 'null' };
    if (n.t === 'boolean') return { c: String(n.v), t: 'boolean' };
    if (n.t === 'char') return { c: String(n.v), t: 'char' };
    let c = String(n.v);
    if (n.t === 'float') c = String(Math.fround(n.v)) === String(n.v) ? c : c;
    return { c, t: n.t };
  }
  exField(n) {
    const o = this.ex(n.obj);
    if (o.t && o.t.startsWith('$class:')) {
      const cname = o.t.slice(7);
      const u = this.userClass(cname);
      if (u) {
        const nested = this.classes.get(n.name);
        if (nested && nested.outer === u) return { c: nested.js, t: '$class:' + n.name, cls: n.name };
        const f = this.findField(u, n.name);
        if (f) return { c: `${f.owner.js}.${n.name}`, t: f.type };
        if (n.name === 'length') return { c: `${o.c}.length`, t: 'int' };
        this.err(`'${n.name}' is not a field of ${cname}`, n.line);
      }
      if (/^[A-Z][a-z0-9]/.test(n.name) && !/^[A-Z0-9_]+$/.test(n.name)) return { c: `${o.c}.${n.name}`, t: '$class:' + cname + '.' + n.name };
      let t = cname;
      if (cname === 'Math' && (n.name === 'PI' || n.name === 'E')) t = 'double';
      else if (/^(Integer|Long|Short|Byte)$/.test(cname)) t = BOXED[cname] || 'int';
      else if (/^(Double|Float)$/.test(cname)) t = BOXED[cname];
      return { c: `${o.c}.${n.name}`, t };
    }
    if (n.name === 'length' && o.t && o.t.endsWith('[]')) return { c: `${o.c}.length`, t: 'int' };
    let t = null;
    const u = this.userClass(o.t);
    if (u && !(o.t || '').endsWith('[]')) {
      const f = this.findField(u, n.name);
      if (f) t = f.type;
      else if (this.isOpModeLike(u) && OPMODE_FIELDS[n.name]) t = OPMODE_FIELDS[n.name];
    } else if (o.t === 'Gamepad') t = GAMEPAD_FLOATS.has(n.name) ? 'float' : (n.name === 'id' ? 'int' : 'boolean');
    else if (n.name === 'length') t = 'int';
    return { c: `${o.c}.${n.name}`, t };
  }
  args(list) { return list.map(a => this.ex(a)); }
  exCall(n) {
    const name = n.name;
    if (n.obj === null) {
      if (name === 'super' || name === 'this') this.err(`'${name}(...)' must be the first statement of a constructor`, n.line);
      const r = this.resolveMethod(name);
      const a = this.args(n.args);
      const ac = a.map(x => x.c).join(', ');
      if (!r) {
        if (BLOCKING.has(name) || name === 'getRuntime' || name === 'resetRuntime' || name === 'requestOpModeStop' || name === 'terminateOpModeNow' || name === 'updateTelemetry')
          this.err(`'${name}()' is an OpMode method, but this class doesn't extend LinearOpMode or OpMode. Pass the OpMode in and call opMode.${name}() instead.`, n.line);
        this.err(`Cannot find method '${name}(...)'.`, n.line);
      }
      const call = `${r.recv}.${name}(${ac})`;
      if (r.user) return { c: r.sync ? call : this.wrapYield(call), t: r.ret };
      if (BLOCKING.has(name)) return { c: this.wrapYield(call), t: name === 'sleep' || name === 'waitForStart' || name === 'idle' ? 'void' : 'boolean' };
      return { c: call, t: SDK_RET[name] !== undefined ? SDK_RET[name] : null };
    }
    if (n.obj.k === 'super') {
      const a = this.args(n.args).map(x => x.c).join(', ');
      const sup = this.superOf(this.curCls);
      const m = sup && this.findMethod(sup, name);
      const call = `super.${name}(${a})`;
      if (m) return { c: SYNC_METHODS.has(name) ? call : this.wrapYield(call), t: m.list[0].ret };
      return { c: BLOCKING.has(name) ? this.wrapYield(`$y(${call})`) : call, t: SDK_RET[name] || null };
    }
    const o = this.ex(n.obj);
    const a = this.args(n.args);
    if (CHAR_AS_STRING.has(name)) for (const x of a) if (x.t === 'char' || x.t === 'Character') { x.c = `String.fromCharCode(${x.c})`; x.t = 'String'; }
    const ac = a.map(x => x.c);
    if (o.t && o.t.startsWith('$class:')) {
      const cname = o.t.slice(7);
      const u = this.userClass(cname);
      if (u) {
        const m = this.findMethod(u, name);
        if (u.kind === 'enum' && (name === 'values' || name === 'valueOf')) return { c: `${u.js}.${name}(${ac.join(', ')})`, t: name === 'values' ? cname + '[]' : cname };
        if (!m) this.err(`Cannot find method '${name}(...)' in ${cname}`, n.line);
        const call = `${m.owner.js}.${name}(${ac.join(', ')})`;
        return { c: SYNC_METHODS.has(name) ? call : this.wrapYield(call), t: m.list[0].ret };
      }
      const call = `${o.c}.${name}(${ac.join(', ')})`;
      if (cname === 'Thread' && name === 'sleep') return { c: this.wrapYield(call), t: 'void' };
      if (cname === 'Math') {
        if (name === 'abs' || name === 'max' || name === 'min' || name === 'clamp') {
          let t = a[0] ? numT(a[0].t) : null;
          for (const x of a.slice(1)) t = promote(t, x.t);
          return { c: call, t: name === 'abs' ? (a[0] && numT(a[0].t)) || null : t };
        }
        if (name === 'round') return { c: call, t: a[0] && a[0].t === 'float' ? 'int' : 'long' };
      }
      if (cname === 'Range' && name === 'clip') {
        let t = null; for (const x of a) t = t === null ? numT(x.t) : promote(t, x.t);
        return { c: call, t };
      }
      if ((cname === 'String' && name === 'valueOf') || (/^(Integer|Double|Float|Long|Boolean|Character)$/.test(cname) && name === 'toString')) {
        return { c: `$str(${this.toStr(a[0])})`, t: 'String' };
      }
      return { c: call, t: SDK_RET[name] !== undefined ? SDK_RET[name] : null };
    }
    const u = o.t && !o.t.endsWith('[]') ? this.userClass(o.t) : null;
    if (u) {
      const m = this.findMethod(u, name);
      if (m) {
        const call = `${o.c}.${name}(${ac.join(', ')})`;
        if (SYNC_METHODS.has(name)) return { c: call, t: m.list[0].ret };
        // an interface may be implemented by a lambda, which returns plain values
        return { c: this.wrapYield(m.owner.kind === 'interface' || u.kind === 'interface' ? `$y(${call})` : call), t: m.list[0].ret };
      }
      if (u.kind === 'enum' && (name === 'name' || name === 'ordinal' || name === 'toString' || name === 'equals' || name === 'compareTo')) {
        if (name === 'equals') return { c: `(${o.c} === ${ac[0]})`, t: 'boolean' };
        return { c: `${o.c}.${name}(${ac.join(', ')})`, t: SDK_RET[name] || 'String' };
      }
    }
    const key = `${name}/${a.length}`;
    if (!u && STR_REWRITE[key] && !(o.t === 'Telemetry' || o.t === 'HardwareMap')) {
      let t = { equals: 'boolean', equalsIgnoreCase: 'boolean', length: 'int', isEmpty: 'boolean', contains: 'boolean', compareTo: 'int', charAt: 'char', toString: 'String', hashCode: 'int', split: 'String[]', replace: 'String', replaceAll: 'String', matches: 'boolean' }[name];
      if (t === undefined) t = SDK_RET[name] || null;
      return { c: STR_REWRITE[key](o.c, ac), t };
    }
    let call = `${o.c}.${name}(${ac.join(', ')})`;
    if (o.t === 'Telemetry' && name === 'addData' && a.length === 2) {
      call = `${o.c}.addData(${ac[0]}, ${this.toStr(a[1], true)})`;
    }
    if (BLOCKING.has(name)) return { c: this.wrapYield(`$y(${call})`), t: name === 'sleep' || name === 'waitForStart' || name === 'idle' ? 'void' : 'boolean' };
    if (!u && this.userMethodNames.has(name) && !(o.t && /^(Telemetry|HardwareMap|Gamepad|DcMotor|DcMotorEx|Servo|CRServo|IMU|ElapsedTime|String)$/.test(o.t))) {
      return { c: this.wrapYield(`$y(${call})`), t: null };
    }
    if (o.t === 'String' && (name === 'substring' || name === 'trim' || name === 'toUpperCase' || name === 'toLowerCase')) return { c: call, t: 'String' };
    return { c: call, t: SDK_RET[name] !== undefined ? SDK_RET[name] : null };
  }
  toStr(e, forTelemetry) {
    if (!e) return '""';
    const t = e.t;
    if (t === 'double' || t === 'Double') return `$dstr(${e.c})`;
    if (t === 'float' || t === 'Float') return `$fstr(${e.c})`;
    if (t === 'char' || t === 'Character') return `String.fromCharCode(${e.c})`;
    if (forTelemetry) return e.c;
    if (t === 'String' || isIntegral(t) || t === 'boolean') return e.c;
    return `$str(${e.c})`;
  }
  ctorCall(u, argCodes, line) {
    const byArity = u.ctors.filter(c => c.params.length === argCodes.length || (c.params.length && c.params[c.params.length - 1].varargs));
    if (!u.ctors.length) {
      if (argCodes.length) {
        const sup = this.superOf(u);
        if (sup) return this.ctorCall(sup, argCodes, line);
        this.err(`${u.name} has no constructor that takes ${argCodes.length} argument(s)`, line);
      }
      return '';
    }
    if (!byArity.length) this.err(`${u.name} has no constructor that takes ${argCodes.length} argument(s)`, line);
    return `.$c${u.ctors.indexOf(byArity[0])}(${argCodes.join(', ')})`;
  }
  exNew(n) {
    const tn = typeName(n.type);
    const a = this.args(n.args).map(x => x.c);
    if (n.body) {
      const u = this.userClass(tn);
      const anon = this.makeAnon(n.body, tn);
      const clsCode = this.emitClassBody(anon, true);
      if (u) {
        return { c: `new (${clsCode})().$o(this)${u.kind === 'interface' ? '' : this.ctorCall(u, a, n.line)}`, t: tn };
      }
      return { c: `new (${clsCode})(${a.join(', ')}).$o(this)`, t: tn };
    }
    const u = this.userClass(tn);
    if (u) {
      if (u.kind === 'enum') this.err(`Enums can't be created with 'new'`, n.line);
      if (u.kind === 'interface') this.err(`'${tn}' is an interface and can't be created with 'new'`, n.line);
      let c = `new ${u.js}()`;
      if (!u.isStatic) c += '.$o(this)';
      c += this.ctorCall(u, a, n.line);
      return { c, t: tn };
    }
    return { c: `new ${this.sdk(tn)}(${a.join(', ')})`, t: tn };
  }
  makeAnon(body, baseName) {
    const name = `$Anon${++this.anonCount}`;
    body.name = name;
    const u = this.userClass(baseName);
    const isIface = u ? u.kind === 'interface' : false;
    body.ext = isIface ? null : { n: baseName, args: null, dims: 0 };
    body.impl = isIface ? [{ n: baseName, args: null, dims: 0 }] : [];
    if (!u) body.sdkBase = baseName;
    const info = {
      decl: body, name, js: name, outer: this.curCls, kind: 'class', isStatic: false, anon: true,
      ext: body.ext ? baseName : null, impl: isIface ? [baseName] : [], fields: new Map(), methods: new Map(), ctors: [],
    };
    for (const m of body.members) {
      if (m.k === 'field') for (const d of m.decls) info.fields.set(d.name, { type: typeName(m.type), static: false });
      else if (m.k === 'method') {
        if (!info.methods.has(m.name)) info.methods.set(m.name, []);
        info.methods.get(m.name).push({ ret: typeName(m.ret), params: m.params, static: false, decl: m });
        this.userMethodNames.add(m.name);
      }
    }
    this.classes.set(name, info);
    return info;
  }
  exNewArr(n) {
    const base = typeName(Object.assign({}, n.type, { dims: 0 }));
    const total = n.dims.length + n.extra;
    const t = base + '[]'.repeat(total);
    if (n.init) return { c: this.ex(n.init).c, t };
    const def = this.defaultFor(n.extra ? null : base);
    return { c: `$newArr([${n.dims.map(d => this.ex(d).c).join(', ')}], ${def})`, t };
  }
  defaultFor(t) {
    if (!t) return 'null';
    if (RANK[t]) return '0';
    if (t === 'boolean') return 'false';
    return 'null';
  }
  exBin(n) {
    const l = this.ex(n.l), r = this.ex(n.r);
    const op = n.op;
    if (op === '+' && (l.t === 'String' || r.t === 'String')) {
      return { c: `(${this.toStr(l)} + ${this.toStr(r)})`, t: 'String' };
    }
    if (op === '==' || op === '!=') {
      const loose = l.t === 'null' || r.t === 'null';
      return { c: `(${l.c} ${loose ? op : op + '='} ${r.c})`, t: 'boolean' };
    }
    if (op === '&&' || op === '||') return { c: `(${l.c} ${op} ${r.c})`, t: 'boolean' };
    if (op === '<' || op === '>' || op === '<=' || op === '>=') return { c: `(${l.c} ${op} ${r.c})`, t: 'boolean' };
    if ((op === '&' || op === '|' || op === '^') && (l.t === 'boolean' || r.t === 'boolean')) {
      if (op === '^') return { c: `(!!${l.c} !== !!${r.c})`, t: 'boolean' };
      return { c: `!!(${l.c} ${op} ${r.c})`, t: 'boolean' };
    }
    const t = promote(l.t, r.t);
    if (op === '/' && isIntegral(numT(l.t)) && isIntegral(numT(r.t))) return { c: `$idiv(${l.c}, ${r.c})`, t };
    if (op === '<<' || op === '>>' || op === '>>>') return { c: `(${l.c} ${op} ${r.c})`, t: numT(l.t) || 'int' };
    return { c: `(${l.c} ${op} ${r.c})`, t };
  }
  exAssign(n) {
    const l = this.ex(n.l), r = this.ex(n.r);
    if (n.op === '=') {
      let rc = r.c;
      if (isIntegral(l.t) && (r.t === 'double' || r.t === 'float')) rc = `$toInt(${rc})`;
      return { c: `(${l.c} = ${rc})`, t: l.t };
    }
    const op = n.op.slice(0, -1);
    if (op === '+' && l.t === 'String') return { c: `(${l.c} += ${this.toStr(r)})`, t: 'String' };
    if (isIntegral(l.t)) {
      if (op === '/') {
        if (isIntegral(numT(r.t))) return { c: `(${l.c} = $idiv(${l.c}, ${r.c}))`, t: l.t };
        return { c: `(${l.c} = $toInt(${l.c} / ${r.c}))`, t: l.t };
      }
      if ((op === '+' || op === '-' || op === '*' || op === '%') && (numT(r.t) === 'double' || numT(r.t) === 'float' || !numT(r.t))) {
        if (numT(r.t) === 'double' || numT(r.t) === 'float') return { c: `(${l.c} = $toInt(${l.c} ${op} ${r.c}))`, t: l.t };
      }
    }
    if ((op === '&' || op === '|' || op === '^') && l.t === 'boolean') {
      if (op === '^') return { c: `(${l.c} = (!!${l.c} !== !!${r.c}))`, t: 'boolean' };
      return { c: `(${l.c} = !!(${l.c} ${op} ${r.c}))`, t: 'boolean' };
    }
    return { c: `(${l.c} ${n.op} ${r.c})`, t: l.t };
  }
  exCast(n) {
    const tn = typeName(n.type);
    const e = this.ex(n.e);
    if (tn === 'int' || tn === 'long' || tn === 'short' || tn === 'byte') {
      if (isIntegral(numT(e.t)) && tn !== 'short' && tn !== 'byte') return { c: e.c, t: tn };
      let c = `$toInt(${e.c})`;
      if (tn === 'short') c = `((${c} << 16) >> 16)`;
      if (tn === 'byte') c = `((${c} << 24) >> 24)`;
      return { c, t: tn };
    }
    if (tn === 'char') return { c: `($toInt(${e.c}) & 0xFFFF)`, t: 'char' };
    if (tn === 'double') return { c: e.c, t: 'double' };
    if (tn === 'float') return { c: `Math.fround(${e.c})`, t: 'float' };
    return { c: e.c, t: tn };
  }
  exLambda(n) {
    const saveSync = this.sync;
    this.sync = true;
    this.pushScope();
    const ps = n.params.map(p => this.declare(p.name, p.type ? typeName(p.type) : null));
    if (!n.expr) {
      this.sync = false;
      const b = n.body.body.map(s => this.st(s)).join('\n');
      this.popScope();
      this.sync = saveSync;
      return { c: `$lamg(function* (${ps.join(', ')}) {\n${b}\n}.bind(this))`, t: null };
    }
    const body = this.ex(n.expr).c;
    this.popScope();
    this.sync = saveSync;
    return { c: `$lam((${ps.join(', ')}) => ${body.startsWith('{') ? '(' + body + ')' : body})`, t: null };
  }
  exMref(n) {
    if (n.name === 'new') {
      const name = this.flatName(n.obj);
      return { c: `$lam((...a) => new ${this.classRef(name)}(...a))`, t: null };
    }
    const o = this.ex(n.obj);
    return { c: `$lam((...a) => $sync(${o.c}.${n.name}(...a)))`, t: null };
  }
  caseLabel(lbl, selT) {
    if (lbl.k === 'name') {
      const u = this.userClass(selT);
      if (u && u.kind === 'enum' && u.fields.has(lbl.id)) return `${u.js}.${lbl.id}`;
      let local = null;
      try { local = this.resolveName(lbl.id, lbl.line); } catch (e) { local = null; }
      if (local && !(local.t || '').startsWith('$class:') && !/^[A-Z0-9_]+$/.test(lbl.id)) return local.c;
      const owners = this.enumConstOwners.get(lbl.id);
      if (owners && owners.length) return `${this.userClass(owners[0]).js}.${lbl.id}`;
      if (selT && !RANK[selT] && selT !== 'String') return `${this.classRef(selT)}.${lbl.id}`;
      if (local) return local.c;
      this.err(`Unknown case label '${lbl.id}'`, lbl.line);
    }
    return this.ex(lbl).c;
  }
  switchCases(cases, selT, asExpr) {
    let out = '';
    for (const c of cases) {
      for (const l of c.labels) {
        if (l.k === 'lit' && l.t === 'null') { out += `case null:\n`; continue; }
        out += `case ${this.caseLabel(l, selT)}:\n`;
      }
      if (c.isDefault) out += 'default:\n';
      this.pushScope();
      if (c.arrow) {
        const s = c.body[0];
        if (asExpr && s.k === 'expr') out += `{ return ${this.ex(s.e).c}; }\n`;
        else out += `{ ${this.st(s)} ${asExpr ? '' : 'break;'} }\n`;
      } else {
        out += c.body.map(s => this.st(s)).join('\n') + '\n';
      }
      this.popScope();
    }
    return out;
  }
  exSwitchExpr(n) {
    const sel = this.ex(n.e);
    const saveSync = this.sync;
    this.sync = false;
    const body = `(function* () { switch (${sel.c}) {\n${this.switchCases(n.cases, sel.t, true)}} }).call(this)`;
    this.sync = saveSync;
    return { c: this.wrapYield(body), t: null };
  }

  /* ---------- statements */
  guard() { return this.sync ? '$gs();' : 'if ($g()) yield 0;'; }
  body(s) {
    if (s.k === 'block') { this.pushScope(); const b = s.body.map(x => this.st(x)).join('\n'); this.popScope(); return b; }
    this.pushScope(); const b = this.st(s); this.popScope(); return b;
  }
  st(s) {
    const L = s.line ? `$ln=${s.line}; ` : '';
    switch (s.k) {
      case 'block': { this.pushScope(); const b = s.body.map(x => this.st(x)).join('\n'); this.popScope(); return `{\n${b}\n}`; }
      case 'empty': return ';';
      case 'expr': return L + this.ex(s.e).c + ';';
      case 'local': return L + this.localDecl(s) + ';';
      case 'if': {
        const c = this.ex(s.c).c;
        let out = `${L}if (${c}) {\n${this.body(s.a)}\n}`;
        if (s.b) out += ` else {\n${this.body(s.b)}\n}`;
        return out;
      }
      case 'while': return `${L}while (${this.ex(s.c).c}) {\n${this.guard()}\n${this.body(s.body)}\n}`;
      case 'dowhile': {
        const b = this.body(s.body);
        return `${L}do {\n${this.guard()}\n${b}\n} while (${this.ex(s.c).c});`;
      }
      case 'for': {
        this.pushScope();
        let init = '';
        if (s.initDecl) init = this.localDecl(s.initDecl);
        else init = s.init.map(e => this.ex(e).c).join(', ');
        const c = s.c ? this.ex(s.c).c : '';
        const u = s.update.map(e => this.ex(e).c).join(', ');
        const b = this.body(s.body);
        this.popScope();
        return `${L}for (${init}; ${c}; ${u}) {\n${this.guard()}\n${b}\n}`;
      }
      case 'foreach': {
        const it = this.ex(s.iter);
        this.pushScope();
        let et = typeName(s.type);
        if (!et && it.t && it.t.endsWith('[]')) et = it.t.slice(0, -2);
        const v = this.declare(s.name, et);
        const b = this.body(s.body);
        this.popScope();
        return `${L}for (let ${v} of $it(${it.c})) {\n${this.guard()}\n${b}\n}`;
      }
      case 'return': return L + (s.e ? `return ${this.ex(s.e).c};` : 'return;');
      case 'break': return L + (s.label ? `break ${s.label};` : 'break;');
      case 'continue': return L + (s.label ? `continue ${s.label};` : 'continue;');
      case 'throw': return L + `throw ${this.ex(s.e).c};`;
      case 'labeled': return `${L}${s.label}: ${this.st(s.body).replace(/^\$ln=\d+; /, '')}`;
      case 'switch': {
        const sel = this.ex(s.e);
        this.pushScope();
        const out = `${L}switch (${sel.c}) {\n${this.switchCases(s.cases, sel.t, false)}}`;
        this.popScope();
        return out;
      }
      case 'try': return this.tryStmt(s, L);
      case 'localclass': this.err('Classes declared inside a method are not supported. Move the class to the top level of your file.', s.line);
    }
    this.err(`Unsupported statement '${s.k}'`, s.line);
  }
  localDecl(s) {
    const base = typeName(s.type);
    const parts = [];
    for (const d of s.decls) {
      let t = base ? base + '[]'.repeat(d.dims) : null;
      let ic = null;
      if (d.init) {
        const e = this.ex(d.init);
        if (!t) t = e.t && e.t !== 'null' && !e.t.startsWith('$class:') ? e.t : null;
        ic = e.c;
        if (isIntegral(t) && (e.t === 'double' || e.t === 'float')) ic = `$toInt(${ic})`;
      }
      const js = this.declare(d.name, t);
      parts.push(ic !== null ? `${js} = ${ic}` : js);
    }
    return 'let ' + parts.join(', ');
  }
  tryStmt(s, L) {
    this.pushScope();
    let res = '';
    for (const r of s.resources) res += `let ${this.declare(r.name, typeName(r.type))} = ${this.ex(r.init).c};\n`;
    const block = s.block.body.map(x => this.st(x)).join('\n');
    this.popScope();
    let out = `${L}try {\n${res}${block}\n}`;
    if (s.catches.length) {
      out += ' catch ($e) {\n$e = $wrap($e);\n';
      s.catches.forEach((c, i) => {
        const names = c.types.map(t => JSON.stringify(typeName(t))).join(', ');
        this.pushScope();
        const v = this.declare(c.name, typeName(c.types[0]));
        const b = c.body.body.map(x => this.st(x)).join('\n');
        this.popScope();
        out += `${i ? ' else ' : ''}if ($inst($e, ${names})) {\nlet ${v} = $e;\n${b}\n}`;
      });
      out += ' else throw $e;\n}';
    }
    if (s.fin) out += ` finally {\n${this.body(s.fin)}\n}`;
    return out;
  }

  /* ---------- classes */
  methodCode(m, info, nameOverride) {
    const sync = SYNC_METHODS.has(m.name);
    const save = [this.sync, this.isStatic];
    this.sync = sync;
    this.isStatic = m.mods.has('static');
    this.pushScope();
    const ps = m.params.map(p => (p.varargs ? '...' : '') + this.declare(p.name, typeName(p.type)));
    const body = m.body.body.map(s => this.st(s)).join('\n');
    this.popScope();
    [this.sync, this.isStatic] = save;
    const nm = nameOverride || m.name;
    return `${m.mods.has('static') ? 'static ' : ''}${sync ? '' : '*'}${nm}(${ps.join(', ')}) {\n${body}\n}`;
  }
  ctorCode(c, idx, info) {
    const save = [this.sync, this.isStatic];
    this.sync = true; this.isStatic = false;
    this.pushScope();
    const ps = c.params.map(p => (p.varargs ? '...' : '') + this.declare(p.name, typeName(p.type)));
    const stmts = c.body.body.slice();
    let pre = '';
    const first = stmts[0];
    const sup = this.superOf(info);
    if (first && first.k === 'expr' && first.e.k === 'call' && first.e.obj === null && (first.e.name === 'super' || first.e.name === 'this')) {
      stmts.shift();
      const a = this.args(first.e.args).map(x => x.c);
      if (first.e.name === 'this') pre = `this${this.ctorCall(info, a, first.line)};\n`;
      else if (sup) pre = `super${this.ctorCall(sup, a, first.line).replace(/^\./, '.')};\n`;
      else pre = `if (super.$init) super.$init(${a.join(', ')});\n`;
    } else if (sup && sup.ctors.some(x => x.params.length === 0)) {
      pre = `super${this.ctorCall(sup, [], c.line)};\n`;
    }
    const body = stmts.map(s => this.st(s)).join('\n');
    this.popScope();
    [this.sync, this.isStatic] = save;
    return `$c${idx}(${ps.join(', ')}) {\n${pre}${body}\nreturn this;\n}`;
  }
  emitClassBody(info, asExpr) {
    const d = info.decl;
    const saveCls = this.curCls, saveScopes = this.scopes;
    this.curCls = info;
    if (!asExpr) this.scopes = [];
    this.pushScope(info);
    let ext = '';
    if (d.kind === 'enum') ext = ' extends $Enum';
    else if (info.ext) {
      const u = this.userClass(info.ext);
      ext = ' extends ' + (u ? u.js : `$base(${this.sdk(info.ext)})`);
    } else if (d.sdkBase) ext = ` extends $base(${this.sdk(d.sdkBase)})`;
    const parts = [];
    // instance fields
    const saveSync = this.sync; this.sync = true;
    for (const m of d.members) {
      if (m.k !== 'field' || m.mods.has('static') || d.kind === 'interface') continue;
      for (const dc of m.decls) {
        const t = typeName(m.type) + '[]'.repeat(dc.dims);
        const init = dc.init ? this.ex(dc.init) : null;
        let ic = init ? init.c : this.defaultFor(dc.dims ? null : typeName(m.type));
        if (init && isIntegral(t) && (init.t === 'double' || init.t === 'float')) ic = `$toInt(${ic})`;
        parts.push(`${dc.name} = ${ic};`);
      }
    }
    this.sync = saveSync;
    parts.push(`$o(o) { this.$outer = o; return this; }`);
    info.ctors.forEach((c, i) => parts.push(this.ctorCode(c, i, info)));
    // methods, grouped for overloads
    const groups = new Map();
    for (const m of d.members) {
      if (m.k !== 'method' || !m.body) continue;
      const key = (m.mods.has('static') ? 'S:' : 'I:') + m.name;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    for (const [, ms] of groups) {
      if (ms.length === 1) { parts.push(this.methodCode(ms[0], info)); continue; }
      const m0 = ms[0];
      const isSt = m0.mods.has('static');
      const sync = SYNC_METHODS.has(m0.name);
      const recv = isSt ? info.js : 'this';
      const seen = new Set();
      let disp = `${isSt ? 'static ' : ''}${sync ? '' : '*'}${m0.name}(...a) {\nswitch (a.length) {\n`;
      ms.forEach((m, i) => {
        const nm = `${m.name}$${i}`;
        parts.push(this.methodCode(m, info, nm));
        if (!seen.has(m.params.length)) {
          seen.add(m.params.length);
          disp += `case ${m.params.length}: return ${sync ? '' : 'yield* '}${recv}.${nm}(...a);\n`;
        }
      });
      const sup = this.superOf(info);
      const supHas = sup && this.findMethod(sup, m0.name);
      disp += `}\n${supHas ? `return ${sync ? '' : 'yield* '}super.${m0.name}(...a);` : `throw new Error('No version of ${m0.name}() takes ' + a.length + ' arguments');`}\n}`;
      parts.push(disp);
    }
    if (d.kind === 'enum') parts.push(`static values() { return ${info.js}.$values.slice(); }`, `static valueOf(s) { return $Enum.valueOf(${info.js}, s); }`);
    this.popScope();
    this.curCls = saveCls;
    this.scopes = saveScopes;
    const nm = info.anon ? '' : ' ' + info.js;
    return `class${nm}${ext} {\n${parts.join('\n')}\n}`;
  }
  emitStatics(info) {
    const d = info.decl;
    const saveCls = this.curCls;
    this.curCls = info;
    this.scopes = [];
    this.pushScope(info);
    const save = [this.sync, this.isStatic];
    this.sync = true; this.isStatic = true;
    const out = [];
    (d.consts || []).forEach((c, i) => {
      const a = this.args(c.args).map(x => x.c);
      let ctor = info.ctors.length ? this.ctorCall(info, a, c.line) : '';
      if (c.body) {
        const anon = this.makeAnon(c.body, info.name);
        const code = this.emitClassBody(anon, true);
        out.push(`${info.js}.${c.name} = new (${code})(${JSON.stringify(c.name)}, ${i})${ctor};`);
      } else out.push(`${info.js}.${c.name} = new ${info.js}(${JSON.stringify(c.name)}, ${i})${ctor};`);
    });
    if (d.kind === 'enum') out.push(`${info.js}.$values = [${(d.consts || []).map(c => `${info.js}.${c.name}`).join(', ')}];`);
    for (const m of d.members) {
      if (m.k === 'field' && (m.mods.has('static') || d.kind === 'interface')) {
        for (const dc of m.decls) {
          const t = typeName(m.type);
          const init = dc.init ? this.ex(dc.init) : null;
          let ic = init ? init.c : this.defaultFor(dc.dims ? null : t);
          if (init && isIntegral(t) && (init.t === 'double' || init.t === 'float')) ic = `$toInt(${ic})`;
          out.push(`$ln=${m.line}; ${info.js}.${dc.name} = ${ic};`);
        }
      } else if (m.k === 'init' && m.static) {
        out.push(`(function () {\n${m.body.body.map(s => this.st(s)).join('\n')}\n}).call(${info.js});`);
      }
    }
    [this.sync, this.isStatic] = save;
    this.popScope();
    this.curCls = saveCls;
    return out.join('\n');
  }
  compile() {
    for (const t of this.unit.types) this.register(t, null);
    // order: superclasses first
    const done = new Set(), sorted = [];
    const visit = (info, depth) => {
      if (done.has(info.name) || depth > 50) return;
      const sup = this.superOf(info);
      if (sup) visit(sup, depth + 1);
      done.add(info.name); sorted.push(info);
    };
    for (const info of this.order) visit(info, 0);
    const classCode = [], staticCode = [], mixins = [];
    for (const info of sorted) {
      for (const m of info.decl.members) if (m.k === 'init' && !m.static) this.warnings.push({ line: m.line, msg: 'Instance initializer blocks { ... } are ignored. Move that code into a constructor or init().' });
      classCode.push(this.emitClassBody(info, false));
      for (const i of info.impl) { const ic = this.userClass(i); if (ic) mixins.push(`$mixin(${info.js}, ${ic.js});`); }
    }
    for (const info of sorted) staticCode.push(this.emitStatics(info));
    const opModes = [];
    for (const info of this.order) {
      const root = this.sdkRoot(info);
      if (root !== 'LinearOpMode' && root !== 'OpMode') continue;
      if (info.decl.mods.has('abstract')) continue;
      const an = info.decl.annos;
      const tele = an.find(a => a.name === 'TeleOp');
      const auto = an.find(a => a.name === 'Autonomous');
      const a = tele || auto;
      opModes.push({
        className: info.name, js: info.js,
        name: (a && (a.args.name || a.args.value)) || info.name,
        group: (a && a.args.group) || '',
        type: tele ? 'TeleOp' : auto ? 'Autonomous' : (/tele/i.test(info.name) ? 'TeleOp' : 'Autonomous'),
        kind: root === 'LinearOpMode' ? 'linear' : 'iterative',
        disabled: an.some(x => x.name === 'Disabled'),
        annotated: !!a,
      });
    }
    const header = [
      '"use strict";',
      `const {${HELPERS.join(', ')}} = $rt.h;`,
      ...[...this.usedSdk].sort().map(n => `const S_${n} = $rt.cls(${JSON.stringify(n)});`),
      'let $ln = 0;',
    ].join('\n');
    const exportsList = this.order.filter(i => !i.anon).map(i => `${JSON.stringify(i.name)}: ${i.js}`).join(', ');
    const code = `${header}\n${classCode.join('\n\n')}\n${mixins.join('\n')}\nreturn { classes: { ${exportsList} }, line: () => $ln, init() {\n${staticCode.join('\n')}\n} };`;
    return { code, opModes, warnings: this.warnings, imports: this.unit.imports.map(i => i.name), usedSdk: [...this.usedSdk] };
  }
}

function compileJava(src) {
  const unit = FTC.parseJava(src);
  if (!unit.types.length) throw new CompileError('No class found. Paste a complete OpMode file, including the class declaration.', 1);
  return new Emitter(unit).compile();
}

FTC.compileJava = compileJava;
FTC.CompileError = CompileError;
if (typeof module !== 'undefined' && module.exports) module.exports = FTC;
})(typeof globalThis !== 'undefined' ? globalThis : window);
