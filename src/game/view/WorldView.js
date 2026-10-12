// シミュレーション（World）を毎フレーム絵にする。建物・ロボ・ドローン・トラックは見えない Object3D で動かし、
// Instancer でまとめて描く。荷物は入れ物（ベルト・入荷口・棚・ポート・アーム・ロボ・ドローン・床）ごとに並べる。
import * as THREE from 'three';
import { DX, DY, opp, W } from '../sim/consts.js';
import { DOCKS } from '../sim/days.js';
import { Instancer } from './Instancer.js';
import { Env } from './Env.js';
import {
  mats, geos, makeBelt, makeJunction, makeSorter, makeArm, armIK, makePad, makeDrone, makeShelf, makeCharger,
  makeLabeler, makeDock, makeTruck, makeRobot, labelMat, BELT_Y, BOX, SHELF_SLOTS, DOCK_SLOTS,
} from './models.js';
import { clamp, lerp, damp, dampAngle, wrapAngle, ease } from '../../core/math.js';

const Q = Math.PI / 2;
const yawOf = (d) => -d * Q;
// ドローンの行き先（宛先ごとに東の空の別の方向へ）
const FLY = [[34, 9, -16], [38, 10, -4], [37, 9, 9], [33, 11, 22]];
const PAD_SLOTS = [0, 1, 2, 3, 4, 5].map((i) => { const a = (i / 6) * Math.PI * 2 + 0.5; return [Math.cos(a) * 0.32, Math.sin(a) * 0.32]; });

export class WorldView {
  /** mini：使い方の見本用（まわりの景色を作らない。ベルトの模様は自分の材質で動かす） */
  constructor(scene, world, { mini = false } = {}) {
    this.scene = scene;
    this.w = world;
    this.mini = mini;
    this.env = mini ? null : new Env(scene);
    this.stat = new Instancer(scene, 'static');
    this.dyn = new Instancer(scene, 'dyn');
    this.pk = new Instancer(scene, 'pk');
    this.bmap = new Map();
    this.rmap = new Map();
    this.dmap = new Map();
    this.tmap = new Map();
    this.seenVer = -1;
    this.tpl = { S: makeBelt('S'), L: makeBelt('L'), R: makeBelt('R'), J: makeJunction() };
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3(1, 1, 1);
    this.e = new THREE.Euler();
    // 段ボールの色（少しずつ違う）
    this.tints = Array.from({ length: 8 }, (_, i) => new THREE.Color().setHSL(0.085 + (i % 4) * 0.006, 0.36 + (i % 3) * 0.05, 0.55 + (i % 5) * 0.025));
    this.time = 0;
    this.blink = 0;
    this.hidden = new Set();   // 描かない建物（ゴーストで置きかえ中など）
    const M = mats();
    geos();
    // 見本の画面は本編と同時に動くので、ベルトの模様（テクスチャのずらし）を別にする
    if (mini) {
      this.beltMat = M.belt.clone();
      this.beltMat.map = M.beltTexture.clone();
      this.beltMat.map.needsUpdate = true;
      for (const t of Object.values(this.tpl)) this._remap(t);
    }
  }

  _remap(root) {
    if (!this.beltMat) return root;
    const M = mats();
    root.traverse((o) => { if (o.isMesh && o.material === M.belt) o.material = this.beltMat; });
    return root;
  }

  // ------------------------------------------------------------------ 建物
  _syncLayout() {
    const w = this.w;
    const alive = new Set();
    for (const b of w.buildings) {
      alive.add(b.id);
      if (b.type === 'belt' || b.type === 'junction') continue;
      let e = this.bmap.get(b.id);
      if (!e) {
        const root = b.type === 'sorter' ? makeSorter() : b.type === 'arm' ? makeArm() : b.type === 'pad' ? makePad(b.cfg.dest)
          : b.type === 'shelf' ? makeShelf() : b.type === 'charger' ? makeCharger() : b.type === 'labeler' ? makeLabeler() : b.type === 'dock' ? makeDock() : null;
        if (!root) continue;
        this._remap(root);
        e = { b, root, yaw: 0 };
        this.bmap.set(b.id, e);
        if (b.type === 'arm') e.yaw = yawOf(opp(b.dir));
      }
      e.root.position.set(b.x, 0, b.y);
      e.root.rotation.y = yawOf(b.dir);
    }
    for (const [id, e] of this.bmap) if (!alive.has(id)) this.bmap.delete(id);
    // ベルト（動かないので、置きかえたときだけまとめ直す）
    const st = this.stat;
    st.begin();
    for (const b of w.lists.belts) {
      if (b.type === 'sorter' || this.hidden.has(b.id)) continue;
      const t = b.type === 'junction' ? this.tpl.J : this.tpl[b.shape] || this.tpl.S;
      t.position.set(b.x, 0, b.y);
      t.rotation.y = yawOf(b.dir);
      st.add(t);
    }
    st.end();
    // 開いている入荷口
    if (this.env) {
      this.env.setOpenDocks(w.lists.docks.map((d) => d.dockNo));
      const lockKey = w.day + ':' + (w.def?.zone ?? -1);
      if (this.lockKey !== lockKey) { this.lockKey = lockKey; this.env.setLocked(w.locked); }
    }
    this.seenVer = w.layoutVer;
  }

