// 「見えない Object3D の階層」を、(形, 材質) ごとの InstancedMesh にまとめて描く。
// 建物やロボは、ふつうの Object3D で組み立てて動かし（シーンには入れない）、毎フレームここで行列を写す。
// 何台置いても、描く回数は (形, 材質) の組の数だけで済む。
//
//   const inst = new Instancer(scene);
//   inst.begin();  inst.add(rootObject);  …  inst.end();
//   mesh.userData.tint = THREE.Color で一体ずつ色を変えられる（材質の色に掛かる）
//   mesh.visible = false の部品は描かない
import * as THREE from 'three';

const WHITE = new THREE.Color(1, 1, 1);

export class Instancer {
  constructor(scene, name = 'inst') {
    this.scene = scene;
    this.name = name;
    this.buckets = new Map();
    this.order = [];
    this._stack = [];
  }

  _bucket(geo, mat, src) {
    const key = geo.uuid + '|' + mat.uuid;
    let b = this.buckets.get(key);
    if (!b) {
      b = { key, geo, mat, cap: 0, mesh: null, n: 0, tinted: false, cast: src.castShadow, recv: src.receiveShadow, order: src.renderOrder || 0 };
      this.buckets.set(key, b);
      this.order.push(b);
      this._grow(b, 16);
    }
    return b;
  }

  _grow(b, cap) {
    const old = b.mesh;
    const m = new THREE.InstancedMesh(b.geo, b.mat, cap);
    m.name = `${this.name}:${b.geo.name || 'geo'}:${b.mat.name || 'mat'}`;
    m.castShadow = b.cast;
    m.receiveShadow = b.recv;
    m.frustumCulled = false;
    m.renderOrder = b.order;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (old) {
      m.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, Math.min(old.instanceMatrix.array.length, m.instanceMatrix.array.length)));
      if (old.instanceColor) {
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
        m.instanceColor.array.set(old.instanceColor.array.subarray(0, Math.min(old.instanceColor.array.length, cap * 3)));
      }
      this.scene.remove(old);
      old.dispose();
    }
    b.mesh = m;
    b.cap = cap;
    this.scene.add(m);
  }

  begin() { for (const b of this.order) b.n = 0; }

  /** root 以下の見える Mesh を写す。root.updateMatrixWorld は呼び出し側で済ませておいてもよい（force で呼ぶ）。 */
  add(root, update = true) {
    if (!root.visible) return;
    if (update) root.updateMatrixWorld(true);
    const stack = this._stack;
    stack.length = 0;
    stack.push(root);
    while (stack.length) {
      const o = stack.pop();
      if (!o.visible) continue;
      if (o.isMesh) this._put(o);
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) stack.push(ch[i]);
    }
  }

  _put(o) {
    const b = this._bucket(o.geometry, o.material, o);
    if (b.n >= b.cap) this._grow(b, b.cap * 2);
    const m = b.mesh;
    m.setMatrixAt(b.n, o.matrixWorld);
    const tint = o.userData.tint;
    if (tint || b.tinted) {
      if (!m.instanceColor) {
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(b.cap * 3).fill(1), 3);
        b.tinted = true;
      }
      m.setColorAt(b.n, tint || WHITE);
    }
    b.n++;
  }

  /** 行列を直接入れる（荷物などの、部品が 1 つのもの）。 */
  addMatrix(geo, mat, matrix, tint = null, flags = { cast: true, recv: true }) {
    const b = this._bucket(geo, mat, { castShadow: flags.cast, receiveShadow: flags.recv });
    if (b.n >= b.cap) this._grow(b, b.cap * 2);
    b.mesh.setMatrixAt(b.n, matrix);
    if (tint || b.tinted) {
      if (!b.mesh.instanceColor) {
        b.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(b.cap * 3).fill(1), 3);
        b.tinted = true;
      }
      b.mesh.setColorAt(b.n, tint || WHITE);
    }
    b.n++;
  }

  end() {
    for (const b of this.order) {
      const m = b.mesh;
      m.count = b.n;
      m.visible = b.n > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** 描いている数（確認用）。 */
  stats() { return Object.fromEntries(this.order.filter((b) => b.n).map((b) => [b.mesh.name, b.n])); }

  dispose() { for (const b of this.order) { this.scene.remove(b.mesh); b.mesh.dispose(); } this.buckets.clear(); this.order = []; }
}
