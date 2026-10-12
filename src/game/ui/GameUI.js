// ゲーム中の画面：上の帯（日・時刻・出荷・お金・速さ）、道具箱、調べる窓、AI のログ、浮かぶ文字、知らせ。
// 日の説明（brief）と日報（report）の画面も、ここで作って Screens に足す。文言はすべて i18n のキー。
import { t, onLangChange, applyDom } from '../../core/i18n.js';
import { ICONS, destIcon } from './icons.js';
import { TOOLS, DEFS, DESTS, ROBOT_COST, UPGRADES, ARM_FILTERS, SORTER_FILTERS, DAY_LEN, EXP_TIME, PRICE } from '../sim/consts.js';
import { CAMPAIGN_DAYS } from '../sim/days.js';
import { GUIDE_OF } from '../view/GuideView.js';

/** アームが動けない理由（i18n のキー）。動けるなら null。 */
export function armProblem(a) {
  const src = a.nb[(a.dir + 2) & 3], dst = a.nb[a.dir];
  if (!src || !['belt', 'sorter', 'dock', 'shelf', 'labeler'].includes(src.type)) return 'st.armNoSrc';
  if (!dst || !['pad', 'shelf', 'belt', 'sorter', 'labeler'].includes(dst.type)) return 'st.armNoDst';
  return null;
}

/** ラベル機が荷物を出せない理由（i18n のキー）。出せているなら null。 */
export function labelerProblem(l) {
  const dst = l.nb[l.dir];
  const arm = dst?.type === 'arm' && dst.dir === l.dir; // 前のアームが後ろ（ラベル機）から取る
  if (!dst || (!['belt', 'sorter', 'junction'].includes(dst.type) && !arm)) return 'st.labNoDst';
  if (l.outWait > 1.2) return 'st.labJam';
  return null;
}