  /** 毎フレーム。simDt：この間にシミュレーションが進んだ時間（ベルトの模様を動かす）。 */
  sync(dt, simDt, rig) {
    const w = this.w;
    this.time += dt;
    this.blink += dt;
    if (this.seenVer !== w.layoutVer) this._syncLayout();
    const M = mats();
    (this.beltMat ? this.beltMat.map : M.beltTexture).offset.y = -((w.beltPhase || 0) % 1);
    this.env?.update(dt, rig, this.time);
    const perf = w.perf();
    const dyn = this.dyn;
    dyn.begin();
    this.pk.begin();
    for (const e of this.bmap.values()) {
      if (this.hidden.has(e.b.id)) continue;
      this._animBuilding(e, dt, perf);
      dyn.add(e.root);
    }
    for (const e of this.bmap.values()) if (!this.hidden.has(e.b.id)) this._buildingPackages(e, perf);
    this._robots(dt);
    this._drones(dt, perf);
    this._trucks(dt);
    this._beltPackages();
    for (const p of w.floor) this._pkg(p, p.fx, BOX.h / 2, p.fy, (p.id * 1.7) % 6.28, 1);
    dyn.end();
    this.pk.end();
  }

  _animBuilding(e, dt, perf) {
    const b = e.b, u = e.root.userData, M = mats();
    switch (b.type) {
      case 'sorter': {
        u.sign.material = M.sign[b.cfg.filter] || M.sign.any;
        u.arrow.rotation.y = b.cfg.side === 'L' ? Math.PI : 0;
        const div = b.lanes[0].some((p) => p.exit !== b.dir && p.pos > 0.25 && p.pos < 0.85);
        e.push = damp(e.push || 0, div ? 1 : 0, 14, dt);
        const s = b.cfg.side === 'L' ? 1 : -1;
        u.pusher.position.z = s * lerp(0.36, 0.08, e.push);
        break;
      }
      case 'arm': this._animArm(e, dt, perf); break;
      case 'pad': {
        u.top.material = M.padTop[b.cfg.dest];
        u.lights.visible = (this.blink % 1.2) < 0.6 || b.store.length === 0;
        break;
      }
      case 'charger': {
        const on = !!b.user;
        u.ring.visible = on;
        if (on) { const s = 0.8 + Math.sin(this.time * 4) * 0.08; u.ring.scale.set(s, 1, s); }
        break;
      }
      case 'labeler': {
        u.head.position.z = b.cur ? Math.sin(this.time * 9) * 0.18 : 0;
        break;
      }
      case 'dock': {
        u.light.visible = !!b.bay && b.bay.st === 'unload' && (this.blink % 0.8) < 0.4;
        break;
      }
    }
  }

