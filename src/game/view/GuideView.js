// 使い方の見本：小さな窓の中で、本物のシミュレーションと模型を動かして見せる（チュートリアルの動画の代わり）。
// 窓（canvas）は 1 つだけで、道具の説明の札・日の説明・あそびかたの、どれかの入れ物に差しこんで使う。
// 本編とは別の WebGLRenderer（別の canvas）で描く。見えている間だけ進めて描く。
//
//   guide.open(containerEl, 'arm')   guide.close()   guide.step(dt)（Game.step から）  guide.render()（Game.render から）
import * as THREE from 'three';
import { World } from '../sim/World.js';
import { SP } from '../sim/consts.js';
import { WorldView } from './WorldView.js';
import { CameraRig } from './CameraRig.js';
import { floorTex } from './textures.js';
import { t } from '../../core/i18n.js';

/** 道具 → 見本の種類（同じ見本を使い回すものもある）。 */
export const GUIDE_OF = { belt: 'belt', sorter: 'sorter', junction: 'junction', arm: 'arm', shelf: 'flow', robot: 'flow', pad: 'pad', charger: 'charger', labeler: 'labeler' };
export const GUIDE_KINDS = ['flow', 'belt', 'arm', 'sorter', 'junction', 'labeler', 'pad', 'charger'];

const A = 0, B = 1, C = 2, D = 3;
const line = (w, x0, y0, x1, y1, dir) => { for (let x = x0, y = y0; ; ) { w.build('belt', x, y, dir); if (x === x1 && y === y1) break; x += Math.sign(x1 - x); y += Math.sign(y1 - y); } };

