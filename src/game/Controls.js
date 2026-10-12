// 建てる・選ぶ・カメラを動かす操作。マウス・キーボード・ゲームパッド・タッチを同じ「動作」にまとめる。
//
// マウス：左クリックで置く・選ぶ、左ドラッグでベルトを引く（調べる道具ではカメラを動かす）、右ドラッグでカメラ、右クリックで道具をやめる、
//         ホイールで寄る・引く
// キー：WASD でカメラ、矢印でカーソル、Enter で置く・選ぶ、R で向き、Q/E でカメラを回す、1〜0 で道具、
//       Space で一時停止、F で速さ、Tab で分析ビュー、Esc で道具をやめる（なければメニュー）
// パッド：左スティック・十字でカーソル、右スティックでカメラ、LT/RT で寄る・引く、LB/RB で道具、
//         A で置く（押したまま動かすとベルトを引く）、B でやめる、X で向き、Y で一時停止、View で分析、R3 で速さ、L3 でカメラを回す
// タッチ：1 本指でタップ＝置く・選ぶ、ドラッグ＝ベルトを引く（ほかの道具ではカメラ）、2 本指で動かす・つまむ・ひねる
import { DX, DY, TOOLS, W, H, opp, leftOf, rightOf } from './sim/consts.js';
import { isBelt } from './sim/World.js';
import { clamp } from '../core/math.js';

const DRAW_TOOLS = new Set(['belt', 'remove']);
const MOVE_THRESH = 7;

export class Controls {
  constructor(game, dom) {
    this.g = game;
    this.dom = dom;
    this.tool = 'select';
    this.rot = 0;
    this.cursor = { x: 8, y: 8, ok: false, gx: 8, gz: 8 };
    this.path = null;           // ベルト・撤去で引いている道 [[x, y], …]
    this.selected = null;       // { kind: 'b' | 'r', ref }
    this.mouse = null;          // マウスを押している間の情報
    this.touches = new Map();
    this.touchMode = null;      // 'tool' | 'pan' | 'two'
    this.padA = false;
    this.rep = {};
    this.stickAcc = { x: 0, y: 0 };
    this.lastPointer = 'mouse';
    this.enabled = false;
    this._bind();
  }

  get w() { return this.g.world; }
  get rig() { return this.g.rig; }

  // ------------------------------------------------------------------ 道具
  setTool(t) {
    if (!TOOLS.includes(t)) return;
    if (t !== 'select' && t !== 'remove' && !this.w.tools.has(t) && t !== 'robot') { this.g.audio.sfx('invalid'); return; }
    if (t === 'robot' && !this.w.tools.has('robot')) { this.g.audio.sfx('invalid'); return; }
    if (this.tool !== t) this.g.audio.sfx('tool');
    this.tool = t;
    this.path = null;
    if (t !== 'select') this.select(null);
    this.g.ui?.setTool(t);
    this.g.view.env.showGrid(t !== 'select');
    // 初めて選んだ道具は、使い方の見本を出す
    if (this.enabled) this.g.ui?.autoGuide(t);
  }

  cycleTool(d) {
    const list = TOOLS.filter((t) => t === 'select' || t === 'remove' || this.w.tools.has(t));
    const i = list.indexOf(this.tool);
    this.setTool(list[(i + d + list.length) % list.length]);
  }

  rotate(d = 1) {
    const s = this.selected;
    if (s?.kind === 'b' && s.ref.cfg && this.w.at(s.ref.x, s.ref.y) === s.ref && this._rotatable(s.ref)) {
      this.w.rotate(s.ref, (s.ref.dir + d + 4) & 3);
      this.g.audio.sfx('rotate');
      return;
    }
    this.rot = (this.rot + d + 4) & 3;
    this.g.audio.sfx('rotate');
    this.g.ui?.setRot(this.rot);
  }
  _rotatable(b) { return ['belt', 'sorter', 'arm', 'labeler'].includes(b.type); }

  cancel() {
    if (this.g.ui?.hideGuide()) return true;
    if (this.path) { this.path = null; return true; }
    if (this.selected) { this.select(null); return true; }
    if (this.tool !== 'select') { this.setTool('select'); return true; }
    return false;
  }

  select(s) {
    this.selected = s;
    this.g.ui?.inspect(s);
  }

