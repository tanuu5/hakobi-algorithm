// キャンペーンの日の中身。トラックの来かた・宛先・速達・ラベル不明・使える区画・新しい道具。
// 9 日目からは「延長契約」：8 日目を元に、少しずつ量を増やして続ける。
import { Rng } from '../../core/rng.js';
import { LAST_TRUCK } from './consts.js';

// 使える区画（壁の内側 x 1..26, y 1..16 のうち）
export const ZONES = [
  { x0: 1, y0: 3, x1: 15, y1: 14 },
  { x0: 1, y0: 1, x1: 20, y1: 16 },
  { x0: 1, y0: 1, x1: 26, y1: 16 },
];

// 入荷口（壁の上に置く。dir は中へ向く向き）
export const DOCKS = [
  { x: 0, y: 8, dir: 0 },
  { x: 0, y: 13, dir: 0 },
  { x: 9, y: 0, dir: 1 },
];

// 1 日目の最初から置いてあるもの
export const DAY1_LAYOUT = {
  b: [
    ['pad', 13, 6, 0, { dest: 0 }],
    ['pad', 13, 11, 0, { dest: 1 }],
    ['charger', 3, 4, 0, {}],
  ],
  robots: 1,
};

// trucks：入荷口ごとの来かた（start 秒から every 秒ごと、size 個）。rush：この間は間隔が mul 倍。storm：ドローンが飛べない間
export const DAYS = [
  {
    n: 1, zone: 0, docks: [0], dests: [0, 1], exp: 0, unk: 0, ratio: 0.65,
    trucks: [{ dock: 0, start: 4, every: 21, size: [5, 7] }],
    newTools: ['belt', 'shelf', 'pad', 'charger', 'robot'], news: ['robots'],
  },
  {
    n: 2, zone: 0, docks: [0], dests: [0, 1], exp: 0, unk: 0, ratio: 0.7,
    trucks: [{ dock: 0, start: 4, every: 15, size: [7, 9] }],
    newTools: ['arm'], news: [],
  },
  {
    n: 3, zone: 1, docks: [0, 1], dests: [0, 1, 2], exp: 0, unk: 0, ratio: 0.7,
    trucks: [{ dock: 0, start: 4, every: 16, size: [7, 9] }, { dock: 1, start: 12, every: 24, size: [7, 9] }],
    newTools: ['sorter', 'junction'], news: ['destC', 'dock2', 'zone1'],
  },
  {
    n: 4, zone: 1, docks: [0, 1], dests: [0, 1, 2], exp: 0.22, unk: 0, ratio: 0.72,
    trucks: [{ dock: 0, start: 4, every: 15, size: [7, 9] }, { dock: 1, start: 10, every: 21, size: [7, 9] }],
    newTools: [], news: ['express'],
  },
  {
    n: 5, zone: 1, docks: [0, 1], dests: [0, 1, 2], exp: 0.18, unk: 0.14, ratio: 0.72,
    trucks: [{ dock: 0, start: 4, every: 14, size: [7, 9] }, { dock: 1, start: 9, every: 19, size: [7, 9] }],
    newTools: ['labeler'], news: ['unknown'],
  },
  {
    n: 6, zone: 2, docks: [0, 1, 2], dests: [0, 1, 2, 3], exp: 0.18, unk: 0.12, ratio: 0.72,
    trucks: [{ dock: 0, start: 4, every: 15, size: [7, 9] }, { dock: 1, start: 9, every: 19, size: [7, 9] }, { dock: 2, start: 14, every: 22, size: [7, 9] }],
    newTools: [], news: ['destD', 'dock3', 'zone2'],
  },
  {
    n: 7, zone: 2, docks: [0, 1, 2], dests: [0, 1, 2, 3], exp: 0.2, unk: 0.12, ratio: 0.72,
    trucks: [{ dock: 0, start: 4, every: 15, size: [7, 9] }, { dock: 1, start: 8, every: 18, size: [7, 9] }, { dock: 2, start: 12, every: 20, size: [7, 9] }],
    rush: { from: 50, to: 115, mul: 0.6 }, newTools: [], news: ['rush'],
  },
  {
    n: 8, zone: 2, docks: [0, 1, 2], dests: [0, 1, 2, 3], exp: 0.2, unk: 0.14, ratio: 0.7,
    trucks: [{ dock: 0, start: 4, every: 14, size: [7, 9] }, { dock: 1, start: 8, every: 17, size: [7, 9] }, { dock: 2, start: 12, every: 19, size: [7, 9] }],
    storm: { from: 70, to: 105 }, newTools: [], news: ['storm'],
  },
];
export const CAMPAIGN_DAYS = DAYS.length;

/** n 日目の中身（9 日目からは作る）。 */
export function dayDef(n) {
  if (n <= DAYS.length) return DAYS[n - 1];
  const k = n - DAYS.length;            // 延長契約の何日目か
  const base = DAYS[DAYS.length - 1];
  const f = Math.pow(0.95, k);          // 間隔が少しずつ短くなる
  const ev = k % 3 === 1 ? { rush: { from: 40, to: 110, mul: 0.65 } } : k % 3 === 2 ? { storm: { from: 60, to: 95 } } : {};
  return {
    ...base, n, ratio: 0.72, exp: Math.min(0.3, 0.2 + k * 0.01), unk: Math.min(0.2, 0.14 + k * 0.005),
    trucks: base.trucks.map((tr) => ({ ...tr, every: Math.max(8, tr.every * f) })),
    storm: undefined, rush: undefined, ...ev, newTools: [], news: k === 1 ? ['overtime'] : [],
  };
}

/** n 日目までに使えるようになった道具。 */
export function toolsUntil(n) {
  const s = new Set(['select', 'remove']);
  for (let i = 1; i <= Math.min(n, DAYS.length); i++) for (const t of DAYS[i - 1].newTools) s.add(t);
  return s;
}

/** トラックの到着の予定を作る。戻り値：[{ t, dock, pkgs: [{ dest, exp, unk }] }]（時刻の順）。 */
export function buildSchedule(def, seed = def.n * 7919 + 13) {
  const rng = new Rng(seed);
  const list = [];
  for (const tr of def.trucks) {
    let t = tr.start;
    while (t <= LAST_TRUCK) {
      const size = rng.int(tr.size[0], tr.size[1]);
      // トラックごとに「多めの宛先」を 1 つ決める（荷物の来かたに波を作る）
      const main = rng.pick(def.dests);
      const pkgs = [];
      for (let i = 0; i < size; i++) {
        const dest = rng.chance(0.4) ? main : rng.pick(def.dests);
        const exp = rng.chance(def.exp || 0);
        const unk = !exp && rng.chance(def.unk || 0);
        pkgs.push({ dest, exp, unk });
      }
      list.push({ t: +(t + rng.range(-1.5, 1.5)).toFixed(2), dock: tr.dock, pkgs });
      let gap = tr.every;
      if (def.rush && t >= def.rush.from && t < def.rush.to) gap *= def.rush.mul;
      t += gap * rng.range(0.9, 1.1);
    }
  }
  list.sort((a, b) => a.t - b.t);
  return list;
}

/** その日の荷物の総数とノルマ。 */
export function dayTotals(def) {
  const sched = buildSchedule(def);
  const total = sched.reduce((s, tr) => s + tr.pkgs.length, 0);
  return { total, quota: Math.round(total * def.ratio), sched };
}
