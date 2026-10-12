// 手続きで組み立てるモデル。どれも「見えない Object3D の階層」を返す（Instancer がまとめて描く）。
// 形と材質は使い回す（同じ形・材質なら 1 回の描画にまとまる）。
// 向き：どのモデルも「前 = +X」。マスの向き d には rotation.y = -d·π/2 を掛ける。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DESTS } from '../sim/consts.js';
import { beltTex, labelTex, cardboardTex, padTex, signTex, trailerTex, ringTex, blobTex } from './textures.js';

// ------------------------------------------------------------------ 材質
const std = (color, rough = 0.6, metal = 0.1, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });

let _M = null;
export function mats() {
  if (_M) return _M;
  const belt = beltTex();
  const M = {
    belt: std('#ffffff', 0.85, 0.05, { map: belt }),
    beltStatic: std('#ffffff', 0.85, 0.05, { map: beltTex() }),
    frame: std('#a3adb8', 0.4, 0.55),
    dark: std('#3b4048', 0.7, 0.25),
    darker: std('#23272d', 0.8, 0.15),
    steel: std('#c7ced6', 0.35, 0.6),
    orange: std('#ff7a1f', 0.42, 0.12),
    yellow: std('#f2c230', 0.5, 0.1),
    white: std('#f2f4f7', 0.38, 0.05),
    shell: std('#f4f6f9', 0.3, 0.05),
    joint: std('#4a505a', 0.55, 0.3),
    visor: std('#0f141b', 0.12, 0.5),
    eye: basic('#5cf6ff'),
    cyan: basic('#47e8ff'),
    amber: basic('#ffb02e'),
    red: basic('#ff4a4a'),
    green: basic('#4dff8a'),
    led: basic('#ffffff'),           // 色は tint で
    rackPost: std('#2f5d9b', 0.5, 0.35),
    rackBeam: std('#ff8a2a', 0.5, 0.2),
    deck: std('#b8c0c9', 0.5, 0.5),
    rotor: new THREE.MeshStandardMaterial({ color: '#59616c', roughness: 0.5, transparent: true, opacity: 0.5, depthWrite: false }),
    box: std('#ffffff', 0.85, 0.0, { map: cardboardTex() }),
    cab: std('#ffffff', 0.4, 0.2),
    glass: std('#1c2633', 0.1, 0.6),
    tire: std('#1b1d21', 0.9, 0.0),
    trailer: std('#eef1f4', 0.5, 0.15),
    door: std('#c6ced8', 0.45, 0.4),
    labelerBody: std('#e9eef3', 0.4, 0.1),
    labelerPanel: std('#2b6fd6', 0.5, 0.2),
    screen: basic('#7ff3ff'),
    ring: new THREE.MeshBasicMaterial({ map: ringTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    blob: new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false }),
    arrow: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false }),
    sideArrow: new THREE.MeshBasicMaterial({ color: '#47e8ff', transparent: true, opacity: 0.9, depthWrite: false }),
    label: {}, padTop: [], sign: {}, trailerSide: [],
  };
  M.beltTexture = belt;
  for (let d = 0; d < 4; d++) {
    M.label[d] = std('#ffffff', 0.7, 0, { map: labelTex(d) });
    M.label['x' + d] = std('#ffffff', 0.7, 0, { map: labelTex(d, true) });
    M.padTop[d] = std('#ffffff', 0.7, 0.1, { map: padTex(d) });
  }
  M.label.unk = std('#ffffff', 0.7, 0, { map: labelTex('unk') });
  for (const f of ['any', 0, 1, 2, 3, 'exp', 'unk', 'alt']) M.sign[f] = new THREE.MeshBasicMaterial({ map: signTex(f), transparent: true });
  const TRUCK = ['#e2483a', '#2d6cdf', '#e8a815', '#2ea36b', '#8e5bd8'];
  M.truckColors = TRUCK.map((c) => new THREE.Color(c));
  M.trailerSide = TRUCK.map((c) => std('#ffffff', 0.5, 0.1, { map: trailerTex(c) }));
  for (const [k, m] of Object.entries(M)) if (m?.isMaterial) m.name = k;
  return (_M = M);
}

