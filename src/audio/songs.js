// 曲のデータ（書き方は sequencer.js の先頭。1 小節 = 16 トークン）。
//   title  ：タイトル。ゆったりした D メジャー（夜明けの物流センター）
//   plan   ：計画中。考えごとの曲（時間が止まっている）
//   work   ：業務中。軽いグルーヴ（D ドリアン）。32 小節で、伴奏だけ → 旋律 → 静かな間奏 → 旋律の変化
//   report ：日報。あたたかい終わり
const rest = '. . . . . . . . . . . . . . . .';
const hold = (ch) => `${ch} - - - - - - - - - - - - - - -`;
const rep = (arr, n) => Array.from({ length: n }, () => arr).flat();

// ---- 業務中（work）
const W_CH = ['D3+F3+A3+C4', 'G3+B3+D4+F4', 'C3+E3+G3+B3', 'A2+C3+E3+G3', 'Bb2+D3+F3+A3', 'C3+E3+G3+Bb3', 'D3+F3+A3+C4', 'A2+C#3+E3+G3'];
const W_BASS = [
  'D2 . . D2 . . A2 . D2 . . C3 . A2 G2 .',
  'G1 . . G1 . . D2 . G1 . . F2 . D2 B1 .',
  'C2 . . C2 . . G2 . C2 . . B2 . G2 E2 .',
  'A1 . . A1 . . E2 . A1 . . G2 . E2 C2 .',
  'Bb1 . . Bb1 . . F2 . Bb1 . . A2 . F2 D2 .',
  'C2 . . C2 . . G2 . C2 . . Bb2 . G2 E2 .',
  'D2 . . D2 . . A2 . D2 . . C3 . A2 G2 .',
  'A1 . . A1 . . E2 . A1 . . G2 . E2 C#2 .',
];
const W_BASS_HALF = ['D2 - - - - - - - A1 - - - - - - -', 'G1 - - - - - - - D2 - - - - - - -', 'C2 - - - - - - - G1 - - - - - - -', 'A1 - - - - - - - E2 - - - - - - -',
  'Bb1 - - - - - - - F2 - - - - - - -', 'C2 - - - - - - - G1 - - - - - - -', 'D2 - - - - - - - A1 - - - - - - -', 'A1 - - - - - - - C#2 - - - - - - -'];
const W_ARP = [
  'D4 . F4 . A4 . C5 . D5 . C5 . A4 . F4 .',
  'G4 . B4 . D5 . F5 . G5 . F5 . D5 . B4 .',
  'C4 . E4 . G4 . B4 . C5 . B4 . G4 . E4 .',
  'A3 . C4 . E4 . G4 . A4 . G4 . E4 . C4 .',
  'Bb3 . D4 . F4 . A4 . Bb4 . A4 . F4 . D4 .',
  'C4 . E4 . G4 . Bb4 . C5 . Bb4 . G4 . E4 .',
  'D4 . F4 . A4 . C5 . D5 . C5 . A4 . F4 .',
  'A3 . C#4 . E4 . G4 . A4 . G4 . E4 . C#4 .',
];
const W_MEL_A = [
  'A4 - - - C5 - D5 - . . F5 - E5 - D5 -',
  'B4 - - - . . G4 - A4 - B4 - D5 - - -',
  'E5 - - - D5 - C5 - B4 - - - G4 - - -',
  'A4 - - - - - - - . . . . E4 - G4 -',
  'F4 - - - A4 - - - D5 - - - C5 - Bb4 -',
  'C5 - - - - - E5 - - - G5 - - - E5 -',
  'F5 - - - E5 - D5 - C5 - A4 - - - - -',
  'C#5 - - - - - - - E5 - - - - - . .',
];
const W_MEL_B = [
  'D5 - A4 - . . D5 - F5 - - - E5 - D5 -',
  'D5 - - - B4 - - - G4 - A4 - B4 - C5 -',
  'E5 - - - G5 - - - E5 - D5 - C5 - - -',
  'A4 - - - - - - - - - - - . . . .',
  'D5 - - - F5 - - - A5 - - - G5 - F5 -',
  'E5 - - - - - C5 - - - E5 - G5 - - -',
  'F5 - E5 - D5 - C5 - A4 - - - C5 - D5 -',
  'E5 - - - - - - - C#5 - - - - - . .',
];
const W_BELL = [
  'A5 - - - . . . . F5 - - - . . . .',
  'G5 - - - . . . . D5 - - - . . . .',
  'E5 - - - . . . . G5 - - - . . . .',
  'C5 - - - . . . . . . . . . . . .',
  'D5 - - - . . . . F5 - - - . . . .',
  'E5 - - - . . . . G5 - - - . . . .',
  'A5 - - - . . . . F5 - - - . . . .',
  'E5 - - - . . . . C#5 - - - . . . .',
];
const GROOVE = { kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'o.x.o.x.o.x.o.xO' };
const FILL = { kick: 'x.....x...x...x.', snare: '....x.......x.xo', hat: 'o.x.o.x.o.x.xxxx' };
const SOFT = { kick: 'x.......x.......', hat: '..o...o...o...o.' };
const LIFT = { kick: 'x.......x...x...', hat: '..o...o.o.o.o.oo', snare: '............o.oX' };

