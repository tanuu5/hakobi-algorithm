// タイトル・一時停止・設定・あそびかたの画面。上に重なる画面（モーダル）は積み重ねで管理し、
// いちばん上の画面を MenuNav が操作する。文言はすべて i18n のキー（data-i18n）で書く。
//
//   const screens = new Screens(uiRoot, { onStart, onResume, onRetry, onToTitle, onSettings });
//   screens.showTitle(true)  screens.open('pause')  screens.back()  screens.current()
//   screens.addModal('report', html)   作品の画面を足す（<section id="m-report" class="modal hidden">…）。
//                                      中の data-act のボタンのうち、ここで知らないものは cb.onAction(act, el) に届く
import { t, applyDom, onLangChange, LANGS } from '../core/i18n.js';
import { settings, overrides, QUALITIES, PAD_TYPES } from '../core/settings.js';
import { ICONS } from '../game/ui/icons.js';

// 版表記。中身はビルド時に vite.config.js が埋める。?debug のときは時刻とハッシュも足す
const B = __BUILD__;
const BUILD_FULL = [`v${B.version}`, `${B.date} ${B.time}`, B.hash].filter(Boolean).join(' · ');
const BUILD_LINE = overrides.debug ? BUILD_FULL : `v${B.version} · ${B.date}`;

const opt = (v, key) => `<option value="${v}" data-i18n="${key}">${t(key)}</option>`;
const slider = (k) => `<label class="row"><span data-i18n="settings.${k}">${t('settings.' + k)}</span>
  <input type="range" min="0" max="100" step="5" data-vol="${k}" value="${Math.round(settings.volume[k] * 100)}"></label>`;

