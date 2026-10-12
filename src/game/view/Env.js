// 動かないまわりのもの：地面・構内の床・壁・外の舗装と道・木・遠くの街・看板・光（日の傾き）・雨。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { W, H } from '../sim/consts.js';
import { DOCKS } from '../sim/days.js';
import { floorTex, asphaltTex, grassTex, hatchTex, gridTex } from './textures.js';
import { Rng } from '../../core/rng.js';
import { clamp, lerp } from '../../core/math.js';

const C = (c) => new THREE.Color(c);
// 時刻（0 = 朝、0.5 = 昼、1 = 夕方）ごとの光
const SUN_KEYS = [
  { f: 0, sun: C('#ffd9a8'), si: 2.1, hemiSky: C('#cfe0ff'), hemiGround: C('#8c7c68'), hi: 1.15, fog: C('#c9d9e6') },
  { f: 0.5, sun: C('#fff4e6'), si: 2.7, hemiSky: C('#dcebff'), hemiGround: C('#8a8172'), hi: 1.25, fog: C('#cfe0ec') },
  { f: 1, sun: C('#ffad6e'), si: 1.9, hemiSky: C('#ffd2b0'), hemiGround: C('#7a6656'), hi: 1.05, fog: C('#e6c8b4') },
];
const STORM = { sun: C('#b8c4d4'), si: 0.9, hemiSky: C('#9aa8bb'), hemiGround: C('#4a4c52'), hi: 0.95, fog: C('#7d8896') };

export class Env {
  constructor(scene) {
    this.scene = scene;
    const g = (this.group = new THREE.Group());
    g.name = 'env';
    scene.add(g);
    this._lights();
    this._ground();
    this._walls();
    this._outside();
    this._overlays();
    this._rain();
    this.time = 0;
    this.storm = 0;
    this.setTime(0.1);
  }