// ---- タイトル（title）
const T_CH = ['D3+F#3+A3+C#4', 'B2+D3+F#3+A3', 'G2+B2+D3+F#3', 'A2+D3+E3+G3', 'F#2+A2+C#3+E3', 'B2+D3+F#3+A3', 'E3+G3+B3+D4', 'A2+C#3+E3+G3'];
const T_ARP = [
  'D4 . A4 . C#5 . F#5 . E5 . C#5 . A4 . F#4 .',
  'B3 . F#4 . A4 . D5 . C#5 . A4 . F#4 . D4 .',
  'G3 . D4 . F#4 . B4 . A4 . F#4 . D4 . B3 .',
  'A3 . E4 . G4 . D5 . C#5 . A4 . G4 . E4 .',
  'F#3 . C#4 . E4 . A4 . F#4 . E4 . C#4 . A3 .',
  'B3 . F#4 . A4 . D5 . B4 . A4 . F#4 . D4 .',
  'E3 . B3 . D4 . G4 . F#4 . D4 . B3 . G3 .',
  'A3 . E4 . G4 . C#5 . E5 . C#5 . A4 . G4 .',
];
const T_BELL = [
  'F#5 - - - - - - - . . . . E5 - - -',
  'D5 - - - - - - - . . . . . . . .',
  'B4 - - - - - - - D5 - - - F#5 - - -',
  'E5 - - - - - - - . . . . . . . .',
  'C#5 - - - - - - - E5 - - - A5 - - -',
  'F#5 - - - - - - - . . . . . . . .',
  'G5 - - - - - - - F#5 - - - D5 - - -',
  'E5 - - - - - - - C#5 - - - . . . .',
];

// ---- 計画中（plan）
const P_CH = ['A2+C3+E3+G3+B3', 'F2+A2+C3+E3+G3', 'C3+E3+G3+B3+D4', 'G2+B2+D3+G3+A3', 'A2+C3+E3+G3+B3', 'F2+A2+C3+E3+G3', 'D3+F3+A3+C4', 'E2+A2+B2+D3+E3'];
const P_PL = [
  '. . E5 . . . C5 . . . B4 . . . A4 .',
  '. . . . C5 . . . A4 . . . G4 . . .',
  '. . G5 . . . E5 . . . D5 . . . B4 .',
  '. . . . D5 . . . B4 . . . A4 . . .',
  '. . E5 . . . C5 . . . B4 . . . A4 .',
  '. . . . C5 . . . E5 . . . G5 . . .',
  '. . F5 . . . E5 . . . D5 . . . C5 .',
  '. . B4 . . . . . . . . . . . . .',
];

// ---- 日報（report）
const R_CH = ['F3+A3+C4+E4', 'G3+B3+D4+E4', 'E3+G3+B3+D4', 'A2+C3+E3+G3', 'D3+F3+A3+C4', 'G2+B2+D3+F3', 'C3+E3+G3+B3', 'C3+E3+G3+C4'];
const R_BELL = [
  'A5 - - - G5 - - - E5 - - - C5 - - -',
  'D5 - - - - - - - B4 - - - - - - -',
  'E5 - - - G5 - - - B5 - - - A5 - - -',
  'E5 - - - - - - - . . . . . . . .',
  'F5 - - - E5 - - - D5 - - - C5 - - -',
  'B4 - - - D5 - - - G5 - - - F5 - - -',
  'E5 - - - D5 - - - C5 - - - B4 - - -',
  'C5 - - - - - - - - - - - . . . .',
];

