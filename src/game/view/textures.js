// canvas で描くテクスチャ（画像ファイルは使わない）。
import * as THREE from 'three';
import { DESTS } from '../sim/consts.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, { repeat = false, srgb = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}
// 決まった並びの乱数（描くたびに同じ模様になるように）
function prng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** 床（コンクリート）。cols × rows マス。 */
export function floorTex(cols, rows, px = 64) {
  const [c, g] = canvas(cols * px, rows * px);
  const r = prng(7);
  g.fillStyle = '#d3d0c8';
  g.fillRect(0, 0, c.width, c.height);
  // マスごとに少し色を変える（打ち継ぎの跡）
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const v = (r() - 0.5) * 10;
    g.fillStyle = `rgba(${v > 0 ? 255 : 60},${v > 0 ? 255 : 60},${v > 0 ? 250 : 55},${Math.abs(v) / 120})`;
    g.fillRect(x * px, y * px, px, px);
  }
  // 細かいざらつき
  for (let i = 0; i < cols * rows * 40; i++) {
    const a = r() * 0.06;
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    g.fillRect(r() * c.width, r() * c.height, 1 + r() * 2, 1 + r() * 2);
  }
  // しみ
  for (let i = 0; i < cols * rows * 0.15; i++) {
    const x = r() * c.width, y = r() * c.height, rad = 10 + r() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(90,80,70,${0.03 + r() * 0.04})`);
    gr.addColorStop(1, 'rgba(90,80,70,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // 目地
  g.strokeStyle = 'rgba(70,66,60,0.18)';
  g.lineWidth = 1.2;
  for (let x = 0; x <= cols; x++) { g.beginPath(); g.moveTo(x * px + 0.5, 0); g.lineTo(x * px + 0.5, c.height); g.stroke(); }
  for (let y = 0; y <= rows; y++) { g.beginPath(); g.moveTo(0, y * px + 0.5); g.lineTo(c.width, y * px + 0.5); g.stroke(); }
  // 壁ぎわの黄色い線
  g.strokeStyle = 'rgba(240,190,40,0.85)';
  g.lineWidth = px * 0.06;
  const m = px * 0.16;
  g.strokeRect(m, m, c.width - m * 2, c.height - m * 2);
  return tex(c, { aniso: 8 });
}

/** 外の舗装（アスファルト・白線）。size × size マスぶん。 */
export function asphaltTex(px = 512) {
  const [c, g] = canvas(px, px);
  const r = prng(11);
  g.fillStyle = '#62666d';
  g.fillRect(0, 0, px, px);
  for (let i = 0; i < 9000; i++) {
    const a = r() * 0.12;
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.7})`;
    g.fillRect(r() * px, r() * px, 1 + r() * 2, 1 + r() * 2);
  }
  return tex(c, { repeat: true, aniso: 8 });
}

export function grassTex(px = 256) {
  const [c, g] = canvas(px, px);
  const r = prng(5);
  g.fillStyle = '#8dbb63';
  g.fillRect(0, 0, px, px);
  for (let i = 0; i < 5000; i++) {
    const v = r();
    g.fillStyle = v < 0.5 ? `rgba(60,110,40,${0.12 + r() * 0.12})` : `rgba(190,230,140,${0.08 + r() * 0.1})`;
    g.fillRect(r() * px, r() * px, 1 + r() * 2, 2 + r() * 3);
  }
  return tex(c, { repeat: true, aniso: 8 });
}

/** ベルトの表面（ゴムと、流れる向きの山形）。v が流れる向き。
 *  山形ははっきり明るく大きく（向きが一目で分かるように）。1 マスに 2 つ。 */
export function beltTex() {
  const Wd = 128, Hd = 256;
  const [c, g] = canvas(Wd, Hd);
  g.fillStyle = '#22262d';
  g.fillRect(0, 0, Wd, Hd);
  // ゴムの細かい筋
  for (let y = 0; y < Hd; y += 16) { g.fillStyle = '#2a2f37'; g.fillRect(0, y, Wd, 5); }
  // 山形（流れる向き = 上へ。canvas の上が v の大きいほう）
  for (const y0 of [0, 128]) {
    g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    g.lineWidth = 16;
    g.lineJoin = 'miter';
    g.lineCap = 'butt';
    g.beginPath(); g.moveTo(24, y0 + 84); g.lineTo(64, y0 + 42); g.lineTo(104, y0 + 84); g.stroke();
    g.strokeStyle = 'rgba(236, 241, 247, 0.86)';
    g.lineWidth = 11;
    g.beginPath(); g.moveTo(24, y0 + 80); g.lineTo(64, y0 + 38); g.lineTo(104, y0 + 80); g.stroke();
  }
  // 縁
  g.fillStyle = '#16191e';
  g.fillRect(0, 0, 8, Hd); g.fillRect(Wd - 8, 0, 8, Hd);
  return tex(c, { repeat: true, aniso: 8 });
}

