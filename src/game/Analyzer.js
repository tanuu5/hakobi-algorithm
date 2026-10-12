// 主人公（最適化 AI「ハコビ」）の分析：工場を見張って、ボトルネックを見つけたらログに書く。
// 同じ注意は間をあけて出す（うるさくしない）。文はすべて i18n のキー（log.〇〇）。
import { DESTS } from './sim/consts.js';
import { armProblem, labelerProblem } from './ui/GameUI.js';

export class Analyzer {
  constructor(game) {
    this.g = game;
    this.reset();
  }

  reset() {
    this.cool = new Map();
    this.timer = 0;
    this.hist = [];        // [t, delivered]（予測に使う）
    this.said = new Set(); // その日に一度だけのもの
  }

  get w() { return this.g.world; }

  _say(kind, key, vars = {}, coolKey = key, coolT = 30) {
    const now = this.w.t;
    const last = this.cool.get(coolKey);
    if (last !== undefined && now - last < coolT) return false;
    this.cool.set(coolKey, now);
    this.g.ui?.log(kind, key, vars);
    if (kind === 'warn' || kind === 'bad') this.g.audio.sfx('alert');
    return true;
  }
  once(kind, key, vars = {}, id = key) {
    if (this.said.has(id)) return;
    this.said.add(id);
    this.g.ui?.log(kind, key, vars);
  }

  /** シミュレーションの出来事を受け取る。 */
  onEvent(e) {
    const w = this.w;
    switch (e.type) {
      case 'ship':
        if (!e.ok) {
          if (e.unk) this._say('bad', 'log.unkShip', {}, 'unkShip', 12);
          else this._say('bad', 'log.mis', { a: DESTS[e.dest].sym, b: DESTS[e.b.cfg.dest].sym }, 'mis', 8);
        } else if (e.late) this._say('warn', 'log.expLate', {}, 'expLate', 15);
        if (w.stats.delivered === w.quota && w.running) this.once('good', 'log.quota', { n: w.quota });
        break;
      case 'truck':
        if (e.dock.line.length >= 2) this._say('warn', 'log.trucks', { n: e.dock.line.length + 1, d: e.dock.dockNo + 1 }, 'trucks' + e.dock.dockNo, 30);
        break;
    }
  }

  /** 毎フレーム（業務中だけ）。1 秒ごとに見回る。 */
  update(dt) {
    const w = this.w;
    if (!w.running) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1;
    const t = w.t;
    this.hist.push([t, w.stats.delivered]);
    while (this.hist.length && this.hist[0][0] < t - 40) this.hist.shift();
    const perf = w.perf();
    // 入荷口があふれている
    for (const d of w.lists.docks) {
      if (d.fullT > 6) this._say('warn', 'log.dockFull', { d: d.dockNo + 1 }, 'dock' + d.dockNo, 30);
    }
    // ポートが満杯
    for (const p of w.lists.pads) {
      if (p.fullT > 6 && !w.storm) this._say('warn', 'log.padFull', { s: DESTS[p.cfg.dest].sym }, 'pad' + p.cfg.dest, 35);
    }
    // 宛先のポートがない
    const have = new Set(w.lists.pads.map((p) => p.cfg.dest));
    for (const d of w.def.dests) if (!have.has(d)) this._say('bad', 'log.noPad', { s: DESTS[d].sym }, 'nopad' + d, 25);
    // ベルトが詰まっている（行き止まりで人型ロボが拾う所は除く）
    for (const b of w.lists.belts) {
      if (b.jamT > 5 * perf.beltSpeed) {
        const p = b.lanes[0][0] || b.lanes[1][0];
        const t2 = p ? b.nb[p.exit] : null;
        if (t2) { this._say('warn', 'log.jam', { x: b.x, y: b.y }, 'jam', 25); break; }
      }
    }
    // 行き止まりに荷物がたまっているのに、拾う人型ロボがいない
    if (!w.robots.length) {
      const stuck = w.lists.belts.some((b) => b.jamT > 3 && b.lanes[0][0] && !b.nb[b.lanes[0][0].exit]);
      const shelfFull = w.lists.shelves.some((s) => s.store.length >= perf.shelfCap);
      if (stuck || shelfFull || w.floor.length) this._say('warn', 'log.noRobot', {}, 'norobot', 30);
    }
    // 向きが合っていないアーム
    for (const a of w.lists.arms) if (armProblem(a)) { this._say('warn', 'log.armBad', { x: a.x, y: a.y }, 'armBad', 40); break; }
    // 出口がふさがっているラベル機（少し続いたら）
    for (const l of w.lists.labelers) if (l.outWait > 4 && labelerProblem(l) === 'st.labJam') { this._say('warn', 'log.labJam', { x: l.x, y: l.y }, 'labJam', 40); break; }
    // 充電できない
    if (w.robots.some((r) => r.noChg)) this._say('bad', 'log.noCharger', {}, 'nochg', 40);
    // 床に荷物
    if (w.floor.length >= 3) this._say('info', 'log.floor', { n: w.floor.length }, 'floor', 40);
    // 速達が期限に近い
    // 予測（60 秒・120 秒）
    for (const at of [60, 120]) {
      if (t >= at && !this.said.has('fc' + at)) {
        this.said.add('fc' + at);
        const h0 = this.hist[0];
        const rate = h0 && t > h0[0] ? (w.stats.delivered - h0[1]) / (t - h0[0]) : 0;
        const left = Math.max(0, 175 - t);
        const fc = Math.round(w.stats.delivered + rate * left);
        const ok = fc >= w.quota;
        this.g.ui?.log(ok ? 'good' : 'warn', ok ? 'log.forecastOk' : 'log.forecastNg', { n: fc, q: w.quota });
      }
    }
    if (w.storm) this.once('warn', 'log.storm');
    if (w.def.storm && t >= w.def.storm.to) this.once('good', 'log.stormEnd');
    if (w.def.rush && t >= w.def.rush.from) this.once('warn', 'log.rush');
  }

  /** 日報の一言：一番の課題を探す。 */
  verdict(s) {
    const w = this.w;
    const perf = w.perf();
    if (s.mis > Math.max(2, s.delivered * 0.03)) return 'verdict.mis';
    if (s.maxDockQ >= perf.dockCap && s.unprocessed > 5) return 'verdict.inbound';
    if (s.padFullT > 40) return 'verdict.pads';
    if (s.expLate > s.expOn * 0.25 && s.expLate > 2) return 'verdict.express';
    if (s.robotT > 0 && s.robotBusy / s.robotT > 0.85 && s.unprocessed > 5) return 'verdict.robots';
    if (s.unprocessed > 5) return 'verdict.capacity';
    if (s.robotT > 0 && s.robotBusy / s.robotT < 0.25 && w.robots.length > 2) return 'verdict.idle';
    return 'verdict.good';
  }
}