  // ------------------------------------------------------------------ 置く・取る
  /** カーソルのマスで、今の道具を使う（クリック・Enter・A・タップ）。 */
  act(x = this.cursor.x, y = this.cursor.y) {
    const w = this.w, tool = this.tool;
    if (!w.inside(x, y)) return;
    if (tool === 'select') {
      const r = this._robotNear(this.cursor.gx, this.cursor.gz);
      if (r) { this.select({ kind: 'r', ref: r }); this.g.audio.sfx('select'); return; }
      const b = w.at(x, y);
      if (b) { this.select({ kind: 'b', ref: b }); this.g.audio.sfx('select'); }
      else this.select(null);
      return;
    }
    if (tool === 'remove') { this._removeAt(x, y, true); return; }
    this.place(tool, x, y, this.rot, true);
  }

  place(tool, x, y, dir, loud) {
    const w = this.w;
    const why = w.whyNot(tool, x, y);
    if (why) {
      // 同じものが同じ向きで置いてあるだけなら、黙って何もしない
      const cur = w.at(x, y);
      if (cur && cur.type === tool && cur.dir === dir) return null;
      if (loud) { this.g.audio.sfx('invalid'); this.g.ui?.toast('why.' + why); }
      return null;
    }
    // 向き：アームは「後ろから取れて前に置ける」向き、ゲートはベルトの向きに自動でそろえる
    dir = this.ghostDir(tool, x, y, dir);
    let cfg = this._cfgFor(tool, x, y, dir);
    // アームの前がポートなら、フィルターをそのポートの宛先に合わせる（合わない荷物を載せて誤配送にしないように）
    if (tool === 'arm') {
      const front = w.at(x + DX[dir], y + DY[dir]);
      if (front?.type === 'pad') cfg = { ...(cfg || {}), filter: front.cfg.dest };
    }
    // ゲートを置いた横に受け取れるもの（ベルト・ポート・棚）があれば、そちらへ流す
    if (tool === 'sorter') {
      const side = this._sorterSide(x, y, dir);
      if (side) cfg = { ...(cfg || {}), side };
    }
    const b = w.build(tool, x, y, dir, cfg);
    if (b) {
      if (loud) this.g.audio.sfx(tool === 'belt' ? 'belt' : 'place', { pos: { x, y: 0, z: y } });
      this.g.onBuilt?.(tool, b);
      // 設定のあるもの（フィルター・宛先）は、置いたらそのまま調べる窓を開く
      if (loud && (tool === 'arm' || tool === 'sorter' || tool === 'pad')) this.select({ kind: 'b', ref: b });
    }
    return b;
  }

  /** 新しく置くものの設定：前に選んだ設定を引き継ぐ（同じフィルターのアームを並べやすく）。 */
  _cfgFor(tool, x, y, dir) {
    const last = this.g.lastCfg?.[tool];
    if (tool === 'pad') {
      // まだポートのない宛先を先に
      const have = new Set(this.w.lists.pads.map((p) => p.cfg.dest));
      const dests = this.w.def?.dests || [0, 1];
      const free = dests.find((d) => !have.has(d));
      return { dest: free ?? last?.dest ?? dests[0] };
    }
    return last ? { ...last } : null;
  }

  /** 置く向き。アーム・ラベル機はまわりを見て決め、ゲートはベルトの上ならその向き。ほかは選んでいる向き（rot）。 */
  ghostDir(tool, x, y, rot = this.rot) {
    const w = this.w;
    if (tool === 'arm') return this._armAutoDir(x, y, rot);
    if (tool === 'labeler') return this._labAutoDir(x, y, rot);
    if (tool === 'sorter') { const cur = w.at(x, y); if (cur && (cur.type === 'belt' || cur.type === 'sorter')) return cur.dir; }
    return rot;
  }

  /** アーム：後ろ（取る側）にベルト・棚・入荷口、前（置く側）にポート・棚・ベルトがある向きを選ぶ。ポートへ載せる向きを一番に。 */
  _armAutoDir(x, y, rot) {
    const w = this.w;
    const src = (b) => b && ['belt', 'sorter', 'dock', 'shelf', 'labeler'].includes(b.type);
    const dst = (b) => b && ['pad', 'shelf', 'belt', 'sorter', 'labeler'].includes(b.type);
    const score = (d) => {
      const back = w.at(x - DX[d], y - DY[d]), front = w.at(x + DX[d], y + DY[d]);
      if (!src(back) || !dst(front)) return -1;
      let s = 1;
      if (front.type === 'pad') s += 3;
      else if (front.type === 'shelf' || front.type === 'labeler') s += 1.5;
      if (back.type === 'belt' || back.type === 'sorter' || back.type === 'dock') s += 1;
      if (front.type === 'belt' && back.type === 'belt') s -= 0.6;
      if (d === rot) s += 0.4;
      return s;
    };
    let best = rot, bs = score(rot);
    for (let d = 0; d < 4; d++) { const sc = score(d); if (sc > bs + 1e-6) { bs = sc; best = d; } }
    return best;
  }