  // アームの動き：シミュレーションの段階（reach / grip / swing / drop / ret）から姿勢を決める
  _animArm(e, dt, perf) {
    const a = e.b, u = e.root.userData;
    const k = perf.armCycle;
    const yS = Math.PI;        // 後ろ（取る側）。モデルの前 = +X なので、後ろは π
    const yD = 0;
    const ready = { r: 0.5, h: 1.0 };
    const p = a.held;
    const dst = a.nb[a.dir];
    const dropH = (dst?.type === 'pad' ? 0.1 + BOX.h : dst?.type === 'shelf' ? 0.3 + BOX.h : dst?.type === 'labeler' ? 0.65 : BELT_Y + BOX.h) + 0.15;
    // 取りに行く所：荷物が元あった場所（取り始めたときに覚える）
    if (a.phase === 'reach' && p) {
      const fx = p._fx ?? p._vx, fy = p._fy ?? p._vy, fz = p._fz ?? p._vz;
      if (fx !== undefined) {
        const lx = fx - a.x, lz = fz - a.y;
        e.pick = { yaw: wrapAngle(Math.atan2(-lz, lx) - yawOf(a.dir)), r: clamp(Math.hypot(lx, lz), 0.55, 1.05), h: fy + BOX.h / 2 + 0.15 };
      } else e.pick = { yaw: yS, r: 0.95, h: 0.65 };
    }
    const pk = e.pick || { yaw: yS, r: 0.95, h: 0.65 };
    const t = a.t;
    let yaw, r, h;
    switch (a.phase) {
      case 'reach': { const s = ease.inOutQuad(clamp(t / (0.24 * k))); yaw = lerp(yS, pk.yaw, s); r = lerp(ready.r, pk.r, s); h = lerp(ready.h, pk.h, s); break; }
      case 'grip': yaw = pk.yaw; r = pk.r; h = pk.h; break;
      case 'swing': {
        const s = ease.inOutCubic(clamp(t / (0.5 * k)));
        yaw = pk.yaw + wrapAngle(yD - pk.yaw + 0.0001) * s;
        r = lerp(pk.r, 0.95, s) - Math.sin(s * Math.PI) * 0.25;
        h = lerp(pk.h, dropH, s) + Math.sin(s * Math.PI) * 0.35;
        break;
      }
      case 'drop': { const s = clamp(t / (0.12 * k)); yaw = yD; r = 0.95; h = dropH + (1 - s) * 0.05; break; }
      case 'ret': { const s = ease.inOutQuad(clamp(t / (0.38 * k))); yaw = lerp(yD, yS, s); r = lerp(0.95, ready.r, s); h = lerp(dropH, ready.h, s); break; }
      default: yaw = yS; r = ready.r; h = ready.h;
    }
    u.turret.rotation.y = yaw;
    armIK(u, r, h - 0.5);
    u.sign.material = mats().sign[a.cfg.filter] || mats().sign.any;
  }

  // ------------------------------------------------------------------ 荷物
  _pkg(p, x, y, z, rot = 0, scale = 1) {
    p._vx = x; p._vy = y; p._vz = z;
    const G = geos(), M = mats();
    const j = ((p.id * 0.618) % 1 - 0.5) * 0.25;
    this.q.setFromEuler(this.e.set(0, rot + j, 0));
    this.s.set(scale, scale, scale);
    this.m4.compose(this.v.set(x, y, z), this.q, this.s);
    this.pk.addMatrix(G.box, M.box, this.m4, this.tints[p.id & 7]);
    this.m4.compose(this.v.set(x, y + (BOX.h / 2) * scale + 0.003, z), this.q, this.s);
    this.pk.addMatrix(G.label, labelMat(p), this.m4, null, { cast: false, recv: true });
  }

  _beltPackages() {
    const zY = BELT_Y + BOX.h / 2;
    for (const b of this.w.lists.belts) {
      for (const L of b.lanes) for (const p of L) {
        const [ox, oz, rot] = beltOffset(p);
        this._pkg(p, b.x + ox, zY, b.y + oz, rot);
      }
    }
  }

