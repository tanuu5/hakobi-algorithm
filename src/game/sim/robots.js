// 人型ロボ：自分で仕事を探して、荷物をドローンポートまで運ぶ。ラベルが読めない荷物も自分で読める（柔軟さ）。
// バッテリーが減ったら充電ステーションへ行く。
//
// 仕事の元：入荷口の待ち行列・棚・ラベル機の出口・ベルトの行き止まり・床に落ちた荷物
// 行き先：宛先の合うドローンポート（空きを予約してから向かう）
//
// 歩き方：
// - ベルトの上はできるだけ歩かない（道の重さを大きくしてある。回り道がとても長いときや、ほかに道がないときだけ越える）
// - 1 マスに 1 台。次のマスに入る前に予約し、ほかのロボがいれば待つ。手の空いたロボには、どいてもらう
// - 少し待ったら、よけて通る道を探す。それでも長く待ったら、重なってすり抜ける（止まったままにしない）
// - 手が空いたら、ベルトの上やほかのロボと同じマスから、近くの空いた床へよける
import { DX, DY, W, H } from './consts.js';

const LOW = 25;             // これより減ったら充電に行く
const CHARGE_RATE = 7.5;    // %/秒
const DRAIN = { move: 0.85, carry: 0.15, work: 0.4, idle: 0.04 };
const N = W * H;
const AVOID_T = 0.45;       // これだけ待ったら、よけて通る道を探す
const PASS_T = 2.4;         // これより長く待ったら、重なってもすり抜ける
const CROWD_STAND = 14;     // 立ち止まっているロボのマスを通る重さ
const CROWD_GOAL = 5;       // ほかのロボが向かっているマス（行き先を散らす）

export class RobotSystem {
  constructor(w) {
    this.w = w;
    this.cost = new Float32Array(N);
    this.costVer = -1;
    this.dispT = 0;
    this.nextNo = 1;
    this.unreach = new Map();
    // A* の作業用
    this.g = new Float32Array(N);
    this.came = new Int32Array(N);
    this.seen = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    this.stampN = 0;
    this.heap = [];
  }

  get list() { return this.w.robots; }

  clear() { this.w.robots.length = 0; this.nextNo = 1; }

  add(x, y) {
    const r = {
      id: 'r' + this.nextNo, no: this.nextNo++, x, y, ang: Math.PI / 2, st: 'idle', path: null, pi: 0, goal: null,
      carry: [], bat: 100, job: null, t: 0, chg: null, idleT: 0, moving: false, walk: 0, holdT: 0,
      cur: Math.round(y) * W + Math.round(x), resv: -1, waitT: 0, avoided: false, asideFrom: null,
    };
    this.list.push(r);
    return r;
  }

  removeRobot(r) {
    this._cancel(r);
    if (r.carry.length && r.job?.pad && !r.job.pad.gone) r.job.pad.res = Math.max(0, r.job.pad.res - r.carry.length);
    for (const p of r.carry) this.w._toFloor(p, Math.round(r.x), Math.round(r.y));
    r.carry = [];
    this._leaveCharger(r);
    const i = this.list.indexOf(r);
    if (i >= 0) this.list.splice(i, 1);
    r.gone = true;
  }

  newDay() {
    for (const r of this.list) {
      r.bat = 100; r.st = 'idle'; r.job = null; r.carry = []; r.path = null; r.goal = null; r.chg = null; r.t = 0; r.idleT = 0;
      r.x = Math.round(r.x); r.y = Math.round(r.y); r.cur = r.y * W + r.x; r.resv = -1; r.waitT = 0; r.asideFrom = null;
    }
    for (const c of this.w.buildings) if (c.type === 'charger') { c.user = null; c.resBy = null; }
    this.unreach.clear();
  }

  chargerGone(c) {
    for (const r of this.list) if (r.chg === c) { r.chg = null; r.st = r.carry.length ? 'hold' : 'idle'; r.path = null; }
  }

