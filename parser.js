/* Java subset lexer + parser for FTC OpModes. Produces a plain-object AST. */
(function (G) {
'use strict';
const FTC = (G.FTC = G.FTC || {});

const PRIMS = new Set(['boolean', 'byte', 'short', 'int', 'long', 'char', 'float', 'double', 'void']);
const MODIFIERS = new Set(['public', 'private', 'protected', 'static', 'final', 'abstract', 'native', 'synchronized', 'transient', 'volatile', 'strictfp']);
const RESERVED = new Set(['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null']);
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>=']);
const BINPREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, 'instanceof': 7, '<<': 8, '>>': 8, '>>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };

class JavaSyntaxError extends Error {
  constructor(msg, line, col) { super(msg); this.name = 'JavaSyntaxError'; this.line = line; this.col = col; }
}

/* ------------------------------------------------------------------ lexer */
const OPS4 = ['>>>='];
const OPS3 = ['<<=', '>>=', '>>>', '...'];
const OPS2 = ['->', '::', '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>'];
const SINGLE = '{}()[];,.@=<>!~?:+-*/%&|^';

function lex(src) {
  const toks = [];
  const n = src.length;
  let i = 0, line = 1, lineStart = 0;
  const idRe = /[A-Za-z_$À-￿][\w$À-￿]*/y;
  const numRe = /0[xX][0-9a-fA-F_]+[lL]?|0[bB][01_]+[lL]?|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?[fFdDlL]?/y;

  function readEscape() {
    const c = src[i + 1];
    i += 2;
    switch (c) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case 'b': return '\b';
      case 'f': return '\f';
      case 's': return ' ';
      case 'u': { while (src[i] === 'u') i++; const h = src.substr(i, 4); i += 4; return String.fromCharCode(parseInt(h, 16)); }
      case '0': case '1': case '2': case '3': case '4': case '5': case '6': case '7': {
        let s = c;
        while (s.length < 3 && /[0-7]/.test(src[i] || '')) s += src[i++];
        return String.fromCharCode(parseInt(s, 8));
      }
      default: return c;
    }
  }

  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; lineStart = i; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let k = i; k < stop; k++) if (src[k] === '\n') { line++; lineStart = k + 1; }
      i = stop; continue;
    }
    const col = i - lineStart + 1, sline = line;
    const add = (t, v, extra) => toks.push(Object.assign({ t, v, line: sline, col }, extra));

    if (c === '"') {
      if (src.startsWith('"""', i)) {
        i += 3;
        while (i < n && src[i] !== '\n') i++;
        i++; line++; lineStart = i;
        let raw = '';
        while (i < n && !src.startsWith('"""', i)) {
          if (src[i] === '\\') raw += readEscape();
          else { if (src[i] === '\n') { line++; lineStart = i + 1; } raw += src[i++]; }
        }
        i += 3;
        const lines = raw.split('\n');
        const ind = Math.min(...lines.filter((l, k) => l.trim() !== '' || k === lines.length - 1).map(l => l.match(/^[ \t]*/)[0].length));
        add('str', lines.map(l => l.slice(ind).replace(/[ \t]+$/, '')).join('\n'));
        continue;
      }
      i++;
      let s = '';
      while (i < n && src[i] !== '"') {
        if (src[i] === '\n') throw new JavaSyntaxError('Unterminated string literal', sline, col);
        if (src[i] === '\\') s += readEscape(); else s += src[i++];
      }
      if (i >= n) throw new JavaSyntaxError('Unterminated string literal', sline, col);
      i++;
      add('str', s);
      continue;
    }
    if (c === "'") {
      i++;
      let ch;
      if (src[i] === '\\') ch = readEscape(); else ch = src[i++];
      if (src[i] !== "'") throw new JavaSyntaxError('Bad character literal', sline, col);
      i++;
      add('chr', ch.charCodeAt(0), { ch });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      numRe.lastIndex = i;
      const m = numRe.exec(src);
      if (!m || m.index !== i) throw new JavaSyntaxError('Bad number', sline, col);
      const raw = m[0];
      const text = raw.replace(/_/g, '');
      let nt, v;
      if (/^0[xX]/.test(text)) {
        const isL = /[lL]$/.test(text);
        v = parseInt(text.replace(/[lL]$/, ''), 16); nt = isL ? 'long' : 'int';
        if (!isL && v > 0x7fffffff) v = v | 0;
      } else if (/^0[bB]/.test(text)) {
        const isL = /[lL]$/.test(text);
        v = parseInt(text.slice(2).replace(/[lL]$/, ''), 2); nt = isL ? 'long' : 'int';
      } else {
        const suf = /[fFdDlL]$/.exec(text);
        const body = suf ? text.slice(0, -1) : text;
        v = parseFloat(body);
        if (suf && /[fF]/.test(suf[0])) nt = 'float';
        else if (suf && /[dD]/.test(suf[0])) nt = 'double';
        else if (suf && /[lL]/.test(suf[0])) nt = 'long';
        else nt = /[.eE]/.test(body) ? 'double' : 'int';
      }
      i += raw.length;
      add('num', v, { nt, raw });
      continue;
    }
    idRe.lastIndex = i;
    const im = idRe.exec(src);
    if (im && im.index === i) { i += im[0].length; add('id', im[0]); continue; }
    let op = null;
    for (const o of OPS4) if (src.startsWith(o, i)) { op = o; break; }
    if (!op) for (const o of OPS3) if (src.startsWith(o, i)) { op = o; break; }
    if (!op) for (const o of OPS2) if (src.startsWith(o, i)) { op = o; break; }
    if (!op && SINGLE.includes(c)) op = c;
    if (!op) throw new JavaSyntaxError(`Unexpected character '${c}'`, sline, col);
    i += op.length;
    add('op', op);
  }
  return toks;
}