  _lights() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0xdcebff, 0x8a8172, 1.2);
    const sun = (this.sun = new THREE.DirectionalLight(0xfff4e6, 2.6));
    sun.castShadow = true;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 22, bottom: -22, near: 1, far: 120 });
    sun.target.position.set(13.5, 0, 8.5);
    s.add(this.hemi, sun, sun.target);
    s.fog = new THREE.Fog(0xcfe0ec, 40, 120);
    s.background = new THREE.Color(0xcfe0ec);
  }

  setShadowSize(n) {
    this.sun.shadow.mapSize.set(n, n);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  _ground() {
    const g = this.group;
    // 草地
    const gt = grassTex();
    gt.repeat.set(60, 60);
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(300, 300).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: gt, roughness: 1 }));
    grass.position.set(13.5, -0.06, 8.5);
    grass.receiveShadow = true;
    grass.name = 'grass';
    g.add(grass);
    // 構内の土台（壁の下まで）
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W, 0.14, H), new THREE.MeshStandardMaterial({ color: '#b9b5ad', roughness: 0.9 }));
    slab.position.set((W - 1) / 2, -0.07, (H - 1) / 2);
    slab.receiveShadow = true;
    slab.name = 'slab';
    g.add(slab);
    // 構内の床（1..W-2, 1..H-2）
    const cols = W - 2, rows = H - 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(cols, rows).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTex(cols, rows), roughness: 0.92 }));
    floor.position.set((W - 1) / 2, 0.001, (H - 1) / 2);
    floor.receiveShadow = true;
    floor.name = 'floor';
    g.add(floor);
  }

  _walls() {
    const wallMat = new THREE.MeshStandardMaterial({ color: '#eef1f4', roughness: 0.6 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: '#2f64b3', roughness: 0.5 });
    const colMat = new THREE.MeshStandardMaterial({ color: '#aeb8c3', roughness: 0.5, metalness: 0.3 });
    const doorMat = new THREE.MeshStandardMaterial({ color: '#8d97a3', roughness: 0.5, metalness: 0.4 });
    const dockSet = new Set(DOCKS.map((d) => d.y * W + d.x));
    const low = [], stripe = [], cols = [];
    const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!(x === 0 || y === 0 || x === W - 1 || y === H - 1)) continue;
      if (dockSet.has(y * W + x)) continue;
      const corner = (x === 0 || x === W - 1) && (y === 0 || y === H - 1);
      const vertical = x === 0 || x === W - 1; // 西・東の壁（z に沿って伸びる）
      // 南の壁は低くする（カメラの手前で中を隠さないように）
      const h = y === H - 1 ? 0.42 : 0.72;
      if (corner) { cols.push(box(0.44, 1.3, 0.44, x, 0.65, y)); continue; }
      // 青い帯は壁の上の面と重ならないよう、少し下に巻く（重なるとちらつく）
      if (vertical) { low.push(box(0.3, h, 1.0, x, h / 2, y)); stripe.push(box(0.34, 0.1, 1.0, x, h - 0.16, y)); }
      else { low.push(box(1.0, h, 0.3, x, h / 2, y)); stripe.push(box(1.0, 0.1, 0.34, x, h - 0.16, y)); }
      if ((vertical ? y : x) % 4 === 0) cols.push(box(0.4, h + 0.5, 0.4, x, (h + 0.5) / 2, y));
    }
    const add = (geos, mat, name) => {
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      m.castShadow = m.receiveShadow = true;
      m.name = name;
      this.group.add(m);
    };
    add(low, wallMat, 'walls');
    add(stripe, stripeMat, 'wallStripe');
    add(cols, colMat, 'columns');
    // まだ使えない入荷口：閉じたシャッター（日が進むと開く）
    this.closedDoors = DOCKS.map((d) => {
      const vertical = d.dir === 0 || d.dir === 2;
      const m = new THREE.Mesh(vertical ? new THREE.BoxGeometry(0.2, 1.1, 0.96) : new THREE.BoxGeometry(0.96, 1.1, 0.2), doorMat);
      m.position.set(d.x, 0.55, d.y);
      m.castShadow = m.receiveShadow = true;
      m.name = 'closedDoor';
      this.group.add(m);
      return m;
    });
  }

  /** 開いている入荷口の番号（閉じたシャッターを隠す）。 */
  setOpenDocks(list) { this.closedDoors.forEach((m, i) => { m.visible = !list.includes(i); }); }

  _outside() {
    const g = this.group;
    const at = asphaltTex();
    const asphalt = (w, h, x, z, rep) => {
      const t = at.clone(); t.needsUpdate = true; t.repeat.set(w / rep, h / rep);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }));
      m.position.set(x, -0.03, z);
      m.receiveShadow = true;
      m.name = 'asphalt';
      g.add(m);
    };
    // 西の構内道路と待機場（x -16..-0.5）、北の待機場（z -16..-0.5）
    asphalt(16, 40, -8.3, 6.5, 8);
    asphalt(29, 16, 13.5, -8.3, 8);
    // 道の白線（破線）
    const dash = [];
    for (let z = -14; z < 26; z += 2.2) dash.push(new THREE.PlaneGeometry(0.12, 1.1).rotateX(-Math.PI / 2).translate(-11.6, -0.02, z));
    for (let x = -14; x < 28; x += 2.2) dash.push(new THREE.PlaneGeometry(1.1, 0.12).rotateX(-Math.PI / 2).translate(x, -0.02, -11.6));
    // 入荷口の前の黄色い枠
    for (const d of DOCKS) {
      const ox = -(d.dir === 0 ? 1 : 0), oz = -(d.dir === 1 ? 1 : 0);
      for (const s of [-0.65, 0.65]) {
        if (d.dir === 0) dash.push(new THREE.PlaneGeometry(4.2, 0.1).rotateX(-Math.PI / 2).translate(d.x + ox * 2.6, -0.02, d.y + s));
        else dash.push(new THREE.PlaneGeometry(0.1, 4.2).rotateX(-Math.PI / 2).translate(d.x + s, -0.02, d.y + oz * 2.6));
      }
    }
    const lines = new THREE.Mesh(mergeGeometries(dash), new THREE.MeshBasicMaterial({ color: '#f1e7c4', transparent: true, opacity: 0.85 }));
    lines.name = 'roadLines';
    g.add(lines);
    // 木（構内と道を避けて）
    const rng = new Rng(4242);
    const trunks = [], crowns = [], crowns2 = [];
    const blocked = (x, z) => (x > -16.5 && x < W + 0.5 && z > -16.5 && z < H + 0.5) || (x > -16 && x < -0 && z > -16 && z < 26.5);
    let n = 0;
    while (n < 120) {
      const x = rng.range(-30, 60), z = rng.range(-28, 40);
      if (blocked(x, z) || (x > 34 && z > -10 && z < 30)) continue;
      const s = rng.range(0.8, 1.5);
      trunks.push(new THREE.CylinderGeometry(0.1 * s, 0.14 * s, 0.9 * s, 6).translate(x, 0.45 * s, z));
      (n % 3 ? crowns : crowns2).push(new THREE.IcosahedronGeometry(0.7 * s, 0).translate(x, 1.25 * s, z));
      n++;
    }
    const tm = new THREE.Mesh(mergeGeometries(trunks), new THREE.MeshStandardMaterial({ color: '#7a5a3c', roughness: 0.9 }));
    const cm = new THREE.Mesh(mergeGeometries(crowns), new THREE.MeshStandardMaterial({ color: '#4f9a4a', roughness: 0.85, flatShading: true }));
    const cm2 = new THREE.Mesh(mergeGeometries(crowns2), new THREE.MeshStandardMaterial({ color: '#3f8a52', roughness: 0.85, flatShading: true }));
    for (const m of [tm, cm, cm2]) { m.castShadow = true; m.receiveShadow = true; m.name = 'trees'; g.add(m); }
    // 東の遠くの街（ドローンの行き先）
    const blds = [], blds2 = [];
    for (let i = 0; i < 70; i++) {
      const x = rng.range(38, 78), z = rng.range(-22, 36);
      const w = rng.range(2, 4.5), d = rng.range(2, 4.5), h = rng.range(2, 11);
      (i % 3 ? blds : blds2).push(new THREE.BoxGeometry(w, h, d).translate(x, h / 2, z));
    }
    const bm = new THREE.Mesh(mergeGeometries(blds), new THREE.MeshStandardMaterial({ color: '#d7dde4', roughness: 0.7 }));
    const bm2 = new THREE.Mesh(mergeGeometries(blds2), new THREE.MeshStandardMaterial({ color: '#b7c4d3', roughness: 0.6 }));
    for (const m of [bm, bm2]) { m.receiveShadow = true; m.name = 'city'; g.add(m); }
    // 南の芝生の看板
    const c = document.createElement('canvas');
    c.width = 512; c.height = 160;
    const x2 = c.getContext('2d');
    x2.fillStyle = '#16233a'; x2.fillRect(0, 0, 512, 160);
    x2.fillStyle = '#35e0ff'; x2.fillRect(0, 140, 512, 20);
    x2.fillStyle = '#ffffff';
    x2.font = 'bold 54px system-ui, sans-serif';
    x2.fillText('HAKOBI', 36, 72);
    x2.font = '600 30px system-ui, sans-serif';
    x2.fillStyle = '#bfe9ff';
    x2.fillText('LOGISTICS CENTER  No.7', 36, 118);
    const st = new THREE.CanvasTexture(c);
    st.colorSpace = THREE.SRGBColorSpace;
    st.anisotropy = 8;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.3, 0.12), [
      new THREE.MeshStandardMaterial({ color: '#16233a' }), new THREE.MeshStandardMaterial({ color: '#16233a' }),
      new THREE.MeshStandardMaterial({ color: '#16233a' }), new THREE.MeshStandardMaterial({ color: '#16233a' }),
      new THREE.MeshStandardMaterial({ map: st, roughness: 0.5 }), new THREE.MeshStandardMaterial({ color: '#16233a' }),
    ]);
    sign.position.set(5, 1.25, H + 2.2);
    sign.rotation.x = -0.35;
    sign.castShadow = true;
    sign.name = 'sign';
    const posts = new THREE.Mesh(mergeGeometries([new THREE.BoxGeometry(0.12, 1.0, 0.12).translate(3.6, 0.5, H + 2.3), new THREE.BoxGeometry(0.12, 1.0, 0.12).translate(6.4, 0.5, H + 2.3)]), new THREE.MeshStandardMaterial({ color: '#5b6672' }));
    posts.castShadow = true;
    g.add(sign, posts);
  }

  _overlays() {
    // 使えない区画（斜線）。setLocked で作り直す
    this.lockMat = new THREE.MeshBasicMaterial({ map: hatchTex(), transparent: true, depthWrite: false });
    this.lockMesh = null;
    // 建てるときのマス目
    const gt = gridTex();
    gt.repeat.set(W - 2, H - 2);
    this.gridMat = new THREE.MeshBasicMaterial({ map: gt, transparent: true, opacity: 0, depthWrite: false });
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(W - 2, H - 2).rotateX(-Math.PI / 2), this.gridMat);
    this.grid.position.set((W - 1) / 2, 0.006, (H - 1) / 2);
    this.grid.renderOrder = 2;
    this.grid.name = 'grid';
    this.group.add(this.grid);
    this.gridWant = 0;
  }

  setLocked(locked) {
    if (this.lockMesh) { this.group.remove(this.lockMesh); this.lockMesh.geometry.dispose(); }
    const parts = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (!locked[y * W + x]) continue;
      const q = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(x, 0.004, y);
      // 斜線を世界の座標でつなげる
      const uv = q.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + x, uv.getY(i) - y);
      parts.push(q);
    }
    this.lockMesh = parts.length ? new THREE.Mesh(mergeGeometries(parts), this.lockMat) : null;
    if (this.lockMesh) { this.lockMesh.renderOrder = 1; this.lockMesh.name = 'locked'; this.group.add(this.lockMesh); }
  }

  showGrid(on) { this.gridWant = on ? 0.32 : 0; }

  _rain() {
    const n = 900;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 6);
    this.rainSeed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { this.rainSeed[i * 3] = Math.random(); this.rainSeed[i * 3 + 1] = Math.random(); this.rainSeed[i * 3 + 2] = Math.random(); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#c9d6e6', transparent: true, opacity: 0.45 }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.name = 'rain';
    this.scene.add(this.rain);
  }

  /** f：その日の進み（0〜1）。storm：嵐の強さ（0〜1）。 */
  setTime(f, storm = 0) {
    this.time = f = clamp(f);
    this.storm = storm;
    const a = f < 0.5 ? SUN_KEYS[0] : SUN_KEYS[1], b = f < 0.5 ? SUN_KEYS[1] : SUN_KEYS[2];
    const k = f < 0.5 ? f / 0.5 : (f - 0.5) / 0.5;
    const mix = (key) => a[key].clone().lerp(b[key], k).lerp(STORM[key], storm);
    this.sun.color.copy(mix('sun'));
    this.sun.intensity = lerp(lerp(a.si, b.si, k), STORM.si, storm);
    this.hemi.color.copy(mix('hemiSky'));
    this.hemi.groundColor.copy(mix('hemiGround'));
    this.hemi.intensity = lerp(lerp(a.hi, b.hi, k), STORM.hi, storm);
    const fog = mix('fog');
    this.scene.fog.color.copy(fog);
    this.scene.background.copy(fog);
    // 太陽：朝は東、夕方は西。高さは昼に一番高い
    const az = lerp(-1.25, 1.25, f);           // 南から見た角度
    const el = 0.42 + Math.sin(f * Math.PI) * 0.62;
    const c = this.sun.target.position;
    this.sun.position.set(c.x + Math.sin(az) * Math.cos(el) * -40, Math.sin(el) * 40, c.z + Math.cos(az) * Math.cos(el) * 26);
  }

  /** 毎フレーム：霧の距離をカメラに合わせる・マス目の濃さ・雨。 */
  update(dt, rig, time) {
    const d = rig.dist;
    this.scene.fog.near = d * 1.4;
    this.scene.fog.far = d * 4.2 + 30 - this.storm * d * 2;
    const o = this.gridMat.opacity;
    this.gridMat.opacity = o + (this.gridWant - o) * (1 - Math.exp(-10 * dt));
    this.grid.visible = this.gridMat.opacity > 0.01;
    // 雨（カメラの注視点のまわりに降らせる）
    this.rain.visible = this.storm > 0.05;
    if (this.rain.visible) {
      const p = this.rain.geometry.attributes.position.array, s = this.rainSeed;
      const cx = rig.target.x, cz = rig.target.z, R = d * 0.9;
      for (let i = 0; i < s.length / 3; i++) {
        const fall = (s[i * 3 + 2] + time * 1.6) % 1;
        const x = cx + (s[i * 3] - 0.5) * R * 2, z = cz + (s[i * 3 + 1] - 0.5) * R * 2, y = 12 * (1 - fall);
        p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z;
        p[i * 6 + 3] = x - 0.08; p[i * 6 + 4] = y - 0.6; p[i * 6 + 5] = z + 0.04;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.material.opacity = 0.45 * this.storm;
    }
  }
}
