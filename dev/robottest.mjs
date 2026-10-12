// 人型ロボの歩き方の確認（Node）：ベルトの上にいた時間・重なった時間・止まったままのロボがいないか。
//   node dev/robottest.mjs
import { World } from '../src/game/sim/World.js';
import { demoLayout } from '../src/game/sim/layouts.js';
import { DAY1_LAYOUT } from '../src/game/sim/days.js';

function measure(name, setup, sec = 180) {
  const w = new World();
  setup(w);
  w.begin();
  const dt = 1 / 60;
  let t = 0, beltT = 0, beltMoveT = 0, overlapT = 0, maxWait = 0, robotT = 0, longStill = 0;
  const still = new Map();
  for (let k = 0; k < sec * 60 && !w.ended; k++) {
    w.step(dt); w.events.length = 0; t += dt;
    const rs = w.robots;
    for (const r of rs) {
      robotT += dt;
      const b = w.at(Math.round(r.x), Math.round(r.y));
      const onBelt = b && (b.type === 'belt' || b.type === 'sorter' || b.type === 'junction');
      if (onBelt) { beltT += dt; if (r.moving) beltMoveT += dt; }
      maxWait = Math.max(maxWait, r.waitT || 0);
      // 仕事中なのに 8 秒以上まったく動かない
      const busy = r.st === 'toSrc' || r.st === 'toDst' || r.st === 'toChg';
      const key = r.id;
      if (busy && !r.moving) { still.set(key, (still.get(key) || 0) + dt); if (still.get(key) > 8) longStill++; }
      else still.set(key, 0);
    }
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      if (Math.hypot(rs[i].x - rs[j].x, rs[i].y - rs[j].y) < 0.55) overlapT += dt;
    }
  }
  const s = w.stats;
  return { name, robots: w.robots.length, delivered: s.delivered, total: w.totalPkgs, beltPct: +((beltT / robotT) * 100).toFixed(1), beltMovePct: +((beltMoveT / robotT) * 100).toFixed(1),
    overlapS: +overlapT.toFixed(1), maxWait: +maxWait.toFixed(2), longStill };
}

const rows = [];
// 見本の工場に人型ロボを 6 台（混み合う）
rows.push(measure('demo-d7-6robots', (w) => {
  const L = demoLayout();
  w.setupDay(7, { ...L, robots: [[23, 13], [24, 13], [4, 4], [22, 12], [20, 13], [6, 4]], money: 9000, upg: {} });
}));
// 1 日目：ベルト＋棚、ロボ 3 台（ベルトの両側にポート）
rows.push(measure('d1-belt-3robots', (w) => {
  w.setupDay(1, { ...DAY1_LAYOUT, robots: [[4, 5], [5, 5], [6, 5]], money: 1500, upg: {} });
  for (let x = 1; x <= 11; x++) w.build('belt', x, 8, 0);
  w.build('shelf', 12, 8);
}));
// 壁から壁までのベルト（越えないと向こうへ行けない）：ロボは越えて運べるか
rows.push(measure('wall-to-wall', (w) => {
  w.setupDay(3, { b: [['pad', 10, 3, 0, { dest: 0 }], ['pad', 12, 3, 0, { dest: 1 }], ['pad', 14, 3, 0, { dest: 2 }], ['charger', 5, 4, 0, {}]], robots: [[6, 12], [7, 12]], money: 9000, upg: {} });
  for (let x = 1; x <= 20; x++) w.build('belt', x, 8, x < 20 ? 0 : 1);
  for (let y = 9; y <= 15; y++) w.build('belt', 20, y, 1);
  w.build('shelf', 20, 16);
  // 入荷口 2 の荷物は床に置かれる（ベルトなし）：ロボが北側のポートまで運ぶには、東西のベルトを越えるしかない
}));
// 狭い通路で向かい合う：1 マス幅の通路に 4 台
rows.push(measure('corridor', (w) => {
  w.setupDay(1, { b: [['pad', 3, 4, 0, { dest: 0 }], ['pad', 14, 12, 0, { dest: 1 }], ['charger', 2, 12, 0, {}]], robots: [[5, 5], [6, 5], [12, 11], [13, 11]], money: 9000, upg: {} });
  // 区画の真ん中に、1 マスの隙間を残した棚の壁
  for (let y = 3; y <= 14; y++) if (y !== 8) w.build('shelf', 9, y, 0, { collect: false });
  for (let x = 1; x <= 7; x++) w.build('belt', x, 8, 0); w.build('shelf', 8, 9, 0, {});
  w.build('belt', 8, 8, 1);
}));
console.table(rows);