/** 宛先の形を描く。k：0 ● / 1 ▲ / 2 ■ / 3 ◆ */
export function drawSym(g, k, cx, cy, r) {
  g.beginPath();
  if (k === 0) g.arc(cx, cy, r, 0, Math.PI * 2);
  else if (k === 1) { g.moveTo(cx, cy - r * 1.08); g.lineTo(cx + r * 1.08, cy + r * 0.82); g.lineTo(cx - r * 1.08, cy + r * 0.82); g.closePath(); }
  else if (k === 2) g.rect(cx - r * 0.86, cy - r * 0.86, r * 1.72, r * 1.72);
  else if (k === 3) { g.moveTo(cx, cy - r * 1.15); g.lineTo(cx + r * 1.0, cy); g.lineTo(cx, cy + r * 1.15); g.lineTo(cx - r * 1.0, cy); g.closePath(); }
  g.fill();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** 荷物の上のラベル。kind：0〜3（宛先）か 'unk'。exp：速達（赤い枠と帯）。 */
export function labelTex(kind, exp = false) {
  const S = 128;
  const [c, g] = canvas(S, S);
  const col = kind === 'unk' ? '#8d949c' : DESTS[kind].color;
  g.fillStyle = '#f7f4ee';
  roundRect(g, 4, 4, S - 8, S - 8, 14); g.fill();
  if (exp) {
    g.strokeStyle = '#ff2b3a'; g.lineWidth = 14;
    roundRect(g, 10, 10, S - 20, S - 20, 10); g.stroke();
  }
  g.fillStyle = col;
  if (kind === 'unk') {
    // 破れたラベル
    g.fillStyle = '#b9bec4';
    roundRect(g, 22, 22, S - 44, S - 44, 10); g.fill();
    g.fillStyle = '#5b626a';
    g.font = 'bold 64px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('?', S / 2, S / 2 + 4);
    g.strokeStyle = '#f7f4ee'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(20, 80); g.lineTo(46, 64); g.lineTo(60, 92); g.lineTo(90, 70); g.lineTo(110, 96); g.stroke();
  } else {
    drawSym(g, kind, S / 2, S / 2, 34);
  }
  return tex(c, { aniso: 4 });
}

/** 段ボールの側面（テープの帯）。 */
export function cardboardTex() {
  const [c, g] = canvas(64, 64);
  const r = prng(3);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(120,80,30,${r() * 0.08})`; g.fillRect(r() * 64, r() * 64, 2, 1); }
  g.fillStyle = 'rgba(255,236,190,0.55)';
  g.fillRect(26, 0, 12, 64);
  g.fillStyle = 'rgba(90,60,20,0.18)';
  g.fillRect(0, 0, 64, 2); g.fillRect(0, 62, 64, 2); g.fillRect(0, 0, 2, 64); g.fillRect(62, 0, 2, 64);
  return tex(c);
}

/** ドローンポートの床（宛先の色の輪と形）。 */
export function padTex(dest) {
  const S = 256;
  const [c, g] = canvas(S, S);
  const col = DESTS[dest].color;
  g.fillStyle = '#4a515b';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#5a626d';
  roundRect(g, 10, 10, S - 20, S - 20, 22); g.fill();
  // 斜線の縁
  g.save();
  g.beginPath(); g.rect(10, 10, S - 20, S - 20); g.rect(30, 30, S - 60, S - 60); g.clip('evenodd');
  for (let i = -S; i < S * 2; i += 26) { g.fillStyle = i % 52 === 0 ? '#f2c230' : '#2c3036'; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 13, 0); g.lineTo(i + 13 - S, S); g.lineTo(i - S, S); g.closePath(); g.fill(); }
  g.restore();
  g.strokeStyle = col; g.lineWidth = 14;
  g.beginPath(); g.arc(S / 2, S / 2, 78, 0, Math.PI * 2); g.stroke();
  g.fillStyle = col;
  drawSym(g, dest, S / 2, S / 2, 42);
  return tex(c, { aniso: 8 });
}

/** フィルターの札（アーム・ゲートの上）。f：'any' / 0〜3 / 'exp' / 'unk' / 'alt' */
export function signTex(f) {
  const S = 128;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#1b2230';
  g.beginPath(); g.arc(S / 2, S / 2, 60, 0, Math.PI * 2); g.fill();
  g.lineWidth = 8;
  if (typeof f === 'number') {
    g.strokeStyle = DESTS[f].color; g.beginPath(); g.arc(S / 2, S / 2, 54, 0, Math.PI * 2); g.stroke();
    g.fillStyle = DESTS[f].color; drawSym(g, f, S / 2, S / 2, 28);
  } else {
    const col = f === 'exp' ? '#ff3b48' : f === 'unk' ? '#a9b0b8' : f === 'alt' ? '#35e0ff' : '#ffffff';
    g.strokeStyle = col; g.beginPath(); g.arc(S / 2, S / 2, 54, 0, Math.PI * 2); g.stroke();
    g.fillStyle = col;
    g.font = 'bold 60px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(f === 'exp' ? '!' : f === 'unk' ? '?' : f === 'alt' ? '⇄' : '*', S / 2, S / 2 + 3);
  }
  return tex(c);
}

/** まだ使えない区画（暗い床と黄色と黒の斜線）。 */
export function hatchTex() {
  const S = 128;
  const [c, g] = canvas(S, S);
  g.fillStyle = 'rgba(40,44,52,0.55)';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,200,40,0.16)';
  g.lineWidth = 14;
  for (let i = -S; i < S * 2; i += 44) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i - S, S); g.stroke(); }
  return tex(c, { repeat: true });
}

/** 建てるときのマス目（水色の細い線）。 */
export function gridTex() {
  const S = 64;
  const [c, g] = canvas(S, S);
  g.clearRect(0, 0, S, S);
  g.strokeStyle = 'rgba(80,230,255,0.9)';
  g.lineWidth = 1.5;
  g.strokeRect(0.75, 0.75, S - 1.5, S - 1.5);
  g.fillStyle = 'rgba(80,230,255,0.9)';
  for (const [x, y] of [[0, 0], [S, 0], [0, S], [S, S]]) g.fillRect(x - 3, y - 3, 6, 6);
  return tex(c, { repeat: true, srgb: true });
}

/** 背景の空（上が濃い青、地平が白っぽい）。色は呼ぶ側で決める。 */
export function skyTex(top = '#7fb3e6', mid = '#bcd8f0', bottom = '#e8eef2') {
  const [c, g] = canvas(4, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top); gr.addColorStop(0.55, mid); gr.addColorStop(1, bottom);
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
  return tex(c, { aniso: 1 });
}

/** トラックの荷台の横の絵（会社の帯）。 */
export function trailerTex(color) {
  const [c, g] = canvas(256, 64);
  g.fillStyle = '#eef1f4'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = color; g.fillRect(0, 40, 256, 10);
  g.fillStyle = 'rgba(0,0,0,0.08)';
  for (let x = 0; x < 256; x += 16) g.fillRect(x, 0, 1, 64);
  // 会社の名前と箱の絵
  g.fillStyle = color;
  g.fillRect(16, 12, 20, 18);
  g.fillStyle = '#eef1f4'; g.fillRect(16, 18, 20, 2);
  g.fillStyle = '#3a4250';
  g.font = 'bold 15px system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('HAKOBI EXPRESS', 44, 22);
  return tex(c);
}

/** 光の輪（充電中・ドローンの着陸など）。 */
export function ringTex() {
  const S = 128;
  const [c, g] = canvas(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, S * 0.25, S / 2, S / 2, S * 0.5);
  gr.addColorStop(0, 'rgba(80,230,255,0)');
  gr.addColorStop(0.6, 'rgba(80,230,255,0.85)');
  gr.addColorStop(1, 'rgba(80,230,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return tex(c);
}

/** 丸い影（ドローン・ロボの足もと）。 */
export function blobTex() {
  const S = 64;
  const [c, g] = canvas(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.45)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return tex(c);
}
