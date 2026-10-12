// 物流センターのシミュレーション本体（THREE に依存しない）。
//
//   const w = new World();
//   w.setupDay(1, layout)   その日の区画・入荷口・トラックの予定を用意する（計画の時間。まだ動かない）
//   w.begin()               業務開始（トラックが来はじめる）
//   w.step(dt)              dt 秒進める（描画はしない）。出来事は w.events に積む（Game が取り出して音や UI に回す）
//   w.build(type, x, y, dir, cfg) / w.remove(x, y) / w.hire() / w.fire(robot)
//   w.serialize() / w.load(data)
//
// 荷物の居場所（p.where）：truck → dock → belt / arm / shelf / labeler / robot / floor → pad → drone（出荷で消える）
import {
  DX, DY, opp, leftOf, rightOf, W, H, DAY_LEN, SP, ARM_GAP, EXP_TIME,
  DEFS, BASE, UPGRADES, PRICE, ROBOT_COST, ROBOT_OPEX,
} from './consts.js';
import { ZONES, DOCKS, dayDef, buildSchedule, toolsUntil } from './days.js';
import { RobotSystem } from './robots.js';

const isBelt = (b) => !!b && (b.type === 'belt' || b.type === 'sorter' || b.type === 'junction');

/** その面から荷物が入れるか（ベルトの仲間）。side は入る側の面（荷物が来た方向）。 */
export function canEnter(b, side) {
  if (b.type === 'belt') return b.dir !== side;
  if (b.type === 'sorter') return side === opp(b.dir);
  if (b.type === 'junction') return true;
  return false;
}
const laneOf = (b, side) => (b.type === 'junction' ? side & 1 : 0);
const minPos = (b, lane) => { const L = b.lanes[lane]; return L.length ? L[L.length - 1].pos : Infinity; };

/** フィルターに合うか。'alt' は呼び出し側で扱う。 */
export function matchFilter(f, p) {
  if (f === 'any') return true;
  if (typeof f === 'number') return !p.unk && p.dest === f;
  if (f === 'exp') return !!p.exp;
  if (f === 'unk') return !!p.unk;
  return false;
}

