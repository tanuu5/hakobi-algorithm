// シミュレーションだけを Node で回す確認（描画なし）。
//   node dev/simtest.mjs            全部の筋書きを回して、出荷数・ノルマ・詰まりを表に出す
//   node dev/simtest.mjs d1-belt    名前で絞る
// 置き方（筋書き）は「その日をふつうに遊んだらこうなる」程度のもの。ノルマが無理なく届くかを見る。
import { World } from '../src/game/sim/World.js';
import { DAY1_LAYOUT, dayTotals, dayDef } from '../src/game/sim/days.js';
import { DAY_LEN } from '../src/game/sim/consts.js';
import { demoLayout } from '../src/game/sim/layouts.js';

const only = process.argv[2];

/** (x0,y0) から (x1,y1) へ、まず横、次に縦にベルトを引く。 */
function line(w, x0, y0, x1, y1) {
  const pts = [];
  let x = x0, y = y0;
  pts.push([x, y]);
  while (x !== x1) { x += Math.sign(x1 - x); pts.push([x, y]); }
  while (y !== y1) { y += Math.sign(y1 - y); pts.push([x, y]); }
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1] || [ax + (ax - (pts[i - 1]?.[0] ?? ax)), ay + (ay - (pts[i - 1]?.[1] ?? ay))];
    const dir = bx > ax ? 0 : by > ay ? 1 : bx < ax ? 2 : 3;
    const ok = w.build('belt', ax, ay, dir);
    if (!ok) console.warn('  belt NG', ax, ay, w.whyNot('belt', ax, ay));
  }
}
const put = (w, type, x, y, dir = 0, cfg) => { const b = w.build(type, x, y, dir, cfg); if (!b) console.warn('  NG', type, x, y, w.whyNot(type, x, y)); return b; };

const SCEN = {
  // 1 日目：何もしない（ロボ 1 台）
  'd1-none': { day: 1, build() {} },
  // 1 日目：ロボを 2 台足す
  'd1-robots': { day: 1, build(w) { w.hire(3, 5); w.hire(4, 5); } },
  // 1 日目：入荷口からベルトで棚へ（ポートの近く）。ロボは 2 台
  'd1-belt': { day: 1, build(w) { line(w, 1, 8, 11, 8); put(w, 'shelf', 12, 8); w.hire(4, 5); } },
  // 2 日目：ベルトの横にアームでポートへ。行き止まりは棚
  'd2-arms': {
    day: 2,
    build(w) {
      w.money = 1600;
      line(w, 1, 8, 13, 8); put(w, 'shelf', 14, 8);
      put(w, 'pad', 10, 6, 0, { dest: 0 }); put(w, 'pad', 10, 10, 0, { dest: 1 });
      put(w, 'arm', 10, 7, 3, { filter: 0 }); put(w, 'arm', 10, 9, 1, { filter: 1 });
      put(w, 'arm', 13, 7, 3, { filter: 0 }); put(w, 'arm', 13, 9, 1, { filter: 1 });
      put(w, 'pad', 13, 6, 0, { dest: 0 }); put(w, 'pad', 13, 10, 0, { dest: 1 });
    },
    keepDay1: false,
  },
  // 3 日目：仕分けゲートで 3 方向へ
  'd3-sort': {
    day: 3,
    build(w) {
      w.money = 3000;
      // 入荷口 1 (0,8) と 入荷口 2 (0,13) を合流させて東へ
      line(w, 1, 13, 4, 13); line(w, 5, 13, 5, 9); // 縦に上がって
      line(w, 1, 8, 16, 8);
      // ゲート：A は上へ、B は下へ
      put(w, 'sorter', 8, 8, 0, { filter: 0, side: 'L' }); line(w, 8, 7, 8, 5); put(w, 'pad', 8, 4, 0, { dest: 0 });
      put(w, 'sorter', 11, 8, 0, { filter: 1, side: 'R' }); line(w, 11, 9, 11, 11); put(w, 'pad', 11, 12, 0, { dest: 1 });
      put(w, 'sorter', 14, 8, 0, { filter: 2, side: 'L' }); line(w, 14, 7, 14, 5); put(w, 'pad', 14, 4, 0, { dest: 2 });
      put(w, 'shelf', 17, 8);
      put(w, 'pad', 18, 6, 0, { dest: 0 }); put(w, 'pad', 18, 10, 0, { dest: 1 }); put(w, 'pad', 17, 4, 0, { dest: 2 });
    },
  },
};

