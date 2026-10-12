// 俯瞰のカメラ（シムシティ風）。注視点・向き（90° ずつ回す）・距離を持ち、なめらかに追いかける。
// 寄るほど少し寝かせ、引くほど真上に近づける。
import * as THREE from 'three';
import { clamp, damp, wrapAngle } from '../../core/math.js';

export const MIN_DIST = 7;
export const MAX_DIST = 44;

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.target = new THREE.Vector3(13.5, 0, 8.5);
    this.yaw = 0;
    this.dist = 24;
    this.want = { x: 13.5, z: 8.5, yaw: 0, dist: 24 };
    this.bounds = { x0: -3, x1: 30, z0: -3, z1: 21 };
    this.orbit = 0;             // タイトルでゆっくり回す（rad/秒）
    this._ray = new THREE.Raycaster();
    this._v = new THREE.Vector3();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  }

  get pitch() {
    const k = clamp((this.dist - MIN_DIST) / (MAX_DIST - MIN_DIST));
    return 0.78 + k * 0.32; // 45° 〜 63°
  }

  /** すぐにその位置へ（場面の切り替え）。 */
  snap(x, z, dist = this.want.dist, yaw = this.want.yaw) {
    Object.assign(this.want, { x, z, dist, yaw });
    this.target.set(x, 0, z);
    this.dist = dist;
    this.yaw = yaw;
    this.apply();
  }

  /** 区画（x0..x1, y0..y1）が画面に収まる位置へ。縦長の画面では 90° 回して、工場の長い向きを画面の縦に合わせる。 */
  frame(z, { w = innerWidth, h = innerHeight, snap = true, margin = 1.12 } = {}) {
    const aspect = w / Math.max(1, h);
    const portrait = aspect < 0.85;
    const yaw = portrait ? Math.PI / 2 : 0;
    const zw = z.x1 - z.x0 + 1, zh = z.y1 - z.y0 + 1;
    // 画面の横・縦に来る長さ（縦長なら入れかわる）
    const across = portrait ? zh : zw, along = portrait ? zw : zh;
    const tanV = Math.tan(((this.cam.fov || 34) * Math.PI) / 360);
    // 上の帯と道具箱のぶん、縦は少し余裕をもたせる。斜めから見るので奥行きは縮む（sin で近似）
    const k = Math.sin(0.95);
    const dV = (along * k * margin) / (2 * tanV * 0.78);
    const dH = (across * margin) / (2 * tanV * aspect);
    const dist = clamp(Math.max(dV, dH), MIN_DIST, MAX_DIST);
    const cx = (z.x0 + z.x1) / 2, cz = (z.y0 + z.y1) / 2 + (portrait ? 0 : 0.6);
    if (snap) this.snap(cx, cz, dist, yaw);
    else Object.assign(this.want, { x: cx, z: cz, dist, yaw });
    return { dist, yaw };
  }

  /** 画面の向きで動かす（dx：右、dy：上。単位はマス）。 */
  pan(dx, dy) {
    const s = Math.sin(this.want.yaw), c = Math.cos(this.want.yaw);
    // カメラの右 = (cos, -sin)、奥（画面の上）= (-sin, -cos)
    this.want.x += c * dx - s * dy;
    this.want.z += -s * dx - c * dy;
    this._clamp();
  }

  /** つかんで動かす（指・マウスのドラッグ）：遅れずにすぐ動かす。 */
  grab(dx, dz) {
    this.want.x += dx; this.want.z += dz;
    this._clamp();
    this.target.x = this.want.x; this.target.z = this.want.z;
    this.apply();
  }

  /** 寄る・引く。anchor（地面の点）が画面の同じ所に残るように注視点も動かす。 */
  zoom(k, anchor = null, now = false) {
    const nd = clamp(this.want.dist * k, MIN_DIST, MAX_DIST);
    const kk = nd / this.want.dist;
    if (anchor) {
      this.want.x = anchor.x + (this.want.x - anchor.x) * kk;
      this.want.z = anchor.z + (this.want.z - anchor.z) * kk;
    }
    this.want.dist = nd;
    this._clamp();
    if (now) this._now();
  }

  /** 追いかけずに、すぐその値にする（指の操作：つかんだ所が指についてくるように）。 */
  _now() {
    this.target.x = this.want.x; this.target.z = this.want.z;
    this.dist = this.want.dist; this.yaw = this.want.yaw;
    this.apply();
  }

  rotate(steps) { this.want.yaw += (steps * Math.PI) / 2; }

  /** 指でひねる回転（自由）。離したら 90° にそろえる（snapYaw）。 */
  twist(rad, now = false) { this.want.yaw += rad; if (now) this._now(); }
  snapYaw() { this.want.yaw = Math.round(this.want.yaw / (Math.PI / 2)) * (Math.PI / 2); }

  /** 今の向きを 0〜3 で（画面の上が北なら 0）。 */
  get quarter() { return ((Math.round(this.want.yaw / (Math.PI / 2)) % 4) + 4) % 4; }

  _clamp() {
    const B = this.bounds;
    this.want.x = clamp(this.want.x, B.x0, B.x1);
    this.want.z = clamp(this.want.z, B.z0, B.z1);
  }

  update(dt) {
    if (this.orbit) this.want.yaw += this.orbit * dt;
    const w = this.want;
    this.target.x = damp(this.target.x, w.x, 10, dt);
    this.target.z = damp(this.target.z, w.z, 10, dt);
    this.dist = damp(this.dist, w.dist, 9, dt);
    this.yaw += wrapAngle(w.yaw - this.yaw) * (1 - Math.exp(-8 * dt));
    this.apply();
  }

  apply() {
    const p = this.pitch;
    const t = this.target;
    this.cam.position.set(
      t.x + Math.sin(this.yaw) * Math.cos(p) * this.dist,
      t.y + Math.sin(p) * this.dist,
      t.z + Math.cos(this.yaw) * Math.cos(p) * this.dist,
    );
    this.cam.lookAt(t);
    this.cam.updateMatrixWorld();
  }

  /** 画面の点（px）の下の地面（y = h）。当たらなければ null。 */
  groundAt(px, py, w = innerWidth, h = innerHeight, y = 0, out = new THREE.Vector3()) {
    const ndc = new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1);
    this._ray.setFromCamera(ndc, this.cam);
    this._plane.constant = -y;
    return this._ray.ray.intersectPlane(this._plane, out);
  }

  /** 世界の点を画面の px へ。 */
  toScreen(x, y, z, w = innerWidth, h = innerHeight) {
    const v = this._v.set(x, y, z).project(this.cam);
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, front: v.z < 1 };
  }

  /** 点が画面の端から margin（0〜1）より外なら、見える所まで寄せる。 */
  keepInView(x, z, margin = 0.72) {
    const v = this._v.set(x, 0, z).project(this.cam);
    const ox = Math.abs(v.x) > margin ? (v.x - Math.sign(v.x) * margin) : 0;
    const oy = Math.abs(v.y) > margin ? (v.y - Math.sign(v.y) * margin) : 0;
    if (ox || oy) this.pan(ox * this.want.dist * 0.5, oy * this.want.dist * 0.35);
  }
}