// 見本の筋書き。cam：注視点 [x, z] と距離。feed：荷物を流し込む所（at のマスに side の面から、every 秒ごと、specs を順に）。
// labels：窓の上に出す言葉（i18n のキー）。tiles：色を付けるマス（アームの取る・置く）
const SCEN = {
  // 1 日目の基本：入荷口から棚までベルト、人型ロボがポートへ
  flow: {
    cam: [4.3, 3.2, 7.6],
    build(w) {
      line(w, 1, 3, 4, 3, 0); w.build('shelf', 5, 3);
      w.build('pad', 7, 2, 0, { dest: A }); w.build('pad', 7, 4, 0, { dest: B });
      w.hire(6, 3);
    },
    feed: [{ at: [1, 3], side: 2, every: 2.2, specs: [{ dest: A }, { dest: B }, { dest: B }, { dest: A }] }],
    labels: [['guide.lbl.belt', 2.5, 0.7, 3], ['guide.lbl.shelf', 5, 1.2, 3], ['guide.lbl.robot', 6.2, 1.4, 4.2]],
  },
  // ベルト：矢印の向きへ運ぶ。横からつなぐと合流
  belt: {
    cam: [4, 3.6, 7.2],
    build(w) { line(w, 1, 3, 6, 3, 0); w.build('shelf', 7, 3); line(w, 4, 6, 4, 4, 3); },
    feed: [{ at: [1, 3], side: 2, every: 1.6, specs: [{ dest: A }, { dest: C }] }, { at: [4, 6], side: 1, every: 2.1, specs: [{ dest: B }, { dest: D }] }],
    labels: [['guide.lbl.flow', 2, 0.7, 3], ['guide.lbl.merge', 4, 0.7, 5.2]],
  },
  // アーム：後ろ（青）から取って、前（橙）に置く。前がポートならフィルターも合う
  arm: {
    cam: [4, 3.2, 7.2],
    build(w) {
      line(w, 1, 4, 6, 4, 0); w.build('shelf', 7, 4);
      w.build('arm', 4, 3, 3, { filter: A }); w.build('pad', 4, 2, 0, { dest: A });
    },
    feed: [{ at: [1, 4], side: 2, every: 1.25, specs: [{ dest: A }, { dest: B }, { dest: A }, { dest: C }] }],
    tiles: [[4, 4, '#4aa3ff'], [4, 2, '#ffa53a']],
    labels: [['guide.lbl.take', 4, 0.75, 4.55, 'take'], ['guide.lbl.put', 4, 1.05, 1.55, 'put'], ['guide.lbl.filterA', 5.3, 0.9, 3]],
  },
  // 仕分けゲート：フィルターに合う荷物だけを横へ
  sorter: {
    cam: [4, 3.4, 7.2],
    build(w) {
      line(w, 1, 4, 6, 4, 0); w.build('shelf', 7, 4);
      w.build('sorter', 4, 4, 0, { filter: A, side: 'L' }); line(w, 4, 3, 4, 3, 3); w.build('pad', 4, 2, 0, { dest: A });
    },
    feed: [{ at: [1, 4], side: 2, every: 0.9, specs: [{ dest: A }, { dest: B }, { dest: C }, { dest: A }, { dest: D }] }],
    labels: [['guide.lbl.gate', 4, 1.25, 4.4], ['guide.lbl.others', 6.2, 0.7, 4]],
  },
  // 交差：二つの線がまっすぐ通り抜ける
  junction: {
    cam: [4, 3.8, 8.4],
    build(w) {
      line(w, 1, 4, 6, 4, 0); w.build('shelf', 7, 4);
      line(w, 4, 1, 4, 6, 1); w.build('shelf', 4, 7);
      w.build('junction', 4, 4);
    },
    feed: [{ at: [1, 4], side: 2, every: 1.1, specs: [{ dest: A }] }, { at: [4, 1], side: 3, every: 1.3, specs: [{ dest: B }] }],
    labels: [['guide.lbl.cross', 4, 1, 4.6]],
  },
  // ラベル機：? を読み取って前へ
  labeler: {
    cam: [3.8, 3.1, 6.6],
    build(w) { line(w, 1, 3, 2, 3, 0); w.build('labeler', 3, 3, 0); line(w, 4, 3, 5, 3, 0); w.build('shelf', 6, 3); },
    feed: [{ at: [1, 3], side: 2, every: 2.6, specs: [{ dest: A, unk: true }, { dest: C, unk: true }, { dest: B, unk: true }] }],
    labels: [['guide.lbl.unk', 1.5, 0.7, 3], ['guide.lbl.read', 4.6, 0.7, 3]],
  },
  // ドローンポート：宛先の合う荷物をドローンで出荷
  pad: {
    cam: [3.6, 2.9, 6.8],
    build(w) { line(w, 1, 3, 4, 3, 0); w.build('pad', 5, 3, 0, { dest: A }); },
    feed: [{ at: [1, 3], side: 2, every: 1.2, specs: [{ dest: A }] }],
    labels: [['guide.lbl.ship', 5, 1.4, 3]],
  },
  // 充電器：バッテリーが減ると充電しに来る
  charger: {
    cam: [3.6, 3, 6.4], pre: 0, loop: 16,
    build(w) { w.build('charger', 6, 3); const r = w.hire(1, 3); r.bat = 20; },
    feed: [],
    labels: [['guide.lbl.charge', 6, 1.3, 3]],
  },
};

export class GuideView {
  constructor() {
    this.kind = null;
    this.box = null;
    this.ready = false;
  }