/* ----------------------------------------------------------------- parser */
class Parser {
  constructor(toks) {
    this.toks = toks; this.p = 0; this.undo = [];
    const last = toks[toks.length - 1];
    this.EOF = { t: 'eof', v: 'end of file', line: last ? last.line : 1, col: 1 };
  }
  get tok() { return this.toks[this.p] || this.EOF; }
  peek(k = 1) { return this.toks[this.p + k] || this.EOF; }
  err(msg, t = this.tok) { throw new JavaSyntaxError(msg, t.line, t.col); }
  isOp(v) { const t = this.tok; return t.t === 'op' && t.v === v; }
  isKw(v) { const t = this.tok; return t.t === 'id' && t.v === v; }
  is(v) { const t = this.tok; return (t.t === 'op' || t.t === 'id') && t.v === v; }
  accept(v) { if (this.is(v)) { this.p++; return true; } return false; }
  expect(v) {
    if (!this.is(v)) this.err(`Expected '${v}' but found '${this.tok.v}'`);
    return this.toks[this.p++];
  }
  ident() {
    const t = this.tok;
    if (t.t !== 'id' || RESERVED.has(t.v)) this.err(`Expected a name but found '${t.v}'`);
    this.p++;
    return t.v;
  }
  mark() { return { p: this.p, u: this.undo.length }; }
  reset(m) { while (this.undo.length > m.u) { const [i, t] = this.undo.pop(); this.toks[i] = t; } this.p = m.p; }
  attempt(fn) {
    const m = this.mark();
    try { return fn(); } catch (e) { if (!(e instanceof JavaSyntaxError)) throw e; this.reset(m); return null; }
  }