  /** ラベル機：前に出せる所（受けられるベルト・棚・ポート）、ほかの面にこちらへ向いたベルトがある向き。 */
  _labAutoDir(x, y, rot) {
    const w = this.w;
    const score = (d) => {
      const front = w.at(x + DX[d], y + DY[d]);
      let s = 0;
      if (front && ((front.type === 'belt' && front.dir !== opp(d)) || front.type === 'shelf' || front.type === 'pad')) s += 2;
      for (let k = 0; k < 4; k++) {
        if (k === d) continue;
        const nb = w.at(x + DX[k], y + DY[k]);
        if (nb && (nb.type === 'belt' || nb.type === 'sorter') && nb.dir === opp(k)) s += 1;
      }
      if (d === rot) s += 0.4;
      return s;
    };
    let best = rot, bs = score(rot);
    for (let d = 0; d < 4; d++) { const sc = score(d); if (sc > bs + 1e-6) { bs = sc; best = d; } }
    return best;
  }

  /** ゲートの流す向き：左右のどちらかに受け取れるものがあれば、そちら。 */
  _sorterSide(x, y, dir) {
    const w = this.w;
    const ok = (d) => {
      const nb = w.at(x + DX[d], y + DY[d]);
      if (!nb) return 0;
      if (nb.type === 'pad' || nb.type === 'shelf' || nb.type === 'labeler') return 2;
      if (nb.type === 'belt' && nb.dir !== opp(d)) return nb.dir === d ? 3 : 1;
      return 0;
    };
    const L = ok(leftOf(dir)), R = ok(rightOf(dir));
    return L > R ? 'L' : R > L ? 'R' : null;
  }

  _removeAt(x, y, loud) {
    const w = this.w;
    const r = this._robotNear(x, y, 0.6);
    if (r && this.tool === 'remove' && loud) { w.fire(r); this.g.audio.sfx('remove'); return true; }
    const b = w.at(x, y);
    if (!b || b.type === 'dock') { if (loud) this.g.audio.sfx('invalid'); return false; }
    if (this.selected?.ref === b) this.select(null);
    w.remove(x, y);
    this.g.audio.sfx('remove', { pos: { x, y: 0, z: y } });
    return true;
  }

  removeSelected() {
    const s = this.selected;
    if (!s) return;
    if (s.kind === 'r') { this.w.fire(s.ref); this.select(null); this.g.audio.sfx('remove'); return; }
    if (s.ref.type === 'dock') return;
    this._removeAt(s.ref.x, s.ref.y, true);
  }

  _robotNear(gx, gz, rad = 0.45) {
    let best = null, bd = rad;
    for (const r of this.w.robots) { const d = Math.hypot(r.x - gx, r.y - gz); if (d < bd) { bd = d; best = r; } }
    return best;
  }

  // ------------------------------------------------------------------ ベルトを引く
  beginPath(x, y) {
    if (!DRAW_TOOLS.has(this.tool)) return;
    this.path = [[x, y]];
  }

