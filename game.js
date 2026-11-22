/* BIOBUZZ game world: POLLEN balls, intake pickup, launching, HIVE scoring and tipping, points.
   Runs inside the simulator's physics step. Inches, seconds, field frame as in sim.js. */
(function (G) {
'use strict';
const FTC = (G.FTC = G.FTC || {});

const GRAV = 386.1;            // in/s^2
const TIP_AT = 8;              // POLLEN in the up CELL that tip a HIVE. The HIVE calibration in the
                               // Competition Manual: 7 POLLEN must not tip it, 8 must.
const TIP_DELAY = 0.5;         // s before a loaded HIVE starts to move (tips are slow on the real field)
const TILT_RATE = 32;          // deg/s while a HIVE tips
const CELL_LOW_Z = 40;         // bottom edge of a raised CELL opening (it spans about 40-53 in)
const POINTS = { tip: 20, upCellBall: 2, garden: 1, leave: 3, park: 5 };
const STATE = { floor: 0, held: 1, air: 2, cell: 3, flower: 4 };

/* what each non-drive device does in the game, guessed from its name; editable on the Hardware map tab */
function guessJob(name, kind) {
  const n = name.toLowerCase();
  if (kind === 'servo') return /feed|kick|push|index|transfer|flick/.test(n) ? 'feeder' : 'none';
  if (/fly|shoot|launch|outtake|cannon/.test(n)) return 'shooter';
  if (/feed|kick|index|transfer|push|elevat|convey|belt/.test(n)) return 'feeder';
  if (/intake|roller|sweep|collect|brush|spin/.test(n)) return 'intake';
  return 'none';
}

class Game {
  constructor(sim) {
    this.sim = sim;
    this.B = FTC.BIOBUZZ;
    this.r = this.B.flower.pollenD / 2;
    const cfg = sim.cfg;
    this.capacity = cfg.capacity || 4;
    this.balls = [];
    this.hives = this.B.hives.map(h => ({ alliance: h.alliance, x: h.x, upEnd: h.upEnd, angle: h.upEnd * this.B.hiveTiltDeg, tips: 0, tipT: -1, from: 0 }));
    this.awards = { red: { leave: 0, park: 0 }, blue: { leave: 0, park: 0 } };
    this.lastShot = -1; this.lastPick = -1; this.lastEject = -1; this.feedRest = new Map();
    // pre-loads ride in the robot
    for (let i = 0; i < (cfg.preload == null ? 4 : cfg.preload); i++) this.add(STATE.held, 0, 0, 0);
    // GARDENS: 4 POLLEN in a row next to the tape
    for (const g of this.B.gardens) for (let k = 0; k < 4; k++) {
      const b = this.add(STATE.floor, g.x + (g.x < 0 ? 1 : -1) * (this.r + g.w / 2), g.y + (k - 1.5) * this.B.flower.pollenD, this.r);
      b.home = 'garden';
    }
    // FLOWERS: 4 POLLEN stacked in each tube
    this.B.flowers.forEach((f, fi) => { for (let k = 0; k < 4; k++) { const b = this.add(STATE.flower, f.x, f.y, 0); b.flower = fi; b.slot = k; } });
    this.placeFlowerBalls();
    this.events = [];
    this.hinted = false;
  }
  add(state, x, y, z) {
    const b = { id: this.balls.length, state, x, y, z, vx: 0, vy: 0, vz: 0 };
    this.balls.push(b);
    return b;
  }
  held() { return this.balls.filter(b => b.state === STATE.held); }
  log(msg) { this.sim.event('game', msg); }

  /* ---- devices by job */
  jobs() {
    const out = { intake: [], shooter: [], feeder: [] };
    for (const [name, dev] of this.sim.devices) {
      const d = this.sim.cfg.devices[name];
      if (!d || !d.job || d.job === 'none' || !out[d.job]) continue;
      out[d.job].push(dev);
    }
    return out;
  }
  motorPower(dev) {
    const k = dev.constructor.$kind;
    if (k === 'crservo') return dev.power;
    if (k === 'motor') return dev.mode && dev.mode.$name === 'RUN_TO_POSITION' ? Math.sign(dev.physVel) * Math.min(1, Math.abs(dev.physVel) / (dev.$vmax || 1)) : dev.getPower();
    return 0;
  }
  shooterFraction(dev) {
    const k = dev.constructor.$kind;
    if (k === 'motor') { const free = dev.$cfg.rpm / 60 * dev.$cfg.tpr; return Math.min(1.2, Math.abs(dev.physVel) / (free || 1)); }
    if (k === 'crservo') return Math.abs(dev.vel) / (2 * Math.PI * 1.5);
    return 0;
  }
  feederActive(dev) {
    const k = dev.constructor.$kind;
    if (k === 'servo') {
      if (!dev.pwm) return false;
      if (!this.feedRest.has(dev)) this.feedRest.set(dev, dev.act);   // first position seen is "rest"
      return Math.abs(dev.act - this.feedRest.get(dev)) > 0.15;
    }
    return this.motorPower(dev) > 0.2;
  }

  /* ---- per physics step */
  step(dt) {
    const sim = this.sim, t = sim.t, r = this.r;
    const rob = sim.robot, cfg = sim.cfg;
    const L = cfg.robotLength / 2, W = cfg.robotWidth / 2;
    const c = Math.cos(rob.h), s = Math.sin(rob.h);
    const toLocal = (x, y) => [(x - rob.x) * c + (y - rob.y) * s, -(x - rob.x) * s + (y - rob.y) * c];
    const toWorld = (lx, ly) => [rob.x + lx * c - ly * s, rob.y + lx * s + ly * c];
    const J = this.jobs();
    const intakePow = J.intake.reduce((m, d) => (Math.abs(this.motorPower(d)) > Math.abs(m) ? this.motorPower(d) : m), 0);
    const shooterF = J.shooter.reduce((m, d) => Math.max(m, this.shooterFraction(d)), 0);
    const ready = shooterF > 0.3;
    const feeding = J.feeder.length ? J.feeder.some(d => this.feederActive(d)) : intakePow > 0.2;
    const held = this.held();

    // intake: pick up floor POLLEN at the front of the robot
    if (intakePow > 0.2 && held.length < this.capacity && t - this.lastPick > 0.12) {
      for (const b of this.balls) {
        if (b.state !== STATE.floor || b.z > r + 1) continue;
        const [lx, ly] = toLocal(b.x, b.y);
        if (lx > L - 3 && lx < L + r + 2.5 && Math.abs(ly) < W - 1.5) {
          b.state = STATE.held; this.lastPick = t;
          this.log(`Picked up a POLLEN (holding ${held.length + 1})`);
          break;
        }
      }
      // FLOWERS release from the bottom when the intake is pressed against them
      if (this.held().length < this.capacity && t - this.lastPick > 0.4) {
        this.B.flowers.forEach((f, fi) => {
          const [lx, ly] = toLocal(f.x, f.y);
          if (lx > L - 1 && lx < L + this.B.flower.outerD && Math.abs(ly) < W) {
            const stack = this.balls.filter(b => b.state === STATE.flower && b.flower === fi).sort((a, b2) => a.slot - b2.slot);
            if (stack.length && t - this.lastPick > 0.4) {
              stack[0].state = STATE.held; this.lastPick = t;
              stack.slice(1).forEach(b => b.slot--);
              this.placeFlowerBalls();
              this.log('Took a POLLEN from a FLOWER');
            }
          }
        });
      }
    }
    // reversed intake spits a ball out the front
    if (intakePow < -0.2 && held.length && t - this.lastEject > 0.3) {
      const b = held[0]; const [x, y] = toWorld(L + r + 0.5, 0);
      Object.assign(b, { state: STATE.floor, x, y, z: r, vx: rob.vx + 25 * c, vy: rob.vy + 25 * s, vz: 0 });
      this.lastEject = t;
    }
    // launching
    if (ready && feeding && held.length && t - this.lastShot > (cfg.shotGap || 0.25)) {
      const b = held[0];
      const speed = (cfg.exitSpeed || 280) * Math.min(1, shooterF);
      const a = (cfg.launchDeg || 55) * Math.PI / 180;
      const [x, y] = toWorld(cfg.muzzleX == null ? 2 : cfg.muzzleX, 0);
      Object.assign(b, { state: STATE.air, x, y, z: cfg.muzzleZ || cfg.robotHeight || 14,
        vx: rob.vx + speed * Math.cos(a) * c, vy: rob.vy + speed * Math.cos(a) * s, vz: speed * Math.sin(a) });
      b.peak = b.z;
      this.lastShot = t;
      this.log(`Launched a POLLEN at ${Math.round(speed)} in/s (${Math.round(speed / 39.37 * 10) / 10} m/s)`);
    }

    // HIVE tipping: wait a moment, swing to the other stable position, spill the CELL that goes down
    this.hives.forEach((h, hi) => {
      if (h.tipT < 0 || t < h.tipT) return;
      const target = h.upEnd * this.B.hiveTiltDeg, before = h.angle;
      const d = target - h.angle;
      h.angle += Math.sign(d) * Math.min(Math.abs(d), TILT_RATE * dt);
      if (before * h.from > 0 && h.angle * h.from <= 0) this.spill(hi, h.from);
      if (h.angle === target) {
        h.tipT = -1; h.tips++;
        this.log(`The ${h.alliance} HIVE tipped (+${POINTS.tip})`);
      }
    });

    // ball physics
    const H = FTC.FIELD_HALF - r;
    for (const b of this.balls) {
      if (b.state === STATE.air) {
        const px = b.x, py = b.y, pz = b.z;
        // projectile motion, exact for each step (no air drag):
        //   x = x0 + v0 cos(theta) t        y = y0 + v0 sin(theta) t - 1/2 g t^2
        b.x += b.vx * dt; b.y += b.vy * dt;
        b.z += b.vz * dt - 0.5 * GRAV * dt * dt;
        b.vz -= GRAV * dt;
        if (this.checkCells(b, px, py, pz)) continue;
        if (Math.abs(b.x) > H) { b.x = Math.sign(b.x) * H; b.vx *= -0.35; }
        if (Math.abs(b.y) > H) { b.y = Math.sign(b.y) * H; b.vy *= -0.35; }
        if (b.peak != null) b.peak = Math.max(b.peak, b.z);
        if (b.z <= r) {
          b.z = r; b.vz = 0; b.vx *= 0.45; b.vy *= 0.45; b.state = STATE.floor;
          if (b.peak != null && b.peak < CELL_LOW_Z && !this.hinted) {
            this.hinted = true;
            this.log(`That POLLEN only got ${Math.round(b.peak)} in high, but the raised CELL opening is about 40 to 53 in up. Spin the flywheel faster or raise the launch angle.`);
          }
          b.peak = null;
        }
      } else if (b.state === STATE.floor) {
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 0) {
          const ns = Math.max(0, sp - 70 * dt);
          b.vx *= ns / sp; b.vy *= ns / sp;
          b.x += b.vx * dt; b.y += b.vy * dt;
          if (Math.abs(b.x) > H) { b.x = Math.sign(b.x) * H; b.vx *= -0.3; }
          if (Math.abs(b.y) > H) { b.y = Math.sign(b.y) * H; b.vy *= -0.3; }
        }
        // the robot body pushes balls out of the way (except at the intake)
        const [lx, ly] = toLocal(b.x, b.y);
        if (Math.abs(lx) < L + r && Math.abs(ly) < W + r && !(lx > L - 3 && intakePow > 0.2)) {
          const px = L + r - Math.abs(lx), py = W + r - Math.abs(ly);
          let nx = 0, ny = 0;
          if (px < py) nx = Math.sign(lx || 1) * px; else ny = Math.sign(ly || 1) * py;
          const [wx, wy] = [nx * c - ny * s, nx * s + ny * c];
          b.x += wx; b.y += wy;
          b.vx = rob.vx * 0.9; b.vy = rob.vy * 0.9;
        }
      }
    }
  }
  /* HIVE-local coordinates: x across, y along the HIVE (CELLs at +-y), z up from the pivot */
  hiveLocal(h, x, y, z) {
    const be = h.angle * Math.PI / 180, cb = Math.cos(be), sb = Math.sin(be), zz = z - this.B.frame.pivotZ;
    return [x - h.x, y * cb + zz * sb, -y * sb + zz * cb];
  }
  inUp(hi) { const h = this.hives[hi]; return this.balls.filter(b => b.state === STATE.cell && b.hive === hi && b.end === h.upEnd).length; }
  /* A CELL is a box 20 wide x 14 tall x 12 deep whose opening (20 x 14) is its outer end, facing out
     along the HIVE. On the raised end it faces out and up, so POLLEN shot in rolls to the back and stays;
     on the lowered end it faces out and down, so anything in it falls out. A ball that crosses the
     raised CELL's opening is scored; one that hits any other part of a CELL bounces off. */
  checkCells(b, px, py, pz) {
    const C = this.B.cell, half = C.gap / 2, r = this.r, out = half + C.d;
    for (let hi = 0; hi < this.hives.length; hi++) {
      const h = this.hives[hi];
      const a = this.hiveLocal(h, px, py, pz), n = this.hiveLocal(h, b.x, b.y, b.z);
      if (Math.abs(n[0]) > C.w / 2 + r) continue;
      for (const end of [-1, 1]) {
        const ay = a[1] * end, ny = n[1] * end;
        const inMouth = Math.abs(n[0]) < C.w / 2 - 0.4 && n[2] < -0.4 && n[2] > -C.h + 0.4;
        const up = end === h.upEnd && h.tipT < 0;
        if (up && inMouth && ay > out && ny <= out) {
          const k = this.balls.filter(q => q.state === STATE.cell && q.hive === hi && q.end === end).length;
          b.state = STATE.cell; b.hive = hi; b.end = end;
          // they roll to the back of the CELL: 5 across, rows toward the opening, then a layer up
          const row = Math.floor(k / 5) % 3, layer = Math.floor(k / 15);
          b.local = [((k % 5) - 2) * 3.6, end * (half + 0.5 + r + row * 2.9), -C.h + 0.4 + r + layer * 2.8];
          const count = k + 1;
          this.log(`POLLEN in the ${h.alliance} HIVE (${count} of ${TIP_AT} to tip)`);
          if (count >= TIP_AT) {
            h.from = h.upEnd; h.upEnd = -h.upEnd; h.tipT = this.sim.t + TIP_DELAY;
            this.log(`The ${h.alliance} HIVE is tipping`);
          }
          return true;
        }
        // solid parts: top, bottom, sides, back. The lowered CELL's opening also sends balls back out.
        const outer = inMouth ? out : out + r;      // through the opening, the ball reaches the opening plane itself
        const inBox = Math.abs(n[0]) < C.w / 2 + r && ny > half - r && ny < outer && n[2] < r && n[2] > -C.h - r;
        const wasIn = Math.abs(a[0]) < C.w / 2 + r && ay > half - r && ay < outer && a[2] < r && a[2] > -C.h - r;
        if (inBox && !wasIn) {
          b.x = px; b.y = py; b.z = pz;
          if (a[2] >= r || a[2] <= -C.h - r) {                        // hit the top or bottom
            b.vz = -b.vz * 0.3;
            if (Math.abs(b.vz) < 25) b.vx += (n[0] >= 0 ? 1 : -1) * 40;  // roll off instead of resting on the CELL
          }
          else if (Math.abs(a[0]) >= C.w / 2 + r) b.vx = -b.vx * 0.3; // hit a side
          else { b.vy = -b.vy * 0.3; b.vx *= 0.6; }                  // hit an end
          return true;
        }
      }
    }
    return false;
  }
  /* the CELL that swings down drops its POLLEN onto the field */
  spill(hi, end) {
    const h = this.hives[hi];
    let n = 0;
    for (const b of this.balls) {
      if (b.state !== STATE.cell || b.hive !== hi || b.end !== end) continue;
      // roll out through the opening, past the CELL's outer end
      const [ox, oy, oz] = this.cellBallWorld(Object.assign({}, b, { local: [b.local[0], end * (this.B.cell.gap / 2 + this.B.cell.d + this.r + 0.5), b.local[2]] }));
      Object.assign(b, { state: STATE.air, x: ox, y: oy, z: Math.max(oz, this.r), vx: (((b.id * 0.618) % 1) - 0.5) * 20, vy: end * (30 + ((b.id * 0.371) % 1) * 30), vz: -5 - ((b.id * 0.853) % 1) * 15, peak: null });
      n++;
    }
    if (n) this.log(`${n} POLLEN spilled out of the ${h.alliance} HIVE`);
  }
  placeFlowerBalls() {
    const F = this.B.flower;
    for (const b of this.balls) if (b.state === STATE.flower) {
      const f = this.B.flowers[b.flower];
      b.x = f.x; b.y = f.y; b.z = F.pollenD / 2 + 0.4 + b.slot * F.pollenD;
    }
  }
  /* world position of a ball sitting in a CELL (moves with the HIVE as it tips) */
  cellBallWorld(b) {
    const h = this.hives[b.hive], be = h.angle * Math.PI / 180, cb = Math.cos(be), sb = Math.sin(be);
    const [lx, ly, lz] = b.local;
    return [h.x + lx, ly * cb - lz * sb, this.B.frame.pivotZ + ly * sb + lz * cb];
  }

  /* ---- scoring */
  robotTouchesZone(z) {
    const cs = this.sim.corners(this.sim.robot.x, this.sim.robot.y, this.sim.robot.h);
    const x0 = z.x - z.w / 2, x1 = z.x + z.w / 2, y0 = z.y - z.d / 2, y1 = z.y + z.d / 2;
    if (cs.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) return true;
    const [lx, ly] = [(z.x - this.sim.robot.x), (z.y - this.sim.robot.y)];
    const c = Math.cos(-this.sim.robot.h), s = Math.sin(-this.sim.robot.h);
    return Math.abs(lx * c - ly * s) < this.sim.cfg.robotLength / 2 && Math.abs(lx * s + ly * c) < this.sim.cfg.robotWidth / 2;
  }
  award(alliance, kind) {
    const a = this.awards[alliance];
    if (kind === 'leave') a.leave = POINTS.leave;
    if (kind === 'park') a.park += POINTS.park;
  }
  /* end of AUTO and end of match checks for our robot */
  checkLeave(alliance, start) {
    const r = this.sim.robot;
    if (Math.hypot(r.x - start.x, r.y - start.y) > 3) { this.award(alliance, 'leave'); return true; }
    return false;
  }
  checkPark(alliance) {
    const z = this.B.loadingZones.find(q => q.alliance === alliance);
    if (z && this.robotTouchesZone(z)) { this.award(alliance, 'park'); return true; }
    return false;
  }
  score() {
    const out = {};
    for (const al of ['red', 'blue']) {
      const h = this.hives.find(q => q.alliance === al);
      const upBalls = this.balls.filter(b => b.state === STATE.cell && b.hive === this.hives.indexOf(h) && b.end === h.upEnd).length;
      const g = this.B.gardens.find(q => q.alliance === al);
      const garden = this.balls.filter(b => b.state === STATE.floor && Math.abs(b.x - g.x) <= g.w / 2 + this.r + 1 && Math.abs(b.y - g.y) <= g.d / 2).length;
      const a = this.awards[al];
      const parts = { tips: h.tips * POINTS.tip, cells: upBalls * POINTS.upCellBall, garden: garden * POINTS.garden, leave: a.leave, park: a.park };
      out[al] = { total: parts.tips + parts.cells + parts.garden + parts.leave + parts.park, parts, tipCount: h.tips, inUp: upBalls, toTip: Math.max(0, TIP_AT - upBalls), tipping: h.tipT >= 0 };
    }
    out.holding = this.held().length;
    return out;
  }

  /* ---- snapshots for replay: x, y, z, state per ball + hive angles + score */
  snapshot() {
    const n = this.balls.length, a = new Float32Array(n * 4);
    this.balls.forEach((b, i) => {
      let p = [b.x, b.y, b.z];
      if (b.state === STATE.cell) p = this.cellBallWorld(b);
      a[i * 4] = p[0]; a[i * 4 + 1] = p[1]; a[i * 4 + 2] = p[2]; a[i * 4 + 3] = b.state;
    });
    return { balls: a, angles: this.hives.map(h => h.angle), score: this.score() };
  }
}

FTC.Game = Game;
FTC.GAME_STATE = STATE;
FTC.GAME_POINTS = POINTS;
FTC.TIP_AT = TIP_AT;

/* Shot calculator. From the launch point, the target (center of a raised CELL opening) is a horizontal
   distance x away and dy higher. A ball launched at angle theta (from the ground) passes through it when
       dy = x tan(theta) - g x^2 / (2 v0^2 cos^2(theta))
   so the launch speed it needs is
       v0 = sqrt( g x^2 / (2 cos^2(theta) (x tan(theta) - dy)) )
   pose: {x, y, h (radians)}; angles: each HIVE's tilt in degrees. */
FTC.shotSolve = (cfg, pose, angles, shooterFree) => {
  const B = FTC.BIOBUZZ, C = B.cell, half = C.gap / 2;
  const th = (cfg.launchDeg || 55) * Math.PI / 180;
  const c = Math.cos(pose.h), s = Math.sin(pose.h), mx = cfg.muzzleX == null ? 2 : cfg.muzzleX;
  const lx = pose.x + mx * c, ly = pose.y + mx * s, lz = cfg.muzzleZ || cfg.robotHeight || 14;
  let best = null;
  B.hives.forEach((hv, i) => {
    const ang = angles ? angles[i] : 0, up = ang > 0 ? 1 : -1;
    const be = ang * Math.PI / 180, cb = Math.cos(be), sb = Math.sin(be);
    const ly0 = up * (half + C.d), lz0 = -C.h / 2;                      // opening center, HIVE-local
    const tx = hv.x, ty = ly0 * cb - lz0 * sb, tz = B.frame.pivotZ + ly0 * sb + lz0 * cb;
    const facing = (ly - ty) * up > 0;                                   // on the side the opening faces
    const x = Math.hypot(tx - lx, ty - ly), dy = tz - lz;
    const cand = { alliance: hv.alliance, x, dy, tz, facing, bearing: Math.atan2(ty - ly, tx - lx) };
    if (!best || (cand.facing && !best.facing) || (cand.facing === best.facing && x < best.x)) best = cand;
  });
  const den = 2 * Math.cos(th) ** 2 * (best.x * Math.tan(th) - best.dy);
  best.v0 = den > 0 ? Math.sqrt(GRAV * best.x * best.x / den) : null;    // null: angle too low to get there
  best.theta = th;
  best.turn = ((best.bearing - pose.h) * 180 / Math.PI + 540) % 360 - 180;
  best.rising = best.v0 != null && 2 * best.dy / best.x > Math.tan(th);  // still going up when it arrives
  if (best.v0 != null) {
    best.fraction = best.v0 / (cfg.exitSpeed || 280);
    if (shooterFree) best.ticks = best.fraction * shooterFree;
  }
  return best;
};
FTC.guessJob = guessJob;
if (typeof module !== 'undefined' && module.exports) module.exports = FTC;
})(typeof globalThis !== 'undefined' ? globalThis : window);