  // ------------------------------------------------------------------ 道
  _updateCost() {
    const w = this.w;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) this.cost[y * W + x] = w.walkCost(x, y);
  }

  /** 歩けるマスか。 */
  walkable(i) { return this.cost[i] < Infinity; }

  /** (sx, sy) から goals（マスの番号の配列）のどれかへの道。[] ならもう着いている、null なら行けない。
   *  extra(i)：そのマスに足す重さ（ほかのロボを避ける。Infinity なら通らない） */
  findPath(sx, sy, goals, extra = null) {
    if (!goals.length) return null;
    const start = sy * W + sx;
    if (goals.includes(start)) return [];
    const st = ++this.stampN;
    const { g, came, seen, closed, cost } = this;
    const gx = goals.map((i) => i % W), gy = goals.map((i) => (i / W) | 0);
    const hfn = (i) => {
      const x = i % W, y = (i / W) | 0;
      let m = Infinity;
      for (let k = 0; k < gx.length; k++) { const d = Math.abs(x - gx[k]) + Math.abs(y - gy[k]); if (d < m) m = d; }
      return m;
    };
    const goalSet = new Set(goals);
    const heap = this.heap;
    heap.length = 0;
    g[start] = 0; seen[start] = st; came[start] = -1;
    heapPush(heap, start, hfn(start));
    let guard = 0;
    while (heap.length && guard++ < N * 4) {
      const cur = heapPop(heap);
      if (closed[cur] === st) continue;
      closed[cur] = st;
      if (goalSet.has(cur)) {
        const path = [];
        for (let i = cur; i !== start; i = came[i]) path.push(i);
        return path.reverse();
      }
      const cx = cur % W, cy = (cur / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d], ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        let c = cost[ni];
        if (c === Infinity) continue;
        if (extra) { c += extra(ni); if (c === Infinity) continue; }
        const ng = g[cur] + c;
        if (seen[ni] !== st || ng < g[ni]) {
          seen[ni] = st; g[ni] = ng; came[ni] = cur;
          heapPush(heap, ni, ng + hfn(ni));
        }
      }
    }
    return null;
  }

  /** そのマスのまわりで、歩けるマス（立って作業できる所）。self：そのマス自身も入れる。 */
  around(x, y, self = false) {
    const out = [];
    if (self && this.walkable(y * W + x)) out.push(y * W + x);
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const i = ny * W + nx;
      if (this.walkable(i)) out.push(i);
    }
    return out;
  }

  /** ほかのロボを避けるための重さ。立ち止まっているロボのマスは重く、ほかのロボの行き先も少し重く。 */
  _crowd(r) {
    const m = new Map();
    const add = (i, v) => { if (i >= 0) m.set(i, (m.get(i) || 0) + v); };
    for (const q of this.list) {
      if (q === r) continue;
      const still = !q.path || q.pi >= q.path.length || q.waitT > 0;
      add(q.cur, still ? CROWD_STAND : 2);
      if (q.resv >= 0) add(q.resv, 3);
      if (q.path && q.path.length && q.pi < q.path.length) add(q.path[q.path.length - 1], CROWD_GOAL);
    }
    return m.size ? (i) => m.get(i) || 0 : null;
  }

  _go(r, goals, extra = this._crowd(r)) {
    // 次のマスへ向かっている途中なら、そのマスまでは行ってから新しい道へ
    let sx = Math.round(r.x), sy = Math.round(r.y), prefix = null;
    if (r.resv >= 0) { sx = r.resv % W; sy = (r.resv / W) | 0; prefix = r.resv; }
    const path = this.findPath(sx, sy, goals, extra);
    r.goal = goals;
    r.path = path ? (prefix !== null ? [prefix, ...path] : path) : null;
    r.pi = 0;
    r.waitT = 0;
    r.avoided = false;
    return path !== null;
  }

  /** i のマスにいる・入ろうとしている、ほかのロボ。 */
  _occupant(i, r) {
    for (const q of this.list) if (q !== r && (q.cur === i || q.resv === i)) return q;
    return null;
  }

  // ------------------------------------------------------------------ 1 コマ
  step(dt) {
    const w = this.w;
    if (this.costVer !== w.layoutVer) {
      this._updateCost();
      this.costVer = w.layoutVer;
      for (const r of this.list) if (r.goal && r.path) r.repath = true;
    }
    this.dispT -= dt;
    if (this.dispT <= 0) { this.dispT = 0.25; this._dispatch(); }
    for (const r of this.list) this._update(r, dt);
  }

  _update(r, dt) {
    const w = this.w;
    const perf = w.perf();
    r.t += dt;
    r.moving = false;
    if (w.running) {
      w.stats.robotT += dt;
      if (r.st !== 'idle' && r.st !== 'charging' && r.st !== 'chgWait' && r.st !== 'toChg') w.stats.robotBusy += dt;
    }
    const drain = (k) => { r.bat = Math.max(0, r.bat - (DRAIN[k] * dt) / perf.battery); };
    switch (r.st) {
      case 'idle':
        r.idleT += dt;
        drain('idle');
        if (r.bat < LOW) this._goCharge(r);
        else if (r.idleT > 5 && r.bat < 70) this._goCharge(r, true);
        // ベルトや機械の上、ほかのロボと同じマスにいたら、近くの空いた床へよける（0.8 秒ごとに見る）
        else if ((r.tidyT = (r.tidyT || 0) + dt) > 0.8) { r.tidyT = 0; this._tidy(r); }
        break;
      case 'aside':
        if (this._move(r, dt) || !r.path) { r.st = r.asideFrom || 'idle'; r.asideFrom = null; r.path = null; r.idleT = 0; }
        break;
      case 'toSrc':
        if (this._move(r, dt)) {
          if (this._jobValid(r)) { r.st = 'pick'; r.t = 0; this._face(r, r.job.sx, r.job.sy); }
          else this._cancel(r);
        }
        break;
      case 'pick':
        drain('work');
        if (r.t >= 0.45) {
          if (!this._jobValid(r)) { this._cancel(r); break; }
          for (const p of r.job.pkgs) { this._takeFrom(r.job, p); p.where = 'robot'; p.host = r; }
          r.carry = r.job.pkgs;
          w.emit('pick', { r });
          if (r.carry.some((p) => p.unk)) { r.st = 'read'; r.t = 0; }
          else this._toPad(r);
        }
        break;
      case 'read':
        drain('work');
        if (r.t >= 1.0) {
          for (const p of r.carry) if (p.unk) { p.unk = false; w.stats.robotRelabel++; }
          w.emit('robotRead', { r });
          this._toPad(r);
        }
        break;
      case 'toDst':
        if (!r.job?.pad || r.job.pad.gone) { this._retarget(r); break; }
        if (this._move(r, dt)) { r.st = 'drop'; r.t = 0; this._face(r, r.job.pad.x, r.job.pad.y); }
        break;
      case 'drop':
        drain('work');
        if (r.t >= 0.4) {
          const pad = r.job.pad;
          if (!pad || pad.gone) { this._retarget(r); break; }
          for (const p of r.carry) {
            pad.res = Math.max(0, pad.res - 1);
            pad.store.push(p); p.where = 'pad'; p.host = pad; p.res = null;
          }
          r.carry = [];
          r.job = null;
          w.emit('drop', { r, b: pad });
          r.st = 'idle'; r.idleT = 0;
          if (r.bat < LOW) this._goCharge(r);
        }
        break;
      case 'hold':
        r.holdT += dt;
        drain('idle');
        if (r.holdT > 1 && r.holdT % 3 < dt) this._tidy(r);
        break;
      case 'toChg':
        if (!r.chg || r.chg.gone) { r.chg = null; r.st = 'idle'; break; }
        if (this._move(r, dt)) {
          const c = r.chg;
          if (!c.user && (c.resBy === r || !c.resBy)) { c.resBy = r; c.user = r; r.st = 'charging'; r.x = c.x; r.y = c.y; r.cur = c.y * W + c.x; r.resv = -1; w.emit('charge', { r }); }
          else r.st = 'chgWait';
        }
        break;
      case 'chgWait': {
        const c = r.chg;
        if (!c || c.gone) { r.chg = null; r.st = 'idle'; break; }
        drain('idle');
        if (!c.user && (!c.resBy || c.resBy === r)) { c.resBy = r; r.st = 'toChg'; this._go(r, [c.y * W + c.x], null); }
        break;
      }
      case 'charging': {
        const c = r.chg;
        if (!c || c.gone) { r.chg = null; r.st = 'idle'; break; }
        r.bat = Math.min(100, r.bat + CHARGE_RATE * dt);
        if (r.bat >= 100) { this._leaveCharger(r); r.st = 'idle'; r.idleT = 0; }
        break;
      }
    }
  }

  /** 道に沿って進む。着いたら true。次のマスにほかのロボがいれば待つ（よける・すり抜けるは _blocked）。 */
  _move(r, dt) {
    const w = this.w;
    if (r.repath) {
      r.repath = false;
      if (r.goal && !this._go(r, r.goal)) { r.path = null; }
    }
    if (!r.path) {
      // 行けない：少し待ってからもう一度探す
      r.stuck = (r.stuck || 0) + dt;
      if (r.stuck > 1 && r.goal) { r.stuck = 0; if (!this._go(r, r.goal) && r.st === 'toSrc') this._cancel(r); }
      return false;
    }
    r.stuck = 0;
    if (r.pi >= r.path.length) return true;
    const perf = w.perf();
    const under = w.grid[Math.round(r.y) * W + Math.round(r.x)];
    const slow = under && (under.type === 'belt' || under.type === 'sorter' || under.type === 'junction') ? 0.45 : 1;
    const sp = perf.robotSpeed * slow * (r.bat <= 0 ? 0.35 : 1);
    let left = sp * dt;
    let moved = false;
    while (left > 1e-6 && r.pi < r.path.length) {
      const i = r.path[r.pi];
      if (r.resv !== i && r.cur !== i) {
        const q = this._occupant(i, r);
        if (q && r.waitT < PASS_T) { this._blocked(r, q, i, dt); break; }
        r.resv = i; r.waitT = 0; r.avoided = false;
      }
      const tx = i % W, ty = (i / W) | 0;
      const dx = tx - r.x, dy = ty - r.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) r.ang = Math.atan2(dy, dx);
      if (d <= left) { r.x = tx; r.y = ty; left -= d; r.pi++; r.cur = i; r.resv = -1; }
      else { r.x += (dx / d) * left; r.y += (dy / d) * left; left = 0; }
      moved = true;
    }
    if (moved) {
      r.moving = true;
      r.walk += sp * dt;
      r.bat = Math.max(0, r.bat - ((DRAIN.move + (r.carry.length ? DRAIN.carry : 0)) * dt) / perf.battery);
    }
    return r.pi >= r.path.length;
  }

  /** 次のマス i に、ほかのロボ q がいる。待つ・どいてもらう・よけて通る。 */
  _blocked(r, q, i, dt) {
    r.waitT += dt;
    // 手の空いているロボ（仕事を待っている・ポートを待っている）には、どいてもらう
    if ((q.st === 'idle' || q.st === 'hold') && (!q.path || q.pi >= q.path.length)) this._yield(q, r);
    // 少し待ったら、そのマスを通らない道を探す（ほかに行き先のマスがあれば、そちらへ）
    if (r.waitT > AVOID_T && !r.avoided && r.goal) {
      r.avoided = true;
      const crowd = this._crowd(r);
      const sx = r.cur % W, sy = (r.cur / W) | 0;
      const rest = r.path.length - r.pi;
      const alt = this.findPath(sx, sy, r.goal, (k) => (k === i ? Infinity : crowd ? crowd(k) : 0));
      if (alt && alt.length && alt.length <= rest + 8) { r.path = alt; r.pi = 0; r.waitT = 0; r.avoided = false; }
    }
  }

  /** 立ち止まっている q に、r の通り道からどいてもらう（となりの空いたマスへ。なければそのまま）。 */
  _yield(q, r) {
    const ahead = new Set(r.path ? r.path.slice(r.pi, r.pi + 4) : []);
    const cx = q.cur % W, cy = (q.cur / W) | 0;
    let best = -1, bs = Infinity;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const k = ny * W + nx;
      const c = this.cost[k];
      if (c === Infinity || ahead.has(k) || k === r.cur || this._occupant(k, q)) continue;
      if (c < bs) { bs = c; best = k; }
    }
    if (best < 0) return false;
    this._aside(q, [best]);
    return true;
  }

  /** よける：path の先へ動いて、終わったら元の状態に戻る。 */
  _aside(q, path) {
    if (q.st !== 'aside') q.asideFrom = q.st;
    q.st = 'aside';
    q.path = path;
    q.pi = 0;
    q.goal = [path[path.length - 1]];
    q.waitT = 0;
  }

  /** 手の空いたロボ：ベルト・機械の上や、ほかのロボと同じマスにいたら、近くの空いた床へ。 */
  _tidy(r) {
    const c = this.cost[r.cur];
    const onThing = c > 1.5;  // ベルト・充電器・機械の上（床は 1）
    const shared = this.list.some((q) => q !== r && q.cur === r.cur);
    if (!onThing && !shared) return;
    // 近い順に、床で、だれもいない・向かっていないマスを探す
    const seen = new Set([r.cur]);
    const queue = [r.cur];
    const goals = new Set();
    for (const q of this.list) if (q !== r && q.path && q.pi < q.path.length) goals.add(q.path[q.path.length - 1]);
    while (queue.length) {
      const i = queue.shift();
      const x = i % W, y = (i / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = ny * W + nx;
        if (seen.has(k) || this.cost[k] === Infinity) continue;
        seen.add(k);
        if (Math.abs(nx - r.x) + Math.abs(ny - r.y) > 7) continue;
        if (this.cost[k] <= 1.5 && !this._occupant(k, r) && !goals.has(k)) {
          const path = this.findPath(Math.round(r.x), Math.round(r.y), [k], this._crowd(r));
          if (path && path.length) this._aside(r, path);
          return;
        }
        queue.push(k);
      }
    }
  }

  _face(r, x, y) { const dx = x - r.x, dy = y - r.y; if (dx || dy) r.ang = Math.atan2(dy, dx); }

  // ------------------------------------------------------------------ 仕事
  _jobValid(r) {
    const j = r.job;
    if (!j) return false;
    for (const p of j.pkgs) {
      if (p.res !== r) return false;
      if (j.kind === 'floor') { if (p.where !== 'floor') return false; }
      else if (p.host !== j.src || j.src.gone) return false;
    }
    return true;
  }

  _takeFrom(j, p) {
    const w = this.w;
    let list;
    if (j.kind === 'floor') list = w.floor;
    else if (j.kind === 'belt') list = j.src.lanes[p.lane];
    else if (j.kind === 'dock') list = j.src.queue;
    else if (j.kind === 'shelf') list = j.src.store;
    else if (j.kind === 'labeler') list = j.src.outQ;
    const i = list ? list.indexOf(p) : -1;
    if (i >= 0) list.splice(i, 1);
  }

  _cancel(r) {
    const j = r.job;
    if (j) {
      for (const p of j.pkgs) if (p.res === r && !r.carry.includes(p)) p.res = null;
      if (j.pad && !r.carry.length) j.pad.res = Math.max(0, j.pad.res - j.pkgs.length);
    }
    if (!r.carry.length) { r.job = null; r.st = 'idle'; r.idleT = 0; r.path = null; r.goal = null; }
  }

  _toPad(r) {
    const j = r.job;
    if (!j.pad || j.pad.gone) { this._retarget(r); return; }
    const goals = this.around(j.pad.x, j.pad.y);
    if (!this._go(r, goals)) { r.st = 'toDst'; return; }
    r.st = 'toDst';
  }

  /** 運んでいる途中でポートが無くなった：別のポートを探す。無ければ持ったまま待つ。 */
  _retarget(r) {
    const pad = this._padFor(r.carry[0], Math.round(r.x), Math.round(r.y), r.carry.length);
    if (r.job?.pad && !r.job.pad.gone) r.job.pad.res = Math.max(0, r.job.pad.res - r.carry.length);
    if (!pad) { r.st = 'hold'; r.holdT = 0; r.path = null; if (r.job) r.job.pad = null; return; }
    pad.res += r.carry.length;
    if (!r.job) r.job = { pkgs: r.carry, kind: 'held' };
    r.job.pad = pad;
    this._toPad(r);
  }

  _padFor(p, x, y, n = 1) {
    if (!p) return null;
    const perf = this.w.perf();
    let best = null, bd = Infinity;
    for (const pad of this.w.lists.pads) {
      if (pad.cfg.dest !== p.dest) continue;
      if (perf.padCap - pad.store.length - pad.res < n) continue;
      const d = Math.abs(pad.x - x) + Math.abs(pad.y - y);
      if (d < bd) { bd = d; best = pad; }
    }
    return best;
  }

  _goCharge(r, topUp = false) {
    const cs = this.w.lists.chargers;
    if (!cs.length) { if (!topUp) { r.noChg = true; r.idleT = 0; } return; }
    r.noChg = false;
    let best = null, bd = Infinity, bestFree = null, bfd = Infinity;
    for (const c of cs) {
      const d = Math.abs(c.x - r.x) + Math.abs(c.y - r.y);
      if (d < bd) { bd = d; best = c; }
      if (!c.resBy && !c.user && d < bfd) { bfd = d; bestFree = c; }
    }
    if (topUp && !bestFree) { r.idleT = 0; return; }
    const c = bestFree || best;
    r.chg = c;
    if (c === bestFree) { c.resBy = r; this._go(r, [c.y * W + c.x], null); }
    else this._go(r, this.around(c.x, c.y));
    r.st = 'toChg';
    r.idleT = 0;
  }

  _leaveCharger(r) {
    const c = r.chg;
    if (c) { if (c.user === r) c.user = null; if (c.resBy === r) c.resBy = null; }
    r.chg = null;
  }

  /** 仕事の候補を集める（予約されていない荷物と、その行き先のポート）。 */
  _candidates() {
    const w = this.w;
    const out = [];
    const now = w.t;
    const add = (p, kind, src, x, y) => {
      if (p.res) return;
      const key = kind === 'floor' ? 'f' + p.tile : src.id;
      const u = this.unreach.get(key);
      if (u && u > now) return;
      let prio = 0;
      if (p.exp) prio += 14 + Math.max(0, 30 - (p.dl - now));
      if (kind === 'floor' || kind === 'belt') prio += 4;
      prio += Math.min(10, (now - p.born) * 0.08);
      out.push({ p, kind, src, x, y, key, prio });
    };
    for (const d of w.lists.docks) if (d.cfg.collect) for (const p of d.queue) add(p, 'dock', d, d.x, d.y);
    for (const s of w.lists.shelves) if (s.cfg.collect !== false) for (const p of s.store) add(p, 'shelf', s, s.x, s.y);
    for (const l of w.lists.labelers) for (const p of l.outQ) add(p, 'labeler', l, l.x, l.y);
    for (const b of w.lists.belts) {
      for (const L of b.lanes) {
        const p = L[0];
        if (!p || p.pos < 0.98) continue;
        const t = b.nb[p.exit];
        // 行き止まり（先に何もない・入れない）で止まっているものだけ
        const dead = !t || (t.type !== 'pad' && t.type !== 'shelf' && t.type !== 'labeler' && !((t.type === 'belt' || t.type === 'sorter' || t.type === 'junction') && canEnterSimple(t, (p.exit + 2) & 3)));
        if (dead) add(p, 'belt', b, b.x, b.y);
      }
    }
    for (const p of w.floor) add(p, 'floor', null, p.tile % W, (p.tile / W) | 0);
    return out;
  }

  _dispatch() {
    const w = this.w;
    const perf = w.perf();
    // 持ったまま待っているロボ：ポートができたら向かう
    for (const r of this.list) if (r.st === 'hold' && r.carry.length) this._retarget(r);
    const idle = this.list.filter((r) => r.st === 'idle' && r.bat >= LOW);
    if (!idle.length) return;
    const cands = this._candidates();
    if (!cands.length) return;
    // ポートの空き
    const free = new Map();
    for (const pad of w.lists.pads) free.set(pad, perf.padCap - pad.store.length - pad.res);
    const padOf = (c) => {
      let best = null, bd = Infinity;
      for (const pad of w.lists.pads) {
        if (pad.cfg.dest !== c.p.dest || free.get(pad) <= 0) continue;
        const d = Math.abs(pad.x - c.x) + Math.abs(pad.y - c.y);
        if (d < bd) { bd = d; best = pad; }
      }
      c.pad = best; c.padD = bd;
      return best;
    };
    const pairs = [];
    for (const c of cands) {
      if (!padOf(c)) continue;
      for (const r of idle) pairs.push({ r, c, cost: Math.abs(r.x - c.x) + Math.abs(r.y - c.y) + c.padD * 0.6 - c.prio });
    }
    pairs.sort((a, b) => a.cost - b.cost);
    const usedR = new Set(), usedP = new Set();
    for (const { r, c } of pairs) {
      if (usedR.has(r) || usedP.has(c.p)) continue;
      let pad = c.pad;
      if (free.get(pad) <= 0) { pad = padOf(c); if (!pad) continue; }
      const goals = this.around(c.x, c.y, c.kind === 'floor');
      if (!this._go(r, goals)) { this.unreach.set(c.key, w.t + 3); r.goal = null; continue; }
      const pkgs = [c.p];
      usedP.add(c.p);
      free.set(pad, free.get(pad) - 1);
      // 2 個持ち：同じ所から、同じポートへ行くものをもう 1 つ
      if (perf.robotCarry > 1) {
        for (const o of cands) {
          if (pkgs.length >= perf.robotCarry || free.get(pad) <= 0) break;
          if (o === c || usedP.has(o.p) || o.src !== c.src || o.kind !== c.kind || o.p.dest !== c.p.dest) continue;
          if (o.kind === 'floor' && o.p.tile !== c.p.tile) continue;
          pkgs.push(o.p); usedP.add(o.p); free.set(pad, free.get(pad) - 1);
        }
      }
      for (const p of pkgs) p.res = r;
      pad.res += pkgs.length;
      r.job = { pkgs, kind: c.kind, src: c.src, sx: c.x, sy: c.y, pad };
      r.st = 'toSrc';
      r.idleT = 0;
      usedR.add(r);
    }
  }
}

function canEnterSimple(t, side) {
  if (t.type === 'belt') return t.dir !== side;
  if (t.type === 'sorter') return side === ((t.dir + 2) & 3);
  return true;
}

// ---- 二分ヒープ（[番号, 優先度] を平らな配列に）
function heapPush(h, i, f) {
  h.push([i, f]);
  let k = h.length - 1;
  while (k > 0) {
    const pk = (k - 1) >> 1;
    if (h[pk][1] <= h[k][1]) break;
    [h[pk], h[k]] = [h[k], h[pk]];
    k = pk;
  }
}
function heapPop(h) {
  const top = h[0][0];
  const last = h.pop();
  if (h.length) {
    h[0] = last;
    let k = 0;
    for (;;) {
      const l = 2 * k + 1, r = l + 1;
      let m = k;
      if (l < h.length && h[l][1] < h[m][1]) m = l;
      if (r < h.length && h[r][1] < h[m][1]) m = r;
      if (m === k) break;
      [h[m], h[k]] = [h[k], h[m]];
      k = m;
    }
  }
  return top;
}