// ------------------------------------------------------------------ 形
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 16) => new THREE.CylinderGeometry(rt, rb, h, seg);
function at(g, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
  return g.clone().applyMatrix4(m);
}

/** 平らな四角（上向き）。u は z、v は x に沿う（v が流れる向き）。 */
function flatQuad(x0, x1, z0, z1, y) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** 平らな扇形（上向き）。中心 (cx, cz)、半径 r0〜r1、角度 a0 → a1。v は角度に沿う。 */
function flatArc(cx, cz, r0, r1, a0, a1, y, seg = 10, flipU = false) {
  const pos = [], uv = [], nor = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const s = i / seg, a = a0 + (a1 - a0) * s;
    const c = Math.cos(a), sn = Math.sin(a);
    pos.push(cx + c * r0, y, cz + sn * r0, cx + c * r1, y, cz + sn * r1);
    uv.push(flipU ? 1 : 0, s, flipU ? 0 : 1, s);
    nor.push(0, 1, 0, 0, 1, 0);
    if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 3, k, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // 面の向きをそろえる（上から見える向きに）
  const n = new THREE.Vector3();
  g.computeVertexNormals();
  n.fromBufferAttribute(g.attributes.normal, 0);
  if (n.y < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/** 弧に沿った細い箱の並び（ベルトの手すり）。 */
function arcRail(cx, cz, r, a0, a1, y, h, w, seg = 8) {
  const parts = [];
  for (let i = 0; i < seg; i++) {
    const am = a0 + (a1 - a0) * ((i + 0.5) / seg);
    const len = Math.abs(a1 - a0) / seg * r + 0.01;
    parts.push(at(box(w, h, len), cx + Math.cos(am) * r, y, cz + Math.sin(am) * r, 0, -am, 0));
  }
  return mergeGeometries(parts);
}

/** 扇形の土台（押し出し）。 */
function arcBase(cx, cz, r0, r1, a0, a1, y0, y1, seg = 10) {
  const shape = new THREE.Shape();
  const P = (r, a) => [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  const pts = [];
  for (let i = 0; i <= seg; i++) pts.push(P(r1, a0 + (a1 - a0) * (i / seg)));
  for (let i = seg; i >= 0; i--) pts.push(P(r0, a0 + (a1 - a0) * (i / seg)));
  shape.moveTo(pts[0][0], -pts[0][1]);
  for (const p of pts.slice(1)) shape.lineTo(p[0], -p[1]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

export const BELT_Y = 0.215;   // ベルトの面の高さ
export const BOX = { w: 0.34, h: 0.26, d: 0.34 };

let _G = null;
export function geos() {
  if (_G) return _G;
  const G = {};
  // --- ベルト（まっすぐ）
  G.beltBase = at(box(1.0, 0.13, 0.7), 0, 0.125, 0);
  G.beltSurf = flatQuad(-0.5, 0.5, -0.31, 0.31, BELT_Y);
  G.beltRails = mergeGeometries([at(box(1.0, 0.07, 0.05), 0, 0.235, -0.345), at(box(1.0, 0.07, 0.05), 0, 0.235, 0.345)]);
  G.beltFeet = mergeGeometries([at(box(0.07, 0.07, 0.62), -0.4, 0.035, 0), at(box(0.07, 0.07, 0.62), 0.4, 0.035, 0)]);
  // --- ベルト（曲がる）：L は左（北）から入って前（東）へ、R は右（南）から
  for (const [k, cz, a0, a1, flip] of [['L', -0.5, Math.PI, Math.PI / 2, false], ['R', 0.5, Math.PI, Math.PI * 1.5, true]]) {
    G['curveSurf' + k] = flatArc(0.5, cz, 0.19, 0.81, a0, a1, BELT_Y, 12, flip);
    G['curveBase' + k] = arcBase(0.5, cz, 0.15, 0.85, a0, a1, 0.06, 0.19, 12);
    G['curveRails' + k] = mergeGeometries([arcRail(0.5, cz, 0.155, a0, a1, 0.235, 0.07, 0.05, 6), arcRail(0.5, cz, 0.845, a0, a1, 0.235, 0.07, 0.05, 10)]);
  }
  // --- 交差
  G.junctionBase = at(box(0.98, 0.13, 0.98), 0, 0.125, 0);
  G.junctionSurfX = flatQuad(-0.5, 0.5, -0.31, 0.31, BELT_Y);
  G.junctionSurfZ = flatQuad(-0.5, 0.5, -0.31, 0.31, BELT_Y + 0.003).rotateY(Math.PI / 2);
  G.junctionCorners = mergeGeometries([-1, 1].flatMap((sx) => [-1, 1].map((sz) => at(box(0.16, 0.08, 0.16), sx * 0.42, 0.235, sz * 0.42))));
  // --- 仕分けゲート
  G.gatePosts = mergeGeometries([at(box(0.06, 0.6, 0.06), 0, 0.5, -0.41), at(box(0.06, 0.6, 0.06), 0, 0.5, 0.41)]);
  G.gateBar = at(box(0.16, 0.09, 0.9), 0, 0.82, 0);
  G.gateLight = at(box(0.04, 0.02, 0.7), 0, 0.77, 0);
  G.gateSign = new THREE.PlaneGeometry(0.34, 0.34).rotateX(-Math.PI / 2).translate(0, 0.87, 0);
  G.pusher = at(box(0.3, 0.12, 0.05), 0, 0.29, 0);
  // 横向きの矢印（+Z へ）
  const tri = new THREE.Shape();
  tri.moveTo(-0.13, 0); tri.lineTo(0.13, 0); tri.lineTo(0, 0.17); tri.closePath();
  G.sideArrow = new THREE.ShapeGeometry(tri).rotateX(Math.PI / 2).translate(0, 0.875, 0.28);
  // --- 床の矢印（アームの向き。-X → +X）
  const arr = new THREE.Shape();
  arr.moveTo(0.36, -0.16); arr.lineTo(0.47, 0); arr.lineTo(0.36, 0.16); arr.lineTo(0.36, 0.09); arr.lineTo(0.41, 0); arr.lineTo(0.36, -0.09); arr.closePath();
  G.floorArrow = new THREE.ShapeGeometry(arr).rotateX(-Math.PI / 2).translate(0, 0.012, 0);
  G.floorSign = new THREE.PlaneGeometry(0.3, 0.3).rotateX(-Math.PI / 2);
  // --- アーム
  G.armBase = at(cyl(0.3, 0.34, 0.1, 20), 0, 0.05, 0);
  G.armRing = at(cyl(0.22, 0.26, 0.1, 20), 0, 0.15, 0);
  G.armTurret = at(box(0.3, 0.2, 0.28), 0, 0.1, 0);
  G.armJoint = cyl(0.085, 0.085, 0.2, 14).rotateX(Math.PI / 2);
  G.armJointS = cyl(0.065, 0.065, 0.16, 12).rotateX(Math.PI / 2);
  G.armUpper = at(box(0.55, 0.11, 0.11), 0.275, 0, 0);
  G.armFore = at(box(0.55, 0.09, 0.09), 0.275, 0, 0);
  G.armWrist = at(cyl(0.05, 0.05, 0.12, 10).rotateZ(Math.PI / 2), 0.06, 0, 0);
  G.armCup = at(cyl(0.08, 0.1, 0.04, 14).rotateZ(Math.PI / 2), 0.13, 0, 0);
  G.armLed = at(cyl(0.055, 0.055, 0.02, 12).rotateZ(Math.PI / 2), 0.1, 0, 0);
  // --- 荷物
  G.box = box(BOX.w, BOX.h, BOX.d);
  G.label = new THREE.PlaneGeometry(0.25, 0.25).rotateX(-Math.PI / 2);
  // --- ドローンポート
  G.padBase = at(box(0.94, 0.1, 0.94), 0, 0.05, 0);
  G.padTop = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2).translate(0, 0.102, 0);
  G.padLights = mergeGeometries([-1, 1].flatMap((sx) => [-1, 1].map((sz) => at(box(0.06, 0.04, 0.06), sx * 0.43, 0.12, sz * 0.43))));
  // --- ドローン
  G.droneBody = at(box(0.28, 0.09, 0.28), 0, 0, 0);
  G.droneDome = new THREE.SphereGeometry(0.12, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(0, 0.045, 0);
  G.droneArms = mergeGeometries([0, 1, 2, 3].map((i) => at(box(0.58, 0.03, 0.04), 0, 0.01, 0, 0, Math.PI / 4 + (i * Math.PI) / 2, 0)));
  G.droneMotor = cyl(0.035, 0.035, 0.06, 10);
  G.rotor = cyl(0.14, 0.14, 0.006, 20);
  G.droneLed = at(box(0.32, 0.025, 0.32), 0, -0.035, 0);
  G.droneSkids = mergeGeometries([at(box(0.03, 0.03, 0.34), -0.11, -0.09, 0), at(box(0.03, 0.03, 0.34), 0.11, -0.09, 0), at(box(0.02, 0.07, 0.02), -0.11, -0.06, 0.12), at(box(0.02, 0.07, 0.02), 0.11, -0.06, 0.12), at(box(0.02, 0.07, 0.02), -0.11, -0.06, -0.12), at(box(0.02, 0.07, 0.02), 0.11, -0.06, -0.12)]);
  G.cable = at(box(0.012, 0.12, 0.012), 0, -0.12, 0);
  // --- 棚
  G.rackPosts = mergeGeometries([-1, 1].flatMap((sx) => [-1, 1].map((sz) => at(box(0.05, 0.92, 0.05), sx * 0.42, 0.46, sz * 0.36))));
  G.rackBeams = mergeGeometries([0.24, 0.62].flatMap((y) => [-1, 1].map((sz) => at(box(0.88, 0.06, 0.04), 0, y, sz * 0.36))));
  G.rackDecks = mergeGeometries([0.24, 0.62].map((y) => at(box(0.84, 0.02, 0.72), 0, y + 0.03, 0)));
  // --- 充電ステーション
  G.chgBase = at(cyl(0.42, 0.45, 0.05, 24), 0, 0.025, 0);
  G.chgStripe = new THREE.RingGeometry(0.33, 0.4, 24).rotateX(-Math.PI / 2).translate(0, 0.052, 0);
  G.chgPost = at(box(0.12, 0.66, 0.16), -0.36, 0.33, 0);
  G.chgHead = at(box(0.16, 0.18, 0.26), -0.34, 0.68, 0);
  G.chgScreen = at(box(0.01, 0.1, 0.18), -0.255, 0.68, 0);
  G.ring = new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2);
  // --- ラベル機
  G.labBody = at(box(0.66, 0.5, 0.74), -0.08, 0.25, 0);
  G.labPanel = at(box(0.67, 0.12, 0.75), -0.08, 0.42, 0);
  G.labMouth = at(box(0.04, 0.24, 0.5), -0.42, 0.22, 0);
  G.labScreen = new THREE.PlaneGeometry(0.3, 0.22).rotateX(-Math.PI / 2).translate(-0.12, 0.505, 0);
  G.labHead = at(box(0.1, 0.06, 0.5), 0, 0, 0);
  G.labOut = flatQuad(0.25, 0.5, -0.24, 0.24, BELT_Y);
  G.labOutBase = at(box(0.25, 0.13, 0.54), 0.375, 0.125, 0);
  // --- 入荷口
  G.dockPosts = mergeGeometries([at(box(0.12, 1.3, 0.12), 0, 0.65, -0.52), at(box(0.12, 1.3, 0.12), 0, 0.65, 0.52), at(box(0.18, 0.16, 1.2), 0, 1.3, 0)]);
  G.dockRoll = at(cyl(0.11, 0.11, 1.0, 14).rotateX(Math.PI / 2), 0.02, 1.13, 0);
  G.dockBed = at(box(1.7, 0.16, 0.96), -0.35, 0.08, 0);
  G.dockBedTop = flatQuad(-1.2, 0.5, -0.44, 0.44, 0.162);
  G.dockLight = at(box(0.08, 0.08, 0.08), 0.06, 1.42, -0.5);
  G.bumpers = mergeGeometries([at(box(0.1, 0.22, 0.16), -0.56, 0.3, -0.36), at(box(0.1, 0.22, 0.16), -0.56, 0.3, 0.36)]);
  // --- トラック（後ろが原点、-X へ伸びる）
  G.trailer = at(box(3.3, 1.15, 1.02), -1.65, 0.95, 0);
  G.trailerSideL = new THREE.PlaneGeometry(3.25, 1.1).translate(-1.65, 0.95, 0.512);
  G.trailerSideR = new THREE.PlaneGeometry(3.25, 1.1).rotateY(Math.PI).translate(-1.65, 0.95, -0.512);
  G.chassis = at(box(4.4, 0.16, 0.8), -2.2, 0.36, 0);
  G.cab = at(box(0.95, 0.95, 1.0), -3.95, 0.86, 0);
  G.cabRoof = at(box(0.7, 0.18, 0.96), -3.85, 1.42, 0);
  G.windshield = at(box(0.04, 0.42, 0.86), -4.43, 1.02, 0);
  G.wheels = mergeGeometries([-0.55, -1.0, -3.9].flatMap((x) => [-1, 1].map((sz) => at(cyl(0.22, 0.22, 0.14, 14).rotateX(Math.PI / 2), x, 0.22, sz * 0.43))));
  // --- 人型ロボ
  G.pelvis = at(box(0.22, 0.09, 0.16), 0, 0, 0);
  G.chest = at(cyl(0.13, 0.105, 0.26, 14), 0, 0.13, 0);
  G.chestLight = at(box(0.02, 0.04, 0.09), 0.115, 0.16, 0);
  G.pack = at(box(0.08, 0.17, 0.17), -0.12, 0.15, 0);
  G.neck = at(cyl(0.035, 0.04, 0.05, 8), 0, 0.28, 0);
  G.head = new THREE.SphereGeometry(0.11, 18, 12).scale(1.05, 0.95, 1).translate(0, 0.095, 0);
  G.visor = new THREE.SphereGeometry(0.096, 18, 10, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.3, Math.PI * 0.35).translate(0.018, 0.095, 0);
  G.antenna = mergeGeometries([at(cyl(0.008, 0.008, 0.09, 6), 0, 0.22, 0), new THREE.SphereGeometry(0.022, 8, 6).translate(0, 0.27, 0)]);
  G.eyes = mergeGeometries([at(box(0.02, 0.022, 0.035), 0.103, 0.1, -0.036), at(box(0.02, 0.022, 0.035), 0.103, 0.1, 0.036)]);
  G.upperArm = at(cyl(0.036, 0.032, 0.2, 10), 0, -0.1, 0);
  G.foreArm = at(cyl(0.03, 0.026, 0.18, 10), 0, -0.09, 0);
  G.hand = new THREE.SphereGeometry(0.035, 10, 8).translate(0, -0.19, 0);
  G.shoulder = new THREE.SphereGeometry(0.048, 12, 8);
  G.thigh = at(cyl(0.046, 0.04, 0.2, 10), 0, -0.1, 0);
  G.shin = at(cyl(0.04, 0.034, 0.19, 10), 0, -0.095, 0);
  G.foot = at(box(0.13, 0.04, 0.07), 0.025, -0.2, 0);
  G.knee = new THREE.SphereGeometry(0.04, 10, 8);
  G.blob = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  for (const [k, g] of Object.entries(G)) g.name = k;
  return (_G = G);
}

// ------------------------------------------------------------------ 組み立て
function mesh(geo, mat, { cast = true, recv = true, name } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = recv;
  if (name) m.name = name;
  return m;
}

export function makeBelt(shape = 'S') {
  const G = geos(), M = mats();
  const g = new THREE.Group();
  if (shape === 'S') {
    g.add(mesh(G.beltBase, M.dark), mesh(G.beltSurf, M.belt, { cast: false }), mesh(G.beltRails, M.frame), mesh(G.beltFeet, M.darker, { cast: false }));
  } else {
    g.add(mesh(G['curveBase' + shape], M.dark), mesh(G['curveSurf' + shape], M.belt, { cast: false }), mesh(G['curveRails' + shape], M.frame));
  }
  return g;
}

export function makeJunction() {
  const G = geos(), M = mats();
  const g = new THREE.Group();
  g.add(mesh(G.junctionBase, M.dark), mesh(G.junctionSurfX, M.belt, { cast: false }), mesh(G.junctionSurfZ, M.beltStatic, { cast: false }), mesh(G.junctionCorners, M.frame));
  return g;
}

export function makeSorter() {
  const G = geos(), M = mats();
  const g = makeBelt('S');
  g.add(mesh(G.gatePosts, M.steel), mesh(G.gateBar, M.labelerPanel), mesh(G.gateLight, M.cyan, { cast: false }));
  const sign = mesh(G.gateSign, M.sign[0], { cast: false, recv: false, name: 'sign' });
  const arrow = mesh(G.sideArrow, M.sideArrow, { cast: false, recv: false, name: 'arrow' });
  const pusher = mesh(G.pusher, M.yellow, { name: 'pusher' });
  g.add(sign, arrow, pusher);
  g.userData = { sign, arrow, pusher };
  return g;
}

export function makeArm() {
  const G = geos(), M = mats();
  const g = new THREE.Group();
  g.add(mesh(G.armBase, M.dark), mesh(G.armRing, M.joint));
  const arrow = mesh(G.floorArrow, M.arrow, { cast: false, recv: false });
  const sign = mesh(G.floorSign, M.sign.any, { cast: false, recv: false });
  sign.position.set(-0.33, 0.014, 0.33);
  g.add(arrow, sign);
  const turret = new THREE.Group(); turret.position.y = 0.2; g.add(turret);
  turret.add(mesh(G.armTurret, M.orange));
  const shoulder = new THREE.Group(); shoulder.position.set(0, 0.3, 0); turret.add(shoulder);
  shoulder.add(mesh(G.armJoint, M.joint));
  shoulder.add(mesh(G.armUpper, M.orange));
  const elbow = new THREE.Group(); elbow.position.set(0.55, 0, 0); shoulder.add(elbow);
  elbow.add(mesh(G.armJointS, M.joint), mesh(G.armFore, M.orange));
  const wrist = new THREE.Group(); wrist.position.set(0.55, 0, 0); elbow.add(wrist);
  wrist.add(mesh(G.armWrist, M.joint), mesh(G.armCup, M.darker), mesh(G.armLed, M.cyan, { cast: false }));
  const tip = new THREE.Object3D(); tip.position.set(0.15, 0, 0); wrist.add(tip);
  g.userData = { turret, shoulder, elbow, wrist, tip, sign };
  return g;
}

/** 2 本の腕の逆運動学。肩から水平に r、高さ dy の所へ手首を持っていく。 */
export function armIK(arm, r, dy) {
  const L1 = 0.55, L2 = 0.55;
  const d = Math.min(L1 + L2 - 1e-3, Math.max(0.05, Math.hypot(r, dy)));
  const c2 = Math.max(-1, Math.min(1, (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2)));
  const q2 = -Math.acos(c2);
  const q1 = Math.atan2(dy, r) - Math.atan2(L2 * Math.sin(q2), L1 + L2 * Math.cos(q2));
  arm.shoulder.rotation.z = q1;
  arm.elbow.rotation.z = q2;
  arm.wrist.rotation.z = -Math.PI / 2 - (q1 + q2);
}

export function makePad(dest) {
  const G = geos(), M = mats();
  const g = new THREE.Group();
  const top = mesh(G.padTop, M.padTop[dest], { cast: false, name: 'top' });
  g.add(mesh(G.padBase, M.dark), top);
  const lights = mesh(G.padLights, M.amber, { cast: false, name: 'lights' });
  g.add(lights);
  g.userData = { top, lights };
  return g;
}

export function makeDrone() {
  const G = geos(), M = mats();
  const g = new THREE.Group();
  g.add(mesh(G.droneBody, M.shell), mesh(G.droneDome, M.white), mesh(G.droneArms, M.dark), mesh(G.droneSkids, M.dark, { cast: false }));
  const led = mesh(G.droneLed, M.led, { cast: false, name: 'led' });
  g.add(led);
  const rotors = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const x = Math.cos(a) * 0.29, z = Math.sin(a) * 0.29;
    const m = mesh(G.droneMotor, M.joint, { cast: false }); m.position.set(x, 0.03, z); g.add(m);
    const r = mesh(G.rotor, M.rotor, { cast: false, recv: false }); r.position.set(x, 0.065, z); g.add(r);
    rotors.push(r);
  }
  const hook = new THREE.Object3D(); hook.position.set(0, -0.12, 0); g.add(hook);
  const cable = mesh(G.cable, M.darker, { cast: false }); g.add(cable);
  g.userData = { led, rotors, hook, cable };
  return g;
}

export function makeShelf() {
  const G = geos(), M = mats();
  const g = new THREE.Group();
  g.add(mesh(G.rackPosts, M.rackPost), mesh(G.rackBeams, M.rackBeam), mesh(G.rackDecks, M.deck));
  return g;
}
/** 棚の荷物を置く場所（8 か所）。 */
export const SHELF_SLOTS = [0.27, 0.65].flatMap((y) => [[-0.2, -0.17], [0.2, -0.17], [-0.2, 0.17], [0.2, 0.17]].map(([x, z]) => [x, y + 0.03 + BOX.h / 2, z]));

export function makeCharger() {
  const G = geos(), M = mats();
  const g = new THREE.Group();
  g.add(mesh(G.chgBase, M.darker), mesh(G.chgStripe, M.yellow, { cast: false }), mesh(G.chgPost, M.white), mesh(G.chgHead, M.white), mesh(G.chgScreen, M.screen, { cast: false }));
  const ring = mesh(G.ring, M.ring, { cast: false, recv: false, name: 'ring' });
  ring.position.y = 0.06;
  g.add(ring);
  g.userData = { ring };
  return g;
}

export function makeLabeler() {
  const G = geos(), M = mats();
  const g = new THREE.Group();
  g.add(mesh(G.labBody, M.labelerBody), mesh(G.labPanel, M.labelerPanel), mesh(G.labMouth, M.darker), mesh(G.labScreen, M.screen, { cast: false }));
  g.add(mesh(G.labOutBase, M.dark), mesh(G.labOut, M.belt, { cast: false }));
  const head = mesh(G.labHead, M.orange, { name: 'head' });
  head.position.set(0.12, 0.55, 0);
  g.add(head);
  g.userData = { head };
  return g;
}

export function makeDock() {
  const G = geos(), M = mats();
  const g = new THREE.Group();
  g.add(mesh(G.dockPosts, M.dark), mesh(G.dockRoll, M.door), mesh(G.dockBed, M.joint), mesh(G.dockBedTop, M.beltStatic, { cast: false }), mesh(G.bumpers, M.darker));
  const light = mesh(G.dockLight, M.amber, { cast: false, name: 'light' });
  g.add(light);
  g.userData = { light };
  return g;
}
/** 入荷口の荷物を並べる場所（12 か所。前のほうから）。 */
export const DOCK_SLOTS = [];
for (let c = 0; c < 4; c++) for (const z of [0, -0.26, 0.26]) DOCK_SLOTS.push([0.28 - c * 0.38, 0.162 + BOX.h / 2, z]);

export function makeTruck(colorIdx = 0) {
  const G = geos(), M = mats();
  const g = new THREE.Group();
  g.add(mesh(G.trailer, M.trailer), mesh(G.trailerSideL, M.trailerSide[colorIdx], { cast: false }), mesh(G.trailerSideR, M.trailerSide[colorIdx], { cast: false }));
  g.add(mesh(G.chassis, M.darker), mesh(G.wheels, M.tire));
  const cab = mesh(G.cab, M.cab); cab.userData.tint = M.truckColors[colorIdx];
  const roof = mesh(G.cabRoof, M.cab); roof.userData.tint = M.truckColors[colorIdx];
  g.add(cab, roof, mesh(G.windshield, M.glass));
  return g;
}

export function makeRobot() {
  const G = geos(), M = mats();
  const root = new THREE.Group();
  const blob = mesh(G.blob, M.blob, { cast: false, recv: false });
  blob.scale.set(0.5, 1, 0.5); blob.position.y = 0.01;
  root.add(blob);
  const hips = new THREE.Group(); hips.position.y = 0.42; root.add(hips);
  hips.add(mesh(G.pelvis, M.joint));
  const torso = new THREE.Group(); torso.position.y = 0.04; hips.add(torso);
  torso.add(mesh(G.chest, M.shell), mesh(G.chestLight, M.cyan, { cast: false }), mesh(G.pack, M.joint), mesh(G.neck, M.joint));
  const head = new THREE.Group(); head.position.y = 0.29; torso.add(head);
  head.add(mesh(G.head, M.shell), mesh(G.visor, M.visor), mesh(G.eyes, M.eye, { cast: false }), mesh(G.antenna, M.cyan, { cast: false }));
  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(0, 0.22, s * 0.165); torso.add(sh);
    sh.add(mesh(G.shoulder, M.joint), mesh(G.upperArm, M.shell));
    const el = new THREE.Group(); el.position.y = -0.2; sh.add(el);
    el.add(mesh(G.foreArm, M.joint), mesh(G.hand, M.joint));
    arms.push({ sh, el });
    const hip = new THREE.Group(); hip.position.set(0, -0.03, s * 0.07); hips.add(hip);
    hip.add(mesh(G.thigh, M.shell));
    const kn = new THREE.Group(); kn.position.y = -0.2; hip.add(kn);
    kn.add(mesh(G.knee, M.joint), mesh(G.shin, M.joint), mesh(G.foot, M.darker));
    legs.push({ hip, kn });
  }
  const hold = new THREE.Object3D(); hold.position.set(0.2, 0.2, 0); torso.add(hold);
  root.userData = { hips, torso, head, arms, legs, hold, blob };
  return root;
}

/** 荷物の材質（ラベル）。 */
export function labelMat(p) {
  const M = mats();
  if (p.unk) return M.label.unk;
  return p.exp ? M.label['x' + p.dest] : M.label[p.dest];
}

export function destColor(d) { return new THREE.Color(DESTS[d].color); }
