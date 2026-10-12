// シミュレーションの定数。描画（THREE）に依存しない。Node でもそのまま読める。
//
// 座標：マス (x, y)。x は東（右）へ、y は南（下）へ増える。世界の X = x、Z = y（マスの中心が整数）。
// 向き：0 = 東 (+x)、1 = 南 (+y)、2 = 西 (-x)、3 = 北 (-y)。

export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];
export const opp = (d) => (d + 2) & 3;
export const leftOf = (d) => (d + 3) & 3;
export const rightOf = (d) => (d + 1) & 3;

export const W = 28;
export const H = 18;

export const DAY_LEN = 180;       // 1 日の長さ（秒）。等速で 3 分
export const LAST_TRUCK = 150;    // これより後にトラックは来ない
export const SP = 0.5;            // ベルトの上の荷物どうしの間（マス）。1 マスに 2 個まで
export const ARM_GAP = 0.42;      // アームが置くときに空いていてほしい幅
export const EXP_TIME = 50;       // 速達の期限（荷下ろしからの秒）

// 宛先：A ● 青 / B ▲ 橙 / C ■ 緑 / D ◆ 紫（形でも見分けられるように）
export const DESTS = [
  { key: 'A', color: '#2f7bff', sym: '●' },
  { key: 'B', color: '#ff9419', sym: '▲' },
  { key: 'C', color: '#16b26a', sym: '■' },
  { key: 'D', color: '#c63ee0', sym: '◆' },
];

// フィルター：'any'（すべて）、0〜3（宛先）、'exp'（速達）、'unk'（ラベル不明）、'alt'（交互：仕分けゲートだけ）
export const ARM_FILTERS = ['any', 0, 1, 2, 3, 'exp', 'unk'];
export const SORTER_FILTERS = [0, 1, 2, 3, 'exp', 'unk', 'alt'];

// 置けるもの。cost：建てる費用（撤去で全額返る）、opex：運用費（1 分あたり）、
// rot：向きがある、belt：ベルトの仲間（荷物が上を流れる）、
// walk：人型ロボが通るときの道の重さ（無ければ通れない）。ベルトは「回り道が 17 マスより長いときだけ越える」くらいに重くする
// unlock：使えるようになる日
export const BELT_WALK = 18;
export const DEFS = {
  belt: { cost: 5, opex: 0.03, rot: true, belt: true, walk: BELT_WALK, unlock: 1 },
  sorter: { cost: 60, opex: 0.6, rot: true, belt: true, walk: BELT_WALK, unlock: 3 },
  junction: { cost: 25, opex: 0.05, rot: false, belt: true, walk: BELT_WALK, unlock: 3 },
  arm: { cost: 90, opex: 1.5, rot: true, unlock: 2 },
  shelf: { cost: 40, opex: 0, rot: false, unlock: 1 },
  pad: { cost: 250, opex: 2, rot: false, unlock: 1 },
  charger: { cost: 120, opex: 0.5, rot: false, walk: 3, unlock: 1 },
  labeler: { cost: 220, opex: 2, rot: true, unlock: 5 },
  dock: { cost: 0, opex: 0, rot: true, fixed: true },
};
export const ROBOT_COST = 350;
export const ROBOT_OPEX = 8;     // 1 分あたり

// 道具の並び（UI の順）。'robot' は人型ロボを雇う、'remove' は撤去、'select' は調べる
export const TOOLS = ['select', 'belt', 'sorter', 'junction', 'arm', 'shelf', 'pad', 'charger', 'robot', 'labeler', 'remove'];
export const toolUnlock = (tool) => (tool === 'select' || tool === 'remove' ? 1 : tool === 'robot' ? 1 : DEFS[tool]?.unlock ?? 99);

// 機械の性能（アップグレードで変わるものは World.perf() で計算する）
export const BASE = {
  beltSpeed: 1.25,      // マス/秒
  armCycle: 1.0,        // アームの 1 回の動きの長さの倍率（小さいほど速い）
  droneCap: 3,          // ドローン 1 機が一度に運ぶ数
  drones: 1,            // ポート 1 つのドローンの数
  flight: 6.5,          // ドローンの往復（秒、離着陸を除く）
  robotSpeed: 1.9,      // 人型ロボの歩く速さ（マス/秒、床の上）
  robotCarry: 1,
  battery: 1,           // バッテリーの持ちの倍率
  padCap: 6,
  shelfCap: 8,
  dockCap: 12,
};

// アップグレード（日報の画面で買う）。lv ごとの値段と効果
export const UPGRADES = {
  belt: { costs: [400, 900], apply: (p, lv) => { p.beltSpeed *= [1, 1.3, 1.6][lv]; } },
  arm: { costs: [400, 900], apply: (p, lv) => { p.armCycle *= [1, 0.75, 0.58][lv]; } },
  droneCap: { costs: [500, 1000], apply: (p, lv) => { p.droneCap += lv; } },
  drones: { costs: [1200], apply: (p, lv) => { p.drones += lv; } },
  robotSpeed: { costs: [500, 1000], apply: (p, lv) => { p.robotSpeed *= [1, 1.25, 1.5][lv]; } },
  robotCarry: { costs: [900], apply: (p, lv) => { p.robotCarry += lv; } },
  battery: { costs: [350], apply: (p, lv) => { p.battery *= [1, 1.6][lv]; } },
};

// 収支
export const PRICE = { normal: 8, expOnTime: 20, expLate: 4, mis: -15 };
