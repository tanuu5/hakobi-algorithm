// 地図の上に重ねる表示：カーソル、置く前の半透明の形（ゴースト）、選んでいるもの、ベルトの引き途中、
// アームの「取る・置く」マス、分析ビュー（詰まり・満杯・待ち時間を色で）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DX, DY, opp, W, H } from '../sim/consts.js';
import { makeBelt, makeJunction, makeSorter, makeArm, makePad, makeShelf, makeCharger, makeLabeler, makeRobot, armIK, BOX } from './models.js';

const OK = new THREE.Color('#3fe6ff');
const BAD = new THREE.Color('#ff4d5e');
const SEL = new THREE.Color('#ffffff');

function frameGeo(s = 0.98, t = 0.06) {
  const h = s / 2;
  return mergeGeometries([
    new THREE.BoxGeometry(s, 0.02, t).translate(0, 0, -h + t / 2), new THREE.BoxGeometry(s, 0.02, t).translate(0, 0, h - t / 2),
    new THREE.BoxGeometry(t, 0.02, s - t * 2).translate(-h + t / 2, 0, 0), new THREE.BoxGeometry(t, 0.02, s - t * 2).translate(h - t / 2, 0, 0),
  ]);
}

export class Overlay {
  constructor(scene) {
    this.scene = scene;
    const g = (this.group = new THREE.Group());
    g.name = 'overlay';
    scene.add(g);
    this.frameG = frameGeo();
    this.cursorMat = new THREE.MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.95, depthWrite: false });
    this.cursor = new THREE.Mesh(this.frameG, this.cursorMat);
    this.cursor.renderOrder = 5;
    g.add(this.cursor);
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.16, depthWrite: false }));
    this.fill.renderOrder = 4;
    g.add(this.fill);
    this.selMat = new THREE.MeshBasicMaterial({ color: SEL, transparent: true, opacity: 0.95, depthWrite: false });
    this.sel = new THREE.Mesh(frameGeo(1.08, 0.08), this.selMat);
    this.sel.renderOrder = 6;
    g.add(this.sel);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 32).rotateX(-Math.PI / 2), this.selMat);
    this.ring.renderOrder = 6;
    g.add(this.ring);
    // アームの取る（青）・置く（橙）マス
    // ベルトやポートの上に重ねて見せる（床の高さだとベルトに隠れる）
    this.srcMat = new THREE.MeshBasicMaterial({ color: '#4aa3ff', transparent: true, opacity: 0.42, depthWrite: false, depthTest: false });
    this.dstMat = new THREE.MeshBasicMaterial({ color: '#ffa53a', transparent: true, opacity: 0.45, depthWrite: false, depthTest: false });
    const q = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);
    this.src = new THREE.Mesh(q, this.srcMat); this.dst = new THREE.Mesh(q, this.dstMat);
    this.src.renderOrder = this.dst.renderOrder = 9;
    g.add(this.src, this.dst);
    // ゴースト
    this.ghostOk = new THREE.MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.42, depthWrite: false });
    this.ghostBad = new THREE.MeshBasicMaterial({ color: BAD, transparent: true, opacity: 0.42, depthWrite: false });
    this.ghosts = new Map();      // tool → Object3D
    this.beltPool = [];           // 引き途中のベルト
    this.removeMarks = [];
    // 分析ビュー
    // 機械の上にも重ねて見せる（床の高さだとベルトやポートに隠れる）
    this.anaMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, depthTest: false });
    this.ana = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2), this.anaMat, W * H);
    this.ana.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(W * H * 3), 3);
    this.ana.count = 0;
    this.ana.renderOrder = 20;
    this.ana.frustumCulled = false;
    g.add(this.ana);
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#3fe6ff', transparent: true, opacity: 0.85 }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 7;
    g.add(this.lines);
    // ベルトの向きの矢印（建てる道具を持っているときと、分析ビューのとき）。荷物より少し上に浮かべる
    const ar = new THREE.Shape();
    ar.moveTo(-0.24, -0.065); ar.lineTo(0.03, -0.065); ar.lineTo(0.03, -0.17); ar.lineTo(0.27, 0); ar.lineTo(0.03, 0.17); ar.lineTo(0.03, 0.065); ar.lineTo(-0.24, 0.065); ar.closePath();
    this.flowMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.88, depthWrite: false });
    this.flow = new THREE.InstancedMesh(new THREE.ShapeGeometry(ar).rotateX(-Math.PI / 2), this.flowMat, W * H * 2);
    this.flow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(W * H * 2 * 3).fill(1), 3);
    this.flow.count = 0;
    this.flow.frustumCulled = false;
    this.flow.renderOrder = 7;
    this.flow.visible = false;
    g.add(this.flow);
    this.flowCol = { main: new THREE.Color('#62f0ff'), side: new THREE.Color('#ffb547'), ghost: new THREE.Color('#ffffff') };
    // 1 日目の案内：入荷口からポートのほうへ流れる矢印（ベルトを 1 本置くまで）
    const chev = new THREE.Shape();
    chev.moveTo(-0.18, -0.3); chev.lineTo(0.12, 0); chev.lineTo(-0.18, 0.3); chev.lineTo(-0.06, 0.3); chev.lineTo(0.24, 0); chev.lineTo(-0.06, -0.3); chev.closePath();
    this.guideMat = new THREE.MeshBasicMaterial({ color: '#47e8ff', transparent: true, opacity: 0.6, depthWrite: false });
    this.guide = new THREE.InstancedMesh(new THREE.ShapeGeometry(chev).rotateX(-Math.PI / 2), this.guideMat, 24);
    this.guide.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(24 * 3).fill(1), 3);
    this.guide.frustumCulled = false;
    this.guide.renderOrder = 6;
    this.guide.visible = false;
    g.add(this.guide);
    this.anaT = 0;
    this.m4 = new THREE.Matrix4();
    this.t = 0;
  }

  _ghost(tool) {
    let g = this.ghosts.get(tool);
    if (g) return g;
    const src = tool === 'belt' ? makeBelt('S') : tool === 'junction' ? makeJunction() : tool === 'sorter' ? makeSorter() : tool === 'arm' ? makeArm()
      : tool === 'pad' ? makePad(0) : tool === 'shelf' ? makeShelf() : tool === 'charger' ? makeCharger() : tool === 'labeler' ? makeLabeler() : tool === 'robot' ? makeRobot() : null;
    if (!src) return null;
    if (tool === 'arm') armIK(src.userData, 0.5, 0.5);
    g = src.clone(true);
    g.traverse((o) => { if (o.isMesh) { o.material = this.ghostOk; o.castShadow = false; o.receiveShadow = false; o.renderOrder = 8; } });
    g.visible = false;
    this.group.add(g);
    this.ghosts.set(tool, g);
    return g;
  }

  _beltGhost(i, shape) {
    let e = this.beltPool[i];
    if (!e || e.shape !== shape) {
      if (e) this.group.remove(e.root);
      const root = makeBelt(shape).clone(true);
      root.traverse((o) => { if (o.isMesh) { o.material = this.ghostOk; o.castShadow = false; o.renderOrder = 8; } });
      this.group.add(root);
      e = this.beltPool[i] = { root, shape };
    }
    e.root.visible = true;
    return e.root;
  }

  _setGhostMat(root, ok) { root.traverse((o) => { if (o.isMesh) o.material = ok ? this.ghostOk : this.ghostBad; }); }

  /** 毎フレーム。c：Controls、w：World。 */
  update(dt, c, w, analysis) {
    this.t += dt;
    for (const g of this.ghosts.values()) g.visible = false;
    for (const e of this.beltPool) e.root.visible = false;
    for (const m of this.removeMarks) m.visible = false;
    this.src.visible = this.dst.visible = false;
    this.sel.visible = this.ring.visible = false;
    const active = c && c.enabled;
    this.cursor.visible = this.fill.visible = false;
    if (active) this._tool(c, w);
    if (active && c.selected) this._selection(c, w);
    this._analysis(dt, w, analysis);
    this._flow(c, w, analysis);
    this._guide(w, active);
  }

  /** ベルトの向きの矢印。建てる道具（調べる以外）を持っているとき・分析ビューのとき。引き途中の道にも出す。 */
  _flow(c, w, analysis) {
    const on = !!c && c.enabled && (c.tool !== 'select' || analysis);
    this.flow.visible = on;
    if (!on) return;
    const m4 = this.m4, q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    let n = 0;
    const put = (x, y, dir, col, s = 1, ox = 0, oz = 0) => {
      q.setFromAxisAngle(up, -dir * Math.PI / 2);
      sc.setScalar(s);
      m4.compose(pos.set(x + ox, 0.52, y + oz), q, sc);
      this.flow.setMatrixAt(n, m4);
      this.flow.setColorAt(n, col);
      n++;
    };
    const drawing = c.path && c.tool === 'belt';
    const onPath = drawing ? new Set(c.path.map(([x, y]) => y * W + x)) : null;
    for (const b of w.lists.belts) {
      if (onPath?.has(b.y * W + b.x)) continue;
      if (b.type === 'belt') put(b.x, b.y, b.dir, this.flowCol.main);
      else if (b.type === 'sorter') {
        put(b.x, b.y, b.dir, this.flowCol.main, 0.85);
        const sd = b.cfg.side === 'L' ? (b.dir + 3) & 3 : (b.dir + 1) & 3;
        put(b.x, b.y, sd, this.flowCol.side, 0.6, DX[sd] * 0.18, DY[sd] * 0.18);
      }
    }
    if (drawing) c.path.forEach(([x, y], i) => put(x, y, c.pathDir(i), this.flowCol.ghost));
    this.flow.count = n;
    this.flow.instanceMatrix.needsUpdate = true;
    this.flow.instanceColor.needsUpdate = true;
  }

  _guide(w, active) {
    const on = active && w.day === 1 && !w.running && !w.ended && w.lists.belts.length === 0;
    this.guide.visible = on;
    if (!on) return;
    const col = new THREE.Color();
    let n = 0;
    for (let x = 1.5; x <= 11.5; x += 0.5) {
      const ph = (x * 0.35 - this.t * 0.9) % 1;
      const a = 0.25 + 0.75 * Math.pow(Math.max(0, Math.cos(ph * Math.PI * 2)), 4);
      this.m4.makeTranslation(x, 0.02, 8);
      this.guide.setMatrixAt(n, this.m4);
      this.guide.setColorAt(n, col.setRGB(a, a, a));
      n++;
    }
    this.guide.count = n;
    this.guide.instanceMatrix.needsUpdate = true;
    this.guide.instanceColor.needsUpdate = true;
  }

  _tool(c, w) {
    const { x, y } = c.cursor;
    const tool = c.tool;
    const show = c.cursor.ok && (c.lastPointer !== 'touch' || c.path || tool === 'select');
    // ベルト・撤去の引き途中
    if (c.path) {
      let k = 0;
      c.path.forEach(([px, py], i) => {
        if (tool === 'remove') {
          const b = w.at(px, py);
          if (!b || b.type === 'dock') return;
          let m = this.removeMarks[k];
          if (!m) { m = new THREE.Mesh(this.frameG, this.ghostBad); m.renderOrder = 8; this.group.add(m); this.removeMarks[k] = m; }
          m.position.set(px, 0.03, py); m.visible = true; k++;
          return;
        }
        const dir = c.pathDir(i);
        // 曲がり：前のマスから入ってくる向きで形を決める
        let shape = 'S';
        if (i > 0) {
          const [qx, qy] = c.path[i - 1];
          const from = qx < px ? 2 : qy < py ? 3 : qx > px ? 0 : 1; // 入ってくる面
          if (from === ((dir + 3) & 3)) shape = 'L'; else if (from === ((dir + 1) & 3)) shape = 'R';
        }
        const g = this._beltGhost(k++, shape);
        const why = w.whyNot('belt', px, py);
        const cur = w.at(px, py);
        const ok = !why || (cur && (cur.type === 'belt' || cur.type === 'sorter' || cur.type === 'junction') && why !== 'money');
        this._setGhostMat(g, ok);
        g.position.set(px, 0.01, py);
        g.rotation.y = -dir * Math.PI / 2;
      });
      return;
    }
    if (!show) return;
    // カーソル
    let ok = true;
    if (tool !== 'select' && tool !== 'remove') ok = !w.whyNot(tool, x, y) || (tool === 'belt' && w.at(x, y)?.type === 'belt');
    if (tool === 'remove') ok = !!w.at(x, y) && w.at(x, y).type !== 'dock';
    const col = tool === 'remove' ? BAD : tool === 'select' ? SEL : ok ? OK : BAD;
    this.cursorMat.color.copy(col);
    this.fill.material.color.copy(col);
    this.cursor.position.set(x, 0.02 + Math.sin(this.t * 6) * 0.004, y);
    this.fill.position.set(x, 0.015, y);
    this.cursor.visible = true;
    this.fill.visible = tool !== 'select';
    if (tool === 'select' || tool === 'remove') return;
    const g = this._ghost(tool);
    if (!g) return;
    const cur = w.at(x, y);
    const occupied = cur && !((tool === 'belt' || tool === 'sorter' || tool === 'junction') && (cur.type === 'belt' || cur.type === 'sorter' || cur.type === 'junction'));
    if (occupied) return;
    this._setGhostMat(g, ok);
    g.visible = true;
    g.position.set(x, 0.01, y);
    const gd = c.ghostDir(tool, x, y);
    g.rotation.y = tool === 'robot' ? -c.rot * Math.PI / 2 : -(['pad', 'shelf', 'charger', 'junction'].includes(tool) ? 0 : gd) * Math.PI / 2;
    if (tool === 'arm') this._armTiles(x, y, gd);
    if (tool === 'labeler') { this.src.visible = false; this.dst.visible = true; this.dst.position.set(x + DX[gd], 0.25, y + DY[gd]); }
  }

  _armTiles(x, y, dir) {
    const b = opp(dir);
    this.src.position.set(x + DX[b], 0.25, y + DY[b]);
    this.dst.position.set(x + DX[dir], 0.25, y + DY[dir]);
    this.src.visible = this.dst.visible = true;
  }

  _selection(c, w) {
    const s = c.selected;
    if (s.kind === 'r') {
      if (s.ref.gone) { c.select(null); return; }
      this.ring.position.set(s.ref.x, 0.02, s.ref.y);
      this.ring.visible = true;
      return;
    }
    const b = s.ref;
    if (b.gone || w.at(b.x, b.y) !== b) { c.select(null); return; }
    this.sel.position.set(b.x, 0.03, b.y);
    this.sel.visible = true;
    if (b.type === 'arm') this._armTiles(b.x, b.y, b.dir);
    if (b.type === 'labeler' || b.type === 'dock') { this.dst.visible = true; this.dst.position.set(b.x + DX[b.dir], 0.25, b.y + DY[b.dir]); }
  }

  // 分析ビュー：0.25 秒ごとに色を作り直す
  _analysis(dt, w, on) {
    this.ana.visible = on;
    this.lines.visible = on;
    if (!on) return;
    this.anaT -= dt;
    if (this.anaT > 0) return;
    this.anaT = 0.25;
    const col = new THREE.Color();
    let n = 0;
    const put = (x, y, c, a = 1) => {
      this.m4.makeTranslation(x, 0.3, y);
      this.ana.setMatrixAt(n, this.m4);
      col.copy(c).multiplyScalar(a);
      this.ana.setColorAt(n, col);
      n++;
    };
    const GOOD = new THREE.Color('#29d17a'), MID = new THREE.Color('#ffd23a'), HOT = new THREE.Color('#ff3b4e'), IDLE = new THREE.Color('#5b7da8');
    const perf = w.perf();
    for (const b of w.buildings) {
      let c = null;
      if (b.lanes) {
        const load = (b.lanes[0].length + b.lanes[1].length) / 2;
        c = b.jamT > 1.2 ? HOT : load > 0.9 ? MID : load > 0 ? GOOD : IDLE;
      } else if (b.type === 'dock') {
        const f = b.queue.length / perf.dockCap;
        c = f >= 0.95 ? HOT : f > 0.5 ? MID : GOOD;
      } else if (b.type === 'pad') {
        const f = b.store.length / perf.padCap;
        c = f >= 0.99 ? HOT : f > 0.5 ? MID : GOOD;
      } else if (b.type === 'arm') {
        c = b.phase === 'idle' && b.waitT > 2 ? IDLE : b.phase === 'drop' && b.t > 0.6 ? HOT : GOOD;
      } else if (b.type === 'shelf') {
        const f = b.store.length / perf.shelfCap;
        c = f >= 0.99 ? HOT : f > 0.5 ? MID : GOOD;
      } else if (b.type === 'labeler') c = b.inQ.length >= 3 || b.outWait > 1.2 ? HOT : b.cur || b.outQ.length ? GOOD : IDLE;
      else if (b.type === 'charger') c = b.user ? MID : IDLE;
      if (c) put(b.x, b.y, c);
    }
    this.ana.count = n;
    this.ana.instanceMatrix.needsUpdate = true;
    this.ana.instanceColor.needsUpdate = true;
    // 人型ロボの行き先の線
    const pts = [];
    for (const r of w.robots) {
      if (!r.path || r.pi >= r.path.length) continue;
      let px = r.x, py = r.y;
      for (let i = r.pi; i < r.path.length; i++) {
        const t = r.path[i], tx = t % W, ty = (t / W) | 0;
        pts.push(px, 0.06, py, tx, 0.06, ty);
        px = tx; py = ty;
      }
    }
    this.lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }
}
