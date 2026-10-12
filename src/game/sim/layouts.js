// できあがった工場の見本（タイトルの背景・撮影の確認用）。World.load() の形。
import { DX, DY } from './consts.js';

/** 線を引く：pts は折れ点の並び。最後のマスは last の向き（無ければ最後の進む向き）。 */
function belts(list, pts, last) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const dir = x1 > x0 ? 0 : y1 > y0 ? 1 : x1 < x0 ? 2 : 3;
    let x = x0, y = y0;
    while (x !== x1 || y !== y1) { list.push(['belt', x, y, dir, {}]); x += DX[dir]; y += DY[dir]; }
  }
  const [lx, ly] = pts[pts.length - 1];
  const [px, py] = pts[pts.length - 2];
  list.push(['belt', lx, ly, last ?? (lx > px ? 0 : ly > py ? 1 : lx < px ? 2 : 3), {}]);
}

export function demoLayout() {
  const b = [];
  // 入荷口 1（西・中央）から東への本線
  belts(b, [[1, 8], [19, 8]]);
  // 入荷口 2（西・南）：東へ進んで北へ上がり、本線に横から入る
  belts(b, [[1, 13], [6, 13], [6, 9]]);
  // 入荷口 3（北）：南へ下りて本線に横から入る
  belts(b, [[9, 1], [9, 7]]);
  // 仕分けゲートと、ポートへの枝
  const gate = (x, f, side) => { const i = b.findIndex((e) => e[1] === x && e[2] === 8); b[i] = ['sorter', x, 8, 0, { filter: f, side }]; };
  gate(11, 0, 'L'); belts(b, [[11, 7], [11, 5]]); b.push(['pad', 11, 4, 0, { dest: 0 }]);
  gate(13, 1, 'R'); belts(b, [[13, 9], [13, 11]]); b.push(['pad', 13, 12, 0, { dest: 1 }]);
  gate(15, 2, 'L'); belts(b, [[15, 7], [15, 5]]); b.push(['pad', 15, 4, 0, { dest: 2 }]);
  gate(17, 3, 'R'); belts(b, [[17, 9], [17, 11]]); b.push(['pad', 17, 12, 0, { dest: 3 }]);
  // 本線の終わり：アームで 2 つめのポートへ
  b.push(['arm', 19, 7, 3, { filter: 0 }], ['pad', 19, 6, 0, { dest: 0 }]);
  b.push(['arm', 19, 9, 1, { filter: 1 }], ['pad', 19, 10, 0, { dest: 1 }]);
  belts(b, [[20, 8], [21, 8]]);
  b.push(['arm', 21, 7, 3, { filter: 2 }], ['pad', 21, 6, 0, { dest: 2 }]);
  b.push(['arm', 21, 9, 1, { filter: 3 }], ['pad', 21, 10, 0, { dest: 3 }]);
  // 行き止まりの棚：人型ロボが拾ってポートへ（ラベル不明も読める）
  b.push(['shelf', 22, 8, 0, { collect: true }]);
  b.push(['pad', 24, 5, 0, { dest: 0 }], ['pad', 25, 7, 0, { dest: 1 }], ['pad', 25, 9, 0, { dest: 2 }], ['pad', 24, 11, 0, { dest: 3 }]);
  b.push(['charger', 25, 14, 0, {}], ['charger', 23, 14, 0, {}], ['charger', 3, 3, 0, {}]);
  // 速達の近道：ゲートで速達だけ北へ分け、交差で入荷口 3 の線を越えて A のポートへ
  return {
    b,
    docks: [[0, { collect: true }], [1, { collect: true }], [2, { collect: true }]],
    robots: [[23, 13], [24, 13], [4, 4]],
    money: 99999,
    upg: { belt: 1, arm: 1, droneCap: 1, drones: 0, robotSpeed: 1, robotCarry: 0, battery: 0 },
  };
}