  /* ---- declarations */
  parseUnit() {
    const unit = { imports: [], types: [], pkg: null };
    while (this.tok.t !== 'eof') {
      if (this.isKw('package')) { this.p++; unit.pkg = this.qualName(); this.expect(';'); }
      else if (this.isKw('import')) {
        this.p++;
        const st = this.accept('static');
        const name = this.qualName(true);
        this.expect(';');
        unit.imports.push({ name, static: st });
      }
      else if (this.accept(';')) { /* stray */ }
      else unit.types.push(this.parseTypeDecl());
    }
    return unit;
  }
  qualName(allowStar) {
    let s = this.ident();
    while (this.isOp('.')) {
      this.p++;
      if (allowStar && this.isOp('*')) { this.p++; s += '.*'; break; }
      s += '.' + this.ident();
    }
    return s;
  }
  parseMods() {
    const mods = new Set(), annos = [];
    for (;;) {
      const t = this.tok;
      if (t.t === 'op' && t.v === '@' && !(this.peek().t === 'id' && this.peek().v === 'interface')) {
        this.p++;
        const name = this.qualName();
        const a = { name: name.split('.').pop(), args: {} };
        if (this.isOp('(')) this.collectAnnoArgs(a);
        annos.push(a);
        continue;
      }
      if (t.t === 'id' && MODIFIERS.has(t.v)) {
        if (t.v === 'synchronized' && this.peek().t === 'op' && this.peek().v === '(') break;
        mods.add(t.v); this.p++; continue;
      }
      if (t.t === 'id' && t.v === 'default' && this.peek().t === 'id') { mods.add('default'); this.p++; continue; }
      break;
    }
    return { mods, annos };
  }
  collectAnnoArgs(a) {
    this.expect('(');
    let depth = 1;
    while (depth > 0) {
      const k = this.tok;
      if (k.t === 'eof') this.err('Unterminated annotation');
      if (k.t === 'op' && k.v === '(') depth++;
      else if (k.t === 'op' && k.v === ')') depth--;
      else if (depth === 1 && k.t === 'id' && this.peek().t === 'op' && this.peek().v === '=' && this.peek(2).t === 'str') {
        a.args[k.v] = this.peek(2).v; this.p += 2;
      } else if (depth === 1 && k.t === 'str' && a.args.value === undefined) a.args.value = k.v;
      this.p++;
    }
  }
  parseTypeDecl() {
    const pre = this.parseMods();
    if (this.isKw('class') || this.isKw('interface') || this.isKw('enum')) return this.parseClass(this.tok.v, pre.mods, pre.annos);
    if (this.isOp('@')) this.err('Annotation type declarations are not supported');
    this.err(`Expected a class declaration but found '${this.tok.v}'`);
  }
  parseClass(kind, mods, annos) {
    const line = this.tok.line;
    this.p++;
    const name = this.ident();
    if (this.isOp('<')) this.skipAngles();
    let ext = null; const impl = [];
    if (this.accept('extends')) {
      if (kind === 'interface') { impl.push(this.parseType()); while (this.accept(',')) impl.push(this.parseType()); }
      else ext = this.parseType();
    }
    if (this.accept('implements')) { impl.push(this.parseType()); while (this.accept(',')) impl.push(this.parseType()); }
    const cls = { k: 'class', kind, name, mods, annos, ext, impl, members: [], consts: [], line };
    this.expect('{');
    if (kind === 'enum') this.parseEnumConsts(cls);
    this.parseMembers(cls);
    this.expect('}');
    return cls;
  }
  parseEnumConsts(cls) {
    while (!this.isOp(';') && !this.isOp('}')) {
      this.parseMods();
      const line = this.tok.line;
      const name = this.ident();
      let args = [];
      if (this.isOp('(')) args = this.parseArgs();
      let body = null;
      if (this.isOp('{')) {
        body = { k: 'class', kind: 'class', name: null, mods: new Set(), annos: [], ext: null, impl: [], members: [], consts: [], line };
        this.p++; this.parseMembers(body); this.expect('}');
      }
      cls.consts.push({ name, args, body, line });
      if (!this.accept(',')) break;
    }
    this.accept(';');
  }
  parseMembers(cls) {
    while (!this.isOp('}')) {
      if (this.tok.t === 'eof') this.err('Unexpected end of file: a closing brace is missing' + (cls.name ? ` for class ${cls.name}` : ''));
      if (this.accept(';')) continue;
      cls.members.push(this.parseMember(cls));
    }
  }
  parseMember(cls) {
    const pre = this.parseMods();
    const mods = pre.mods;
    const line = this.tok.line;
    if (this.isOp('{')) return { k: 'init', static: mods.has('static'), body: this.parseBlock(), line };
    if (this.isKw('class') || this.isKw('interface') || this.isKw('enum')) return this.parseClass(this.tok.v, mods, pre.annos);
    if (this.isOp('<')) this.skipAngles();
    if (this.tok.t === 'id' && cls.name && this.tok.v === cls.name && this.peek().t === 'op' && this.peek().v === '(') {
      this.p++;
      const params = this.parseParams();
      this.skipThrows();
      return { k: 'ctor', mods, params, body: this.parseBlock(), line };
    }
    const type = this.parseType();
    const name = this.ident();
    if (this.isOp('(')) {
      const params = this.parseParams();
      while (this.isOp('[')) this.p += 2;
      this.skipThrows();
      let body = null;
      if (this.isOp('{')) body = this.parseBlock();
      else { if (this.accept('default')) this.parseTernary(); this.expect(';'); }
      return { k: 'method', mods, annos: pre.annos, ret: type, name, params, body, line };
    }
    const decls = this.parseDeclarators(type, name);
    this.expect(';');
    return { k: 'field', mods, type, decls, line };
  }
  parseDeclarators(type, firstName) {
    const decls = [];
    let name = firstName;
    for (;;) {
      let dims = 0;
      while (this.isOp('[')) { this.p += 2; dims++; }
      let init = null;
      if (this.accept('=')) init = this.parseVarInit();
      decls.push({ name, dims, init });
      if (!this.accept(',')) break;
      name = this.ident();
    }
    return decls;
  }
  parseVarInit() { return this.isOp('{') ? this.parseArrayInit() : this.parseExpr(); }
  parseArrayInit() {
    const line = this.tok.line;
    this.expect('{');
    const elems = [];
    while (!this.isOp('}')) { elems.push(this.parseVarInit()); if (!this.accept(',')) break; }
    this.expect('}');
    return { k: 'arrlit', elems, line };
  }
  parseParams() {
    this.expect('(');
    const ps = [];
    while (!this.isOp(')')) {
      this.parseMods();
      let type = this.parseType(), varargs = false;
      if (this.accept('...')) { varargs = true; type = Object.assign({}, type, { dims: type.dims + 1 }); }
      const name = this.ident();
      let dims = 0;
      while (this.isOp('[')) { this.p += 2; dims++; }
      if (dims) type = Object.assign({}, type, { dims: type.dims + dims });
      ps.push({ type, name, varargs });
      if (!this.accept(',')) break;
    }
    this.expect(')');
    return ps;
  }
  skipThrows() { if (this.accept('throws')) { this.parseType(); while (this.accept(',')) this.parseType(); } }
  skipAngles() {
    let depth = 0;
    do {
      const t = this.tok;
      if (t.t === 'eof') this.err('Unbalanced <>');
      if (t.t === 'op') {
        if (t.v === '<') depth++;
        else if (t.v === '>') depth--;
        else if (t.v === '>>') depth -= 2;
        else if (t.v === '>>>') depth -= 3;
      }
      this.p++;
    } while (depth > 0);
  }