  extendPath(x, y) {
    const P = this.path;
    if (!P) return;
    let [cx, cy] = P[P.length - 1];
    let guard = 0;
    while ((cx !== x || cy !== y) && guard++ < 80) {
      const dx = x - cx, dy = y - cy;
      if (Math.abs(dx) >= Math.abs(dy)) cx += Math.sign(dx); else cy += Math.sign(dy);
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) break;
      // 一つ前に戻ったら、最後を取り消す
      if (P.length >= 2 && P[P.length - 2][0] === cx && P[P.length - 2][1] === cy) { P.pop(); continue; }
      if (P.some(([px, py]) => px === cx && py === cy)) continue;
      P.push([cx, cy]);
      if (P.length > 1) this.g.audio.sfx('tick', { minGap: 0.04 });
    }
  }

  /** 引いた道の向き（i 番目のマス）。 */
  pathDir(i) {
    const P = this.path;
    if (!P) return this.rot;
    if (P.length === 1) return this.rot;
    const [ax, ay] = P[Math.min(i, P.length - 2)], [bx, by] = P[Math.min(i, P.length - 2) + 1];
    return bx > ax ? 0 : by > ay ? 1 : bx < ax ? 2 : 3;
  }

  commitPath() {
    const P = this.path;
    this.path = null;
    if (!P) return;
    if (this.tool === 'remove') {
      let n = 0;
      for (const [x, y] of P) if (this.w.at(x, y) && this.w.at(x, y).type !== 'dock') { this._removeAt(x, y, false); n++; }
      if (n) this.g.audio.sfx('remove'); else if (P.length === 1) this._removeAt(P[0][0], P[0][1], true);
      return;
    }
    if (P.length > 1) this.rot = this.pathDir(P.length - 1);
    let placed = 0, fail = null;
    for (let i = 0; i < P.length; i++) {
      const [x, y] = P[i];
      const dir = this.pathDir(i);
      const why = this.w.whyNot('belt', x, y);
      const cur = this.w.at(x, y);
      if (why && !(cur && isBelt(cur) && why !== 'money')) { fail = fail || why; continue; }
      if (cur && cur.type === 'belt' && cur.dir === dir) continue;
      // ゲート・交差は、向きを変えずに残す（引いた線がまたぐだけ）
      if (cur && (cur.type === 'sorter' || cur.type === 'junction')) continue;
      if (this.w.build('belt', x, y, dir)) placed++;
    }
    if (placed) { this.g.audio.sfx('belt'); this.g.onBuilt?.('belt', null, placed); }
    else if (fail) { this.g.audio.sfx('invalid'); this.g.ui?.toast('why.' + fail); }
    this.g.ui?.setRot(this.rot);
  }

  // ------------------------------------------------------------------ 入力
  _bind() {
    const dom = this.dom;
    dom.addEventListener('pointerdown', (e) => this._down(e));
    addEventListener('pointermove', (e) => this._move(e));
    addEventListener('pointerup', (e) => this._up(e));
    addEventListener('pointercancel', (e) => this._up(e, true));
    dom.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const a = this.rig.groundAt(e.clientX, e.clientY);
      this.rig.zoom(Math.pow(1.0015, e.deltaY * (e.deltaMode === 1 ? 30 : 1)), a);
    }, { passive: false });
  }

  _ground(px, py) {
    const g = this.rig.groundAt(px, py);
    if (!g) return null;
    return g;
  }

  _setCursorFromScreen(px, py) {
    const g = this._ground(px, py);
    if (!g) { this.cursor.ok = false; return; }
    this.cursor.gx = g.x; this.cursor.gz = g.z;
    this.cursor.x = clamp(Math.round(g.x), 0, W - 1);
    this.cursor.y = clamp(Math.round(g.z), 0, H - 1);
    this.cursor.ok = g.x > -0.5 && g.z > -0.5 && g.x < W - 0.5 && g.z < H - 0.5;
  }

  _down(e) {
    if (!this.enabled) return;
    this.lastPointer = e.pointerType;
    if (e.pointerType === 'touch') { this._touchDown(e); return; }
    try { this.dom.setPointerCapture?.(e.pointerId); } catch { /* 作った PointerEvent では捕まえられない */ }
    this._setCursorFromScreen(e.clientX, e.clientY);
    const g = this._ground(e.clientX, e.clientY);
    this.mouse = { btn: e.button, x: e.clientX, y: e.clientY, moved: false, g0: g ? g.clone() : null, draw: false };
    if (e.button === 0 && DRAW_TOOLS.has(this.tool) && this.cursor.ok) { this.mouse.draw = true; this.beginPath(this.cursor.x, this.cursor.y); }
  }

  _move(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'touch') { this._touchMove(e); return; }
    this._setCursorFromScreen(e.clientX, e.clientY);
    this.g.ui?.hover(e.clientX, e.clientY);
    const m = this.mouse;
    if (!m) return;
    if (!m.moved && Math.hypot(e.clientX - m.x, e.clientY - m.y) > MOVE_THRESH) m.moved = true;
    if (m.draw) { if (this.cursor.ok || this.path) this.extendPath(this.cursor.x, this.cursor.y); return; }
    // つかんで動かす：押した所の地面が、ずっとマウスの下にあるように
    if (m.moved && m.g0) {
      const g = this._ground(e.clientX, e.clientY);
      if (g) this.rig.grab(m.g0.x - g.x, m.g0.z - g.z);
    }
  }

  _up(e, cancel = false) {
    if (e.pointerType === 'touch') { this._touchUp(e, cancel); return; }
    const m = this.mouse;
    this.mouse = null;
    if (!m || !this.enabled) return;
    if (m.draw) { if (cancel) this.path = null; else this.commitPath(); return; }
    if (m.moved || cancel) return;
    if (m.btn === 0 && this.cursor.ok) this.act();
    else if (m.btn === 2) { if (!this.cancel()) this.select(null); this.g.audio.sfx('ui_back'); }
  }

  // ---- タッチ
  _touchDown(e) {
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    if (this.touches.size === 1) {
      this._setCursorFromScreen(e.clientX, e.clientY);
      const g = this._ground(e.clientX, e.clientY);
      this.touchMode = DRAW_TOOLS.has(this.tool) ? 'draw?' : 'tap?';
      this.tg0 = g ? g.clone() : null;
      this.tMoved = false;
    } else if (this.touches.size === 2) {
      // 2 本目：線引きはやめて、動かす・つまむ・ひねるへ
      this.path = null;
      this.touchMode = 'two';
      this._two = this._twoState();
    }
  }

  _twoState() {
    const [a, b] = [...this.touches.values()];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    return { mx, my, d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), g: this._ground(mx, my)?.clone() };
  }

  _touchMove(e) {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX; t.y = e.clientY;
    if (this.touchMode === 'two' && this.touches.size >= 2) {
      const s0 = this._two, s1 = this._twoState();
      if (s0 && s1.d > 10 && s0.d > 10) {
        // ひねる：指をひねった向きに地面も回る（地図アプリと同じ）。つまむ：指の間が広がれば寄る
        const da = s1.ang - s0.ang;
        const twist = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(twist) < 0.5) this.rig.twist(twist, true);
        this.rig.zoom(s0.d / s1.d, null, true);
        // 前の中点の下にあった地面を、いまの中点の下へ（回す・寄るで動いたぶんも、ここでそろう）
        if (s0.g) { const g = this._ground(s1.mx, s1.my); if (g) this.rig.grab(s0.g.x - g.x, s0.g.z - g.z); }
      }
      this._two = this._twoState();
      return;
    }
    if (this.touches.size !== 1) return;
    if (!this.tMoved && Math.hypot(t.x - t.x0, t.y - t.y0) > MOVE_THRESH * 1.5) {
      this.tMoved = true;
      if (this.touchMode === 'draw?') { this.touchMode = 'draw'; const g = this._ground(t.x0, t.y0); if (g) this.beginPath(clamp(Math.round(g.x), 0, W - 1), clamp(Math.round(g.z), 0, H - 1)); }
      else this.touchMode = 'pan';
    }
    this._setCursorFromScreen(t.x, t.y);
    if (this.touchMode === 'draw') this.extendPath(this.cursor.x, this.cursor.y);
    else if (this.touchMode === 'pan' && this.tg0) { const g = this._ground(t.x, t.y); if (g) this.rig.grab(this.tg0.x - g.x, this.tg0.z - g.z); }
  }

  _touchUp(e, cancel) {
    const t = this.touches.get(e.pointerId);
    this.touches.delete(e.pointerId);
    if (!t || !this.enabled) { if (!this.touches.size) this.touchMode = null; return; }
    if (this.touchMode === 'two') {
      if (this.touches.size < 2) { this.rig.snapYaw(); this.touchMode = this.touches.size ? 'done' : null; }
      return;
    }
    if (this.touches.size) return;
    const mode = this.touchMode;
    this.touchMode = null;
    if (cancel) { this.path = null; return; }
    if (mode === 'draw') { this.commitPath(); return; }
    if (mode === 'tap?' || mode === 'draw?') {
      this._setCursorFromScreen(t.x, t.y);
      if (!this.cursor.ok) return;
      if (mode === 'draw?') { this.beginPath(this.cursor.x, this.cursor.y); this.commitPath(); }
      else this.act();
    }
  }

  // ------------------------------------------------------------------ 毎フレーム（キー・パッド）
  update(dt) {
    if (!this.enabled) return;
    const input = this.g.input;
    const k = input.keys;
    // カメラ：WASD・右スティック
    const sp = this.rig.want.dist * 0.9 * dt;
    let px = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    let py = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const pad = this._pad();
    if (pad) { px += pad.rx; py -= pad.ry; }
    if (px || py) this.rig.pan(px * sp, py * sp);
    // 寄る・引く
    let z = (k.has('Equal') || k.has('NumpadAdd') || k.has('PageUp') ? -1 : 0) + (k.has('Minus') || k.has('NumpadSubtract') || k.has('PageDown') ? 1 : 0);
    if (pad) z += pad.lt - pad.rt;
    if (z) this.rig.zoom(Math.pow(1.9, z * dt));
    // カーソル：矢印・十字（1 マスずつ、押しっぱなしで続けて）と左スティック（なめらかに）
    let cx = 0, cy = 0;
    // 1 コマより短い叩き（押して離すまでがフレームの間）は押しっぱなしに出ないので、押した記録でも数える
    const kp = input.keysPressed;
    const step = (name, code, padHeld) => this._repeat(name, k.has(code) || padHeld, dt) || (kp.has(code) && !k.has(code));
    const q = this.rig.quarter;
    if (step('up', 'ArrowUp', pad?.up)) cy -= 1;
    if (step('down', 'ArrowDown', pad?.down)) cy += 1;
    if (step('left', 'ArrowLeft', pad?.left)) cx -= 1;
    if (step('right', 'ArrowRight', pad?.right)) cx += 1;
    if (pad && (Math.abs(pad.lx) > 0.2 || Math.abs(pad.ly) > 0.2)) {
      this.stickAcc.x += pad.lx * dt * 7;
      this.stickAcc.y += pad.ly * dt * 7;
      const ix = Math.trunc(this.stickAcc.x), iy = Math.trunc(this.stickAcc.y);
      cx += ix; cy += iy; this.stickAcc.x -= ix; this.stickAcc.y -= iy;
    } else { this.stickAcc.x = this.stickAcc.y = 0; }
    if (cx || cy) {
      // 画面の向き（カメラを回していても、上を押せば画面の上へ）
      const r = rotScreen(cx, cy, q);
      this.cursor.x = clamp(this.cursor.x + r[0], 0, W - 1);
      this.cursor.y = clamp(this.cursor.y + r[1], 0, H - 1);
      this.cursor.gx = this.cursor.x; this.cursor.gz = this.cursor.y;
      this.cursor.ok = true;
      this.lastPointer = 'key';
      this.rig.keepInView(this.cursor.x, this.cursor.y);
      if (this.path) this.extendPath(this.cursor.x, this.cursor.y);
    }
    // 動作
    if (input.pressed('place')) {
      if (DRAW_TOOLS.has(this.tool)) { this.beginPath(this.cursor.x, this.cursor.y); this.padA = true; }
      else {
        this.act();
        // パッド・キーボードで選んだら、調べる窓をそのまま操作できるように
        if (this.tool === 'select' && this.selected) this.g.focusInspect();
      }
    }
    if (this.padA && !input.down('place')) { this.padA = false; this.commitPath(); }
    if (input.pressed('rotate')) this.rotate(k.has('ShiftLeft') || k.has('ShiftRight') ? -1 : 1);
    if (input.pressed('toolPrev')) this.cycleTool(-1);
    if (input.pressed('toolNext')) this.cycleTool(1);
    if (input.pressed('camL')) this.rig.rotate(-1);
    if (input.pressed('camR')) this.rig.rotate(1);
    if (input.pressed('del')) { if (this.selected) this.removeSelected(); else this.setTool(this.tool === 'remove' ? 'select' : 'remove'); }
    for (let i = 0; i < 10; i++) if (input.keysPressed.has('Digit' + ((i + 1) % 10)) && TOOLS[i] && TOOLS[i] !== 'remove') this.setTool(TOOLS[i]);
  }

  _repeat(name, held, dt) {
    const r = this.rep[name] || (this.rep[name] = { held: false, t: 0 });
    let fire = false;
    if (held) {
      if (!r.held) { fire = true; r.t = 0.32; }
      else if ((r.t -= dt) <= 0) { fire = true; r.t = 0.075; }
    }
    r.held = !!held;
    return fire;
  }

  _pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
      const b = (i) => !!gp.buttons[i]?.pressed;
      const v = (i) => gp.buttons[i]?.value || 0;
      return { lx: dz(gp.axes[0] || 0), ly: dz(gp.axes[1] || 0), rx: dz(gp.axes[2] || 0), ry: dz(gp.axes[3] || 0),
        up: b(12), down: b(13), left: b(14), right: b(15), lt: v(6), rt: v(7) };
    }
    return null;
  }
}

/** 画面の向きの (dx, dy) を、カメラの向き（0〜3）に合わせてマスの向きへ。 */
function rotScreen(dx, dy, q) {
  // q = 0：画面の上 = 北（-y）。カメラを 90° 回すごとに、画面の上が西・南・東と変わる
  for (let i = 0; i < q; i++) [dx, dy] = [dy, -dx];
  return [dx, dy];
}