  _buildingPackages(e, perf) {
    const b = e.b;
    const c = Math.cos(yawOf(b.dir)), s = Math.sin(yawOf(b.dir));
    const loc = (lx, lz) => [b.x + lx * c + lz * s, b.y - lx * s + lz * c]; // ローカル（前 = +X）→ 世界
    switch (b.type) {
      case 'dock': b.queue.forEach((p, i) => { const sl = DOCK_SLOTS[Math.min(i, DOCK_SLOTS.length - 1)]; const [x, z] = loc(sl[0], sl[2]); this._pkg(p, x, sl[1] + (i >= DOCK_SLOTS.length ? 0.26 : 0), z, yawOf(b.dir)); }); break;
      case 'shelf': b.store.forEach((p, i) => { const sl = SHELF_SLOTS[i % 8]; this._pkg(p, b.x + sl[0], sl[1], b.y + sl[2], 0); }); break;
      case 'pad': b.store.forEach((p, i) => { const sl = PAD_SLOTS[i % 6]; this._pkg(p, b.x + sl[0], 0.1 + BOX.h * 0.4 + (i >= 6 ? BOX.h * 0.8 : 0), b.y + sl[1], i, 0.8); }); break;
      case 'labeler': b.outQ.forEach((p, i) => { if (i === 0) { const [x, z] = loc(0.37, 0); this._pkg(p, x, BELT_Y + BOX.h / 2, z, yawOf(b.dir)); } }); break;
      case 'arm': {
        const p = b.held;
        if (!p) break;
        e.root.userData.tip.getWorldPosition(this.v);
        let x = this.v.x, y = this.v.y - BOX.h / 2, z = this.v.z;
        const rot = e.root.userData.turret.rotation.y + yawOf(b.dir);
        if (b.phase === 'reach') {
          // 元の場所から手先へ寄せる。元の場所は _fx に覚えておく（アームの姿勢の計算にも使う）
          if (p._fx === undefined) { p._fx = p._vx ?? x; p._fy = p._vy ?? y; p._fz = p._vz ?? z; }
          const k = ease.inQuad(clamp(b.t / (0.24 * perf.armCycle)));
          this._pkg(p, lerp(p._fx, x, k), lerp(p._fy, y, k), lerp(p._fz, z, k), rot);
        } else {
          p._fx = p._fy = p._fz = undefined;
          this._pkg(p, x, y, z, rot);
        }
        break;
      }
    }
  }

  // ------------------------------------------------------------------ 人型ロボ
  _robots(dt) {
    const w = this.w;
    const alive = new Set();
    const rs = w.robots;
    for (const r of rs) {
      alive.add(r.id);
      let e = this.rmap.get(r.id);
      if (!e) { e = { root: makeRobot(), yaw: -r.ang, ph: 0, ox: 0, oz: 0 }; e.root.scale.setScalar(1.14); this.rmap.set(r.id, e); }
      const u = e.root.userData;
      e.yaw = dampAngle(e.yaw, -r.ang, 12, dt);
      // すり抜けるとき（めったにない）に、ぴったり重なって見えないよう、少し左右へずらす（見た目だけ）
      let px = 0, pz = 0;
      for (const q of rs) {
        if (q === r) continue;
        const dx = r.x - q.x, dz = r.y - q.y, d = Math.hypot(dx, dz);
        if (d < 0.6) { const k = (0.6 - d) / 0.6; if (d > 1e-4) { px += (dx / d) * k * 0.2; pz += (dz / d) * k * 0.2; } else { px += (r.no < q.no ? 0.2 : -0.2) * k; } }
      }
      e.ox = damp(e.ox, px, 10, dt); e.oz = damp(e.oz, pz, 10, dt);
      e.root.position.set(r.x + e.ox, 0, r.y + e.oz);
      e.root.rotation.y = e.yaw;
      const carry = r.carry.length > 0 || r.st === 'pick' || r.st === 'drop';
      const walk = r.moving ? r.walk * 5.2 : 0;
      e.amp = damp(e.amp || 0, r.moving ? 1 : 0, 10, dt);
      const sw = Math.sin(walk) * 0.55 * e.amp;
      u.legs[0].hip.rotation.z = sw; u.legs[1].hip.rotation.z = -sw;
      u.legs[0].kn.rotation.z = -Math.max(0, -Math.sin(walk)) * 0.7 * e.amp;
      u.legs[1].kn.rotation.z = -Math.max(0, Math.sin(walk)) * 0.7 * e.amp;
      u.hips.position.y = 0.42 + Math.abs(Math.cos(walk)) * 0.025 * e.amp - (r.st === 'charging' ? 0.02 : 0);
      const charging = r.st === 'charging';
      if (carry) {
        for (const a of u.arms) { a.sh.rotation.z = damp(a.sh.rotation.z, 1.25, 12, dt); a.el.rotation.z = damp(a.el.rotation.z, 0.35, 12, dt); }
      } else {
        u.arms[0].sh.rotation.z = damp(u.arms[0].sh.rotation.z, -sw * 0.8, 12, dt);
        u.arms[1].sh.rotation.z = damp(u.arms[1].sh.rotation.z, sw * 0.8, 12, dt);
        for (const a of u.arms) a.el.rotation.z = damp(a.el.rotation.z, 0.25 + (charging ? 0 : 0.1), 10, dt);
      }
      u.torso.rotation.z = (r.moving ? 0.08 : 0) + (r.st === 'read' ? Math.sin(this.time * 6) * 0.05 : 0);
      u.head.rotation.y = r.st === 'idle' ? Math.sin(this.time * 0.7 + r.no) * 0.5 : r.st === 'read' ? Math.sin(this.time * 3) * 0.2 : 0;
      u.head.rotation.z = r.st === 'read' ? -0.35 : r.st === 'charging' ? -0.2 : 0;
      this.dyn.add(e.root);
      if (r.carry.length) {
        u.hold.getWorldPosition(this.v);
        const hx = this.v.x, hy = this.v.y, hz = this.v.z;
        r.carry.forEach((p, i) => this._pkg(p, hx, hy + i * BOX.h * 0.85, hz, e.yaw));
      }
    }
    for (const id of [...this.rmap.keys()]) if (!alive.has(id)) this.rmap.delete(id);
  }