  /* ---- types */
  parseType(allowDims = true) {
    while (this.isOp('@')) { this.p++; this.qualName(); if (this.isOp('(')) this.collectAnnoArgs({ args: {} }); }
    const t = this.tok;
    let name, args = null;
    if (t.t === 'id' && PRIMS.has(t.v)) { name = t.v; this.p++; }
    else if (t.t === 'id' && !RESERVED.has(t.v)) {
      name = t.v; this.p++;
      if (this.isOp('<')) args = this.typeArgs();
      while (this.isOp('.') && this.peek().t === 'id' && !RESERVED.has(this.peek().v)) {
        this.p++; name += '.' + this.tok.v; this.p++;
        if (this.isOp('<')) args = this.typeArgs();
      }
    } else this.err(`Expected a type but found '${t.v}'`);
    let dims = 0;
    if (allowDims) while (this.isOp('[') && this.peek().t === 'op' && this.peek().v === ']') { this.p += 2; dims++; }
    return { n: name, args, dims };
  }
  typeArgs() {
    this.expect('<');
    const args = [];
    if (this.isOp('>')) { this.p++; return args; }
    for (;;) {
      if (this.isOp('?')) {
        this.p++;
        if (this.accept('extends') || this.accept('super')) args.push(this.parseType());
        else args.push({ n: 'Object', args: null, dims: 0 });
      } else args.push(this.parseType());
      if (!this.accept(',')) break;
    }
    this.closeAngle();
    return args;
  }
  closeAngle() {
    const t = this.tok;
    if (t.t === 'op' && t.v === '>') { this.p++; return; }
    if (t.t === 'op' && (t.v === '>>' || t.v === '>>>')) {
      this.undo.push([this.p, t]);
      this.toks[this.p] = Object.assign({}, t, { v: t.v.slice(1) });
      return;
    }
    this.err("Expected '>' to close the type arguments");
  }
  isLocalDecl() {
    const m = this.mark();
    try {
      const t = this.tok;
      if (t.t !== 'id') return false;
      if (RESERVED.has(t.v) && !PRIMS.has(t.v)) return false;
      this.parseType();
      const n = this.tok;
      if (n.t !== 'id' || RESERVED.has(n.v)) return false;
      const a = this.peek();
      return a.t === 'op' && (a.v === '=' || a.v === ';' || a.v === ',' || a.v === ':' || a.v === '[');
    } catch (e) {
      if (e instanceof JavaSyntaxError) return false;
      throw e;
    } finally { this.reset(m); }
  }