  _init() {
    if (this.ready) return;
    this.ready = true;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.canvas = r.domElement;
    this.canvas.className = 'guide-canvas';
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color('#1a2638');
    scene.add(new THREE.HemisphereLight(0xdcebff, 0x8a8172, 1.25));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff4e6, 2.5));
    sun.position.set(9, 14, 10);
    sun.target.position.set(4, 0, 3.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0005;
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 50 });
    scene.add(sun, sun.target);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 11).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTex(14, 11), roughness: 0.92 }));
    floor.position.set(4.5, 0.001, 3.5);
    floor.receiveShadow = true;
    scene.add(floor);
    this.world = new World();
    this.view = new WorldView(scene, this.world, { mini: true });
    this.camera = new THREE.PerspectiveCamera(34, 1.6, 0.3, 120);
    this.rig = new CameraRig(this.camera);
    this.tileGroup = new THREE.Group();
    scene.add(this.tileGroup);
    this.labelBox = document.createElement('div');
    this.labelBox.className = 'guide-labels';
  }

  /** box（要素）の中で、kind の見本を動かす。 */
  open(box, kind) {
    if (!SCEN[kind]) return false;
    this._init();
    this.box = box;
    this.kind = kind;
    box.classList.add('guide-host');
    box.append(this.canvas, this.labelBox);
    this._setup();
    return true;
  }

  close() {
    this.canvas?.remove();
    this.labelBox?.remove();
    this.box?.classList.remove('guide-host');
    this.box = null;
    this.kind = null;
  }

  get visible() { return !!(this.box && this.box.isConnected && this.box.offsetParent !== null); }

  _setup() {
    const S = SCEN[this.kind];
    const w = this.world;
    w.setupSandbox();
    S.build(w);
    w.relink();
    this.feedT = S.feed.map(() => 0.2);
    this.feedI = S.feed.map(() => 0);
    this.age = 0;
    // 先に少し進めて、流れている所から見せる
    for (let i = 0; i < (S.pre ?? 1.5) * 60; i++) this._tick(1 / 60);
    const [x, z, d] = S.cam;
    this.rig.snap(x, z, d, 0);
    // 色を付けるマス
    this.tileGroup.clear();
    for (const [tx, ty, col] of S.tiles || []) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.4, depthWrite: false, depthTest: false }));
      m.position.set(tx, 0.25, ty);
      m.renderOrder = 9;
      this.tileGroup.add(m);
    }
    // 言葉
    this.labelBox.innerHTML = '';
    this.labels = (S.labels || []).map(([key, x, y, z, cls]) => {
      const el = document.createElement('span');
      el.className = 'gl-tag ' + (cls || '');
      el.textContent = t(key);
      el.dataset.key = key;
      this.labelBox.append(el);
      return { el, x, y, z };
    });
  }

  _tick(dt) {
    const S = SCEN[this.kind];
    const w = this.world;
    // 流し込み
    S.feed.forEach((f, i) => {
      this.feedT[i] -= dt;
      if (this.feedT[i] > 0) return;
      const b = w.at(f.at[0], f.at[1]);
      if (!b?.lanes) return;
      const L = b.lanes[b.type === 'junction' ? f.side & 1 : 0];
      if (L.length && L[L.length - 1].pos < SP) return;
      const spec = f.specs[this.feedI[i]++ % f.specs.length];
      w._enterBelt(b, w._newPkg(spec), f.side, 0);
      this.feedT[i] = f.every;
    });
    // 片づけ：行き止まりの棚がいっぱいにならないように、古いものから消す
    for (const s of w.lists.shelves) {
      while (s.store.length > (this.kind === 'flow' ? 6 : 3)) { const p = s.store.shift(); w.packages.delete(p); }
    }
    w.step(dt);
    w.events.length = 0;
  }

  /** Game.step から。見えていなければ何もしない。 */
  step(dt) {
    if (!this.box) return;
    if (!this.visible) return;
    this.age += dt;
    // 長く見ていても崩れないよう、ときどき最初から
    if (this.age > (SCEN[this.kind].loop || 40)) { this._setup(); return; }
    const n = Math.max(1, Math.ceil(dt / (1 / 60) - 1e-6));
    for (let i = 0; i < n; i++) this._tick(dt / n);
    this.simDt = (this.simDt || 0) + dt;
  }

  /** Game.render から。 */
  render(dt) {
    if (!this.box || !this.visible) return;
    const w = Math.max(1, this.box.clientWidth), h = Math.max(1, this.box.clientHeight);
    if (this._w !== w || this._h !== h) {
      this._w = w; this._h = h;
      this.renderer.setSize(w, h, true);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.rig.update(dt);
    this.view.sync(dt, this.simDt || 0, this.rig);
    this.simDt = 0;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    for (const L of this.labels) {
      const p = this.rig.toScreen(L.x, L.y, L.z, w, h);
      L.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
    }
  }

  /** 言語を変えたとき。 */
  relabel() { for (const L of this.labels || []) L.el.textContent = t(L.el.dataset.key); }
}