  // ------------------------------------------------------------------ ドローン
  _drones(dt, perf) {
    const w = this.w, M = mats();
    const alive = new Set();
    for (const pad of w.lists.pads) {
      pad.drones.forEach((d, i) => {
        const key = pad.id + ':' + i;
        alive.add(key);
        let e = this.dmap.get(key);
        if (!e) { e = { root: makeDrone(), spin: 0, tilt: 0 }; this.dmap.set(key, e); }
        const u = e.root.userData;
        u.led.userData.tint = e.tint || (e.tint = new THREE.Color());
        e.tint.set(['#2f7bff', '#ff9419', '#16b26a', '#c63ee0'][pad.cfg.dest]);
        const base = e.base || (e.base = new THREE.Vector3());
        base.set(pad.x, 0.2, pad.y);
        const far = FLY[pad.cfg.dest];
        const hi = 3.3;
        let x = base.x, y = base.y, z = base.z, rotorOn = 1, yaw = 0, visible = true, tilt = 0;
        switch (d.st) {
          case 'dock': rotorOn = d.load.length ? 0.6 : 0; break;
          case 'up': { const s = ease.inOutQuad(clamp(d.t / 1.1)); y = lerp(0.2, hi, s); break; }
          case 'away': {
            const half = perf.flight / 2;
            const out = d.t < half;
            const s = out ? ease.inOutQuad(d.t / half) : 1 - ease.inOutQuad((d.t - half) / half);
            x = lerp(base.x, far[0], s); y = lerp(hi, far[1], Math.sin(s * Math.PI / 2)); z = lerp(base.z, far[2], s);
            yaw = Math.atan2(-(far[2] - base.z), far[0] - base.x) + (out ? 0 : Math.PI);
            tilt = 0.22;
            visible = s < 0.97;
            break;
          }
          case 'down': { const s = ease.inOutQuad(clamp(d.t / 1.1)); y = lerp(hi, 0.2, s); break; }
          case 'hold': y = 2.3 + Math.sin(this.time * 2 + i) * 0.08; x += 0.25 * Math.cos(this.time * 0.6 + i); z += 0.25 * Math.sin(this.time * 0.6 + i); break;
        }
        e.yaw = dampAngle(e.yaw ?? yaw, yaw, 4, dt);
        e.tilt = damp(e.tilt, tilt, 4, dt);
        e.root.visible = visible;
        e.root.position.set(x, y, z);
        e.root.rotation.set(0, e.yaw, -e.tilt);
        e.spin += dt * 60 * rotorOn;
        for (const r of u.rotors) r.rotation.y = e.spin;
        this.dyn.add(e.root);
        // 運んでいる荷物（ぶら下げる）
        // 荷物を下げるのは、ポートで積んでいる間と、離陸して届け先へ向かう間だけ（帰りは空）
        const list = d.st === 'dock' ? d.load : (d.st === 'up' || d.st === 'away') && d.ship ? d.ship : [];
        if (visible && list.length) {
          u.hook.getWorldPosition(this.v);
          list.forEach((p, k) => {
            const ox = k === 0 ? 0 : Math.cos(k * 2.1) * 0.17, oz = k === 0 ? 0 : Math.sin(k * 2.1) * 0.17;
            this._pkg(p, this.v.x + ox, this.v.y - BOX.h * 0.38 - (k ? 0.04 : 0), this.v.z + oz, e.yaw, 0.75);
          });
        }
      });
    }
    for (const k of [...this.dmap.keys()]) if (!alive.has(k)) this.dmap.delete(k);
  }