  /* ---- statements */
  parseBlock() {
    const line = this.tok.line;
    this.expect('{');
    const body = [];
    while (!this.isOp('}')) {
      if (this.tok.t === 'eof') this.err('Unexpected end of file: a closing brace is missing');
      body.push(this.parseStmt());
    }
    this.expect('}');
    return { k: 'block', body, line };
  }
  parseStmt() {
    const t = this.tok, line = t.line;
    if (t.t === 'op') {
      if (t.v === '{') return this.parseBlock();
      if (t.v === ';') { this.p++; return { k: 'empty', line }; }
    }
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': {
          this.p++; this.expect('(');
          const c = this.parseExpr(); this.expect(')');
          const a = this.parseStmt();
          let b = null;
          if (this.accept('else')) b = this.parseStmt();
          return { k: 'if', c, a, b, line };
        }
        case 'while': {
          this.p++; this.expect('(');
          const c = this.parseExpr(); this.expect(')');
          return { k: 'while', c, body: this.parseStmt(), line };
        }
        case 'do': {
          this.p++;
          const body = this.parseStmt();
          this.expect('while'); this.expect('(');
          const c = this.parseExpr(); this.expect(')'); this.expect(';');
          return { k: 'dowhile', c, body, line };
        }
        case 'for': return this.parseFor();
        case 'return': {
          this.p++;
          let e = null;
          if (!this.isOp(';')) e = this.parseExpr();
          this.expect(';');
          return { k: 'return', e, line };
        }
        case 'break': case 'continue': {
          this.p++;
          let label = null;
          if (this.tok.t === 'id' && !RESERVED.has(this.tok.v)) label = this.ident();
          this.expect(';');
          return { k: t.v, label, line };
        }
        case 'throw': {
          this.p++;
          const e = this.parseExpr(); this.expect(';');
          return { k: 'throw', e, line };
        }
        case 'try': return this.parseTry();
        case 'switch': {
          // switch statement (a switch used as an expression statement is rare)
          this.p++; this.expect('(');
          const e = this.parseExpr(); this.expect(')');
          return { k: 'switch', e, cases: this.parseSwitchBody(), line };
        }
        case 'synchronized': {
          this.p++; this.expect('('); this.parseExpr(); this.expect(')');
          return this.parseBlock();
        }
        case 'assert': {
          this.p++; this.parseExpr();
          if (this.accept(':')) this.parseExpr();
          this.expect(';');
          return { k: 'empty', line };
        }
      }
      if (!RESERVED.has(t.v) && this.peek().t === 'op' && this.peek().v === ':') {
        this.p += 2;
        return { k: 'labeled', label: t.v, body: this.parseStmt(), line };
      }
    }
    let hadMods = false;
    if ((t.t === 'id' && (t.v === 'final' || t.v === 'abstract' || t.v === 'static')) || (t.t === 'op' && t.v === '@')) {
      this.parseMods(); hadMods = true;
    }
    if (this.isKw('class') || this.isKw('interface') || this.isKw('enum')) {
      return { k: 'localclass', cls: this.parseClass(this.tok.v, new Set(), []), line };
    }
    if (hadMods || this.isLocalDecl()) return this.parseLocalDecl(line);
    const e = this.parseExpr();
    this.expect(';');
    return { k: 'expr', e, line };
  }
  parseLocalDecl(line) {
    const type = this.parseType();
    const name = this.ident();
    const decls = this.parseDeclarators(type, name);
    this.expect(';');
    return { k: 'local', type, decls, line };
  }
  parseFor() {
    const line = this.tok.line;
    this.p++; this.expect('(');
    let init = [], initDecl = null;
    if (!this.isOp(';')) {
      this.parseMods();
      if (this.isLocalDecl()) {
        const type = this.parseType();
        const name = this.ident();
        if (this.isOp(':')) {
          this.p++;
          const iter = this.parseExpr(); this.expect(')');
          return { k: 'foreach', type, name, iter, body: this.parseStmt(), line };
        }
        initDecl = { k: 'local', type, decls: this.parseDeclarators(type, name), line };
      } else {
        init.push(this.parseExpr());
        while (this.accept(',')) init.push(this.parseExpr());
      }
    }
    this.expect(';');
    const c = this.isOp(';') ? null : this.parseExpr();
    this.expect(';');
    const update = [];
    if (!this.isOp(')')) { update.push(this.parseExpr()); while (this.accept(',')) update.push(this.parseExpr()); }
    this.expect(')');
    return { k: 'for', init, initDecl, c, update, body: this.parseStmt(), line };
  }
  parseTry() {
    const line = this.tok.line;
    this.p++;
    const resources = [];
    if (this.accept('(')) {
      while (!this.isOp(')')) {
        this.parseMods();
        const type = this.parseType();
        const name = this.ident();
        this.expect('=');
        resources.push({ type, name, init: this.parseExpr() });
        if (!this.accept(';')) break;
      }
      this.expect(')');
    }
    const block = this.parseBlock();
    const catches = [];
    while (this.isKw('catch')) {
      this.p++; this.expect('(');
      this.parseMods();
      const types = [this.parseType()];
      while (this.accept('|')) types.push(this.parseType());
      const name = this.ident();
      this.expect(')');
      catches.push({ types, name, body: this.parseBlock() });
    }
    let fin = null;
    if (this.accept('finally')) fin = this.parseBlock();
    if (!catches.length && !fin && !resources.length) this.err("'try' needs a 'catch' or 'finally'");
    return { k: 'try', resources, block, catches, fin, line };
  }
  parseSwitchBody() {
    this.expect('{');
    const cases = [];
    while (!this.isOp('}')) {
      if (this.tok.t === 'eof') this.err('Unexpected end of file inside switch');
      const c = { labels: [], isDefault: false, arrow: false, body: [], line: this.tok.line };
      if (this.isKw('default')) { this.p++; c.isDefault = true; }
      else {
        this.expect('case');
        for (;;) {
          if (this.isKw('default')) { this.p++; c.isDefault = true; }
          else c.labels.push(this.parseTernary());
          if (!this.accept(',')) break;
        }
      }
      if (this.accept('->')) {
        c.arrow = true;
        if (this.isOp('{')) c.body = [this.parseBlock()];
        else if (this.isKw('throw')) c.body = [this.parseStmt()];
        else { const ln = this.tok.line; const e = this.parseExpr(); this.expect(';'); c.body = [{ k: 'expr', e, line: ln, arrowValue: true }]; }
      } else {
        this.expect(':');
        while (!this.isOp('}') && !this.isKw('case') && !this.isKw('default')) c.body.push(this.parseStmt());
      }
      cases.push(c);
    }
    this.expect('}');
    return cases;
  }

  /* ---- expressions */
  parseExpr() { return this.parseAssign(); }
  parseAssign() {
    const lam = this.tryLambda();
    if (lam) return lam;
    const l = this.parseTernary();
    const t = this.tok;
    if (t.t === 'op' && ASSIGN_OPS.has(t.v)) {
      this.p++;
      const r = this.parseAssign();
      return { k: 'assign', op: t.v, l, r, line: t.line };
    }
    return l;
  }
  parseTernary() {
    const c = this.parseBin(0);
    if (this.isOp('?')) {
      const line = this.tok.line;
      this.p++;
      const a = this.parseAssign();
      this.expect(':');
      const b = this.parseAssign();
      return { k: 'cond', c, a, b, line };
    }
    return c;
  }
  parseBin(min) {
    let left = this.parseUnary();
    for (;;) {
      const t = this.tok;
      let op = null;
      if (t.t === 'op' && BINPREC[t.v] !== undefined) op = t.v;
      else if (t.t === 'id' && t.v === 'instanceof') op = 'instanceof';
      if (!op) break;
      const prec = BINPREC[op];
      if (prec < min) break;
      this.p++;
      if (op === 'instanceof') {
        this.accept('final');
        const type = this.parseType();
        let bind = null;
        if (this.tok.t === 'id' && !RESERVED.has(this.tok.v)) bind = this.ident();
        left = { k: 'instanceof', e: left, type, bind, line: t.line };
        continue;
      }
      const right = this.parseBin(prec + 1);
      left = { k: 'bin', op, l: left, r: right, line: t.line };
    }
    return left;
  }
  parseUnary() {
    const t = this.tok, line = t.line;
    if (t.t === 'op') {
      if (t.v === '+' || t.v === '-' || t.v === '!' || t.v === '~') { this.p++; return { k: 'unary', op: t.v, e: this.parseUnary(), line }; }
      if (t.v === '++' || t.v === '--') { this.p++; return { k: 'incdec', op: t.v, prefix: true, e: this.parseUnary(), line }; }
      if (t.v === '(') { const c = this.tryCast(); if (c) return c; }
    }
    return this.parsePostfix(this.parsePrimary());
  }
  tryCast() {
    const m = this.mark(), line = this.tok.line;
    this.p++;
    const t = this.tok;
    if (t.t === 'id' && PRIMS.has(t.v)) {
      const type = this.attempt(() => this.parseType());
      if (type && this.isOp(')')) { this.p++; return { k: 'cast', type, e: this.parseUnary(), line }; }
      this.reset(m); return null;
    }
    if (t.t === 'id' && !RESERVED.has(t.v)) {
      const type = this.attempt(() => { const ty = this.parseType(); while (this.isOp('&')) { this.p++; this.parseType(); } return ty; });
      if (type && this.isOp(')')) {
        const nx = this.peek();
        const ok = nx.t === 'str' || nx.t === 'num' || nx.t === 'chr' ||
          (nx.t === 'id' && (!RESERVED.has(nx.v) || ['this', 'new', 'super', 'true', 'false', 'null', 'switch'].includes(nx.v))) ||
          (nx.t === 'op' && (nx.v === '(' || nx.v === '!' || nx.v === '~'));
        if (ok) { this.p++; return { k: 'cast', type, e: this.parseUnary(), line }; }
      }
    }
    this.reset(m);
    return null;
  }
  tryLambda() {
    const t = this.tok;
    if (t.t === 'id' && !RESERVED.has(t.v) && this.peek().t === 'op' && this.peek().v === '->') {
      this.p += 2;
      return this.lambdaBody([{ name: t.v, type: null }], t.line);
    }
    if (t.t === 'op' && t.v === '(') {
      let depth = 0, i = this.p;
      for (; i < this.toks.length; i++) {
        const k = this.toks[i];
        if (k.t === 'op') { if (k.v === '(') depth++; else if (k.v === ')') { depth--; if (depth === 0) break; } }
      }
      const after = this.toks[i + 1];
      if (after && after.t === 'op' && after.v === '->') {
        this.p++;
        const params = [];
        while (!this.isOp(')')) {
          this.parseMods();
          const nx = this.peek();
          if (this.tok.t === 'id' && nx.t === 'op' && (nx.v === ',' || nx.v === ')')) params.push({ name: this.ident(), type: null });
          else { const type = this.parseType(); params.push({ name: this.ident(), type }); }
          if (!this.accept(',')) break;
        }
        this.expect(')'); this.expect('->');
        return this.lambdaBody(params, t.line);
      }
    }
    return null;
  }
  lambdaBody(params, line) {
    if (this.isOp('{')) return { k: 'lambda', params, body: this.parseBlock(), line };
    return { k: 'lambda', params, expr: this.parseExpr(), line };
  }
  parseArgs() {
    this.expect('(');
    const args = [];
    while (!this.isOp(')')) { args.push(this.parseExpr()); if (!this.accept(',')) break; }
    this.expect(')');
    return args;
  }
  parseNew() {
    const line = this.tok.line;
    this.expect('new');
    const type = this.parseType(false);
    if (this.isOp('[')) {
      const dims = []; let extra = 0;
      while (this.isOp('[')) {
        this.p++;
        if (this.isOp(']')) { this.p++; extra++; }
        else { dims.push(this.parseExpr()); this.expect(']'); }
      }
      const init = this.isOp('{') ? this.parseArrayInit() : null;
      return { k: 'newarr', type, dims, extra, init, line };
    }
    const args = this.parseArgs();
    let body = null;
    if (this.isOp('{')) {
      body = { k: 'class', kind: 'class', name: null, mods: new Set(), annos: [], ext: null, impl: [], members: [], consts: [], line };
      this.p++; this.parseMembers(body); this.expect('}');
    }
    return { k: 'new', type, args, body, line };
  }
  parsePrimary() {
    const t = this.tok, line = t.line;
    switch (t.t) {
      case 'num': this.p++; return { k: 'lit', t: t.nt, v: t.v, raw: t.raw, line };
      case 'str': this.p++; return { k: 'lit', t: 'String', v: t.v, line };
      case 'chr': this.p++; return { k: 'lit', t: 'char', v: t.v, line };
      case 'op':
        if (t.v === '(') { this.p++; const e = this.parseExpr(); this.expect(')'); return { k: 'paren', e, line }; }
        break;
      case 'id':
        switch (t.v) {
          case 'true': case 'false': this.p++; return { k: 'lit', t: 'boolean', v: t.v === 'true', line };
          case 'null': this.p++; return { k: 'lit', t: 'null', v: null, line };
          case 'this':
            this.p++;
            if (this.isOp('(')) return { k: 'call', obj: null, name: 'this', args: this.parseArgs(), line };
            return { k: 'this', line };
          case 'super':
            this.p++;
            if (this.isOp('(')) return { k: 'call', obj: null, name: 'super', args: this.parseArgs(), line };
            return { k: 'super', line };
          case 'new': return this.parseNew();
          case 'switch': {
            this.p++; this.expect('(');
            const e = this.parseExpr(); this.expect(')');
            return { k: 'switchexpr', e, cases: this.parseSwitchBody(), line };
          }
        }
        if (PRIMS.has(t.v)) {
          const ty = this.parseType();
          if (this.isOp('.') && this.peek().v === 'class') { this.p += 2; return { k: 'classlit', name: ty.n, line }; }
          this.err(`Unexpected '${t.v}'`);
        }
        if (RESERVED.has(t.v)) this.err(`Unexpected '${t.v}'`);
        this.p++;
        if (this.isOp('(')) return { k: 'call', obj: null, name: t.v, args: this.parseArgs(), line };
        return { k: 'name', id: t.v, line };
    }
    this.err(`Unexpected '${t.v}'`);
  }
  parsePostfix(e) {
    for (;;) {
      const t = this.tok;
      if (t.t !== 'op') break;
      const line = t.line;
      if (t.v === '.') {
        this.p++;
        if (this.isOp('<')) this.skipAngles();
        const nt = this.tok;
        if (nt.t !== 'id') this.err(`Expected a name after '.' but found '${nt.v}'`);
        if (nt.v === 'class') { this.p++; e = { k: 'classlit', e, line }; continue; }
        if (nt.v === 'this') { this.p++; e = { k: 'outerthis', e, line }; continue; }
        this.p++;
        if (this.isOp('(')) e = { k: 'call', obj: e, name: nt.v, args: this.parseArgs(), line: nt.line };
        else e = { k: 'field', obj: e, name: nt.v, line: nt.line };
        continue;
      }
      if (t.v === '[') { this.p++; const idx = this.parseExpr(); this.expect(']'); e = { k: 'index', obj: e, idx, line }; continue; }
      if (t.v === '++' || t.v === '--') { this.p++; e = { k: 'incdec', op: t.v, prefix: false, e, line }; continue; }
      if (t.v === '::') {
        this.p++;
        let nm;
        if (this.isKw('new')) { this.p++; nm = 'new'; } else nm = this.ident();
        e = { k: 'mref', obj: e, name: nm, line };
        continue;
      }
      break;
    }
    return e;
  }
}

function parseJava(src) {
  return new Parser(lex(src)).parseUnit();
}

FTC.parseJava = parseJava;
FTC.lexJava = lex;
FTC.JavaSyntaxError = JavaSyntaxError;
FTC.JAVA_PRIMS = PRIMS;
FTC.JAVA_RESERVED = RESERVED;
if (typeof module !== 'undefined' && module.exports) module.exports = FTC;
})(typeof globalThis !== 'undefined' ? globalThis : window);