export const yen = (v) => (v < 0 ? '-¥' : '¥') + Math.abs(Math.round(v * 100)).toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const clock = (tt) => { const m = 8 * 60 + Math.floor((tt / DAY_LEN) * 600); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
const filterLabel = (f) => (typeof f === 'number' ? `<i class="sym" style="color:${DESTS[f].color}">${DESTS[f].sym}</i>${DESTS[f].key}` : t('f.' + f));
const costOf = (tool) => (tool === 'robot' ? ROBOT_COST : DEFS[tool]?.cost ?? 0);
const DIRS = ['→', '↓', '←', '↑'];

export class GameUI {
  constructor(root, game) {
    this.g = game;
    this.root = root;
    root.insertAdjacentHTML('beforeend', `
<div id="gui" class="hidden">
  <div class="wlabels"></div>
  <div class="floats"></div>
  <header class="topbar">
    <div class="tb-day">
      <div class="os">HAKOBI<b>OS</b></div>
      <div class="dline"><b class="dayname"></b><span class="clock">8:00</span></div>
      <div class="dprog"><i></i></div>
      <div class="status"></div>
    </div>
    <div class="tb-quota">
      <div class="qline"><span class="ql" data-i18n="hud.shipped">${t('hud.shipped')}</span><b class="qn">0</b><span class="qs">/</span><span class="qq">0</span></div>
      <div class="qbar"><i></i></div>
      <div class="qsub"><span class="acc"></span><span class="exp"></span></div>
    </div>
    <div class="tb-right">
      <div class="money"></div>
      <div class="speed">
        <button data-sp="0" class="sp" aria-label="pause">${ICONS.pause}</button><button data-sp="1" class="sp">${ICONS.play}</button><button data-sp="2" class="sp">${ICONS.ff}</button><button data-sp="3" class="sp">${ICONS.fff}</button>
        <span class="glyph-row"><i data-glyph="simPause"></i><i data-glyph="speed"></i></span>
      </div>
      <button class="iconbtn menu" data-ui="menu" data-i18n-aria="pause.title" aria-label="${t('pause.title')}">${ICONS.menu}</button>
    </div>
  </header>
  <aside class="log"><div class="log-head"><span class="dot"></span>SYSTEM LOG</div><ol></ol></aside>
  <button class="startday hidden" data-ui="begin"><span class="sd-main" data-i18n="hud.start">${t('hud.start')}</span><span class="sd-sub" data-i18n="hud.startHint">${t('hud.startHint')}</span><i data-glyph="simPause"></i></button>
  <div class="hint"><span class="hint-text"></span><button class="hint-help" data-ui="guide"><b>?</b><span data-i18n="guide.help">${t('guide.help')}</span><i data-glyph="help"></i></button></div>
  <section class="guide-card hidden">
    <header><span class="ic"></span><b class="gt"></b><button class="iconbtn x" data-ui="guideClose" data-i18n-aria="ui.close" aria-label="${t('ui.close')}">${ICONS.close}</button></header>
    <div class="gview"></div>
    <p class="gtext"></p>
  </section>
  <nav class="tools">
    <i class="tg" data-glyph="toolPrev"></i>
    <div class="tlist">${TOOLS.map((tool, i) => `<button class="tool" data-tool="${tool}"><span class="ic">${ICONS[tool]}</span><span class="nm" data-i18n="tool.${tool}">${t('tool.' + tool)}</span><span class="cost">${tool === 'select' || tool === 'remove' ? '&nbsp;' : yen(costOf(tool))}</span><kbd>${tool === 'remove' ? 'X' : (i + 1) % 10}</kbd><em class="new" data-i18n="ui.new">${t('ui.new')}</em></button>`).join('')}</div>
    <i class="tg" data-glyph="toolNext"></i>
    <div class="tsep"></div>
    <button class="iconbtn rot" data-ui="rotate"><span class="ic">${ICONS.rotate}</span><span class="rdir">→</span><i data-glyph="rotate"></i></button>
    <button class="iconbtn ana" data-ui="analysis"><span class="ic">${ICONS.eye}</span><i data-glyph="analysis"></i></button>
  </nav>
  <section id="inspector" class="hidden">
    <header data-nav-skip><span class="ic"></span><h3></h3><button class="iconbtn x" data-ins="close" data-i18n-aria="ui.close" aria-label="${t('ui.close')}">${ICONS.close}</button></header>
    <p class="st"></p>
    <div class="opts"></div>
    <div class="acts"></div>
  </section>
  <div class="toast hidden"></div>

  <div class="banner hidden"><span></span></div>
</div>`);
    const q = (s) => root.querySelector('#gui ' + s);
    this.el = root.querySelector('#gui');
    this.E = {
      dayname: q('.dayname'), clock: q('.clock'), dprog: q('.dprog i'), status: q('.status'),
      qn: q('.qn'), qq: q('.qq'), qbar: q('.qbar i'), acc: q('.acc'), exp: q('.exp'), money: q('.money'),
      log: q('.log ol'), logBox: q('.log'), start: q('.startday'), hint: q('.hint-text'), hintBox: q('.hint'),
      tools: [...root.querySelectorAll('#gui .tool')], rdir: q('.rdir'), ana: q('.ana'),
      ins: q('#inspector'), insIc: q('#inspector .ic'), insH: q('#inspector h3'), insSt: q('#inspector .st'), insOpts: q('#inspector .opts'), insActs: q('#inspector .acts'),
      toast: q('.toast'), floats: q('.floats'), wlabels: q('.wlabels'),
      guide: q('.guide-card'), guideView: q('.guide-card .gview'), guideTitle: q('.guide-card .gt'), guideIc: q('.guide-card .ic'), guideText: q('.guide-card .gtext'), hintHelp: q('.hint-help'), banner: q('.banner'), speed: [...root.querySelectorAll('#gui .sp')],
    };
    this.logs = [];
    this.floatPool = [];
    this.uiT = 0;
    this.insT = 0;
    this.sel = null;
    this.seenTools = new Set();
    this._wire();
    onLangChange(() => {
      this.refreshTools(); this.inspect(this.sel); this._relog(); this.setTool(this.g.controls?.tool || 'select');
      if (this.guideTool) { this.E.guideTitle.textContent = t('guide.title', { name: t('tool.' + this.guideTool) }); this.E.guideText.textContent = t('guide.' + GUIDE_OF[this.guideTool]); }
      this.g.guide?.relabel();
    });
  }

  show(on) { this.el.classList.toggle('hidden', !on); }

  _wire() {
    this.el.addEventListener('click', (e) => {
      const g = this.g;
      const tb = e.target.closest('[data-tool]');
      if (tb) { g.controls.setTool(tb.dataset.tool); tb.querySelector('.new')?.classList.remove('on'); this.seenTools.add(tb.dataset.tool); return; }
      const sp = e.target.closest('[data-sp]');
      if (sp) { g.setSpeed(+sp.dataset.sp); return; }
      const u = e.target.closest('[data-ui]');
      if (u) {
        const a = u.dataset.ui;
        if (a === 'menu') g.openMenu();
        else if (a === 'begin') g.beginDay();
        else if (a === 'rotate') g.controls.rotate(1);
        else if (a === 'analysis') g.toggleAnalysis();
        else if (a === 'guide') this.toggleGuide();
        else if (a === 'guideClose') this.hideGuide();
        return;
      }
      const ins = e.target.closest('[data-ins]');
      if (ins) this._insAction(ins);
    });
    this.E.logBox.addEventListener('click', () => this.E.logBox.classList.toggle('open'));
  }

  // ------------------------------------------------------------------ 道具
  /** 使える道具だけ出す。新しく使えるようになったものに「NEW」。 */
  refreshTools(newTools = []) {
    const w = this.g.world;
    for (const b of this.E.tools) {
      const tool = b.dataset.tool;
      const on = tool === 'select' || tool === 'remove' || w.tools.has(tool);
      b.classList.toggle('hidden', !on);
      // 「NEW」は 2 日目から（1 日目は全部が新しいので出さない）
      if (w.day > 1 && newTools.includes(tool) && !this.seenTools.has(tool)) b.querySelector('.new').classList.add('on');
      const c = b.querySelector('.cost');
      if (tool !== 'select' && tool !== 'remove') c.textContent = yen(costOf(tool));
    }
  }

  setTool(tool) {
    for (const b of this.E.tools) b.classList.toggle('on', b.dataset.tool === tool);
    this.E.hintHelp.classList.toggle('hidden', !GUIDE_OF[tool]);
    // 使い方の札：開いていれば、選んだ道具の見本に切り替える（見本のない道具なら閉じる）
    if (this.guideTool && this.guideTool !== tool) { if (GUIDE_OF[tool]) this.showGuide(tool); else this.hideGuide(); }
    const touch = this.g.input.device === 'touch';
    const key = touch && t('hintT.' + tool) !== 'hintT.' + tool ? 'hintT.' + tool : 'hint.' + tool;
    this.E.hint.textContent = t(key);
    this.E.hintBox.classList.toggle('on', tool !== 'select');
    this.el.classList.toggle('building', tool !== 'select');
    this.setRot(this.g.controls?.rot ?? 0);
  }

  setRot(r) { this.E.rdir.textContent = DIRS[r & 3]; }

  // ------------------------------------------------------------------ 毎フレーム
  update(dt) {
    this.uiT -= dt;
    if (this.uiT <= 0) { this.uiT = 0.1; this._top(); }
    this.insT -= dt;
    if (this.insT <= 0 && this.sel) { this.insT = 0.25; this._insStatus(); }
    this._floats(dt);
    this._labels(dt);
    // 使い方の札：ほかの画面（あそびかた・日の説明）に見本の窓を貸していたら、遊ぶ画面に戻ったときに取り戻す
    const st = this.g.state;
    if (this.guideTool && (st === 'play' || st === 'inspect') && this.g.guide.box !== this.E.guideView) this.g.guide.open(this.E.guideView, GUIDE_OF[this.guideTool]);
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) this.E.toast.classList.add('hidden');
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.E.banner.classList.add('hidden');
  }

  /** すぐに描き直す（日を変えたときなど）。 */
  refresh() { this.uiT = 0; this._top(); }

  _top() {
    const g = this.g, w = g.world, s = w.stats, E = this.E;
    E.dayname.textContent = t(w.day > CAMPAIGN_DAYS ? 'hud.dayOver' : 'hud.day', { n: w.day });
    E.clock.textContent = clock(w.t);
    E.dprog.style.width = `${Math.min(100, (w.t / DAY_LEN) * 100)}%`;
    const st = w.ended ? 'hud.ended' : !w.running ? 'hud.planning' : g.simPaused ? 'hud.paused' : w.storm ? 'hud.storm' : 'hud.running';
    E.status.textContent = t(st);
    E.status.dataset.k = st;
    E.qn.textContent = s.delivered;
    E.qq.textContent = w.quota;
    E.qbar.style.width = `${Math.min(100, (s.delivered / Math.max(1, w.quota)) * 100)}%`;
    E.qbar.parentElement.classList.toggle('done', s.delivered >= w.quota);
    const tot = s.delivered + s.mis;
    E.acc.textContent = t('hud.acc', { n: tot ? Math.floor((s.delivered / tot) * 100) : 100 });
    E.acc.classList.toggle('bad', tot > 0 && s.delivered / tot < 0.97);
    const ex = s.expOn + s.expLate;
    E.exp.textContent = ex || w.def?.exp ? t('hud.exp', { n: ex ? Math.floor((s.expOn / ex) * 100) : 100 }) : '';
    E.money.textContent = yen(w.money);
    E.money.classList.toggle('bad', w.money < 0);
    E.start.classList.toggle('hidden', w.running || w.ended || g.state !== 'play');
    const spI = g.simPaused || !w.running ? 0 : g.speedI + 1;
    E.speed.forEach((b, i) => b.classList.toggle('on', i === spI));
    E.ana.classList.toggle('on', !!g.analysis);
  }

  // ------------------------------------------------------------------ ログ
  log(kind, key, vars = {}) {
    const w = this.g.world;
    this.logs.push({ kind, key, vars, tt: w.t });
    if (this.logs.length > 40) this.logs.shift();
    this._addLogLine(this.logs[this.logs.length - 1]);
  }
  _addLogLine(L) {
    const li = document.createElement('li');
    li.className = 'k-' + L.kind;
    const who = L.kind === 'boss' ? `<b class="who">${t('ui.boss')}</b>` : '';
    li.innerHTML = `<time>${clock(L.tt)}</time><span>${who}${esc(t(L.key, L.vars))}</span>`;
    this.E.log.append(li);
    while (this.E.log.children.length > 40) this.E.log.firstChild.remove();
    this.E.log.scrollTop = this.E.log.scrollHeight;
  }
  _relog() { this.E.log.innerHTML = ''; for (const L of this.logs) this._addLogLine(L); }
  clearLog() { this.logs = []; this.E.log.innerHTML = ''; }

  toast(key, vars) {
    this.E.toast.textContent = t(key, vars);
    this.E.toast.classList.remove('hidden');
    this.toastT = 1.8;
  }

  banner(key, vars, kind = '') {
    const b = this.E.banner;
    b.firstChild.textContent = t(key, vars);
    b.className = 'banner ' + kind;
    this.bannerT = 2.6;
  }

  // ------------------------------------------------------------------ 浮かぶ文字（+¥800 など）
  float(x, y, z, text, cls = '') {
    // 同じ所でまだ浮いている数字があれば、その上に積む（続けて出荷したときに重ならないように）
    const near = this.floatPool.filter((p) => p.t > 0 && Math.abs(p.x - x) < 0.6 && Math.abs(p.z - z) < 0.6);
    if (near.length) y += 0.45 * Math.min(2, near.length);
    let f = this.floatPool.find((p) => p.t <= 0);
    if (!f) {
      if (this.floatPool.length > 30) return;
      const el = document.createElement('div');
      el.className = 'float';
      this.E.floats.append(el);
      f = { el, t: 0 };
      this.floatPool.push(f);
    }
    Object.assign(f, { x, y, z, t: 1.3, life: 1.3 });
    f.el.textContent = text;
    f.el.className = 'float ' + cls;
    f.el.style.display = '';
  }
  _floats(dt) {
    const rig = this.g.rig;
    for (const f of this.floatPool) {
      if (f.t <= 0) continue;
      f.t -= dt;
      if (f.t <= 0) { f.el.style.display = 'none'; continue; }
      const k = 1 - f.t / f.life;
      const p = rig.toScreen(f.x, f.y + k * 0.9, f.z);
      if (!p.front || p.x < -40 || p.y < 60 || p.x > innerWidth + 40 || p.y > innerHeight) { f.el.style.opacity = '0'; continue; }
      f.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
    }
  }

  hover() {}

  // ------------------------------------------------------------------ 使い方の札（小さな見本）
  /** 道具を初めて選んだときに、使い方の見本を一度だけ出す。 */
  autoGuide(tool) {
    const kind = GUIDE_OF[tool];
    if (!kind) return;
    const seen = this.g.save.data.seen || (this.g.save.data.seen = []);
    if (seen.includes(kind)) return;
    seen.push(kind);
    this.g.save.save();
    this.showGuide(tool);
  }

  showGuide(tool) {
    const kind = GUIDE_OF[tool];
    if (!kind) return;
    this.guideTool = tool;
    const E = this.E;
    E.guideIc.innerHTML = ICONS[tool] || '';
    E.guideTitle.textContent = t('guide.title', { name: t('tool.' + tool) });
    E.guideText.textContent = t('guide.' + kind);
    E.guide.classList.remove('hidden');
    this.el.classList.add('guiding');
    this.g.guide.open(E.guideView, kind);
  }

  hideGuide() {
    if (!this.guideTool) return false;
    this.guideTool = null;
    this.E.guide.classList.add('hidden');
    this.el.classList.remove('guiding');
    if (this.g.guide.box === this.E.guideView) this.g.guide.close();
    return true;
  }

  toggleGuide() {
    const tool = this.g.controls.tool;
    if (this.guideTool) this.hideGuide();
    else this.showGuide(tool);
  }

  get guideOpen() { return !!this.guideTool; }

  // ------------------------------------------------------------------ 入荷口・ポートの名札（計画中と分析ビューのとき）
  _labels(dt) {
    const g = this.g, w = g.world;
    const playing = g.state === 'play' || g.state === 'inspect';
    const on = playing && (!w.running || g.analysis || w.t < 6);
    // アームを置こうとしている・選んでいるときは、「取る」「置く」を出す
    const c = g.controls;
    let arm = null;
    if (playing && c.enabled && c.tool === 'arm' && c.cursor.ok && c.lastPointer !== 'touch' && !w.at(c.cursor.x, c.cursor.y)) arm = { x: c.cursor.x, y: c.cursor.y, dir: c.ghostDir('arm', c.cursor.x, c.cursor.y) };
    else if (playing && c.selected?.kind === 'b' && c.selected.ref.type === 'arm') arm = c.selected.ref;
    this.E.wlabels.classList.toggle('hidden', !on && !arm);
    if (!on && !arm) return;
    const pool = this._lbl || (this._lbl = new Map());
    const seen = new Set();
    const put = (key, x, y, z, html, cls) => {
      seen.add(key);
      let el = pool.get(key);
      if (!el) { el = document.createElement('div'); this.E.wlabels.append(el); pool.set(key, el); }
      if (el._html !== html) { el.innerHTML = html; el._html = html; }
      el.className = 'wl ' + cls;
      const p = g.rig.toScreen(x, y, z);
      el.style.display = p.front ? '' : 'none';
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    };
    if (arm) {
      const b = (arm.dir + 2) & 3;
      put('take', arm.x + [1, 0, -1, 0][b], 0.55, arm.y + [0, 1, 0, -1][b], esc(t('guide.lbl.take')), 'take');
      put('put', arm.x + [1, 0, -1, 0][arm.dir], 0.55, arm.y + [0, 1, 0, -1][arm.dir], esc(t('guide.lbl.put')), 'put');
    }
    if (!on) { for (const [k, el] of pool) if (!seen.has(k)) { el.remove(); pool.delete(k); } return; }
    for (const d of w.lists.docks) put('d' + d.id, d.x, 1.6, d.y, `${ICONS.truck}<span>${esc(t('nm.dock', { n: d.dockNo + 1 }))}</span>`, 'dock');
    for (const p of w.lists.pads) put('p' + p.id, p.x, 0.9, p.y, `${destIcon(p.cfg.dest, DESTS[p.cfg.dest].color)}<span>${DESTS[p.cfg.dest].key}</span>`, 'pad');
    for (const [k, el] of pool) if (!seen.has(k)) { el.remove(); pool.delete(k); }
  }

  // ------------------------------------------------------------------ 調べる窓
  inspect(sel) {
    this.sel = sel;
    const E = this.E;
    E.ins.classList.toggle('hidden', !sel);
    this.el.classList.toggle('inspecting', !!sel);
    if (!sel) return;
    const w = this.g.world;
    if (sel.kind === 'r') {
      const r = sel.ref;
      E.insIc.innerHTML = ICONS.robot;
      E.insH.textContent = t('nm.robot', { n: String(r.no).padStart(2, '0') });
      E.insOpts.innerHTML = `<p class="desc">${esc(t('desc.robot'))}</p>`;
      E.insActs.innerHTML = `<button data-ins="fire" class="danger">${ICONS.remove}<span>${esc(t('ins.fire'))} <small>+${yen(ROBOT_COST)}</small></span></button>`;
      this._insStatus();
      return;
    }
    const b = sel.ref;
    const type = b.type;
    E.insIc.innerHTML = ICONS[type === 'dock' ? 'truck' : type] || ICONS.box;
    E.insH.textContent = type === 'dock' ? t('nm.dock', { n: b.dockNo + 1 }) : t('tool.' + type);
    let opts = `<p class="desc">${esc(t('desc.' + type))}</p>`;
    if (type === 'arm') opts += this._chips('filter', ARM_FILTERS.filter((f) => typeof f !== 'number' || w.def.dests.includes(f)).filter((f) => (f !== 'exp' || w.def.exp) && (f !== 'unk' || w.def.unk)), b.cfg.filter, 'ins.filter');
    if (type === 'sorter') {
      opts += this._chips('filter', SORTER_FILTERS.filter((f) => typeof f !== 'number' || w.def.dests.includes(f)).filter((f) => (f !== 'exp' || w.def.exp) && (f !== 'unk' || w.def.unk)), b.cfg.filter, 'ins.filter');
      opts += `<div class="row2"><span>${esc(t('ins.side'))}</span><div class="chips">${['L', 'R'].map((v) => `<button data-ins="side" data-v="${v}" class="${b.cfg.side === v ? 'on' : ''}">${esc(t(v === 'L' ? 'ins.left' : 'ins.right'))}</button>`).join('')}</div></div>`;
    }
    if (type === 'pad') opts += this._chips('dest', w.def.dests, b.cfg.dest, 'ins.dest');
    if (type === 'shelf' || type === 'dock') opts += `<div class="row2"><span>${esc(t('ins.collect'))}</span><div class="chips"><button data-ins="collect" class="${b.cfg.collect !== false ? 'on' : ''}">${esc(t(b.cfg.collect !== false ? 'ui.on' : 'ui.off'))}</button></div></div>`;
    E.insOpts.innerHTML = opts;
    let acts = '';
    if (['belt', 'sorter', 'arm', 'labeler'].includes(type)) acts += `<button data-ins="rotate">${ICONS.rotate}<span>${esc(t('ins.rotate'))}</span><i data-glyph="rotate"></i></button>`;
    if (type !== 'dock') acts += `<button data-ins="remove" class="danger">${ICONS.remove}<span>${esc(t('ins.remove'))} <small>+${yen(DEFS[type].cost)}</small></span></button>`;
    E.insActs.innerHTML = acts;
    this.g.refreshGlyphs?.();
    this._insStatus();
  }

  _chips(kind, list, cur, label) {
    return `<div class="row2"><span>${esc(t(label))}</span><div class="chips">${list.map((v) => `<button data-ins="${kind}" data-v="${v}" class="${v === cur ? 'on' : ''}">${filterLabel(v)}</button>`).join('')}</div></div>`;
  }

  _insAction(el) {
    const g = this.g, w = g.world, sel = this.sel;
    const a = el.dataset.ins;
    if (a === 'close') { g.controls.select(null); g.closeInspect?.(); return; }
    if (!sel) return;
    // 撤去・解雇は 2 回押しで（パッドで選び進めたときに、うっかり消さないように）
    if ((a === 'fire' || a === 'remove') && !el.classList.contains('armed')) {
      el.classList.add('armed');
      el.dataset.label = el.querySelector('span').innerHTML;
      el.querySelector('span').textContent = t('ins.confirm');
      g.audio.sfx('alert');
      clearTimeout(this._armT);
      this._armT = setTimeout(() => { if (el.isConnected) { el.classList.remove('armed'); el.querySelector('span').innerHTML = el.dataset.label; } }, 2200);
      return;
    }
    if (a === 'fire') { g.controls.removeSelected(); g.closeInspect?.(); return; }
    const b = sel.ref;
    const v = el.dataset.v;
    const num = (x) => (/^\d+$/.test(x) ? +x : x);
    if (a === 'filter') { w.configure(b, { filter: num(v) }); g.remember(b); }
    else if (a === 'side') { w.configure(b, { side: v }); g.remember(b); }
    else if (a === 'dest') { w.configure(b, { dest: +v }); g.remember(b); }
    else if (a === 'collect') w.configure(b, { collect: b.cfg.collect === false });
    else if (a === 'rotate') { g.controls.rotate(1); }
    else if (a === 'remove') { g.controls.removeSelected(); g.closeInspect?.(); return; }
    g.audio.sfx('ui_ok');
    // 選んだ状態を描き直す（並びは変えない：パッドの選択位置を保つ）
    for (const c of this.E.insOpts.querySelectorAll(`[data-ins="${a}"]`)) {
      if (a === 'collect') { c.classList.toggle('on', b.cfg.collect !== false); c.textContent = t(b.cfg.collect !== false ? 'ui.on' : 'ui.off'); }
      else c.classList.toggle('on', String(c.dataset.v) === String(a === 'filter' ? b.cfg.filter : a === 'side' ? b.cfg.side : b.cfg.dest));
    }
  }

  _insStatus() {
    const sel = this.sel, w = this.g.world, perf = w.perf();
    if (!sel) return;
    let s = '';
    if (sel.kind === 'r') {
      const r = sel.ref;
      if (r.gone) { this.g.controls.select(null); return; }
      s = `${t('rs.' + r.st)} · ${t('ins.battery', { n: Math.round(r.bat) })}`;
    } else {
      const b = sel.ref;
      if (b.gone) { this.g.controls.select(null); return; }
      switch (b.type) {
        case 'belt': case 'junction': s = t('st.belt', { n: b.lanes[0].length + b.lanes[1].length, d: DIRS[b.dir] }); break;
        case 'sorter': s = t('st.belt', { n: b.lanes[0].length, d: DIRS[b.dir] }); break;
        case 'arm': {
          const why = armProblem(b);
          s = why ? t(why) : t(b.phase === 'idle' ? 'st.armIdle' : b.phase === 'drop' && b.t > 0.5 ? 'st.armWait' : 'st.armBusy');
          this.E.insSt.classList.toggle('bad', !!why);
          break;
        }
        case 'pad': s = t('st.pad', { n: b.store.length, c: perf.padCap, d: t('ds.' + (b.drones[0]?.st || 'dock')) }); break;
        case 'shelf': s = t('st.shelf', { n: b.store.length, c: perf.shelfCap }); break;
        case 'dock': s = t('st.dock', { n: b.queue.length, c: perf.dockCap, k: b.line.length + (b.bay ? 1 : 0) }); break;
        case 'charger': s = b.user ? t('st.chgUse', { n: String(b.user.no).padStart(2, '0') }) : t('st.chgFree'); break;
        case 'labeler': {
          const why = labelerProblem(b);
          s = why ? t(why) : t('st.labeler', { n: b.inQ.length + (b.cur ? 1 : 0) });
          this.E.insSt.classList.toggle('bad', !!why);
          break;
        }
      }
    }
    if (sel.kind !== 'b' || (sel.ref.type !== 'arm' && sel.ref.type !== 'labeler')) this.E.insSt.classList.remove('bad');
    this.E.insSt.textContent = s;
  }

  /** 調べる窓（パッド・キーボードで操作するとき、MenuNav に渡す）。 */
  get inspector() { return this.E.ins; }
}
