// 音源と効果音。音声ファイルは使わず、Web Audio のオシレーターとノイズで鳴らす。
// どの関数も (ctx, out, t, p) の形：out はミキサーの系統（{ dry, wet }）、t は鳴らす時刻（ctx.currentTime 基準）。
// p は { f（Hz）or m（MIDI）, dur, vel（0〜1）, pan（-1〜1）, rev（リバーブへの送り 0〜1） } など。
// 値はすべて fin() で確かめてから使う（NaN が AudioParam に入ると、その音はもう鳴らない）。

const fin = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const FLOOR = 0.0001; // 指数ランプは 0 に向かえないので、ここまで下げる

const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    const n = ctx.sampleRate * 1.5;
    b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = 22222;
    for (let i = 0; i < n; i++) d[i] = ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

/** node → 音量 → 定位 → out.dry（と、rev があれば out.wet）につなぐ。音量の GainNode を返す。 */
function route(ctx, node, out, p) {
  const g = ctx.createGain();
  g.gain.value = 0;
  let last = node.connect(g);
  if (p.pan) {
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, fin(p.pan, 0)));
    last = last.connect(pan);
  }
  last.connect(out.dry);
  const rev = fin(p.rev, 0);
  if (rev > 0) { const s = ctx.createGain(); s.gain.value = rev; last.connect(s).connect(out.wet); }
  return g;
}

/** 立ち上がり a、減衰 d で peak から消える（打楽器・効果音の形）。 */
function perc(param, t, peak, a, d) {
  param.setValueAtTime(FLOOR, t);
  param.linearRampToValueAtTime(Math.max(FLOOR, peak), t + a);
  param.exponentialRampToValueAtTime(FLOOR, t + a + d);
}
/** 立ち上がり a、保持、離して r で消える（持続音の形）。 */
function adsr(param, t, peak, a, hold, r) {
  param.setValueAtTime(FLOOR, t);
  param.linearRampToValueAtTime(Math.max(FLOOR, peak), t + a);
  param.setValueAtTime(Math.max(FLOOR, peak), t + a + hold);
  param.exponentialRampToValueAtTime(FLOOR, t + a + hold + r);
}

function osc(ctx, type, f, t, end) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(1, f), t);
  o.start(t);
  o.stop(end + 0.05);
  return o;
}

function noise(ctx, t, end) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  s.loop = true;
  s.start(t, Math.random() * 1.2);
  s.stop(end + 0.05);
  return s;
}

function filter(ctx, type, f, q = 0.8) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = Math.max(10, f);
  b.Q.value = q;
  return b;
}

const hz = (p, def) => fin(p.f, p.m !== undefined ? mtof(fin(p.m, 69)) : def);

