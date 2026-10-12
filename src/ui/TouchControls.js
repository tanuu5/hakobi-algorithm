// スマホの操作。この作品では、地図の上の指の操作は game/Controls.js が受け持ち、
// ボタン（道具・速さ・一時停止）は ui の上の帯と道具箱にある。ここは雛形との形合わせだけ（仮想スティックは使わない）。
export const BUTTONS = [];

export class TouchControls {
  constructor() { this.visible = false; this.enabled = false; }
  setLabel() {}
  setVisible(v) { this.visible = v; }
  refresh() {}
}