  // ------------------------------------------------------------------ トラック
  _trucks(dt) {
    const w = this.w;
    const alive = new Set();
    for (const d of w.lists.docks) {
      const D = DOCKS[d.dockNo];
      const out = opp(D.dir);
      const bayX = D.x + DX[out] * 1.25, bayZ = D.y + DY[out] * 1.25;
      const stgX = D.x + DX[out] * 6.2, stgZ = D.y + DY[out] * 6.2;
      // 道（西の入荷口は x = -11.6 の南北の道、北は z = -11.6 の東西の道）
      const roadX = D.dir === 0 ? -11.6 : D.x + 4, roadZ = D.dir === 0 ? D.y + 4 : -11.6;
      const yawBay = yawOf(D.dir); // 後ろ（原点）が入荷口に向く
      const put = (tr, x, z, yaw) => {
        alive.add(tr.id + ':' + d.id);
        let e = this.tmap.get(tr.id + ':' + d.id);
        if (!e) { e = { root: makeTruck(tr.color % 5), yaw }; this.tmap.set(tr.id + ':' + d.id, e); }
        e.root.position.set(x, 0, z);
        e.root.rotation.y = yaw;
        this.dyn.add(e.root);
      };
      const tr = d.bay;
      if (tr) {
        if (tr.st === 'back') {
          const s = ease.inOutQuad(clamp(tr.t / 2.4));
          const s1 = clamp(s * 2), s2 = clamp(s * 2 - 1);
          const x = s < 0.5 ? lerp(roadX, stgX, s1) : lerp(stgX, bayX, s2);
          const z = s < 0.5 ? lerp(roadZ, stgZ, s1) : lerp(stgZ, bayZ, s2);
          const roadYaw = D.dir === 0 ? -Q : 0;
          put(tr, x, z, s < 0.5 ? lerp(roadYaw, yawBay, s1) : yawBay);
        } else if (tr.st === 'unload') put(tr, bayX, bayZ, yawBay);
        else if (tr.st === 'leave') {
          const s = ease.inQuad(clamp(tr.t / 2.4));
          put(tr, lerp(bayX, stgX + DX[out] * 4, s), lerp(bayZ, stgZ + DY[out] * 4, s), yawBay);
        }
      }
      // 並んで待っているトラック（道の上）
      d.line.forEach((t2, i) => {
        if (i > 3) return;
        const k = i + 1;
        if (D.dir === 0) put(t2, roadX, roadZ + k * 5.2, -Q);
        else put(t2, roadX + k * 5.2, roadZ, 0);
      });
    }
    for (const k of [...this.tmap.keys()]) if (!alive.has(k)) this.tmap.delete(k);
  }

  /** 確認用：描いている数。 */
  counts() { return { static: this.stat.stats(), dyn: Object.keys(this.dyn.stats()).length, pk: this.pk.stats() }; }
}

/** ベルトの上の荷物の位置（マスの中心からのずれ）と向き。 */
export function beltOffset(p) {
  const s = clamp(p.pos, 0, 1);
  const x = p.exit;
  if (p.mid) {
    const t = clamp((s - 0.5) / 0.5);
    return [DX[x] * 0.5 * t, DY[x] * 0.5 * t, yawOf(x)];
  }
  const e = p.ent;
  if (e === opp(x) || e === x) {
    const ex = e === x ? -DX[x] : DX[e], ey = e === x ? -DY[x] : DY[e];
    return [lerp(ex * 0.5, DX[x] * 0.5, s), lerp(ey * 0.5, DY[x] * 0.5, s), yawOf(x)];
  }
  // 曲がる：二つの辺の真ん中を結ぶ、角を中心とした四分円
  const cx = (DX[e] + DX[x]) * 0.5, cz = (DY[e] + DY[x]) * 0.5;
  const a0 = Math.atan2(DY[e] * 0.5 - cz, DX[e] * 0.5 - cx);
  const a1 = Math.atan2(DY[x] * 0.5 - cz, DX[x] * 0.5 - cx);
  const da = wrapAngle(a1 - a0);
  const a = a0 + da * s;
  const r0 = yawOf(opp(e)), r1 = yawOf(x);
  return [cx + Math.cos(a) * 0.5, cz + Math.sin(a) * 0.5, r0 + wrapAngle(r1 - r0) * s];
}