export class Screens {
  constructor(root, cb) {
    this.cb = cb;
    this.root = root;
    this.stack = [];
    root.insertAdjacentHTML('beforeend', `
<section id="title" class="screen hidden">
  <div class="t-kicker">LOGISTICS OPTIMIZATION AI</div>
  <h1 data-i18n="game.title">${t('game.title')}</h1>
  <p class="tagline" data-i18n="game.tagline">${t('game.tagline')}</p>
  <div class="menu">
    <button data-act="continue" class="continue hidden" data-i18n="title.continue">${t('title.continue')}</button>
    <button data-act="start" data-i18n="title.start">${t('title.start')}</button>
    <button data-act="howto" data-i18n="title.howto">${t('title.howto')}</button>
    <button data-act="settings" data-i18n="title.settings">${t('title.settings')}</button>
  </div>
  <footer class="copyright">© 2026 たぬ<small class="build" title="${BUILD_FULL}">${BUILD_LINE}</small></footer>
</section>
<section id="m-pause" class="modal hidden"><div class="card">
  <h2 data-i18n="pause.title">${t('pause.title')}</h2>
  <button data-act="resume" data-i18n="pause.resume">${t('pause.resume')}</button>
  <button data-act="retry" data-i18n="pause.retry">${t('pause.retry')}</button>
  <button data-act="howto" data-i18n="title.howto">${t('title.howto')}</button>
  <button data-act="settings" data-i18n="title.settings">${t('title.settings')}</button>
  <button data-act="toTitle" data-i18n="pause.toTitle">${t('pause.toTitle')}</button>
</div></section>
<section id="m-settings" class="modal hidden"><div class="card">
  <h2 data-i18n="settings.title">${t('settings.title')}</h2>
  ${slider('master')}${slider('music')}${slider('sfx')}
  <label class="row"><span data-i18n="settings.quality">${t('settings.quality')}</span>
    <select data-set="quality">${QUALITIES.map((q) => opt(q, 'settings.quality.' + q)).join('')}</select></label>
  <label class="row"><span data-i18n="settings.lang">${t('settings.lang')}</span>
    <select data-set="lang">${LANGS.map((l) => `<option value="${l.id}">${l.label}</option>`).join('')}</select></label>
  <label class="row"><span data-i18n="settings.pad">${t('settings.pad')}</span>
    <select data-set="padType">${PAD_TYPES.map((p) => opt(p, 'settings.pad.' + p)).join('')}</select></label>
  <button data-act="back" data-i18n="ui.back">${t('ui.back')}</button>
</div></section>
<section id="m-howto" class="modal hidden"><div class="card wide howto" data-scroll>
  <h2 data-i18n="howto.title">${t('howto.title')}</h2>
  <p data-i18n="howto.body">${t('howto.body')}</p>
  <h3 data-i18n="guide.howto">${t('guide.howto')}</h3>
  <div class="guide-tabs">${['flow', 'belt', 'arm', 'sorter', 'junction', 'labeler', 'pad', 'charger'].map((k) => `<button data-act="guide" data-k="${k}" data-i18n="guide.k.${k}">${t('guide.k.' + k)}</button>`).join('')}</div>
  <div class="howto-guide"><div class="gview"><span class="gempty" data-i18n="guide.pick">${t('guide.pick')}</span></div><p class="gcap"></p></div>
  <h3 data-i18n="howto.parts">${t('howto.parts')}</h3>
  <ul class="howto-list">
    ${['belt', 'arm', 'sorter', 'robot', 'pad', 'shelf', 'junction', 'charger', 'labeler'].map((k) => `<li><span class="ni">${ICONS[k]}</span><span><b data-i18n="tool.${k}">${t('tool.' + k)}</b><span data-i18n="desc.${k}">${t('desc.' + k)}</span></span></li>`).join('')}
    <li><span class="ni"><span class="expmark">!</span></span><span><b data-i18n="howto.exp">${t('howto.exp')}</b><span data-i18n="howto.expD">${t('howto.expD')}</span></span></li>
    <li><span class="ni"><span class="unkmark">?</span></span><span><b data-i18n="howto.unk">${t('howto.unk')}</b><span data-i18n="howto.unkD">${t('howto.unkD')}</span></span></li>
  </ul>
  <h3 data-i18n="howto.controls">${t('howto.controls')}</h3>
  <dl class="keys">
    <dt data-glyph="click"></dt><dd data-i18n="howto.click">${t('howto.click')}</dd>
    <dt data-glyph="rotate"></dt><dd data-i18n="howto.rotate">${t('howto.rotate')}</dd>
    <dt><span data-glyph="toolPrev"></span><span data-glyph="toolNext"></span></dt><dd data-i18n="howto.tools">${t('howto.tools')}</dd>
    <dt data-glyph="cam"></dt><dd data-i18n="howto.cam">${t('howto.cam')}</dd>
    <dt data-glyph="zoom"></dt><dd data-i18n="howto.zoom">${t('howto.zoom')}</dd>
    <dt data-glyph="cursor"></dt><dd data-i18n="howto.cursor">${t('howto.cursor')}</dd>
    <dt data-glyph="camL"></dt><dd data-i18n="howto.camRot">${t('howto.camRot')}</dd>
    <dt data-glyph="simPause"></dt><dd data-i18n="howto.simPause">${t('howto.simPause')}</dd>
    <dt data-glyph="speed"></dt><dd data-i18n="howto.speed">${t('howto.speed')}</dd>
    <dt data-glyph="analysis"></dt><dd data-i18n="howto.analysis">${t('howto.analysis')}</dd>
    <dt data-glyph="pause"></dt><dd data-i18n="howto.pause">${t('howto.pause')}</dd>
  </dl>
  <p class="howto-mouse" data-i18n="howto.mouse">${t('howto.mouse')}</p>
  <p class="howto-touch" data-i18n="howto.touch">${t('howto.touch')}</p>
  <button data-act="back" data-i18n="ui.back">${t('ui.back')}</button>
</div></section>`);
    this.title = root.querySelector('#title');
    this.modals = { pause: root.querySelector('#m-pause'), settings: root.querySelector('#m-settings'), howto: root.querySelector('#m-howto') };

    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      cb.onClick?.(act);
      if (act === 'start') cb.onStart?.();
      else if (act === 'continue') cb.onContinue?.();
      else if (act === 'howto') this.open('howto');
      else if (act === 'settings') this.open('settings');
      else if (act === 'resume') cb.onResume?.();
      else if (act === 'retry') cb.onRetry?.();
      else if (act === 'toTitle') cb.onToTitle?.();
      else if (act === 'back') this.back();
      else cb.onAction?.(act, b);
    });
    const s = this.modals.settings;
    for (const r of s.querySelectorAll('[data-vol]')) {
      r.addEventListener('input', () => { settings.volume[r.dataset.vol] = +r.value / 100; cb.onSettings?.('volume'); });
    }
    for (const sel of s.querySelectorAll('[data-set]')) {
      sel.addEventListener('change', () => { settings[sel.dataset.set] = sel.value; cb.onSettings?.(sel.dataset.set); });
    }
    onLangChange(() => this._labelContinue());
  }

  /** 作品の画面を足す。html は <section id="m-名前" class="modal hidden"> … </section>。開くのは open('名前')。 */
  addModal(name, html) {
    this.root.insertAdjacentHTML('beforeend', html);
    this.modals[name] = this.root.querySelector('#m-' + name);
    return this.modals[name];
  }

  /** 設定画面の表示を、今の設定にそろえる（開くたびに呼ぶ）。 */
  syncSettings() {
    const s = this.modals.settings;
    for (const r of s.querySelectorAll('[data-vol]')) r.value = Math.round(settings.volume[r.dataset.vol] * 100);
    for (const sel of s.querySelectorAll('[data-set]')) sel.value = settings[sel.dataset.set];
  }

  showTitle(on) { this.title.classList.toggle('hidden', !on); }

  /** タイトルの「つづきから」を出すか（セーブのある作品で。main.js の onContinue とつなぐ）。
   *  label で文言を差し替えられる（「つづきから（火曜日）」など）。関数で渡すと、言語を切り替えたときも作り直す：
   *    screens.setContinue(true, () => t('title.continue.at', { day: t('day.tue') }))   // 辞書は 'つづきから（{day}）' */
  setContinue(on, label = null) {
    this.title.querySelector('.continue')?.classList.toggle('hidden', !on);
    this._continueLabel = label;
    this._labelContinue();
  }

  _labelContinue() {
    const b = this.title.querySelector('.continue'), L = this._continueLabel;
    if (!b) return;
    // 差し替えた文言は、applyDom() で元に戻されないよう data-i18n を外しておく
    if (L) { delete b.dataset.i18n; b.textContent = typeof L === 'function' ? L() : L; }
    else { b.dataset.i18n = 'title.continue'; b.textContent = t('title.continue'); }
  }

  open(name) {
    const m = this.modals[name];
    if (name === 'settings') this.syncSettings();
    applyDom(m);
    m.classList.remove('hidden');
    // 同じ画面を 2 回積まない（2 回積むと、もどる 1 回では閉じきらず、状態がその画面のまま戻れなくなる）。開いていれば、いちばん上へ
    const i = this.stack.indexOf(m);
    if (i >= 0) this.stack.splice(i, 1);
    this.stack.push(m);
    if (i < 0) this.cb.onModal?.(name, true);
  }

  /** いちばん上の画面を閉じる。閉じたら true。 */
  back() {
    const m = this.stack.pop();
    if (!m) return false;
    m.classList.add('hidden');
    this.cb.onModal?.(m.id.slice(2), false);
    return true;
  }

  closeAll() { while (this.back()); }

  get top() { return this.stack[this.stack.length - 1] || null; }
  isOpen(name) { return this.stack.includes(this.modals[name]); }

  /** MenuNav が操作する画面：いちばん上のモーダル、なければ（出ていれば）タイトルのメニュー。 */
  current() {
    if (this.top) return this.top;
    return this.title.classList.contains('hidden') ? null : this.title.querySelector('.menu');
  }
}
