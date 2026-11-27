/* AI robots for full matches: an optional partner on your alliance and up to two opponents.
   Each one is a simple holonomic (mecanum-like) robot with an intake and a fixed-hood flywheel shooter.

   What they do:
     AUTO    fire their pre-loads at their own HIVE, collect a few more, and park near the end
     TELEOP  collect POLLEN (floor first, then FLOWERS), drive to a spot facing their HIVE's raised CELL,
             aim, spin up and shoot; park in their LOADING ZONE in the last seconds
     between periods and after the match they stand still.
   They push and get pushed: robots are solid boxes for each other, and for the balls. */
(function (G) {
'use strict';
const FTC = (G.FTC = G.FTC || {});
const STATE = FTC.GAME_STATE;

// how good each level is
const LEVELS = {
  easy:   { label: 'Easy',   speed: 36, accel: 150, turn: 2.6, aimTol: 4,   speedErr: 0.05,  angErr: 2.0, think: 0.7, cap: 3, parkAt: 14, shotGap: 0.55 },
  normal: { label: 'Normal', speed: 50, accel: 210, turn: 3.6, aimTol: 2.5, speedErr: 0.025, angErr: 1.0, think: 0.35, cap: 4, parkAt: 10, shotGap: 0.4 },
  hard:   { label: 'Hard',   speed: 64, accel: 280, turn: 4.8, aimTol: 1.5, speedErr: 0.012, angErr: 0.5, think: 0.15, cap: 4, parkAt: 7, shotGap: 0.3 },
};
FTC.AI_LEVELS = LEVELS;

const BOT = { L: 17, W: 17, H: 15, launchDeg: 70, exitSpeed: 330, muzzleX: 2 };   // steep hood: shots come down into the CELL
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

const P = FTC.Game.prototype;

/* ---- setup: ai = { partner: bool, opponents: 0..2, level: 'easy'|'normal'|'hard', alliance: 'red'|'blue' } */
P.initBots = function (ai) {
  const cfg = this.sim.cfg;
  const us = ai.alliance || (cfg.start.x > 0 ? 'blue' : 'red'), them = us === 'red' ? 'blue' : 'red';
  const roster = [];
  if (ai.partner) roster.push({ alliance: us, role: 'partner' });
  for (let i = 0; i < (ai.opponents == null ? 2 : ai.opponents); i++) roster.push({ alliance: them, role: 'opponent' });
  const level = LEVELS[ai.level] || LEVELS.normal;
  const taken = [{ al: us, y: cfg.start.y }];
  const H = FTC.FIELD_HALF;
  roster.forEach((r, i) => {
    // start touching their alliance wall, facing into the field, away from robots already placed there
    const sx = r.alliance === 'red' ? -1 : 1;
    const ys = [-46, -20, 6, 32, -58].filter(y => taken.every(t => t.al !== r.alliance || Math.abs(t.y - y) > 22));
    const y = ys.length ? ys[0] : -46 + i * 20;
    taken.push({ al: r.alliance, y });
    const bot = {
      id: i, role: r.role, alliance: r.alliance, level, L: BOT.L, W: BOT.W, H: BOT.H,
      x: sx * (H - BOT.L / 2 - 0.2), y, h: sx < 0 ? 0 : Math.PI, vx: 0, vy: 0, w: 0,
      startX: 0, startY: y, fly: 0, flyTarget: 0, intaking: false,
      task: null, target: null, nextThink: 0, lastShot: -1, stuckT: 0, lastPos: null, lane: (i % 3) - 1,
      claim: null, shots: 0,
    };
    bot.startX = bot.x;
    this.bots.push(bot);
    for (let k = 0; k < (cfg.preload == null ? 4 : Math.min(cfg.preload, level.cap)); k++) { const b = this.add(STATE.held, 0, 0, 0); b.holder = bot.id; }
  });
};

/* the match tells the game which period it is in, and when that period ends (sim seconds) */
P.setPhase = function (phase, endsAt) { this.phase = phase; this.phaseEnd = endsAt; };
P.botHeld = function (bot) { return this.balls.filter(b => b.state === STATE.held && b.holder === bot.id); };

/* LEAVE and PARK for the AI robots, at the end of AUTO and at the end of the match */
P.botsAutoEnd = function () {
  const msgs = [];
  for (const bt of this.bots) {
    if (Math.hypot(bt.x - bt.startX, bt.y - bt.startY) > 3) this.award(bt.alliance, 'leave');
    if (this.botInZone(bt)) { this.award(bt.alliance, 'park'); msgs.push(`${bt.alliance} AI parked`); }
  }
  return msgs;
};
P.botsMatchEnd = function () { for (const bt of this.bots) if (this.botInZone(bt)) this.award(bt.alliance, 'park'); };
P.botInZone = function (bt) {
  const z = this.B.loadingZones.find(q => q.alliance === bt.alliance);
  return z && Math.abs(bt.x - z.x) < z.w / 2 + bt.L / 2 - 1 && Math.abs(bt.y - z.y) < z.d / 2 + bt.W / 2 - 1;
};

/* ---- the opening a robot of this alliance shoots at, and where to stand for it */
P.raisedOpening = function (alliance) {
  const hi = this.hives.findIndex(h => h.alliance === alliance), h = this.hives[hi], S = this.S;
  const up = h.tipping ? -h.upEnd : h.upEnd;            // while it swings, aim at where it is going
  const [x, y, z] = this.hiveWorld(Object.assign({}, h, { theta: up * this.rest }), 0, up * S.sO, S.hF + 6.5);
  return { x, y, z, up, hi };
};
P.shootSpot = function (bt) {
  const o = this.raisedOpening(bt.alliance);
  const D = 36 + ((bt.id * 5) % 6);                       // 36-41 in back: far enough that the ball is falling when it arrives
  const lim = FTC.FIELD_HALF - bt.L / 2 - 2;
  return { x: o.x + bt.lane * 9, y: Math.max(-lim, Math.min(lim, o.y + o.up * D)), o };
};

/* ---- one step for all AI robots */
P.stepBots = function (dt) {
  const t = this.sim.t;
  const active = this.phase === 'auto' || this.phase === 'teleop';
  for (const bt of this.bots) {
    const held = this.botHeld(bt);
    let want = { vx: 0, vy: 0, w: 0 };
    bt.intaking = false;
    if (active) {
      if (t >= bt.nextThink) { this.botThink(bt, held, t); bt.nextThink = t + bt.level.think * (0.7 + 0.6 * this.rand()); }
      want = this.botAct(bt, held, t, dt);
    } else { bt.flyTarget = 0; bt.task = null; }
    this.botDrive(bt, want, dt);
    // flywheel spins toward its target speed
    bt.fly += (bt.flyTarget - bt.fly) * Math.min(1, dt / 0.35);
  }
  this.robotsCollide();
};

/* decide what to do next */
P.botThink = function (bt, held, t) {
  const L = bt.level;
  const left = this.phaseEnd != null ? this.phaseEnd - t : 99;
  const parkTime = this.phase === 'auto' ? 4 : L.parkAt;
  if (left < parkTime) { bt.task = 'park'; return; }
  if (bt.task === 'shoot' && held.length) return;          // finish shooting first
  const cap = L.cap;
  if (held.length >= cap) { bt.task = 'shoot'; return; }
  const ball = this.pickBall(bt);
  if (!ball && held.length) { bt.task = 'shoot'; return; }
  if (held.length && ball && Math.hypot(ball.x - bt.x, ball.y - bt.y) > 70) { bt.task = 'shoot'; return; }
  if (ball) { bt.task = 'collect'; bt.claim = ball; return; }
  const fl = this.pickFlower(bt);
  if (fl != null) { bt.task = 'flower'; bt.claim = fl; return; }
  bt.task = held.length ? 'shoot' : 'wait';
};
/* the nearest loose POLLEN on the floor that no other AI robot is going for */
P.pickBall = function (bt) {
  let best = null, bd = 1e9;
  const lim = FTC.FIELD_HALF - 4;
  for (const b of this.balls) {
    if (b.state !== STATE.floor || Math.abs(b.x) > lim || Math.abs(b.y) > lim) continue;
    if (b.home === 'garden') continue;                    // GARDEN POLLEN score where they sit
    if (this.bots.some(o => o !== bt && o.claim === b && o.task === 'collect')) continue;
    if (Math.abs(b.x) < 26 && Math.abs(b.y) < 22) continue;   // under the HIVEs, between the frame rails: skip
    const d = Math.hypot(b.x - bt.x, b.y - bt.y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
};
P.pickFlower = function (bt) {
  let best = null, bd = 1e9;
  this.B.flowers.forEach((f, fi) => {
    const n = this.balls.filter(b => b.state === STATE.flower && b.flower === fi).length;
    if (!n || this.bots.some(o => o !== bt && o.claim === fi && o.task === 'flower')) return;
    const d = Math.hypot(f.x - bt.x, f.y - bt.y) - (f.alliance === bt.alliance ? 20 : 0);
    if (d < bd) { bd = d; best = fi; }
  });
  return best;
};

/* carry out the current task: returns the wanted velocity (field frame) and turn rate */
P.botAct = function (bt, held, t, dt) {
  const L = bt.level;
  bt.flyTarget = held.length && (bt.task === 'shoot' || bt.task === 'collect') ? Math.max(bt.flyTarget, 0.35) : bt.flyTarget * 0.98;
  switch (bt.task) {
    case 'collect': {
      const b = bt.claim;
      if (!b || b.state !== STATE.floor) { bt.nextThink = t; return { vx: 0, vy: 0, w: 0 }; }
      bt.intaking = true;
      const face = Math.atan2(b.y - bt.y, b.x - bt.x);
      // aim the intake at the ball; drive slower once close so it gets swallowed
      const reach = bt.L / 2 + 1;
      const gx = b.x - Math.cos(face) * (reach - 2), gy = b.y - Math.sin(face) * (reach - 2);
      return this.steer(bt, gx, gy, face, Math.abs(wrap(face - bt.h)) > 0.6 ? 0.45 : 1);
    }
    case 'flower': {
      const f = this.B.flowers[bt.claim];
      if (!f) { bt.nextThink = t; return { vx: 0, vy: 0, w: 0 }; }
      bt.intaking = true;
      const face = Math.atan2(-f.ny, -f.nx);               // face the wall, intake against the FLOWER
      const gx = f.x + f.nx * (this.B.flower.outerD / 2 + bt.L / 2 + 0.5), gy = f.y + f.ny * (this.B.flower.outerD / 2 + bt.L / 2 + 0.5);
      if (held.length >= L.cap) bt.nextThink = t;
      return this.steer(bt, gx, gy, face, 1);
    }
    case 'shoot': {
      const sp = this.shootSpot(bt), o = sp.o;
      const mx = bt.x + BOT.muzzleX * Math.cos(bt.h), my = bt.y + BOT.muzzleX * Math.sin(bt.h);
      const bearing = Math.atan2(o.y - my, o.x - mx);
      const dist = Math.hypot(sp.x - bt.x, sp.y - bt.y);
      const th = BOT.launchDeg * Math.PI / 180;
      const need = FTC.solveV0Drag(Math.hypot(o.x - mx, o.y - my), o.z - bt.H, th);
      if (need) bt.flyTarget = Math.min(1, need / BOT.exitSpeed);
      if (dist > 4) return this.steer(bt, sp.x, sp.y, bearing, 1);
      // in position: aim, wait for the flywheel, then fire one at a time
      const err = Math.abs(wrap(bearing - bt.h)) * 180 / Math.PI;
      const spun = need && Math.abs(bt.fly - bt.flyTarget) < 0.02;
      if (err < L.aimTol && spun && held.length && t - bt.lastShot > L.shotGap) this.botLaunch(bt, held[0], t);
      if (!held.length) bt.nextThink = t;
      return this.steer(bt, sp.x, sp.y, bearing, 0.5);
    }
    case 'park': {
      const z = this.B.loadingZones.find(q => q.alliance === bt.alliance);
      const gx = z.x + (z.x < 0 ? 2 : -2), gy = z.y + bt.lane * 3;
      bt.flyTarget = 0;
      const face = bt.alliance === 'red' ? 0 : Math.PI;
      return this.steer(bt, gx, gy, face, 1);
    }
    default:
      bt.flyTarget = 0;
      return { vx: 0, vy: 0, w: 0 };
  }
};

/* go to (gx, gy) facing `face`: straight line, around the frame rails, nudged away from other robots */
P.steer = function (bt, gx, gy, face, scale) {
  const L = bt.level;
  // the frame rails at x = +-24.7 run from y = -19.5 to 19.5: cross them only past their ends
  const fx = this.B.frame.w / 2, fy = this.B.frame.d / 2 + bt.W / 2 + 4;
  let tx = gx, ty = gy;
  for (const rx of [-fx, fx]) {
    if ((bt.x - rx) * (gx - rx) < 0) {
      const u = (rx - bt.x) / (gx - bt.x), yc = bt.y + (gy - bt.y) * u;
      if (Math.abs(yc) < fy) { const sy = Math.abs(bt.y) > 2 ? Math.sign(bt.y) : (gy >= 0 ? 1 : -1); tx = rx - Math.sign(gx - bt.x) * (bt.L / 2 + 3); ty = sy * fy; if (Math.abs(bt.y - ty) < 3 || Math.abs(bt.x - tx) < 3) tx = rx + Math.sign(gx - bt.x) * (bt.L / 2 + 4); }
    }
  }
  let dx = tx - bt.x, dy = ty - bt.y;
  const d = Math.hypot(dx, dy);
  const v = Math.min(L.speed * scale, d * 3.5);
  let vx = d > 0.3 ? dx / d * v : 0, vy = d > 0.3 ? dy / d * v : 0;
  // keep away from other robots (yours included) and the FLOWERS unless that is where it is going
  const others = [{ x: this.sim.robot.x, y: this.sim.robot.y }].concat(this.bots.filter(o => o !== bt));
  for (const o of others) {
    const ox = bt.x - o.x, oy = bt.y - o.y, od = Math.hypot(ox, oy);
    if (od < 26 && od > 0.1) { const k = (26 - od) / 26 * L.speed * 0.9; vx += ox / od * k; vy += oy / od * k; }
  }
  if (bt.task !== 'flower') for (const f of this.B.flowers) {
    const ox = bt.x - f.x, oy = bt.y - f.y, od = Math.hypot(ox, oy);
    if (od < 16 && od > 0.1) { const k = (16 - od) / 16 * L.speed * 0.6; vx += ox / od * k; vy += oy / od * k; }
  }
  // stuck? back off sideways for a moment and rethink
  const tNow = this.sim.t;
  if (!bt.lastPos || tNow - bt.lastPos.t > 1) {
    if (bt.lastPos && Math.hypot(bt.x - bt.lastPos.x, bt.y - bt.lastPos.y) < 2 && d > 6) { bt.stuckT = tNow + 0.6; bt.stuckDir = this.rand() < 0.5 ? -1 : 1; bt.nextThink = tNow + 0.6; bt.claim = null; }
    bt.lastPos = { x: bt.x, y: bt.y, t: tNow };
  }
  if (tNow < bt.stuckT) { const a = bt.h + bt.stuckDir * Math.PI / 2; vx = Math.cos(a) * L.speed * 0.6 - Math.cos(bt.h) * 15; vy = Math.sin(a) * L.speed * 0.6 - Math.sin(bt.h) * 15; }
  const sp = Math.hypot(vx, vy);
  if (sp > L.speed) { vx *= L.speed / sp; vy *= L.speed / sp; }
  const e = wrap(face - bt.h);
  const w = Math.max(-L.turn, Math.min(L.turn, e * 6));
  return { vx, vy, w };
};

/* traction-limited motion, then the walls and field obstacles */
P.botDrive = function (bt, want, dt) {
  const L = bt.level, lim = L.accel * dt;
  let dvx = want.vx - bt.vx, dvy = want.vy - bt.vy;
  const dv = Math.hypot(dvx, dvy);
  if (dv > lim) { dvx *= lim / dv; dvy *= lim / dv; }
  bt.vx += dvx; bt.vy += dvy;
  bt.w += Math.max(-L.turn * 8 * dt, Math.min(L.turn * 8 * dt, want.w - bt.w));
  bt.x += bt.vx * dt; bt.y += bt.vy * dt; bt.h = wrap(bt.h + bt.w * dt);
  this.botCollideField(bt);
  // pick up POLLEN at the front while the intake runs
  if (bt.intaking && this.botHeld(bt).length < bt.level.cap) {
    const c = Math.cos(bt.h), s = Math.sin(bt.h), hl = bt.L / 2, hw = bt.W / 2, r = this.r;
    for (const b of this.balls) {
      if (!this.free(b) || b.z > r + 3) continue;
      const lx = (b.x - bt.x) * c + (b.y - bt.y) * s, ly = -(b.x - bt.x) * s + (b.y - bt.y) * c;
      if (lx > hl - 3 && lx < hl + r + 2.5 && Math.abs(ly) < hw - 1.5) { b.state = STATE.held; b.holder = bt.id; bt.nextThink = this.sim.t; break; }
    }
    if (bt.task === 'flower' && this.sim.t - (bt.lastFlower || 0) > 0.5) {
      const f = this.B.flowers[bt.claim];
      if (f) {
        const lx = (f.x - bt.x) * c + (f.y - bt.y) * s, ly = -(f.x - bt.x) * s + (f.y - bt.y) * c;
        if (lx > hl - 1 && lx < hl + this.B.flower.outerD && Math.abs(ly) < hw) {
          const stack = this.balls.filter(b => b.state === STATE.flower && b.flower === bt.claim).sort((a, b2) => a.slot - b2.slot);
          if (stack.length) {
            stack[0].state = STATE.held; stack[0].holder = bt.id; bt.lastFlower = this.sim.t;
            stack.slice(1).forEach(b => b.slot--); this.placeFlowerBalls();
          } else bt.nextThink = this.sim.t;
        }
      }
    }
  }
};
P.botCorners = function (bt) {
  const c = Math.cos(bt.h), s = Math.sin(bt.h), a = bt.L / 2, b = bt.W / 2;
  return [[a, b], [a, -b], [-a, -b], [-a, b]].map(([p, q]) => [bt.x + p * c - q * s, bt.y + p * s + q * c]);
};
P.botCollideField = function (bt) {
  const FH = FTC.FIELD_HALF;
  const obs = this.B.obstacles.concat((this.sim.cfg.obstacles || []));
  for (let it = 0; it < 3; it++) {
    let dx = 0, dy = 0;
    for (const [x, y] of this.botCorners(bt)) {
      if (x > FH) dx = Math.min(dx, FH - x); if (x < -FH) dx = Math.max(dx, -FH - x);
      if (y > FH) dy = Math.min(dy, FH - y); if (y < -FH) dy = Math.max(dy, -FH - y);
      for (const o of obs) {
        const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, y0 = o.y - o.d / 2, y1 = o.y + o.d / 2;
        if (x > x0 && x < x1 && y > y0 && y < y1) {
          const opts = [[x0 - x, 0], [x1 - x, 0], [0, y0 - y], [0, y1 - y]].sort((p, q) => Math.abs(p[0] + p[1]) - Math.abs(q[0] + q[1]));
          if (Math.abs(opts[0][0]) > Math.abs(dx)) dx = opts[0][0];
          if (Math.abs(opts[0][1]) > Math.abs(dy)) dy = opts[0][1];
        }
      }
    }
    // obstacle corners poking into the robot
    const c = Math.cos(-bt.h), s = Math.sin(-bt.h);
    for (const o of obs) {
      for (const [ox, oy] of [[o.x - o.w / 2, o.y - o.d / 2], [o.x + o.w / 2, o.y - o.d / 2], [o.x + o.w / 2, o.y + o.d / 2], [o.x - o.w / 2, o.y + o.d / 2]]) {
        const lx = (ox - bt.x) * c - (oy - bt.y) * s, ly = (ox - bt.x) * s + (oy - bt.y) * c;
        if (Math.abs(lx) < bt.L / 2 && Math.abs(ly) < bt.W / 2) {
          const px = bt.L / 2 - Math.abs(lx), py = bt.W / 2 - Math.abs(ly);
          const [mx, my] = px < py ? [-Math.sign(lx) * px, 0] : [0, -Math.sign(ly) * py];
          const cc = Math.cos(bt.h), ss = Math.sin(bt.h);
          const wx = mx * cc - my * ss, wy = mx * ss + my * cc;
          if (Math.abs(wx) > Math.abs(dx)) dx = wx; if (Math.abs(wy) > Math.abs(dy)) dy = wy;
        }
      }
    }
    if (!dx && !dy) break;
    bt.x += dx; bt.y += dy;
    if (dx && Math.sign(bt.vx) === -Math.sign(dx)) bt.vx = 0;
    if (dy && Math.sign(bt.vy) === -Math.sign(dy)) bt.vy = 0;
  }
};

/* robots are solid for each other: separating-axis test between every pair of boxes, push both apart */
P.robotsCollide = function () {
  const sim = this.sim, me = sim.robot, cfg = sim.cfg;
  const boxes = [{ ref: me, x: me.x, y: me.y, h: me.h, L: cfg.robotLength, W: cfg.robotWidth, user: true }].concat(this.bots.map(b => ({ ref: b, x: b.x, y: b.y, h: b.h, L: b.L, W: b.W })));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const A = boxes[i], B = boxes[j];
    const dx = B.ref.x - A.ref.x, dy = B.ref.y - A.ref.y;
    if (Math.hypot(dx, dy) > (Math.hypot(A.L, A.W) + Math.hypot(B.L, B.W)) / 2) continue;
    let best = 1e9, nx = 0, ny = 0;
    for (const ang of [A.ref.h, A.ref.h + Math.PI / 2, B.ref.h, B.ref.h + Math.PI / 2]) {
      const ax = Math.cos(ang), ay = Math.sin(ang);
      const ra = Math.abs(A.L / 2 * Math.cos(A.ref.h - ang)) + Math.abs(A.W / 2 * Math.sin(A.ref.h - ang));
      const rb = Math.abs(B.L / 2 * Math.cos(B.ref.h - ang)) + Math.abs(B.W / 2 * Math.sin(B.ref.h - ang));
      const dist = dx * ax + dy * ay, ov = ra + rb - Math.abs(dist);
      if (ov <= 0) { best = 0; break; }
      if (ov < best) { best = ov; const sg = dist >= 0 ? 1 : -1; nx = ax * sg; ny = ay * sg; }
    }
    if (best <= 0 || best === 1e9) continue;
    // push apart half each, and stop them moving into each other
    A.ref.x -= nx * best / 2; A.ref.y -= ny * best / 2; B.ref.x += nx * best / 2; B.ref.y += ny * best / 2;
    const rv = (B.ref.vx - A.ref.vx) * nx + (B.ref.vy - A.ref.vy) * ny;
    if (rv < 0) {
      A.ref.vx += nx * rv / 2; A.ref.vy += ny * rv / 2; B.ref.vx -= nx * rv / 2; B.ref.vy -= ny * rv / 2;
      if (A.user || B.user) {                       // you got bumped (or bumped them): haptics and a log line
        if (sim.t - (me.lastBotBump || -9) > 0.4) { me.bumps = (me.bumps || 0) + 1; me.impact = Math.abs(rv); sim.event('bump', 'Your robot hit another robot'); }
        me.lastBotBump = sim.t;
      }
    }
  }
};

/* fire one held POLLEN from an AI robot */
P.botLaunch = function (bt, b, t) {
  const L = bt.level, R = this.rand;
  const speed = BOT.exitSpeed * bt.fly * (1 + L.speedErr * FTC.gauss(R));
  const a = (BOT.launchDeg + L.angErr * FTC.gauss(R)) * Math.PI / 180;
  const yaw = bt.h + L.angErr * FTC.gauss(R) * Math.PI / 180;
  const c = Math.cos(bt.h), s = Math.sin(bt.h);
  Object.assign(b, { state: STATE.air, holder: null, x: bt.x + BOT.muzzleX * c, y: bt.y + BOT.muzzleX * s, z: bt.H,
    vx: bt.vx + speed * Math.cos(a) * Math.cos(yaw), vy: bt.vy + speed * Math.cos(a) * Math.sin(yaw), vz: speed * Math.sin(a),
    launchT: t, launchedBy: bt.id, peak: null });
  bt.lastShot = t; bt.shots++;
  bt.fly *= 0.9;                                   // the ball takes some energy from the flywheel
};
})(typeof globalThis !== 'undefined' ? globalThis : window);
