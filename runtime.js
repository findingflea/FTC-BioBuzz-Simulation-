/* Runtime: Java library subset + FTC SDK emulation. createRuntime(sim) returns the $rt object
   the compiled program receives. Devices hold their own state; sim.js steps the physics. */
(function (G) {
'use strict';
const FTC = (G.FTC = G.FTC || {});

const GUARD_LIMIT = 200000;   // loop iterations that count as one 5 ms physics step
const HW_READ_COST = 20000;   // one hardware read ~0.5 ms
const isGen = x => x != null && typeof x === 'object' && typeof x.next === 'function' && typeof x[Symbol.iterator] === 'function';

/* ------------------------------------------------------------ exceptions */
class Throwable extends Error {
  constructor(msg, cause) { super(msg == null ? '' : String(msg)); this.$msg = msg == null ? null : String(msg); this.cause = cause || null; }
  $init(msg, cause) { this.$msg = msg == null ? null : String(msg); this.message = this.$msg || ''; this.cause = cause || null; return this; }
  getMessage() { return this.$msg; }
  getLocalizedMessage() { return this.$msg; }
  getCause() { return this.cause; }
  printStackTrace() { if (FTC.$activeSim) FTC.$activeSim.log('error', this.toString()); }
  toString() { return this.constructor.$jname + (this.$msg ? ': ' + this.$msg : ''); }
  getStackTrace() { return []; }
}
Throwable.$jname = 'java.lang.Throwable';
const EXC = { Throwable };
function defExc(name, parent, pkg = 'java.lang') {
  const P = EXC[parent];
  const C = { [name]: class extends P {} }[name];
  C.$jname = pkg + '.' + name;
  C.$simple = name;
  EXC[name] = C;
  return C;
}
Throwable.$simple = 'Throwable';
defExc('Exception', 'Throwable'); defExc('Error', 'Throwable');
defExc('RuntimeException', 'Exception'); defExc('InterruptedException', 'Exception');
defExc('IllegalArgumentException', 'RuntimeException'); defExc('IllegalStateException', 'RuntimeException');
defExc('NullPointerException', 'RuntimeException'); defExc('ArithmeticException', 'RuntimeException');
defExc('IndexOutOfBoundsException', 'RuntimeException'); defExc('ArrayIndexOutOfBoundsException', 'IndexOutOfBoundsException');
defExc('ClassCastException', 'RuntimeException'); defExc('UnsupportedOperationException', 'RuntimeException');
defExc('NumberFormatException', 'IllegalArgumentException'); defExc('ConcurrentModificationException', 'RuntimeException', 'java.util');
defExc('NoSuchElementException', 'RuntimeException', 'java.util'); defExc('IllegalFormatConversionException', 'IllegalArgumentException', 'java.util');
defExc('StackOverflowError', 'Error'); defExc('IOException', 'Exception', 'java.io');
defExc('TargetPositionNotSetException', 'RuntimeException', 'com.qualcomm.robotcore.exception');
defExc('OpModeStoppedException', 'RuntimeException');

function excNames(e) {
  const out = [];
  for (let c = e && e.constructor; c && c !== Error && c !== Object; c = Object.getPrototypeOf(c)) if (c.$simple) out.push(c.$simple);
  return out;
}

/* ------------------------------------------------------------ formatting */
function dstr(x) {
  if (x == null) return 'null';
  if (typeof x !== 'number') return String(x);
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const a = Math.abs(x);
  if (a >= 1e-3 && a < 1e7) { const s = String(x); return /[.e]/.test(s) ? s : s + '.0'; }
  let s = x.toExponential();
  let [m, e] = s.split('e');
  if (!m.includes('.')) m += '.0';
  return m + 'E' + (e[0] === '+' ? e.slice(1) : e);
}
function fstr(x) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return dstr(x);
  const f = Math.fround(x);
  for (let p = 1; p <= 9; p++) {
    const s = Number(f.toPrecision(p));
    if (Math.fround(s) === f) return dstr(s);
  }
  return dstr(f);
}
function groupDigits(s) { const [i, d] = s.split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d !== undefined ? '.' + d : ''); }
function jformat(fmt, args) {
  if (fmt != null && typeof fmt === 'object' && fmt.$isLocale) { fmt = args[0]; args = args.slice(1); }
  fmt = String(fmt);
  let ai = 0;
  return fmt.replace(/%(\d+\$)?([-#+ 0,(]*)(\d+)?(\.\d+)?([a-zA-Z%])/g, (all, pos, flags, width, prec, conv) => {
    if (conv === '%') return '%';
    if (conv === 'n') return '\n';
    let v = pos ? args[parseInt(pos) - 1] : args[ai++];
    const p = prec ? parseInt(prec.slice(1)) : null;
    let s;
    const lc = conv.toLowerCase();
    if (v === undefined) throw new EXC.IllegalArgumentException(`Format specifier '${all}' has no matching argument`);
    switch (lc) {
      case 'd':
        if (typeof v !== 'number' && !(v && typeof v.valueOf() === 'number')) throw new EXC.IllegalFormatConversionException(`d != ${typeof v === 'string' ? 'java.lang.String' : 'java.lang.Object'}`);
        v = Number(v);
        if (!Number.isInteger(v)) throw new EXC.IllegalFormatConversionException('d != java.lang.Double  (use %.2f for decimal numbers, or cast to (int))');
        s = String(Math.abs(v));
        if (flags.includes(',')) s = groupDigits(s);
        s = (v < 0 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '') + s;
        break;
      case 'f':
        if (typeof v !== 'number') { if (typeof v === 'string') throw new EXC.IllegalFormatConversionException('f != java.lang.String'); v = Number(v); }
        if (!Number.isFinite(v)) s = dstr(v);
        else {
          s = Math.abs(v).toFixed(p === null ? 6 : p);
          if (flags.includes(',')) s = groupDigits(s);
          s = (v < 0 || Object.is(v, -0) && Number(s) !== 0 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '') + s;
        }
        break;
      case 'e': s = Number(v).toExponential(p === null ? 6 : p).replace(/e([+-])(\d)$/, 'e$10$2'); break;
      case 'g': s = Number(v).toPrecision(p === null ? 6 : Math.max(p, 1)); break;
      case 'x': s = (v < 0 ? (v >>> 0) : v).toString(16); break;
      case 'o': s = (v >>> 0).toString(8); break;
      case 'c': s = typeof v === 'number' ? String.fromCharCode(v) : String(v); break;
      case 'b': s = String(v != null && v !== false); break;
      case 's': s = str(v); if (p !== null) s = s.slice(0, p); break;
      default: throw new EXC.IllegalArgumentException(`Unknown format conversion '%${conv}'`);
    }
    if (conv !== lc) s = s.toUpperCase();
    if (width) {
      const w = parseInt(width);
      if (s.length < w) {
        if (flags.includes('-')) s = s.padEnd(w);
        else if (flags.includes('0') && /[dfxoeg]/.test(lc)) { const neg = /^[-+ ]/.test(s) ? s[0] : ''; s = neg + s.slice(neg.length).padStart(w - neg.length, '0'); }
        else s = s.padStart(w);
      }
    }
    return s;
  });
}
function str(x) {
  if (x === null || x === undefined) return 'null';
  if (typeof x === 'string') return x;
  if (typeof x === 'number') return String(x);
  if (typeof x === 'boolean') return String(x);
  if (Array.isArray(x)) return '[' + x.length + '-element array]';
  if (typeof x === 'function') return x.$jname || x.name || 'lambda';
  if (typeof x.toString === 'function' && x.toString !== Object.prototype.toString) {
    const r = x.toString();
    return isGen(r) ? String(runInline(r)) : String(r);
  }
  return (x.constructor && x.constructor.name || 'Object') + '@' + (hash(x) >>> 0).toString(16);
}
let hashSeq = 0x1b6d3586;
const hashes = new WeakMap();
function hash(x) {
  if (x == null) return 0;
  if (typeof x === 'string') { let h = 0; for (let i = 0; i < x.length; i++) h = (Math.imul(31, h) + x.charCodeAt(i)) | 0; return h; }
  if (typeof x === 'number') return Number.isInteger(x) ? x | 0 : (x * 1000003) | 0;
  if (typeof x === 'boolean') return x ? 1231 : 1237;
  if (typeof x.hashCode === 'function') return x.hashCode();
  if (!hashes.has(x)) hashes.set(x, (hashSeq = (hashSeq * 1103515245 + 12345) | 0));
  return hashes.get(x);
}
function eq(a, b) {
  if (a === null || a === undefined) throw new EXC.NullPointerException('Cannot invoke "equals()" because the value is null');
  if (typeof a !== 'object') return a === b;
  if (typeof a.equals === 'function') return !!a.equals(b);
  return a === b;
}

/* ------------------------------------------------------------ inline driving */
let currentSim = null;
function runInline(gen) {
  let r = gen.next();
  let guard = 0;
  while (!r.done) {
    if (currentSim) currentSim.advanceInline(typeof r.value === 'number' ? r.value : 0);
    else if (++guard > 1e6) throw new Error('Blocking call in a context that cannot wait');
    r = gen.next();
  }
  return r.value;
}
function single(v) {
  return { [Symbol.iterator]() { return this; }, next() { return { done: true, value: v }; } };
}

/* ------------------------------------------------------------ Java util */
class JEnum {
  constructor(name, ord) { this.$name = name; this.$ord = ord; }
  name() { return this.$name; }
  ordinal() { return this.$ord; }
  toString() { return this.$name; }
  compareTo(o) { return this.$ord - o.$ord; }
  equals(o) { return this === o; }
  hashCode() { return hash(this.$name); }
  static valueOf(C, s) {
    const v = (C.$values || []).find(e => e.$name === s);
    if (!v) throw new EXC.IllegalArgumentException(`No enum constant ${C.name}.${s}`);
    return v;
  }
}
function makeEnum(jname, names, extra) {
  const C = class extends JEnum {};
  Object.defineProperty(C, 'name', { value: jname.split('.').pop() });
  C.$values = names.map((n, i) => (C[n] = new C(n, i)));
  C.values = () => C.$values.slice();
  C.valueOf = s => JEnum.valueOf(C, s);
  C.$jname = jname;
  if (extra) extra(C);
  return C;
}

class JList {
  constructor(src) {
    this.a = [];
    if (src != null && typeof src !== 'number') for (const x of it(src)) this.a.push(x);
  }
  add(i, x) { if (arguments.length === 2) { this.checkIdx(i, true); this.a.splice(i, 0, x); return; } this.a.push(i); return true; }
  addAll(c) { for (const x of it(c)) this.a.push(x); return true; }
  get(i) { this.checkIdx(i); return this.a[i]; }
  set(i, x) { this.checkIdx(i); const o = this.a[i]; this.a[i] = x; return o; }
  checkIdx(i, add) { if (!(i >= 0 && (add ? i <= this.a.length : i < this.a.length))) throw new EXC.IndexOutOfBoundsException(`Index ${i} out of bounds for length ${this.a.length}`); }
  remove(x) {
    if (typeof x === 'number' && Number.isInteger(x) && !this.$boxedNumbers) { this.checkIdx(x); return this.a.splice(x, 1)[0]; }
    const i = this.indexOf(x); if (i >= 0) { this.a.splice(i, 1); return true; } return false;
  }
  removeIf(f) { const n = this.a.length; this.a = this.a.filter(x => !callFn(f, 'test', x)); return n !== this.a.length; }
  size() { return this.a.length; }
  isEmpty() { return this.a.length === 0; }
  contains(x) { return this.indexOf(x) >= 0; }
  indexOf(x) { return this.a.findIndex(y => y === x || (y != null && typeof y === 'object' && typeof y.equals === 'function' && y.equals(x))); }
  clear() { this.a.length = 0; }
  iterator() { let i = 0; const a = this.a; return { hasNext: () => i < a.length, next: () => { if (i >= a.length) throw new EXC.NoSuchElementException(); return a[i++]; }, remove: () => { a.splice(--i, 1); } }; }
  forEach(f) { for (const x of this.a.slice()) callFn(f, 'accept', x); }
  sort(cmp) { this.a.sort(cmp ? (x, y) => callFn(cmp, 'compare', x, y) : defaultCmp); }
  toArray() { return this.a.slice(); }
  subList(a, b) { return new JList(this.a.slice(a, b)); }
  getFirst() { return this.get(0); }
  getLast() { return this.get(this.a.length - 1); }
  removeFirst() { this.checkIdx(0); return this.a.shift(); }
  removeLast() { this.checkIdx(0); return this.a.pop(); }
  addFirst(x) { this.a.unshift(x); }
  addLast(x) { this.a.push(x); }
  peek() { return this.a.length ? this.a[0] : null; }
  poll() { return this.a.length ? this.a.shift() : null; }
  offer(x) { this.a.push(x); return true; }
  push(x) { this.a.unshift(x); }
  pop() { if (!this.a.length) throw new EXC.NoSuchElementException(); return this.a.shift(); }
  stream() { return new JStream(this.a.slice()); }
  equals(o) { return o instanceof JList && o.a.length === this.a.length && this.a.every((x, i) => x === o.a[i] || (x && x.equals && x.equals(o.a[i]))); }
  hashCode() { return this.a.reduce((h, x) => (Math.imul(31, h) + hash(x)) | 0, 1); }
  toString() { return '[' + this.a.map(x => typeof x === 'number' ? fmtNum(x) : str(x)).join(', ') + ']'; }
  [Symbol.iterator]() { return this.a[Symbol.iterator](); }
}
function fmtNum(x) { return Number.isInteger(x) ? String(x) : dstr(x); }
class JStream {
  constructor(a) { this.a = a; }
  map(f) { return new JStream(this.a.map(x => callFn(f, 'apply', x))); }
  mapToDouble(f) { return this.map(f); }
  mapToInt(f) { return this.map(f); }
  filter(f) { return new JStream(this.a.filter(x => callFn(f, 'test', x))); }
  forEach(f) { this.a.forEach(x => callFn(f, 'accept', x)); }
  sum() { return this.a.reduce((s, x) => s + x, 0); }
  count() { return this.a.length; }
  average() { return opt(this.a.length ? this.sum() / this.a.length : null); }
  max(c) { return opt(this.a.length ? this.a.reduce((m, x) => ((c ? callFn(c, 'compare', x, m) : x - m) > 0 ? x : m)) : null); }
  min(c) { return opt(this.a.length ? this.a.reduce((m, x) => ((c ? callFn(c, 'compare', x, m) : x - m) < 0 ? x : m)) : null); }
  anyMatch(f) { return this.a.some(x => callFn(f, 'test', x)); }
  allMatch(f) { return this.a.every(x => callFn(f, 'test', x)); }
  collect() { return new JList(this.a); }
  toList() { return new JList(this.a); }
  toArray() { return this.a.slice(); }
}
function opt(v) {
  return {
    isPresent: () => v != null, isEmpty: () => v == null, get: () => { if (v == null) throw new EXC.NoSuchElementException('No value present'); return v; },
    getAsDouble: () => v, getAsInt: () => v, orElse: d => (v == null ? d : v), ifPresent: f => { if (v != null) callFn(f, 'accept', v); },
  };
}
function defaultCmp(x, y) {
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  if (typeof x === 'string') return x < y ? -1 : x > y ? 1 : 0;
  if (x && x.compareTo) return x.compareTo(y);
  return 0;
}
function mapKey(k) { return k !== null && typeof k === 'object' && typeof k.hashCode === 'function' && !(k instanceof JEnum) ? 'h:' + k.hashCode() : k; }
class JMap {
  constructor(src) { this.m = new Map(); if (src instanceof JMap) for (const [k, v] of src.m) this.m.set(k, v); }
  put(k, v) { const kk = mapKey(k); const o = this.m.has(kk) ? this.m.get(kk)[1] : null; this.m.set(kk, [k, v]); return o; }
  get(k) { const e = this.m.get(mapKey(k)); return e ? e[1] : null; }
  getOrDefault(k, d) { const e = this.m.get(mapKey(k)); return e ? e[1] : d; }
  containsKey(k) { return this.m.has(mapKey(k)); }
  containsValue(v) { for (const [, e] of this.m) if (e[1] === v) return true; return false; }
  remove(k) { const kk = mapKey(k); const e = this.m.get(kk); this.m.delete(kk); return e ? e[1] : null; }
  putIfAbsent(k, v) { if (!this.containsKey(k)) { this.put(k, v); return null; } return this.get(k); }
  merge(k, v, f) { const o = this.get(k); this.put(k, o == null ? v : callFn(f, 'apply', o, v)); return this.get(k); }
  size() { return this.m.size; }
  isEmpty() { return this.m.size === 0; }
  clear() { this.m.clear(); }
  keySet() { return new JSet([...this.m.values()].map(e => e[0])); }
  values() { return new JList([...this.m.values()].map(e => e[1])); }
  entrySet() { return new JSet([...this.m.values()].map(e => ({ getKey: () => e[0], getValue: () => e[1], setValue: v => { const o = e[1]; e[1] = v; return o; }, toString: () => str(e[0]) + '=' + str(e[1]) }))); }
  forEach(f) { for (const [, e] of this.m) callFn(f, 'accept', e[0], e[1]); }
  toString() { return '{' + [...this.m.values()].map(e => str(e[0]) + '=' + (typeof e[1] === 'number' ? fmtNum(e[1]) : str(e[1]))).join(', ') + '}'; }
}
class JSet {
  constructor(src) { this.m = new Map(); if (src != null && typeof src !== 'number') for (const x of it(src)) this.add(x); }
  add(x) { const k = mapKey(x); if (this.m.has(k)) return false; this.m.set(k, x); return true; }
  addAll(c) { let ch = false; for (const x of it(c)) ch = this.add(x) || ch; return ch; }
  remove(x) { return this.m.delete(mapKey(x)); }
  contains(x) { return this.m.has(mapKey(x)); }
  size() { return this.m.size; }
  isEmpty() { return this.m.size === 0; }
  clear() { this.m.clear(); }
  iterator() { return new JList([...this.m.values()]).iterator(); }
  forEach(f) { for (const x of this.m.values()) callFn(f, 'accept', x); }
  stream() { return new JStream([...this.m.values()]); }
  toString() { return '[' + [...this.m.values()].map(str).join(', ') + ']'; }
  [Symbol.iterator]() { return this.m.values(); }
}
class StringBuilder {
  constructor(s) { this.s = typeof s === 'string' ? s : ''; }
  append(x) { this.s += typeof x === 'number' && !Number.isInteger(x) ? dstr(x) : str(x); return this; }
  insert(i, x) { this.s = this.s.slice(0, i) + str(x) + this.s.slice(i); return this; }
  length() { return this.s.length; }
  charAt(i) { return this.s.charCodeAt(i); }
  reverse() { this.s = [...this.s].reverse().join(''); return this; }
  setLength(n) { this.s = this.s.slice(0, n).padEnd(n, '\0'); }
  deleteCharAt(i) { this.s = this.s.slice(0, i) + this.s.slice(i + 1); return this; }
  toString() { return this.s; }
}
class JRandom {
  constructor(seed) { this.s = (seed === undefined ? 0x2545F491 : seed) >>> 0 || 1; }
  nextU() { let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x >>> 0; return this.s / 4294967296; }
  nextInt(a, b) { if (b !== undefined) return a + Math.floor(this.nextU() * (b - a)); if (a === undefined) return (this.nextU() * 4294967296) | 0; return Math.floor(this.nextU() * a); }
  nextDouble() { return this.nextU(); }
  nextBoolean() { return this.nextU() < 0.5; }
  nextGaussian() { const u = Math.max(this.nextU(), 1e-12), v = this.nextU(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
}
function callFn(f, method, ...args) {
  let r;
  if (typeof f === 'function') r = f(...args);
  else if (f && typeof f[method] === 'function') r = f[method](...args);
  else throw new EXC.NullPointerException('Callback is null');
  return isGen(r) ? runInline(r) : r;
}
function it(x) {
  if (x == null) throw new EXC.NullPointerException('Cannot iterate over null');
  if (Array.isArray(x) || typeof x[Symbol.iterator] === 'function') return x;
  if (typeof x.iterator === 'function') { const i = x.iterator(); return { [Symbol.iterator]() { return { next: () => (i.hasNext() ? { done: false, value: i.next() } : { done: true }) }; } }; }
  throw new EXC.ClassCastException('Value is not iterable');
}

const JMath = {
  PI: Math.PI, E: Math.E,
  abs: Math.abs, max: Math.max, min: Math.min, sqrt: Math.sqrt, cbrt: Math.cbrt, pow: Math.pow, exp: Math.exp,
  log: Math.log, log10: Math.log10, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
  atan: Math.atan, atan2: Math.atan2, hypot: Math.hypot, floor: Math.floor, ceil: Math.ceil, random: () => FTC.$rand.nextU(),
  round: x => Math.floor(x + 0.5), rint: x => { const r = Math.round(x); return (Math.abs(x % 1) === 0.5 && r % 2) ? r - 1 : r; },
  signum: x => (x > 0 ? 1 : x < 0 ? -1 : x), toRadians: d => d * Math.PI / 180, toDegrees: r => r * 180 / Math.PI,
  floorMod: (a, b) => ((a % b) + b) % b, floorDiv: (a, b) => Math.floor(a / b), copySign: (m, s) => (Math.sign(s) < 0 || Object.is(s, -0) ? -Math.abs(m) : Math.abs(m)),
  clamp: (v, lo, hi) => Math.min(Math.max(v, lo), hi), sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, ulp: () => Number.EPSILON,
};
const Integer = {
  MAX_VALUE: 2147483647, MIN_VALUE: -2147483648,
  parseInt: (s, r) => { const v = parseInt(String(s).trim(), r || 10); if (Number.isNaN(v) || !/^[-+]?[0-9a-fA-F]+$/.test(String(s).trim())) throw new EXC.NumberFormatException(`For input string: "${s}"`); return v; },
  valueOf: x => (typeof x === 'string' ? Integer.parseInt(x) : x), toString: x => String(x), compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  signum: x => Math.sign(x), abs: Math.abs, max: Math.max, min: Math.min, sum: (a, b) => a + b, toBinaryString: x => (x >>> 0).toString(2), toHexString: x => (x >>> 0).toString(16),
};
const Double = {
  MAX_VALUE: Number.MAX_VALUE, MIN_VALUE: Number.MIN_VALUE, POSITIVE_INFINITY: Infinity, NEGATIVE_INFINITY: -Infinity, NaN: NaN,
  parseDouble: s => { const v = Number(String(s).trim().replace(/[dDfF]$/, '')); if (Number.isNaN(v) && String(s).trim() !== 'NaN') throw new EXC.NumberFormatException(`For input string: "${s}"`); return v; },
  valueOf: x => (typeof x === 'string' ? Double.parseDouble(x) : x), toString: x => dstr(x), isNaN: Number.isNaN, isInfinite: x => x === Infinity || x === -Infinity,
  isFinite: Number.isFinite, compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0), max: Math.max, min: Math.min, sum: (a, b) => a + b,
};
const JFloat = Object.assign({}, Double, { MAX_VALUE: 3.4028234663852886e38, MIN_VALUE: 1.401298464324817e-45, parseFloat: s => Math.fround(Double.parseDouble(s)), toString: x => fstr(x) });
const JLong = Object.assign({}, Integer, { MAX_VALUE: 9223372036854775807, MIN_VALUE: -9223372036854775808, parseLong: s => Integer.parseInt(s) });
const JBoolean = { TRUE: true, FALSE: false, parseBoolean: s => String(s).toLowerCase() === 'true', valueOf: x => (typeof x === 'string' ? x.toLowerCase() === 'true' : !!x), toString: x => String(x), logicalXor: (a, b) => a !== b, compare: (a, b) => (a === b ? 0 : a ? 1 : -1) };
const Character = {
  isDigit: c => c >= 48 && c <= 57, isLetter: c => /\p{L}/u.test(String.fromCharCode(c)), isLetterOrDigit: c => /[\p{L}\d]/u.test(String.fromCharCode(c)),
  isWhitespace: c => /\s/.test(String.fromCharCode(c)), isUpperCase: c => { const s = String.fromCharCode(c); return s !== s.toLowerCase(); },
  isLowerCase: c => { const s = String.fromCharCode(c); return s !== s.toUpperCase(); }, toUpperCase: c => String.fromCharCode(c).toUpperCase().charCodeAt(0),
  toLowerCase: c => String.fromCharCode(c).toLowerCase().charCodeAt(0), getNumericValue: c => parseInt(String.fromCharCode(c), 36), toString: c => String.fromCharCode(c),
};
const JString = {
  format: (fmt, ...a) => jformat(fmt, a), valueOf: x => (typeof x === 'number' && !Number.isInteger(x) ? dstr(x) : str(x)),
  join: (sep, ...parts) => (parts.length === 1 && parts[0] && typeof parts[0] === 'object' ? [...it(parts[0])] : parts).map(str).join(sep),
};
const Arrays = {
  asList: (...a) => new JList(a.length === 1 && Array.isArray(a[0]) ? a[0] : a),
  toString: a => (a == null ? 'null' : '[' + a.map(x => typeof x === 'number' ? fmtNum(x) : str(x)).join(', ') + ']'),
  fill: (a, ...r) => { if (r.length === 1) a.fill(r[0]); else a.fill(r[2], r[0], r[1]); },
  sort: (a, c) => a.sort(c ? (x, y) => callFn(c, 'compare', x, y) : defaultCmp),
  copyOf: (a, n) => { const b = a.slice(0, n); while (b.length < n) b.push(typeof a[0] === 'number' ? 0 : null); return b; },
  copyOfRange: (a, s, e) => a.slice(s, e), equals: (a, b) => a === b || (!!a && !!b && a.length === b.length && a.every((x, i) => x === b[i])),
  stream: a => new JStream(a.slice()), deepToString: a => JSON.stringify(a),
};
const Collections = {
  sort: (l, c) => l.sort(c), reverse: l => l.a.reverse(), max: l => l.a.reduce((m, x) => (defaultCmp(x, m) > 0 ? x : m)), min: l => l.a.reduce((m, x) => (defaultCmp(x, m) < 0 ? x : m)),
  emptyList: () => new JList(), unmodifiableList: l => l, singletonList: x => new JList([x]), shuffle: l => l.a.sort(() => FTC.$rand.nextU() - 0.5), swap: (l, i, j) => { const t = l.a[i]; l.a[i] = l.a[j]; l.a[j] = t; },
};
const Objects = { equals: (a, b) => (a == null ? b == null : eq(a, b)), requireNonNull: (x, m) => { if (x == null) throw new EXC.NullPointerException(m || null); return x; }, hash: (...a) => a.reduce((h, x) => (Math.imul(31, h) + hash(x)) | 0, 1), isNull: x => x == null, nonNull: x => x != null, toString: (x, d) => (x == null && d !== undefined ? d : str(x)) };

/* ------------------------------------------------------------ SDK enums and units */
const Direction = makeEnum('DcMotorSimple.Direction', ['FORWARD', 'REVERSE'], C => { C.prototype.inverted = function () { return this === C.FORWARD ? C.REVERSE : C.FORWARD; }; });
const RunMode = makeEnum('DcMotor.RunMode', ['RUN_WITHOUT_ENCODER', 'RUN_USING_ENCODER', 'RUN_TO_POSITION', 'STOP_AND_RESET_ENCODER', 'RESET_ENCODERS', 'RUN_USING_ENCODERS', 'RUN_WITHOUT_ENCODERS']);
const ZeroPowerBehavior = makeEnum('DcMotor.ZeroPowerBehavior', ['UNKNOWN', 'BRAKE', 'FLOAT']);
const ServoDirection = makeEnum('Servo.Direction', ['FORWARD', 'REVERSE']);
const AngleUnit = makeEnum('AngleUnit', ['DEGREES', 'RADIANS'], C => {
  const P = C.prototype;
  P.fromRadians = function (r) { return this === C.DEGREES ? r * 180 / Math.PI : r; };
  P.fromDegrees = function (d) { return this === C.RADIANS ? d * Math.PI / 180 : d; };
  P.toRadians = function (v) { return this === C.DEGREES ? v * Math.PI / 180 : v; };
  P.toDegrees = function (v) { return this === C.RADIANS ? v * 180 / Math.PI : v; };
  P.fromUnit = function (u, v) { return u === this ? v : this.fromRadians(u.toRadians(v)); };
  P.normalize = function (v) { return this === C.DEGREES ? C.normalizeDegrees(v) : C.normalizeRadians(v); };
  P.getUnnormalized = function () { return this; };
  C.normalizeDegrees = d => { d = ((d % 360) + 360) % 360; return d >= 180 ? d - 360 : d; };
  C.normalizeRadians = r => { r = ((r % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return r >= Math.PI ? r - 2 * Math.PI : r; };
});
const INCH_PER = { INCH: 1, CM: 1 / 2.54, MM: 1 / 25.4, METER: 1 / 0.0254 };
const DistanceUnit = makeEnum('DistanceUnit', ['METER', 'CM', 'MM', 'INCH'], C => {
  const P = C.prototype;
  P.fromInches = function (v) { return v / INCH_PER[this.$name]; };
  P.toInches = function (v) { return v * INCH_PER[this.$name]; };
  P.fromMm = function (v) { return this.fromInches(v / 25.4); };
  P.toMm = function (v) { return this.toInches(v) * 25.4; };
  P.fromCm = function (v) { return this.fromInches(v / 2.54); };
  P.toCm = function (v) { return this.toInches(v) * 2.54; };
  P.fromMeters = function (v) { return this.fromInches(v / 0.0254); };
  P.toMeters = function (v) { return this.toInches(v) * 0.0254; };
  P.fromUnit = function (u, v) { return this.fromInches(u.toInches(v)); };
  P.toUnit = function (u, v) { return u.fromInches(this.toInches(v)); };
  C.infinity = Number.MAX_VALUE;
});
const CurrentUnit = makeEnum('CurrentUnit', ['AMPS', 'MILLIAMPS'], C => { C.prototype.convert = function (v, u) { return u === this ? v : (this === C.AMPS ? v / 1000 : v * 1000); }; });
const TimeUnit = makeEnum('TimeUnit', ['NANOSECONDS', 'MICROSECONDS', 'MILLISECONDS', 'SECONDS', 'MINUTES'], C => {
  const S = { NANOSECONDS: 1e-9, MICROSECONDS: 1e-6, MILLISECONDS: 1e-3, SECONDS: 1, MINUTES: 60 };
  const P = C.prototype;
  P.toMillis = function (v) { return Math.trunc(v * S[this.$name] * 1e3); };
  P.toSeconds = function (v) { return Math.trunc(v * S[this.$name]); };
  P.toNanos = function (v) { return Math.trunc(v * S[this.$name] * 1e9); };
  P.convert = function (v, u) { return Math.trunc(v * S[u.$name] / S[this.$name]); };
  P.sleep = function* (v) { yield v * S[this.$name]; };
  C.$scale = S;
});
const Resolution = makeEnum('ElapsedTime.Resolution', ['SECONDS', 'MILLISECONDS']);
const Locale = { US: { $isLocale: true }, ENGLISH: { $isLocale: true }, ROOT: { $isLocale: true }, getDefault: () => Locale.US };

/* "anything" stub: lets setup-only code (hub orientation, dashboards, vision builders) run */
function anything(label) {
  const store = {};
  const fn = function () {};
  const h = {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => label;
      if (p === 'toString' || p === 'name') return () => label;
      if (p === 'then' || p === Symbol.iterator || p === 'next') return undefined;
      if (p === '$isAnything') return true;
      if (p in store) return store[p];
      if (p === 'getDetections' || p === 'getFreshDetections' || p === 'getRecognitions' || p === 'getUpdatedRecognitions') return () => new JList();
      if (p === 'getLatestResult') return () => null;
      if (p === 'getCameraState') return () => anything('STREAMING');
      if (typeof p === 'string' && /^(is|has)[A-Z]/.test(p)) return () => false;
      return anything(label + '.' + String(p));
    },
    set(t, p, v) { store[p] = v; return true; },
    apply() { return anything(label + '()'); },
    construct() { return anything('new ' + label); },
  };
  return new Proxy(fn, h);
}

FTC.$rand = new JRandom(12345);
FTC.runtimeCore = {
  EXC, excNames, dstr, fstr, jformat, str, hash, eq, isGen, single, runInline, JEnum, makeEnum, JList, JMap, JSet, JStream, StringBuilder, JRandom,
  callFn, it, JMath, Integer, Double, JFloat, JLong, JBoolean, Character, JString, Arrays, Collections, Objects, Locale, anything,
  Direction, RunMode, ZeroPowerBehavior, ServoDirection, AngleUnit, DistanceUnit, CurrentUnit, TimeUnit, Resolution,
  GUARD_LIMIT, HW_READ_COST,
  setSim(s) { currentSim = s; FTC.$activeSim = s; },
};
if (typeof module !== 'undefined' && module.exports) module.exports = FTC;
})(typeof globalThis !== 'undefined' ? globalThis : window);