// 見本の工場（タイトルの背景）を、その日にそのまま使う。upg：アップグレード
const demo = (day, upg = {}) => ({ day, demo: true, upg, build() {} });
for (const d of [6, 7, 8, 9, 10, 12]) { SCEN['demo-d' + d] = demo(d); SCEN['demoU-d' + d] = demo(d, { belt: 1, arm: 1, droneCap: 1 }); }
// 3〜5 日目：d3 の置き方をそのまま、速達・ラベル不明の日に
SCEN['d4-sort'] = { ...SCEN['d3-sort'], day: 4 };
SCEN['d5-sort'] = { ...SCEN['d3-sort'], day: 5 };
SCEN['d5-lab'] = { ...SCEN['d3-sort'], day: 5, extra(w) {
  // 本線の最後をゲート（不明）でラベル機へ。ラベル機は東へ出し、棚へ
  w.remove(17, 8); w.build('sorter', 16, 8, 0, { filter: 'unk', side: 'R' });
  w.build('belt', 16, 9, 1); w.build('labeler', 16, 10, 1); w.build('belt', 16, 11, 1); w.build('belt', 16, 12, 0); w.build('shelf', 17, 12);
  w.build('belt', 17, 8, 0); w.build('shelf', 18, 8);
} };

function fixLine5(w) { // d3：5 列目を北向きに（line の横→縦の最後が上向きになるよう）
  for (let y = 9; y <= 13; y++) w.build('belt', 5, y, 3);
  w.build('belt', 5, 8, 0);
}

function run(name, sc) {
  const w = new World();
  if (sc.demo) {
    w.setupDay(sc.day, { ...demoLayout(), money: 5000, upg: sc.upg });
    return finish(name, sc, w);
  }
  // 前の日までの置き方：1 日目の初期配置から
  w.setupDay(1, { ...DAY1_LAYOUT, robots: [[3, 4]], money: 1500, b: DAY1_LAYOUT.b });
  if (sc.day > 1) {
    if (sc.keepDay1 === false) for (const b of [...w.buildings]) if (b.type === 'pad') w.remove(b.x, b.y);
    w.setupDay(sc.day, w.serialize());
  }
  sc.build(w);
  if (name.startsWith('d3-sort') || name.startsWith('d4-sort') || name.startsWith('d5-')) fixLine5(w);
  sc.extra?.(w);
  return finish(name, sc, w);
}

function finish(name, sc, w) {
  const money0 = w.money;
  w.begin();
  const dt = 1 / 60;
  let maxPk = 0, steps = 0;
  const t0 = performance.now();
  while (!w.ended && steps < DAY_LEN * 60 + 10) {
    w.step(dt);
    w.events.length = 0;
    steps++;
    maxPk = Math.max(maxPk, w.packages.size);
  }
  const ms = performance.now() - t0;
  const s = w.stats;
  const bad = [];
  for (const p of w.packages) if (!Number.isFinite(p.pos)) bad.push(p.id);
  for (const r of w.robots) if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) bad.push(r.id);
  return {
    name, day: sc.day, total: w.totalPkgs, quota: w.quota, delivered: s.delivered, mis: s.mis, left: s.unprocessed,
    t: +w.t.toFixed(1), money: Math.round(w.money - money0), robotUtil: +(s.robotBusy / Math.max(1, s.robotT)).toFixed(2),
    maxDockQ: s.maxDockQ, maxPk, ms: Math.round(ms), nan: bad.length,
    exp: s.expOn + s.expLate ? `${s.expOn}/${s.expOn + s.expLate}` : '-', relabel: s.relabeled + s.robotRelabel, padFull: Math.round(s.padFullT),
  };
}

const rows = [];
for (const [name, sc] of Object.entries(SCEN)) {
  if (only && !name.includes(only)) continue;
  rows.push(run(name, sc));
}
console.table(rows);
for (let n = 1; n <= 10; n++) { const d = dayTotals(dayDef(n)); process.stdout.write(`day${n}: ${d.total}/${d.quota}  `); }
console.log();
