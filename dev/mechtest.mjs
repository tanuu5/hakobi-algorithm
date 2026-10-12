// 仕組みごとの確認（Node）。node dev/mechtest.mjs
// 交差・ラベル機・ベルトの行き止まり・床の荷物・交互のゲート・棚からアーム・ベルトの輪・置きかえ
import { World } from '../src/game/sim/World.js';

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok  ' : '  NG  ') + msg); if (!cond) fails++; };
const run = (w, sec) => { for (let i = 0; i < sec * 60; i++) { w.step(1 / 60); w.events.length = 0; } };
const fresh = (day = 6) => { const w = new World(); w.free = true; w.setupDay(day, { b: [], robots: [], money: 99999, upg: {} }); w.schedule = []; return w; };
const line = (w, x0, y0, x1, y1, dir) => { for (let x = x0, y = y0; ; ) { w.build('belt', x, y, dir); if (x === x1 && y === y1) break; x += Math.sign(x1 - x); y += Math.sign(y1 - y); } };
/** 荷物を直接ベルトの入口に置く。 */
const feed = (w, x, y, side, spec) => { const p = w._newPkg(spec); w._enterBelt(w.at(x, y), p, side, 0); return p; };

console.log('交差：縦と横がまっすぐ通り抜ける');
{
  const w = fresh();
  line(w, 2, 8, 12, 8, 0);             // 東へ
  line(w, 7, 3, 7, 13, 1);             // 南へ
  w.build('junction', 7, 8, 0);
  w.build('shelf', 13, 8); w.build('shelf', 7, 14);
  w.begin();
  for (let i = 0; i < 6; i++) { feed(w, 2, 8, 2, { dest: 0 }); feed(w, 7, 3, 3, { dest: 1 }); run(w, 0.5); }
  run(w, 15);
  const e = w.at(13, 8).store, s = w.at(7, 14).store;
  ok(e.length === 6 && e.every((p) => p.dest === 0), `東の棚に A が 6 個（${e.length}）`);
  ok(s.length === 6 && s.every((p) => p.dest === 1), `南の棚に B が 6 個（${s.length}）`);
}

console.log('ラベル機：不明の荷物を読めるようにして前へ出す');
{
  const w = fresh();
  line(w, 2, 8, 5, 8, 0);
  w.build('labeler', 6, 8, 0);
  line(w, 7, 8, 9, 8, 0);
  w.build('shelf', 10, 8);
  w.begin();
  for (let i = 0; i < 4; i++) { feed(w, 2, 8, 2, { dest: 2, unk: true }); run(w, 0.6); }
  run(w, 20);
  const st = w.at(10, 8).store;
  ok(st.length === 4 && st.every((p) => !p.unk && p.dest === 2), `棚に読める C が 4 個（${st.length}）`);
}

console.log('ラベル機の出口：流れているあいだは人型ロボが拾わず、ふさがったら拾う');
{
  const w = fresh();
  line(w, 2, 8, 5, 8, 0);
  w.build('labeler', 6, 8, 0);
  line(w, 7, 8, 9, 8, 0);
  w.build('shelf', 10, 8);
  w.configure(w.at(10, 8), { collect: false }); // 棚からはロボが取らない（出口だけを見る）
  w.build('pad', 6, 12, 0, { dest: 2 });
  w.build('charger', 3, 3);
  w.hire(4, 5);
  w.begin();
  const lab = w.at(6, 8);
  let robotTook = 0, maxWait = 0;
  // 不明を混ぜて詰めて流す（不明のあとは出口に並ぶ）：棚に入るうちはロボは来ない
  for (let i = 0; i < 6; i++) { feed(w, 2, 8, 2, { dest: 2, unk: i % 3 === 0 }); run(w, 0.5); }
  for (let i = 0; i < 20 * 60; i++) { w.step(1 / 60); w.events.length = 0; maxWait = Math.max(maxWait, lab.outWait); if (w.robots[0].carry.length) robotTook++; }
  ok(w.at(10, 8).store.length === 6 && robotTook === 0, `流れているときは棚へ 6 個、ロボは拾わない（${w.at(10, 8).store.length}、出口の待ち最大 ${maxWait.toFixed(2)} 秒）`);
  // 棚を満杯に（ベルトがふさがる）→ 出口で待つ荷物をロボが拾ってポートへ
  for (let i = 0; i < 16; i++) { feed(w, 2, 8, 2, { dest: 2 }); run(w, 0.5); }
  run(w, 40);
  ok(w.stats.delivered > 0, `ふさがったら、ロボが出口から拾って出荷（${w.stats.delivered}）`);
}

console.log('人型ロボ：ベルトの行き止まりから拾ってポートへ（不明も読む）');
{
  const w = fresh();
  line(w, 2, 8, 6, 8, 0);              // (6,8) が行き止まり
  w.build('pad', 9, 5, 0, { dest: 1 });
  w.build('charger', 3, 3);
  w.hire(4, 5);
  w.begin();
  for (let i = 0; i < 3; i++) { feed(w, 2, 8, 2, { dest: 1, unk: i === 1 }); run(w, 0.5); }
  run(w, 40);
  ok(w.stats.delivered === 3, `3 個とも正しく出荷（${w.stats.delivered}、誤配送 ${w.stats.mis}）`);
  ok(w.stats.robotRelabel === 1, `ロボが不明を 1 個読んだ（${w.stats.robotRelabel}）`);
}