export class World {
  constructor() {
    this.W = W;
    this.H = H;
    this.grid = new Array(W * H).fill(null);
    this.wall = new Uint8Array(W * H);
    this.locked = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x === 0 || y === 0 || x === W - 1 || y === H - 1) this.wall[y * W + x] = 1;
    this.buildings = [];
    this.nextId = 1;
    this.packages = new Set();
    this.floor = [];
    this.robots = [];
    this.events = [];
    this.layoutVer = 0;
    this.upg = Object.fromEntries(Object.keys(UPGRADES).map((k) => [k, 0]));
    this.money = 1500;
    this.day = 1;
    this.def = null;
    this.t = 0;
    this.tick = 0;
    this.running = false;
    this.ended = false;
    this.free = false;          // true：お金を使わない（タイトルの見本・確認用）
    this.tools = toolsUntil(1);
    this.lists = { belts: [], arms: [], pads: [], shelves: [], labelers: [], chargers: [], docks: [] };
    this.roots = [];
    this.stamp = 0;
    this._perf = null;
    this.rs = new RobotSystem(this);
    this.resetStats();
  }

  // ------------------------------------------------------------------ 基本
  idx(x, y) { return y * W + x; }
  inside(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
  at(x, y) { return this.inside(x, y) ? this.grid[y * W + x] : null; }
  emit(type, e = {}) { this.events.push({ type, ...e }); }

  /** アップグレードを入れた性能。 */
  perf() {
    if (this._perf) return this._perf;
    const p = { ...BASE };
    for (const [k, lv] of Object.entries(this.upg)) if (lv) UPGRADES[k].apply(p, lv);
    return (this._perf = p);
  }
  setUpgrade(k, lv) { this.upg[k] = lv; this._perf = null; this.syncDrones(); }

  resetStats() {
    this.stats = {
      arrived: 0, delivered: 0, mis: 0, expOn: 0, expLate: 0, revenue: 0, opex: 0, spent: 0,
      lead: 0, leadN: 0, relabeled: 0, robotRelabel: 0, maxDockQ: 0, truckWait: 0, unprocessed: 0,
      byDest: [0, 0, 0, 0], misByDest: [0, 0, 0, 0], timeline: [], padFullT: 0, robotBusy: 0, robotT: 0,
    };
  }

  // ------------------------------------------------------------------ 日の用意
  /** n 日目を用意する（計画の時間）。layout を渡すと、置いてあるものを入れ替える。 */
  setupDay(n, layout = null) {
    this.day = n;
    this.def = dayDef(n);
    this.tools = toolsUntil(n);
    if (layout) this.load(layout);
    // 区画
    const z = ZONES[this.def.zone];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      this.locked[y * W + x] = x < z.x0 || x > z.x1 || y < z.y0 || y > z.y1 ? 1 : 0;
    }
    // 入荷口（その日に使うものを壁の上に置く。設定は引き継ぐ）
    for (let i = 0; i < DOCKS.length; i++) {
      const D = DOCKS[i];
      const cur = this.at(D.x, D.y);
      if (this.def.docks.includes(i) && !cur) this._place('dock', D.x, D.y, D.dir, { collect: true }, { dockNo: i });
    }
    // 区画の外に残ったもの（ふつうは無い）は片づける
    for (const b of [...this.buildings]) if (b.type !== 'dock' && this.locked[this.idx(b.x, b.y)]) this._unplace(b, true);
    this.clearPackages();
    this.schedule = buildSchedule(this.def);
    this.schedI = 0;
    this.totalPkgs = this.schedule.reduce((s, tr) => s + tr.pkgs.length, 0);
    this.quota = Math.round(this.totalPkgs * this.def.ratio);
    this.t = 0;
    this.running = false;
    this.ended = false;
    this.storm = false;
    this.resetStats();
    this.syncDrones();
    for (const p of this.lists.pads) {
      p.res = 0; p.fullT = 0;
      for (const d of p.drones) { d.st = d === p.drones[0] ? 'dock' : 'hold'; d.t = 0; d.load = []; d.wait = 0; d.idle = 0; d.ship = null; }
    }
    for (const d of this.lists.docks) { d.queue = []; d.bay = null; d.line = []; d.outCd = 0; d.unCd = 0; }
    for (const a of this.lists.arms) { a.phase = 'idle'; a.t = 0; a.held = null; }
    for (const l of this.lists.labelers) { l.inQ = []; l.cur = null; l.outQ = []; }
    this.rs.newDay();
    this.relink();
  }

  /** 使い方の見本用の、何もない作業場（トラックなし・お金なし・全部の道具が使える）。 */
  setupSandbox() {
    for (const b of [...this.buildings]) this._unplace(b, false);
    this.rs.clear();
    this.clearPackages();
    this.day = 0;
    this.def = { n: 0, zone: 2, docks: [], dests: [0, 1, 2, 3], exp: 0, unk: 0, ratio: 1, trucks: [], newTools: [], news: [] };
    this.tools = new Set(['select', 'remove', 'belt', 'sorter', 'junction', 'arm', 'shelf', 'pad', 'charger', 'robot', 'labeler']);
    this.locked.fill(0);
    this.schedule = [];
    this.schedI = 0;
    this.totalPkgs = this.quota = 0;
    this.t = 0;
    this.free = true;
    this.running = false;   // 収支・記録・日の終わりは動かさない（機械とロボは動く）
    this.ended = false;
    this.storm = false;
    this.resetStats();
    this.relink();
  }

  /** 業務開始。 */
  begin() { if (!this.running && !this.ended) { this.running = true; this.emit('begin'); } }

  clearPackages() {
    for (const b of this.buildings) {
      if (b.lanes) { b.lanes[0].length = 0; b.lanes[1].length = 0; }
      if (b.store) b.store.length = 0;
      if (b.queue) b.queue.length = 0;
    }
    this.packages.clear();
    this.floor.length = 0;
  }

  // ------------------------------------------------------------------ 建てる・撤去
  /** 置けるか。理由（i18n のキーの末尾）を返す。置けるなら null。 */
  whyNot(type, x, y) {
    if (!this.inside(x, y)) return 'outside';
    const i = this.idx(x, y);
    if (this.wall[i]) return 'wall';
    if (this.locked[i]) return 'locked';
    if (type !== 'robot' && !this.tools.has(type)) return 'lockedTool';
    const cur = this.grid[i];
    if (type === 'robot') {
      if (!this.free && this.money < ROBOT_COST) return 'money';
      if (this.walkCost(x, y) === Infinity) return 'blocked';
      return null;
    }
    const def = DEFS[type];
    if (!def || def.fixed) return 'bad';
    let cost = def.cost;
    if (cur) {
      // ベルトの仲間どうしは置きかえられる（向きを変える・ゲートにする）
      if (isBelt(cur) && def.belt) cost -= DEFS[cur.type].cost;
      else return 'occupied';
    }
    if (!this.free && cost > 0 && this.money < cost) return 'money';
    return null;
  }

  build(type, x, y, dir = 0, cfg = null) {
    if (type === 'robot') {
      if (this.whyNot('robot', x, y)) return null;
      return this.hire(x, y);
    }
    if (this.whyNot(type, x, y)) return null;
    const def = DEFS[type];
    const cur = this.at(x, y);
    // 同じもの・同じ向きなら何もしない
    if (cur && cur.type === type && cur.dir === dir && !cfg) return cur;
    let keep = null;
    if (cur) {
      if (cur.type === type) { // 向きを変えるだけ：荷物はそのまま
        cur.dir = def.rot ? dir : 0;
        if (cfg) Object.assign(cur.cfg, cfg);
        this.relink();
        this._fixLanes(cur);
        this.emit('rotate', { b: cur });
        return cur;
      }
      keep = this._takeBeltPackages(cur);
      this._pay(-DEFS[cur.type].cost);
      this._unplace(cur, false);
    }
    const b = this._place(type, x, y, def.rot ? dir : 0, { ...defaultCfg(type), ...(cfg || {}) });
    this._pay(def.cost);
    if (keep) for (const p of keep) this._putOnBelt(b, p);
    this._displaceFloor(x, y);
    this.relink();
    this.emit('build', { b });
    return b;
  }

  remove(x, y) {
    const b = this.at(x, y);
    if (!b || DEFS[b.type].fixed) return false;
    this._pay(-DEFS[b.type].cost);
    this._unplace(b, true);
    this.relink();
    this.emit('remove', { x, y, type: b.type });
    return true;
  }

  /** 設定を変える（フィルター・宛先など）。 */
  configure(b, cfg) {
    Object.assign(b.cfg, cfg);
    if (b.type === 'sorter') for (const p of b.lanes[0]) if (p.pos < 0.5) p.exit = this._decide(b, p);
    this.relink();
    this.emit('config', { b });
  }

  rotate(b, dir) {
    if (!DEFS[b.type].rot || DEFS[b.type].fixed) return;
    b.dir = dir & 3;
    this.relink();
    this._fixLanes(b);
    this.emit('rotate', { b });
  }

  _pay(cost) {
    if (this.free) return;
    this.money -= cost;
    if (this.running) this.stats.spent += cost;
  }

  _place(type, x, y, dir, cfg, extra = {}) {
    const b = { id: this.nextId++, type, x, y, dir, cfg, nb: [null, null, null, null], ...extra };
    switch (type) {
      case 'belt': case 'sorter': case 'junction':
        b.lanes = [[], []]; b.feeders = []; b.shape = 'S'; b.alt = false; b.jamT = 0; b.busyT = 0; break;
      case 'arm': b.phase = 'idle'; b.t = 0; b.held = null; b.ang = (dir + 2) & 3; b.busy = 0; b.waitT = 0; break;
      case 'pad': b.store = []; b.res = 0; b.drones = []; b.fullT = 0; break;
      case 'shelf': b.store = []; break;
      case 'labeler': b.inQ = []; b.cur = null; b.t = 0; b.outQ = []; b.outCd = 0; break;
      case 'charger': b.user = null; b.resBy = null; break;
      case 'dock': b.queue = []; b.bay = null; b.line = []; b.outCd = 0; b.unCd = 0; b.fullT = 0; break;
    }
    this.grid[this.idx(x, y)] = b;
    this.buildings.push(b);
    if (type === 'pad') this.syncDrones();
    this.layoutVer++;
    return b;
  }

  /** 取り除く。spill：上にある荷物を床に落とす。 */
  _unplace(b, spill) {
    if (spill) {
      const drop = [];
      if (b.lanes) drop.push(...b.lanes[0], ...b.lanes[1]);
      if (b.store) drop.push(...b.store);
      if (b.queue) drop.push(...b.queue);
      if (b.held) drop.push(b.held);
      if (b.inQ) drop.push(...b.inQ, ...b.outQ, ...(b.cur ? [b.cur] : []));
      if (b.drones) for (const d of b.drones) if (d.st === 'dock') drop.push(...d.load);
      for (const p of drop) this._toFloor(p, b.x, b.y);
    }
    if (b.type === 'charger') this.rs.chargerGone(b);
    this.grid[this.idx(b.x, b.y)] = null;
    const i = this.buildings.indexOf(b);
    if (i >= 0) this.buildings.splice(i, 1);
    b.gone = true;
    this.layoutVer++;
  }

  _takeBeltPackages(b) {
    if (!b.lanes) return null;
    const list = [...b.lanes[0], ...b.lanes[1]];
    b.lanes[0].length = b.lanes[1].length = 0;
    return list;
  }

  /** 置きかえたベルトに荷物を戻す（位置は保つ。入った面は向きに合わせて直す）。 */
  _putOnBelt(b, p) {
    p.where = 'belt';
    p.host = b;
    if (b.type === 'junction') { p.ent = opp(p.exit ?? 0); p.lane = p.ent & 1; p.exit = opp(p.ent); }
    else {
      p.lane = 0;
      if (!canEnter(b, p.ent)) p.ent = opp(b.dir);
      p.exit = b.type === 'sorter' ? this._decide(b, p) : b.dir;
    }
    insertSorted(b.lanes[p.lane], p);
  }

  /** 向きを変えたベルトの荷物の向きを直す。 */
  _fixLanes(b) {
    if (!b.lanes) return;
    const all = this._takeBeltPackages(b);
    for (const p of all) this._putOnBelt(b, p);
  }

  _toFloor(p, x, y) {
    p.where = 'floor';
    p.host = null;
    p.res = null;
    const r = (p.id * 0.618) % 1;
    p.fx = x + (r - 0.5) * 0.5;
    p.fy = y + (((p.id * 0.377) % 1) - 0.5) * 0.5;
    p.tile = this.idx(x, y);
    this.floor.push(p);
  }

  /** 建てたマスに床の荷物があれば、近くの空いている床へ動かす。 */
  _displaceFloor(x, y) {
    const i = this.idx(x, y);
    const here = this.floor.filter((p) => p.tile === i);
    if (!here.length) return;
    const t = this.nearestFreeFloor(x, y);
    if (!t) return;
    for (const p of here) {
      p.tile = this.idx(t[0], t[1]);
      p.fx += t[0] - x;
      p.fy += t[1] - y;
    }
  }

  nearestFreeFloor(x, y) {
    const seen = new Set([this.idx(x, y)]);
    const q = [[x, y]];
    while (q.length) {
      const [cx, cy] = q.shift();
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d], ny = cy + DY[d];
        if (!this.inside(nx, ny)) continue;
        const i = this.idx(nx, ny);
        if (seen.has(i)) continue;
        seen.add(i);
        if (this.wall[i] || this.locked[i]) continue;
        if (!this.grid[i]) return [nx, ny];
        q.push([nx, ny]);
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ つながり
  /** 隣どうしのつながり・流れの順を作り直す（置く・撤去する・向きを変えるたび）。 */
  relink() {
    const L = this.lists;
    for (const k of Object.keys(L)) L[k] = [];
    for (const b of this.buildings) {
      for (let d = 0; d < 4; d++) b.nb[d] = this.at(b.x + DX[d], b.y + DY[d]);
      if (isBelt(b)) { L.belts.push(b); b.feeders = []; }
      else if (b.type === 'arm') L.arms.push(b);
      else if (b.type === 'pad') L.pads.push(b);
      else if (b.type === 'shelf') L.shelves.push(b);
      else if (b.type === 'labeler') L.labelers.push(b);
      else if (b.type === 'charger') L.chargers.push(b);
      else if (b.type === 'dock') L.docks.push(b);
    }
    L.docks.sort((a, b) => a.dockNo - b.dockNo);
    // 流れの向き：b から出て t に入る
    const into = new Map(); // 入ってくる面の一覧（形を決める）
    const addInto = (t, side) => { if (!into.has(t)) into.set(t, new Set()); into.get(t).add(side); };
    for (const b of L.belts) {
      for (const ex of this.exitsOf(b)) {
        const t = b.nb[ex];
        if (isBelt(t) && canEnter(t, opp(ex))) { t.feeders.push(b); addInto(t, opp(ex)); }
      }
    }
    for (const b of [...L.docks, ...L.labelers]) {
      const t = b.nb[b.dir];
      if (isBelt(t) && canEnter(t, opp(b.dir))) addInto(t, opp(b.dir));
    }
    // 根：出口の先がベルトでないもの
    this.roots = L.belts.filter((b) => !this.exitsOf(b).some((ex) => { const t = b.nb[ex]; return isBelt(t) && canEnter(t, opp(ex)); }));
    // ベルトの形（まっすぐ／左から曲がる／右から曲がる）
    for (const b of L.belts) {
      if (b.type !== 'belt') { b.shape = 'S'; continue; }
      const s = into.get(b) || new Set();
      const back = opp(b.dir), l = leftOf(b.dir), r = rightOf(b.dir);
      b.shape = s.has(back) ? 'S' : s.has(l) && !s.has(r) ? 'L' : s.has(r) && !s.has(l) ? 'R' : 'S';
    }
    this.layoutVer++;
  }

  /** ベルトの仲間の出口の向き。 */
  exitsOf(b) {
    if (b.type === 'belt') return [b.dir];
    if (b.type === 'sorter') return [b.dir, b.cfg.side === 'L' ? leftOf(b.dir) : rightOf(b.dir)];
    if (b.type === 'junction') return [0, 1, 2, 3];
    return [];
  }

  // ------------------------------------------------------------------ 1 コマ
  step(dt) {
    if (!this.def) return;
    this.tick++;
    const perf = this.perf();
    if (this.running && !this.ended) {
      this.t += dt;
      this.storm = !!(this.def.storm && this.t >= this.def.storm.from && this.t < this.def.storm.to);
      this._arrivals();
    }
    for (const d of this.lists.docks) this._dock(d, dt);
    for (const l of this.lists.labelers) this._labeler(l, dt);
    this._belts(dt * perf.beltSpeed);
    for (const a of this.lists.arms) this._arm(a, dt, perf);
    for (const p of this.lists.pads) this._pad(p, dt, perf);
    this.rs.step(dt);
    if (this.running && !this.ended) {
      // 運用費（1 分あたり → dt 秒ぶん）
      let opm = this.robots.length * ROBOT_OPEX;
      for (const b of this.buildings) opm += DEFS[b.type].opex;
      const c = (opm * dt) / 60;
      this.stats.opex += c;
      if (!this.free) this.money -= c;
      // 記録（10 秒ごと）
      const k = Math.floor(this.t / 10);
      if (this.stats.timeline.length <= k) this.stats.timeline.push(this.stats.delivered);
      this._checkEnd();
    }
  }

  _arrivals() {
    while (this.schedI < this.schedule.length && this.schedule[this.schedI].t <= this.t) {
      const tr = this.schedule[this.schedI++];
      const dock = this.lists.docks.find((d) => d.dockNo === tr.dock);
      if (!dock) continue;
      const truck = { id: this.schedI, pkgs: tr.pkgs.map((s) => this._newPkg(s)), n0: tr.pkgs.length, st: 'line', t: 0, arrive: this.t, color: this.schedI % 5 };
      dock.line.push(truck);
      this.emit('truck', { dock });
    }
  }

  _newPkg(s) {
    const p = { id: this.nextId++, dest: s.dest, exp: !!s.exp, unk: !!s.unk, born: 0, dl: 0, where: 'truck', host: null,
      pos: 0, ent: 0, exit: 0, lane: 0, res: null, fx: 0, fy: 0, tile: 0 };
    this.packages.add(p);
    return p;
  }

  _checkEnd() {
    const trucksDone = this.schedI >= this.schedule.length && this.lists.docks.every((d) => !d.bay && !d.line.length);
    if (this.t >= DAY_LEN || (trucksDone && this.packages.size === 0 && this.t > 5)) {
      this.ended = true;
      this.running = false;
      let left = this.packages.size;
      this.stats.unprocessed = left;
      this.emit('dayEnd', { cleared: trucksDone && left === 0 });
    }
  }

  // ------------------------------------------------------------------ 入荷口
  _dock(d, dt) {
    // トラック：並ぶ → バック → 荷下ろし → 出ていく
    if (!d.bay && d.line.length) { d.bay = d.line.shift(); d.bay.st = 'back'; d.bay.t = 0; }
    for (const tr of d.line) tr.t += dt;
    const tr = d.bay;
    if (tr) {
      tr.t += dt;
      if (tr.st === 'back' && tr.t >= 2.4) { tr.st = 'unload'; tr.t = 0; this.emit('unload', { dock: d }); }
      else if (tr.st === 'unload') {
        d.unCd -= dt;
        if (d.unCd <= 0 && tr.pkgs.length && d.queue.length < this.perf().dockCap) {
          const p = tr.pkgs.shift();
          p.where = 'dock';
          p.host = d;
          p.born = this.t;
          if (p.exp) p.dl = this.t + EXP_TIME;
          d.queue.push(p);
          this.stats.arrived++;
          d.unCd = 0.45;
        }
        if (!tr.pkgs.length) { tr.st = 'leave'; tr.t = 0; this.stats.truckWait += this.t - tr.arrive; }
      } else if (tr.st === 'leave' && tr.t >= 2.4) d.bay = null;
    }
    const cap = this.perf().dockCap;
    d.fullT = d.queue.length >= cap ? d.fullT + dt : 0;
    if (d.queue.length > this.stats.maxDockQ) this.stats.maxDockQ = d.queue.length;
    // 前のベルトへ流す（人型ロボが予約したものは残す）
    d.outCd -= dt;
    if (d.outCd <= 0 && d.queue.length) {
      const i = d.queue.findIndex((p) => !p.res);
      if (i >= 0 && this._pushOut(d, d.queue[i])) { d.queue.splice(i, 1); d.outCd = 0.32; }
    }
  }

  /** 機械（入荷口・ラベル機）から前のベルトの入口に出す。 */
  _pushOut(m, p) {
    const t = m.nb[m.dir];
    if (!isBelt(t)) return false;
    const side = opp(m.dir);
    if (!canEnter(t, side)) return false;
    const lane = laneOf(t, side);
    if (minPos(t, lane) < SP) return false;
    this._enterBelt(t, p, side, 0);
    return true;
  }

  _enterBelt(b, p, side, pos) {
    p.where = 'belt';
    p.host = b;
    p.ent = side;
    p.pos = pos;
    p.lane = laneOf(b, side);
    p.mid = false;
    p.exit = b.type === 'junction' ? opp(side) : b.type === 'sorter' ? this._decide(b, p) : b.dir;
    b.lanes[p.lane].push(p);
  }

  _decide(b, p) {
    const f = b.cfg.filter;
    let hit;
    if (f === 'alt') { hit = b.alt; b.alt = !b.alt; }
    else hit = matchFilter(f, p);
    return hit ? (b.cfg.side === 'L' ? leftOf(b.dir) : rightOf(b.dir)) : b.dir;
  }

  // ------------------------------------------------------------------ ベルト
  _belts(v) {
    this.beltPhase = ((this.beltPhase || 0) + v) % 1000;
    const st = ++this.stamp;
    const rot = this.tick & 3;
    const visit = (start) => {
      const stack = [start];
      while (stack.length) {
        const b = stack.pop();
        if (b.stamp === st) continue;
        b.stamp = st;
        this._moveBelt(b, v);
        const f = b.feeders, n = f.length;
        for (let i = 0; i < n; i++) { const fb = f[(i + rot) % n]; if (fb.stamp !== st) stack.push(fb); }
      }
    };
    for (const b of this.roots) visit(b);
    for (const b of this.lists.belts) if (b.stamp !== st) visit(b);
  }

  _moveBelt(b, v) {
    for (let lane = 0; lane < 2; lane++) {
      const L = b.lanes[lane];
      if (!L.length) continue;
      let prev = 0;
      for (let i = 0; i < L.length; i++) {
        const p = L[i];
        let limit;
        let tgt = null, kind = 0; // 1：ベルトへ、2：機械へ
        if (i === 0) {
          tgt = b.nb[p.exit];
          if (isBelt(tgt) && canEnter(tgt, opp(p.exit))) {
            kind = 1;
            const mp = minPos(tgt, laneOf(tgt, opp(p.exit)));
            limit = mp === Infinity ? Infinity : 1 + mp - SP;
          } else {
            kind = tgt && (tgt.type === 'pad' || tgt.type === 'shelf' || (tgt.type === 'labeler' && tgt.dir !== opp(p.exit))) ? 2 : 0;
            limit = 1;
          }
        } else limit = prev - SP;
        let np = p.pos + v;
        if (np > limit) np = limit;
        if (np < p.pos) np = p.pos;
        p.pos = np;
        if (i === 0) {
          if (np >= 1 && kind === 1) {
            L.shift(); i--;
            this._enterBelt(tgt, p, opp(p.exit), np - 1);
            prev = np;
            continue;
          }
          if (np >= 1 && kind === 2 && this._acceptMachine(tgt, p, opp(p.exit))) { L.shift(); i--; prev = 2; continue; }
          // 行き止まり・満杯で止まっている時間（詰まりの検出用）
          b.jamT = np >= 1 ? b.jamT + v : 0;
        }
        prev = p.pos;
      }
    }
  }

  /** 機械が荷物を受け取る（ベルトの端・アーム・人型ロボから）。受け取ったら true。 */
  _acceptMachine(m, p, side) {
    const perf = this.perf();
    if (m.type === 'pad') {
      if (m.store.length + m.res >= perf.padCap) return false;
      m.store.push(p); p.where = 'pad'; p.host = m; p.res = null;
      return true;
    }
    if (m.type === 'shelf') {
      if (m.store.length >= perf.shelfCap) return false;
      m.store.push(p); p.where = 'shelf'; p.host = m; p.res = null;
      return true;
    }
    if (m.type === 'labeler') {
      if (side === m.dir || m.inQ.length >= 3) return false;
      m.inQ.push(p); p.where = 'labeler'; p.host = m; p.res = null;
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ ラベル再発行機
  _labeler(l, dt) {
    if (!l.cur && l.inQ.length) { l.cur = l.inQ.shift(); l.t = l.cur.unk ? 2.4 : 0.3; }
    if (l.cur) {
      l.t -= dt;
      if (l.t <= 0 && l.outQ.length < 3) {
        if (l.cur.unk) { l.cur.unk = false; this.stats.relabeled++; this.emit('relabel', { b: l }); }
        l.outQ.push(l.cur);
        l.cur = null;
      }
    }
    l.outCd -= dt;
    if (l.outCd <= 0 && l.outQ.length) {
      const i = l.outQ.findIndex((p) => !p.res);
      if (i >= 0 && this._pushOut(l, l.outQ[i])) { l.outQ.splice(i, 1); l.outCd = 0.32; }
    }
  }

  // ------------------------------------------------------------------ アーム
  // 後ろのマスから取って、前のマスに置く。reach → grip → swing → drop → ret
  _arm(a, dt, perf) {
    const k = perf.armCycle;
    a.t += dt;
    const src = a.nb[opp(a.dir)], dst = a.nb[a.dir];
    switch (a.phase) {
      case 'idle': {
        a.waitT += dt;
        if (!src || !dst) break;
        const p = this._armFind(src, a);
        if (p && this._armCanDrop(dst, p, a)) {
          this._armTake(src, p);
          p.where = 'arm'; p.host = a;
          a.held = p; a.phase = 'reach'; a.t = 0; a.waitT = 0;
          this.emit('arm', { b: a });
        }
        break;
      }
      case 'reach': if (a.t >= 0.24 * k) { a.phase = 'grip'; a.t = 0; } break;
      case 'grip': if (a.t >= 0.1 * k) { a.phase = 'swing'; a.t = 0; } break;
      case 'swing': if (a.t >= 0.5 * k) { a.phase = 'drop'; a.t = 0; } break;
      case 'drop':
        if (a.t >= 0.12 * k) {
          if (!dst) { this._toFloor(a.held, a.x, a.y); a.held = null; a.phase = 'ret'; a.t = 0; break; }
          if (this._armDrop(dst, a.held, a)) { a.held = null; a.phase = 'ret'; a.t = 0; }
        }
        break;
      case 'ret': if (a.t >= 0.38 * k) { a.phase = 'idle'; a.t = 0; } break;
    }
    if (a.phase !== 'idle') a.busy += dt;
  }

  _armFind(src, a) {
    const f = a.cfg.filter;
    if (isBelt(src)) {
      if (src.type === 'junction') return null;
      const L = src.lanes[0];
      for (let i = 0; i < L.length; i++) { const p = L[i]; if (p.pos >= 0.2 && !p.res && matchFilter(f, p)) return p; }
      return null;
    }
    const list = src.type === 'dock' ? src.queue : src.type === 'shelf' ? src.store : src.type === 'labeler' ? src.outQ : null;
    if (!list) return null;
    for (const p of list) if (!p.res && matchFilter(f, p)) return p;
    return null;
  }

  _armTake(src, p) {
    if (isBelt(src)) { const L = src.lanes[p.lane]; L.splice(L.indexOf(p), 1); return; }
    const list = src.type === 'dock' ? src.queue : src.type === 'shelf' ? src.store : src.outQ;
    list.splice(list.indexOf(p), 1);
  }

  _armCanDrop(dst, p, a) {
    const perf = this.perf();
    if (dst.type === 'belt' || dst.type === 'sorter') return this._freeAt(dst, 0.5);
    if (dst.type === 'pad') return dst.store.length + dst.res < perf.padCap;
    if (dst.type === 'shelf') return dst.store.length < perf.shelfCap;
    if (dst.type === 'labeler') return dst.dir !== opp(a.dir) && dst.inQ.length < 3;
    return false;
  }

  _freeAt(b, pos) {
    for (const p of b.lanes[0]) if (Math.abs(p.pos - pos) < ARM_GAP) return false;
    return true;
  }

  _armDrop(dst, p, a) {
    if (dst.gone) return false;
    if (dst.type === 'belt' || dst.type === 'sorter') {
      if (!this._freeAt(dst, 0.5)) return false;
      p.where = 'belt'; p.host = dst; p.pos = 0.5; p.lane = 0;
      p.ent = opp(a.dir); // 置いたのは真ん中。曲がるときの絵のために、アームの側から来たことにする
      if (dst.type === 'belt' && !canEnter(dst, p.ent)) p.ent = opp(dst.dir);
      p.exit = dst.type === 'sorter' ? this._decide(dst, p) : dst.dir;
      p.mid = true; // 真ん中から始まった（前半の絵は描かない）
      insertSorted(dst.lanes[0], p);
      return true;
    }
    return this._acceptMachine(dst, p, opp(a.dir));
  }

  // ------------------------------------------------------------------ ドローンポート
  syncDrones() {
    const n = this.perf().drones;
    // 置いたばかりのポートは lists にまだ入っていないので、建物の一覧から探す
    for (const p of this.buildings) {
      if (p.type !== 'pad') continue;
      while (p.drones.length < n) p.drones.push({ id: p.drones.length, st: p.drones.length ? 'hold' : 'dock', t: 0, load: [], wait: 0, idle: 0 });
      while (p.drones.length > n) p.drones.pop();
    }
  }

  _pad(pad, dt, perf) {
    const cap = perf.padCap;
    pad.fullT = pad.store.length >= cap ? pad.fullT + dt : 0;
    if (pad.fullT > 0 && this.running) this.stats.padFullT += dt;
    let docked = pad.drones.find((d) => d.st === 'dock');
    for (const d of pad.drones) {
      d.t += dt;
      switch (d.st) {
        case 'dock': {
          if (this.storm) { d.wait = 0; break; }
          d.wait += d.load.length ? dt : 0;
          d.ld = (d.ld || 0) - dt;
          if (pad.store.length && d.load.length < perf.droneCap && d.ld <= 0) {
            d.load.push(pad.store.shift());
            d.ld = 0.28;
            d.idle = 0;
            this.emit('load', { b: pad });
          } else if (!pad.store.length) d.idle += dt;
          const go = d.load.length >= perf.droneCap || (d.load.length && (d.wait >= 3.2 || d.idle >= 1.2));
          if (go && d.ld <= 0) {
            for (const p of d.load) this._ship(p, pad);
            d.ship = d.load;
            d.load = [];
            d.st = 'up'; d.t = 0; d.wait = 0; d.idle = 0;
            docked = null;
            this.emit('droneUp', { b: pad, n: d.ship.length });
          }
          break;
        }
        case 'up': if (d.t >= 1.1) { d.st = 'away'; d.t = 0; } break;
        case 'away':
          // 行きの終わり（いちばん遠い所）で荷物を届け終える。帰りは空で戻る
          if (d.ship && d.t >= perf.flight / 2) d.ship = null;
          if (d.t >= perf.flight) { d.st = 'down'; d.t = 0; d.ship = null; }
          break;
        case 'down':
          if (d.t >= 1.1) {
            if (!docked) { d.st = 'dock'; d.t = 0; docked = d; this.emit('droneDown', { b: pad }); }
            else { d.st = 'hold'; d.t = 0; }
          }
          break;
        case 'hold':
          if (!docked && !pad.drones.some((o) => o !== d && o.st === 'down')) { d.st = 'down'; d.t = 0.4; }
          break;
      }
    }
  }

  _ship(p, pad) {
    const s = this.stats;
    const ok = !p.unk && p.dest === pad.cfg.dest;
    let value;
    if (ok) {
      if (p.exp) {
        const on = this.t <= p.dl;
        value = on ? PRICE.expOnTime : PRICE.expLate;
        if (on) s.expOn++; else s.expLate++;
      } else value = PRICE.normal;
      s.delivered++;
      s.byDest[p.dest]++;
    } else {
      value = PRICE.mis;
      s.mis++;
      s.misByDest[pad.cfg.dest]++;
    }
    if (this.running || this.ended) {
      s.revenue += value;
      s.lead += this.t - p.born;
      s.leadN++;
    }
    if (!this.free) this.money += value;
    p.where = 'drone';
    this.packages.delete(p);
    this.emit('ship', { b: pad, ok, exp: p.exp, value, dest: p.dest, unk: p.unk, late: p.exp && ok && this.t > p.dl });
  }

  // ------------------------------------------------------------------ 人型ロボ
  hire(x, y) {
    if (!this.free) {
      if (this.money < ROBOT_COST) return null;
      this.money -= ROBOT_COST;
      if (this.running) this.stats.spent += ROBOT_COST;
    }
    const r = this.rs.add(x, y);
    this.emit('hire', { r });
    return r;
  }

  fire(r) {
    if (!this.free) this.money += ROBOT_COST;
    this.rs.removeRobot(r);
    this.emit('fire', { r });
  }

  /** 人型ロボが歩けるか（重さ。Infinity なら通れない）。 */
  walkCost(x, y) {
    if (!this.inside(x, y)) return Infinity;
    const i = this.idx(x, y);
    if (this.wall[i] || this.locked[i]) return Infinity;
    const b = this.grid[i];
    if (!b) return 1;
    return DEFS[b.type].walk ?? Infinity;
  }

  // ------------------------------------------------------------------ 保存
  serialize() {
    return {
      v: 1,
      b: this.buildings.filter((b) => !DEFS[b.type].fixed).map((b) => [b.type, b.x, b.y, b.dir, { ...b.cfg }]),
      docks: this.lists.docks.map((d) => [d.dockNo, { ...d.cfg }]),
      robots: this.robots.map((r) => [Math.round(r.x), Math.round(r.y)]),
      money: Math.round(this.money),
      upg: { ...this.upg },
    };
  }

  /** 置いてあるものを入れ替える（お金は data.money。払いはしない）。 */
  load(data) {
    for (const b of [...this.buildings]) this._unplace(b, false);
    this.rs.clear();
    this.clearPackages();
    for (const [type, x, y, dir, cfg] of data.b || []) {
      if (!DEFS[type] || DEFS[type].fixed || !this.inside(x, y) || this.at(x, y)) continue;
      this._place(type, x, y, dir, { ...defaultCfg(type), ...(cfg || {}) });
    }
    for (const [no, cfg] of data.docks || []) {
      const D = DOCKS[no];
      if (D && !this.at(D.x, D.y)) this._place('dock', D.x, D.y, D.dir, { collect: true, ...cfg }, { dockNo: no });
    }
    for (const r of data.robots || []) {
      const [x, y] = Array.isArray(r) ? r : [3, 4];
      this.rs.add(x, y);
    }
    if (typeof data.money === 'number') this.money = data.money;
    if (data.upg) for (const k of Object.keys(this.upg)) this.upg[k] = data.upg[k] | 0;
    this._perf = null;
    this.relink();
    this.syncDrones();
  }
}

export function defaultCfg(type) {
  switch (type) {
    case 'sorter': return { filter: 0, side: 'L' };
    case 'arm': return { filter: 'any' };
    case 'pad': return { dest: 0 };
    case 'shelf': return { collect: true };
    case 'dock': return { collect: true };
    default: return {};
  }
}

/** pos の大きい順に並んだ配列へ入れる。 */
function insertSorted(L, p) {
  let i = 0;
  while (i < L.length && L[i].pos > p.pos) i++;
  L.splice(i, 0, p);
}

export { isBelt, laneOf };