export const SONGS = {
  title: {
    id: 'title', bpm: 88, gain: 1.15,
    tracks: {
      pad: { inst: 'pad', vol: 0.7, bars: T_CH.map(hold) },
      pluck: { inst: 'pluck', vol: 0.42, pan: 0.25, bars: T_ARP },
      bass: { inst: 'bass', vol: 0.5, bars: ['D2', 'B1', 'G1', 'A1', 'F#1', 'B1', 'E2', 'A1'].map(hold) },
      bell: { inst: 'bell', vol: 0.45, pan: -0.2, bars: [...rep([rest], 8), ...T_BELL] },
      drums: { inst: 'drums', vol: 0.5, bars: [...rep([null], 8), ...rep([{ hat: 'o...o...o...o...' }, { hat: 'o...o...o...o.o.' }], 4)] },
    },
  },
  plan: {
    id: 'plan', bpm: 80, gain: 1.15,
    tracks: {
      pad: { inst: 'pad', vol: 0.65, bars: P_CH.map(hold) },
      pluck: { inst: 'pluck', vol: 0.4, pan: 0.2, bars: P_PL },
      bass: { inst: 'bass', vol: 0.42, bars: ['A1', 'F1', 'C2', 'G1', 'A1', 'F1', 'D2', 'E1'].map((n) => `${n} - - - - - - - ${n} - - - - - - -`) },
      drums: { inst: 'drums', vol: 0.35, bars: rep([{ hat: '....o.......o...' }, { hat: '....o.......o.o.' }], 4) },
    },
  },
  work: {
    id: 'work', bpm: 108, gain: 0.8,
    tracks: {
      drums: { inst: 'drums', vol: 0.75, bars: [...rep([GROOVE, GROOVE, GROOVE, FILL], 4), ...rep([SOFT], 7), LIFT, ...rep([GROOVE, GROOVE, GROOVE, FILL], 2)] },
      bass: { inst: 'bass', vol: 0.62, bars: [...W_BASS, ...W_BASS, ...W_BASS_HALF, ...W_BASS] },
      pad: { inst: 'pad', vol: 0.55, bars: rep(W_CH.map(hold), 4) },
      arp: { inst: 'pluck', vol: 0.3, pan: 0.3, bars: [...W_ARP, ...W_ARP, ...rep([null], 8), ...W_ARP] },
      lead: { inst: 'lead', vol: 0.42, pan: -0.15, bars: [...rep([null], 8), ...W_MEL_A, ...rep([null], 8), ...W_MEL_B] },
      bell: { inst: 'bell', vol: 0.4, pan: -0.25, bars: [...rep([null], 16), ...W_BELL, ...rep([null], 8)] },
    },
  },
  report: {
    id: 'report', bpm: 92, gain: 1.1,
    tracks: {
      pad: { inst: 'pad', vol: 0.65, bars: R_CH.map(hold) },
      bell: { inst: 'bell', vol: 0.45, pan: 0.15, bars: R_BELL },
      bass: { inst: 'bass', vol: 0.45, bars: ['F1', 'G1', 'E1', 'A1', 'D2', 'G1', 'C2', 'C2'].map((n) => `${n} - - - - - - - ${n} - - - - - - -`) },
      pluck: { inst: 'pluck', vol: 0.3, pan: -0.25, bars: ['F4 . A4 . C5 . E5 . C5 . A4 . F4 . A4 .', 'G4 . B4 . D5 . E5 . D5 . B4 . G4 . B4 .', 'E4 . G4 . B4 . D5 . B4 . G4 . E4 . G4 .', 'A3 . C4 . E4 . G4 . E4 . C4 . A3 . C4 .',
        'D4 . F4 . A4 . C5 . A4 . F4 . D4 . F4 .', 'G3 . B3 . D4 . F4 . D4 . B3 . G3 . B3 .', 'C4 . E4 . G4 . B4 . G4 . E4 . C4 . E4 .', 'C4 . E4 . G4 . C5 . . . . . . . . .'] },
    },
  },
};