console.log('撤去：上の荷物は床に落ち、人型ロボが拾う');
{
  const w = fresh();
  line(w, 2, 8, 9, 8, 0);
  w.build('pad', 12, 8, 0, { dest: 0 });
  w.build('charger', 3, 3);
  w.hire(4, 4);
  w.begin();
  for (let i = 0; i < 4; i++) feed(w, 2 + i * 2, 8, 2, { dest: 0 });
  run(w, 0.5);
  for (let x = 2; x <= 9; x++) w.remove(x, 8);
  ok(w.floor.length === 4, `床に 4 個（${w.floor.length}）`);
  run(w, 60);
  ok(w.stats.delivered === 4 && w.floor.length === 0, `4 個とも出荷（${w.stats.delivered}）、床 ${w.floor.length}`);
}

console.log('交互のゲート：左右に半分ずつ');
{
  const w = fresh();
  line(w, 2, 8, 7, 8, 0);
  w.build('sorter', 8, 8, 0, { filter: 'alt', side: 'L' });
  w.build('belt', 9, 8, 0); w.build('shelf', 10, 8);
  w.build('belt', 8, 7, 3); w.build('shelf', 8, 6);
  w.begin();
  for (let i = 0; i < 8; i++) { feed(w, 2, 8, 2, { dest: 0 }); run(w, 0.5); }
  run(w, 12);
  const a = w.at(10, 8).store.length, b = w.at(8, 6).store.length;
  ok(a === 4 && b === 4, `まっすぐ ${a}、左 ${b}`);
}

console.log('アーム：棚から取ってポートへ、フィルターに合うものだけ');
{
  const w = fresh();
  w.build('shelf', 5, 8);
  w.build('arm', 6, 8, 0, { filter: 0 });
  w.build('pad', 7, 8, 0, { dest: 0 });
  w.begin();
  const sh = w.at(5, 8);
  for (const d of [0, 1, 0, 1, 0]) { const p = w._newPkg({ dest: d }); p.where = 'shelf'; p.host = sh; sh.store.push(p); }
  run(w, 25);
  ok(w.stats.delivered === 3 && sh.store.length === 2 && sh.store.every((p) => p.dest === 1), `A を 3 個出荷、棚に B が 2 個（${w.stats.delivered} / ${sh.store.length}）`);
}

console.log('ベルトの輪：止まらずに回り続ける');
{
  const w = fresh();
  line(w, 4, 4, 8, 4, 0); line(w, 9, 4, 9, 8, 1); line(w, 9, 9, 5, 9, 2); line(w, 4, 9, 4, 5, 3);
  w.build('belt', 9, 4, 1); w.build('belt', 9, 9, 2); w.build('belt', 4, 9, 3); w.build('belt', 4, 4, 0);
  w.begin();
  const ps = [feed(w, 5, 4, 2, { dest: 0 }), feed(w, 7, 4, 2, { dest: 0 })];
  const start = ps.map((p) => p.host.id);
  run(w, 7.3);
  const moved = ps.every((p, i) => p.where === 'belt' && Number.isFinite(p.pos));
  run(w, 3);
  ok(moved && ps.every((p) => p.where === 'belt'), `輪の上で回っている（${ps.map((p) => `${p.host.x},${p.host.y}`).join(' / ')}、最初 ${start.join(',')}）`);
}

console.log('置きかえ：ベルトの向きを変えても荷物は残る');
{
  const w = fresh();
  line(w, 2, 8, 6, 8, 0);
  w.begin();
  const p = feed(w, 4, 8, 2, { dest: 0 });
  run(w, 0.2);
  w.build('belt', 4, 8, 1);
  ok(p.where === 'belt' && p.host === w.at(4, 8) && p.exit === 1, `荷物はそのマスに残り、出口が南に（${p.exit}）`);
  w.build('sorter', 5, 8, 0, { filter: 0, side: 'L' });
  ok(w.at(5, 8).type === 'sorter', 'ベルトをゲートに置きかえ');
}

console.log('ポート：あとから置いたポートにもドローンがいて、出荷する');
{
  const w = fresh();
  w.build('pad', 3, 3, 0, { dest: 0 });          // 1 つめ
  line(w, 2, 8, 5, 8, 0);
  w.build('pad', 6, 8, 0, { dest: 1 });          // 2 つめ（ほかのポートがある所へ足す）
  w.begin();
  ok(w.at(6, 8).drones.length === 1, `2 つめのポートのドローン ${w.at(6, 8).drones.length} 機`);
  for (let i = 0; i < 3; i++) { feed(w, 2, 8, 2, { dest: 1 }); run(w, 0.6); }
  run(w, 12);
  ok(w.stats.delivered === 3, `3 個とも出荷（${w.stats.delivered}）`);
}

console.log(fails ? `\n${fails} 件 NG` : '\nすべて ok');
process.exit(fails ? 1 : 0);