// ---------------------------------------------------------------- 楽器（シーケンサーから使う）
export const INSTRUMENTS = {
  /** 矩形波のリード（チップチューン寄り）。 */
  lead(ctx, out, t, p) {
    const f = hz(p, 440), dur = fin(p.dur, 0.25), vel = fin(p.vel, 0.8);
    const o = osc(ctx, 'square', f, t, t + dur + 0.2);
    const lp = filter(ctx, 'lowpass', Math.min(9000, f * 6), 0.7);
    const g = route(ctx, o.connect(lp), out, { rev: 0.18, ...p });
    adsr(g.gain, t, 0.14 * vel, 0.006, Math.max(0, dur - 0.03), 0.12);
  },
  /** のこぎり波のベース（フィルターで弾く）。 */
  bass(ctx, out, t, p) {
    const f = hz(p, 55), dur = fin(p.dur, 0.25), vel = fin(p.vel, 0.8);
    const o = osc(ctx, 'sawtooth', f, t, t + dur + 0.15);
    const lp = filter(ctx, 'lowpass', 900, 3);
    lp.frequency.setValueAtTime(220 + 2200 * vel, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.18);
    const g = route(ctx, o.connect(lp), out, p);
    adsr(g.gain, t, 0.3 * vel, 0.004, Math.max(0, dur - 0.04), 0.08);
  },
  /** 少しずらした 3 本ののこぎり波のパッド（和音向け）。 */
  pad(ctx, out, t, p) {
    const f = hz(p, 220), dur = fin(p.dur, 1), vel = fin(p.vel, 0.6);
    const lp = filter(ctx, 'lowpass', 1800, 0.5);
    const mix = ctx.createGain();
    for (const det of [-9, 0, 8]) { const o = osc(ctx, 'sawtooth', f, t, t + dur + 0.8); o.detune.value = det; o.connect(mix); }
    mix.gain.value = 0.33;
    const g = route(ctx, mix.connect(lp), out, { rev: 0.35, ...p });
    adsr(g.gain, t, 0.08 * vel, 0.12, Math.max(0, dur - 0.12), 0.6);
  },
  /** 弾いた音（三角波＋短い倍音）。アルペジオ・メロディに。 */
  pluck(ctx, out, t, p) {
    const f = hz(p, 440), vel = fin(p.vel, 0.8);
    const o = osc(ctx, 'triangle', f, t, t + 0.6);
    const o2 = osc(ctx, 'sine', f * 2, t, t + 0.25);
    const m = ctx.createGain();
    o.connect(m); o2.connect(m);
    const g = route(ctx, m, out, { rev: 0.2, ...p });
    perc(g.gain, t, 0.25 * vel, 0.003, 0.45);
  },
  /** 鐘（FM）。完成・ご褒美の合図に。 */
  bell(ctx, out, t, p) {
    const f = hz(p, 880), vel = fin(p.vel, 0.7), dur = fin(p.dur, 1.4);
    const car = osc(ctx, 'sine', f, t, t + dur);
    const mod = osc(ctx, 'sine', f * 3.5, t, t + dur);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 2.2, t);
    mg.gain.exponentialRampToValueAtTime(Math.max(1, f * 0.05), t + dur);
    mod.connect(mg).connect(car.frequency);
    const g = route(ctx, car, out, { rev: 0.35, ...p });
    perc(g.gain, t, 0.18 * vel, 0.002, dur);
  },
  kick(ctx, out, t, p) {
    const vel = fin(p.vel, 0.9);
    const o = osc(ctx, 'sine', 150, t, t + 0.45);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = route(ctx, o, out, p);
    perc(g.gain, t, 0.9 * vel, 0.002, 0.38);
  },
  snare(ctx, out, t, p) {
    const vel = fin(p.vel, 0.8);
    const n = noise(ctx, t, t + 0.25);
    const g = route(ctx, n.connect(filter(ctx, 'bandpass', 1800, 0.7)), out, { rev: 0.15, ...p });
    perc(g.gain, t, 0.5 * vel, 0.001, 0.18);
    const o = osc(ctx, 'triangle', 190, t, t + 0.15);
    const g2 = route(ctx, o, out, p);
    perc(g2.gain, t, 0.3 * vel, 0.001, 0.09);
  },
  hat(ctx, out, t, p) {
    const vel = fin(p.vel, 0.6), open = !!p.open;
    const n = noise(ctx, t, t + (open ? 0.35 : 0.08));
    const g = route(ctx, n.connect(filter(ctx, 'highpass', 7500, 0.7)), out, p);
    perc(g.gain, t, 0.22 * vel, 0.001, open ? 0.3 : 0.05);
  },
};

// ---------------------------------------------------------------- 効果音（audio.sfx(name) で鳴らす）
// 出来事ごとの音。AI の操作画面らしく、短く澄んだ電子音を基本にする。工場の音（モーター・ドローン・トラック）は場所から鳴らす。
const blip = (ctx, out, t, f, { type = 'sine', dur = 0.08, vel = 0.25, f2 = null, rev = 0.12, pan = 0, q = 0 } = {}) => {
  const o = osc(ctx, type, f, t, t + dur + 0.05);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
  const node = q ? o.connect(filter(ctx, 'lowpass', q, 0.7)) : o;
  const g = route(ctx, node, out, { rev, pan });
  perc(g.gain, t, vel, 0.003, dur);
};
const thump = (ctx, out, t, { f = 140, f2 = 50, vel = 0.5, dur = 0.16, p = {} } = {}) => {
  const o = osc(ctx, 'sine', f, t, t + dur + 0.05);
  o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = route(ctx, o, out, p);
  perc(g.gain, t, vel, 0.002, dur);
};
const hiss = (ctx, out, t, { dur = 0.1, f = 3000, type = 'bandpass', q = 0.8, vel = 0.2, p = {}, f2 = null } = {}) => {
  const n = noise(ctx, t, t + dur + 0.05);
  const fl = filter(ctx, type, f, q);
  if (f2) fl.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t + dur);
  const g = route(ctx, n.connect(fl), out, p);
  perc(g.gain, t, vel, 0.002, dur);
};

export const SFX = {
  ui_move(ctx, out, t) { blip(ctx, out, t, 1480, { vel: 0.12, dur: 0.05, rev: 0 }); },
  ui_ok(ctx, out, t) { blip(ctx, out, t, 1175, { vel: 0.16, dur: 0.07 }); blip(ctx, out, t + 0.055, 1760, { vel: 0.16, dur: 0.09 }); },
  ui_back(ctx, out, t) { blip(ctx, out, t, 1320, { vel: 0.15, dur: 0.06 }); blip(ctx, out, t + 0.055, 880, { vel: 0.15, dur: 0.08 }); },
  pause(ctx, out, t) { blip(ctx, out, t, 988, { vel: 0.18, dur: 0.12 }); blip(ctx, out, t + 0.08, 740, { vel: 0.16, dur: 0.16 }); },
  tool(ctx, out, t) { blip(ctx, out, t, 1660, { vel: 0.1, dur: 0.04, rev: 0.05 }); },
  select(ctx, out, t) { blip(ctx, out, t, 1200, { vel: 0.14, dur: 0.07, f2: 1700 }); },
  rotate(ctx, out, t) { hiss(ctx, out, t, { dur: 0.04, f: 4200, vel: 0.12 }); hiss(ctx, out, t + 0.05, { dur: 0.04, f: 3600, vel: 0.1 }); blip(ctx, out, t, 700, { vel: 0.08, dur: 0.1, f2: 1100, type: 'triangle' }); },
  place(ctx, out, t, p = {}) {
    thump(ctx, out, t, { f: 150, f2: 55, vel: 0.55, dur: 0.18, p });
    hiss(ctx, out, t, { dur: 0.07, f: 1800, vel: 0.22, p });
    blip(ctx, out, t + 0.03, 2400, { vel: 0.08, dur: 0.05, type: 'triangle' });
  },
  belt(ctx, out, t, p = {}) { thump(ctx, out, t, { f: 220, f2: 90, vel: 0.3, dur: 0.1, p }); hiss(ctx, out, t, { dur: 0.05, f: 2600, vel: 0.12, p }); },
  tick(ctx, out, t) { blip(ctx, out, t, 2100, { vel: 0.06, dur: 0.025, type: 'triangle', rev: 0 }); },
  remove(ctx, out, t, p = {}) { blip(ctx, out, t, 900, { vel: 0.18, dur: 0.22, f2: 160, type: 'sawtooth', q: 2400 }); hiss(ctx, out, t, { dur: 0.25, f: 2000, f2: 300, vel: 0.15, p }); },
  invalid(ctx, out, t) { for (const f of [196, 207]) blip(ctx, out, t, f, { vel: 0.12, dur: 0.16, type: 'square', q: 1400, rev: 0 }); },
  buy(ctx, out, t) { [1319, 1568, 2093].forEach((f, i) => INSTRUMENTS.bell(ctx, out, t + i * 0.07, { f, vel: 0.45, dur: 0.6 })); },
  hire(ctx, out, t) { [523, 659, 784, 1047].forEach((f, i) => blip(ctx, out, t + i * 0.06, f, { vel: 0.16, dur: 0.1, type: 'triangle' })); blip(ctx, out, t + 0.26, 1568, { vel: 0.12, dur: 0.2 }); },
  // 出荷：明るい鐘。宛先ごとに音の高さが違う（pitch）。続けて鳴ると旋律のように聞こえる
  ship(ctx, out, t, p = {}) {
    const k = fin(p.pitch, 1);
    INSTRUMENTS.bell(ctx, out, t, { f: 1047 * k, vel: 0.42, dur: 0.9, rev: 0.25 });
    blip(ctx, out, t, 2093 * k, { vel: 0.05, dur: 0.12 });
  },
  mis(ctx, out, t) {
    for (const f of [233, 247]) blip(ctx, out, t, f, { vel: 0.18, dur: 0.32, type: 'sawtooth', q: 1600, f2: f * 0.7 });
    blip(ctx, out, t + 0.18, 185, { vel: 0.14, dur: 0.3, type: 'square', q: 1200 });
  },
  // ドローンの離陸：プロペラのうなりが上がっていく
  drone(ctx, out, t, p = {}) {
    const o = osc(ctx, 'sawtooth', 110, t, t + 1.3);
    o.frequency.exponentialRampToValueAtTime(240, t + 0.9);
    const lp = filter(ctx, 'lowpass', 900, 1.2);
    const g = route(ctx, o.connect(lp), out, { rev: 0.2, ...p });
    adsr(g.gain, t, 0.09, 0.25, 0.5, 0.5);
    hiss(ctx, out, t, { dur: 1.1, f: 1600, q: 0.6, vel: 0.07, p });
  },
  truck(ctx, out, t, p = {}) { for (const [dt, f] of [[0, 330], [0.22, 277]]) blip(ctx, out, t + dt, f, { vel: 0.18, dur: 0.18, type: 'square', q: 1800, rev: 0.25 }); },
  beep(ctx, out, t) { for (let i = 0; i < 3; i++) blip(ctx, out, t + i * 0.32, 1046, { vel: 0.08, dur: 0.14, type: 'square', q: 3000, rev: 0.15 }); },
  servo(ctx, out, t, p = {}) {
    const o = osc(ctx, 'sawtooth', 160, t, t + 0.3);
    o.frequency.linearRampToValueAtTime(240, t + 0.12);
    o.frequency.linearRampToValueAtTime(180, t + 0.25);
    const g = route(ctx, o.connect(filter(ctx, 'bandpass', 900, 2)), out, { rev: 0.1, ...p });
    adsr(g.gain, t, 0.05, 0.03, 0.15, 0.08);
  },
  thud(ctx, out, t, p = {}) { thump(ctx, out, t, { f: 120, f2: 60, vel: 0.22, dur: 0.1, p }); },
  scan(ctx, out, t, p = {}) { blip(ctx, out, t, 1400, { vel: 0.1, dur: 0.18, f2: 2800, type: 'triangle', rev: 0.2 }); blip(ctx, out, t + 0.12, 2400, { vel: 0.07, dur: 0.12 }); },
  charge(ctx, out, t, p = {}) { blip(ctx, out, t, 300, { vel: 0.12, dur: 0.45, f2: 900, type: 'triangle', rev: 0.2 }); },
  alert(ctx, out, t) { blip(ctx, out, t, 880, { vel: 0.14, dur: 0.08, type: 'triangle' }); blip(ctx, out, t + 0.12, 880, { vel: 0.14, dur: 0.1, type: 'triangle' }); },
  dayStart(ctx, out, t) { [587, 740, 880].forEach((f, i) => INSTRUMENTS.bell(ctx, out, t + i * 0.11, { f, vel: 0.35, dur: 1.2 })); },
  begin(ctx, out, t) {
    INSTRUMENTS.kick(ctx, out, t, { vel: 0.7 });
    [784, 1175, 1568].forEach((f, i) => INSTRUMENTS.bell(ctx, out, t + i * 0.09, { f, vel: 0.4, dur: 1.4 }));
  },
  dayEnd(ctx, out, t) { [1175, 988, 784, 587].forEach((f, i) => INSTRUMENTS.bell(ctx, out, t + i * 0.13, { f, vel: 0.32, dur: 1.4 })); },
  clear(ctx, out, t) {
    [523, 659, 784, 1047, 1319].forEach((f, i) => INSTRUMENTS.pluck(ctx, out, t + i * 0.07, { f, vel: 0.55, rev: 0.3 }));
    INSTRUMENTS.bell(ctx, out, t + 0.38, { f: 1568, vel: 0.5, dur: 1.8 });
    INSTRUMENTS.pad(ctx, out, t + 0.38, { m: 60, dur: 1.4, vel: 0.5 }); INSTRUMENTS.pad(ctx, out, t + 0.38, { m: 64, dur: 1.4, vel: 0.5 }); INSTRUMENTS.pad(ctx, out, t + 0.38, { m: 67, dur: 1.4, vel: 0.5 });
  },
  fail(ctx, out, t) { [659, 587, 523, 440].forEach((f, i) => INSTRUMENTS.pluck(ctx, out, t + i * 0.16, { f, vel: 0.45, rev: 0.3 })); },
  thunder(ctx, out, t) {
    const n = noise(ctx, t, t + 2.6);
    const lp = filter(ctx, 'lowpass', 900, 0.7);
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 2.4);
    const g = route(ctx, n.connect(lp), out, { rev: 0.5 });
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
  },
  fanfare(ctx, out, t) {
    const seq = [[0, 523], [0.12, 659], [0.24, 784], [0.42, 1047], [0.62, 988], [0.74, 1047], [0.86, 1319]];
    for (const [dt, f] of seq) INSTRUMENTS.lead(ctx, out, t + dt, { f, dur: 0.16, vel: 0.6 });
    for (const m of [60, 64, 67, 72]) INSTRUMENTS.pad(ctx, out, t + 0.86, { m, dur: 2, vel: 0.6 });
    INSTRUMENTS.bell(ctx, out, t + 0.86, { f: 2093, vel: 0.45, dur: 2.2 });
  },
};
