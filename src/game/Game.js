// ゲームの進行：タイトル（見本の工場が動く）→ 日の説明 → 計画・業務 → 日報 → 次の日。
// 形は雛形のまま：async init()・STATES の表・step(dt)（描画しない）・render(dt)・snapshot()。
import * as THREE from 'three';
import { events } from '../core/events.js';
import { damp } from '../core/math.js';
import { createStore } from '../core/save.js';
import { t } from '../core/i18n.js';
import { World } from './sim/World.js';
import { DAY1_LAYOUT, CAMPAIGN_DAYS, dayDef, ZONES } from './sim/days.js';
import { DAY_LEN, DESTS, UPGRADES } from './sim/consts.js';
import { demoLayout } from './sim/layouts.js';
import { WorldView } from './view/WorldView.js';
import { CameraRig } from './view/CameraRig.js';
import { Overlay } from './view/Overlay.js';
import { GuideView, GUIDE_KINDS } from './view/GuideView.js';
import { Controls } from './Controls.js';
import { Analyzer } from './Analyzer.js';
import { GameUI, yen } from './ui/GameUI.js';
import { addPanels, fillBrief, fillReport, fillEnding } from './ui/Panels.js';

// 状態の表。title：タイトル ／ hud：ゲームの画面 ／ input：'play'・'menu' ／ music：曲 ／ modal：開く画面 ／ duck：曲を下げる
// ctl：地図の操作を受けつける ／ sim：シミュレーションを進める
export const STATES = {
  title: { title: true, input: 'menu', music: 'title', sim: true },
  brief: { hud: true, input: 'menu', modal: 'brief', music: 'plan' },
  play: { hud: true, input: 'play', ctl: true, sim: true },
  inspect: { hud: true, input: 'menu', ctl: true, sim: true },
  paused: { hud: true, input: 'menu', modal: 'pause', duck: true },
  report: { hud: true, input: 'menu', modal: 'report', music: 'report' },
  confirm: { title: true, input: 'menu', modal: 'confirm' },
  ending: { hud: true, input: 'menu', modal: 'ending', music: 'report' },
};

const SPEEDS = [1, 2, 4];
const GRANT = 500;           // 2 日目からの、本社からの予算（1 日ごと）
const START_MONEY = 1500;
const PENTA = [0, 3, 5, 7];  // 出荷の音の高さ（宛先ごと）
// 日の説明の中で動かす見本（その日に新しく使えるもの）
const BRIEF_GUIDE = { 1: 'flow', 2: 'arm', 3: 'sorter', 5: 'labeler' };

export class Game {
  constructor({ renderer, input, audio, screens, touch, hud }) {
    Object.assign(this, { renderer, input, audio, screens, touch });
    this.save = createStore('hakobi-algorithm.save', { day: 0, snap: null, stars: {}, cleared: false, seen: [] }, 1);
    this.time = 0;
    this.state = 'title';
    this.speedI = 0;
    this.simPaused = false;
    this.analysis = false;
    this.lastCfg = {};
    this.endT = -1;

    const scene = (this.scene = new THREE.Scene());
    this.world = new World();
    this.view = new WorldView(scene, this.world);
    this.overlay = new Overlay(scene);
    this.camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.5, 400);
    this.rig = new CameraRig(this.camera);
    renderer.setScene(scene, this.camera);
    renderer.onQuality = (p) => this.view.env.setShadowSize(p.shadowSize);
    renderer.onQuality(renderer.preset);
    this.baseLook = { exposure: 1.0, bloomStrength: 0.28, bloomRadius: 0.4, bloomThreshold: 0.92, vignette: 0.22, saturation: 1.08, contrast: 1.04 };
    renderer.setLook(this.baseLook);

    // 画面の縦横が入れかわったら（スマホを回したら）、工場が収まるように見直す
    this._portrait = innerWidth / innerHeight < 0.85;
    addEventListener('resize', () => {
      const p = innerWidth / innerHeight < 0.85;
      if (p === this._portrait) return;
      this._portrait = p;
      if (this.state === 'title') this.rig.frame(ZONES[2], { margin: 0.95 });
      else if (this.world.def) this.rig.frame(ZONES[this.world.def.zone], { snap: false });
    });
    this.guide = new GuideView();
    this.ui = new GameUI(hud.root || document.getElementById('ui'), this);
    this.hud = this.ui;
    addPanels(screens);
    this.controls = new Controls(this, renderer.domElement);
    this.analyzer = new Analyzer(this);
  }

  async init() {
    await document.fonts?.ready;
    this.loadDemo();
    this._continueLabel();
    this.setState('title');
  }

  _continueLabel() {
    const d = this.save.data;
    this.screens.setContinue(d.day >= 1 && !!d.snap, () => t('title.continueDay', { n: d.day }));
  }

  /** タイトルの背景：できあがった工場を、お金なしで回す。 */
  loadDemo() {
    const w = this.world;
    w.free = true;
    w.setupDay(7, demoLayout());
    w.begin();
    for (let i = 0; i < 60 * 25; i++) w.step(1 / 60);
    w.events.length = 0;
    this.rig.frame(ZONES[2], { margin: 0.95 });
    this.rig.orbit = 0.035;
    this.ui?.clearLog();
  }

  // ------------------------------------------------------------------ 状態
  setState(s) {
    const S = STATES[s];
    if (!S) throw new Error('状態がありません: ' + s);
    const prev = this.state;
    this.state = s;
    this.screens.showTitle(!!S.title);
    this.ui.show(!!S.hud);
    this.input.mode = S.input || 'menu';
    this.controls.enabled = !!S.ctl && s === 'play';
    if (!S.modal) this.screens.closeAll();
    else if (!this.screens.isOpen(S.modal)) { this.screens.closeAll(); this.screens.open(S.modal); }
    if (S.music) this.audio.music(S.music);
    else if (s === 'play') this.audio.music(this.world.running ? 'work' : 'plan');
    this.audio.duck(!!S.duck);
    this.ui.el.classList.toggle('focus-ins', s === 'inspect');
    this[`enter_${s}`]?.(prev);
    if (prev !== s) events.emit('state', { from: prev, to: s });
  }

  enter_paused() { this.audio.sfx('pause'); }

  /** タイトルの「はじめる」。セーブがあれば確かめる。 */
  start() {
    if (this.save.data.day >= 1 && this.save.data.snap) { this.setState('confirm'); return; }
    this.newCampaign();
  }

  newCampaign() {
    const d = this.save.data;
    d.day = 1; d.snap = null; d.stars = {}; d.cleared = false;
    this.save.save();
    this.lastCfg = {};
    this.enterDay(1, { ...DAY1_LAYOUT, robots: [[4, 5]], money: START_MONEY, upg: {} });
    // 1 日目の途中でやめても「つづきから」で戻れるように、朝の配置を残す
    d.snap = this.dayStart;
    this.save.save();
    this._continueLabel();
  }

  continueGame() {
    const d = this.save.data;
    if (!d.snap) { this.newCampaign(); return; }
    this.enterDay(d.day, d.snap);
  }

  /** n 日目を始める（計画の時間から）。layout：その日の朝の置き方とお金。 */
  enterDay(n, layout, { grant = 0 } = {}) {
    const w = this.world;
    w.free = false;
    this.rig.orbit = 0;
    w.setupDay(n, layout);
    if (grant) w.money += grant;
    this.dayStart = w.serialize();
    this.speedI = 0;
    this.simPaused = false;
    this.endT = -1;
    this.analysis = false;
    this.renderer.setLook(this.baseLook);
    this.analyzer.reset();
    this.ui.hideGuide();
    this.ui.clearLog();
    this.ui.refreshTools(w.def.newTools);
    this.controls.setTool('select');
    this.controls.select(null);
    this.rig.frame(ZONES[w.def.zone]);
    this.ui.log('info', 'log.hello');
    const featured = BRIEF_GUIDE[n] || null;
    fillBrief(this.screens, { n, def: w.def, total: w.totalPkgs, quota: w.quota, grant, guide: featured });
    this.setState('brief');
    if (featured) this.guide.open(this.screens.modals.brief.querySelector('.gview'), featured);
    this.ui.refresh();
    this.audio.sfx('dayStart');
  }

  /** 業務開始（トラックが来はじめる）。 */
  beginDay() {
    const w = this.world;
    if (w.running || w.ended) return;
    w.begin();
    this.simPaused = false;
    this.ui.log('info', 'log.begin');
    this.ui.banner('banner.begin', { n: w.day });
    this.audio.music('work');
    this.audio.sfx('begin');
  }

  setSpeed(i) {
    const w = this.world;
    if (i === 0) { if (w.running) this.simPaused = true; }
    else { this.speedI = i - 1; this.simPaused = false; if (!w.running) this.beginDay(); }
    this.audio.sfx('tool');
  }

  togglePause() {
    const w = this.world;
    if (!w.running && !w.ended) { this.beginDay(); return; }
    this.simPaused = !this.simPaused;
    this.audio.sfx(this.simPaused ? 'pause' : 'tool');
  }

  cycleSpeed() { this.speedI = (this.speedI + 1) % SPEEDS.length; this.simPaused = false; if (!this.world.running) this.beginDay(); this.audio.sfx('tool'); }

  toggleAnalysis() {
    this.analysis = !this.analysis;
    this.renderer.setLook(this.analysis ? { ...this.baseLook, saturation: 0.35, contrast: 0.95, exposure: 0.9 } : this.baseLook);
    this.audio.sfx(this.analysis ? 'scan' : 'tool');
  }

  openMenu() { if (this.state === 'play' || this.state === 'inspect') this.setState('paused'); }

  /** パッド・キーボードで建物を選んだら、調べる窓を操作できるようにする。 */
  focusInspect() {
    if (!this.controls.selected || this.state !== 'play') return;
    this.setState('inspect');
    this.input.menu.ok = false; // 開いた A / Enter で、窓の最初のボタンまで押さないように
  }
  closeInspect() { if (this.state === 'inspect') this.setState('play'); }

  /** 設定を覚えて、次に置くものに引き継ぐ。 */
  remember(b) { this.lastCfg[b.type] = { ...b.cfg }; }

  onBuilt(tool) { this.tutorial?.(tool); }

  refreshGlyphs() { this._glyphs?.(); }

  // ------------------------------------------------------------------ 画面のボタン（data-act）
  onAction(act, el) {
    const w = this.world;
    switch (act) {
      case 'briefOk': this.setState('play'); this._dayTips(); break;
      case 'confirmNew': this.newCampaign(); break;
      case 'nextDay': this.nextDay(); break;
      case 'retryStart': this.enterDay(w.day, this.dayStart); break;
      case 'retryKeep': {
        const snap = w.serialize();
        snap.money = Math.round(w.money - w.stats.revenue + w.stats.opex);
        this.enterDay(w.day, snap);
        break;
      }
      case 'buy': this.buyUpgrade(el.dataset.k); break;
      case 'guide': {
        // あそびかたの中の見本
        const box = this.screens.modals.howto.querySelector('.gview');
        const k = el.dataset.k;
        if (GUIDE_KINDS.includes(k) && box) {
          this.guide.open(box, k);
          this.screens.modals.howto.querySelector('.gcap').textContent = t('guide.' + k);
          for (const b of this.screens.modals.howto.querySelectorAll('[data-act="guide"]')) b.classList.toggle('on', b === el);
        }
        break;
      }
      case 'overtime': this.nextDay(true); break;
      case 'toTitle': this.reset(); this.setState('title'); break;
    }
  }

  /** 画面が開いた・閉じたとき（Screens から）。あそびかたを開いたら、最初の見本を動かす。 */
  onModal(name, on) {
    if (name === 'howto' && on) {
      const b = this.screens.modals.howto.querySelector('[data-act="guide"].on') || this.screens.modals.howto.querySelector('[data-act="guide"]');
      if (b) this.onAction('guide', b);
    }
  }

  buyUpgrade(k) {
    const w = this.world;
    const U = UPGRADES[k];
    const lv = w.upg[k] || 0;
    if (!U || lv >= U.costs.length || w.money < U.costs[lv]) return;
    w.money -= U.costs[lv];
    w.setUpgrade(k, lv + 1);
    this.audio.sfx('buy');
    this._fillReport();
    this.ui.refreshTools();
  }

  nextDay(fromEnding = false) {
    const w = this.world;
    const n = w.day;
    if (n === CAMPAIGN_DAYS && !fromEnding && !this.save.data.cleared) {
      this.save.data.cleared = true;
      this.save.save();
      const stars = Object.values(this.save.data.stars).reduce((a, b) => a + b, 0);
      fillEnding(this.screens, { stars, max: CAMPAIGN_DAYS * 3 });
      this.setState('ending');
      this.audio.sfx('fanfare');
      return;
    }
    const snap = w.serialize();
    const d = this.save.data;
    d.day = n + 1;
    d.snap = { ...snap, money: snap.money + GRANT };
    this.save.save();
    this._continueLabel();
    this.enterDay(n + 1, snap, { grant: GRANT });
  }

  _dayTips() {
    const w = this.world;
    const n = Math.min(w.day, CAMPAIGN_DAYS + 1);
    const key = n > CAMPAIGN_DAYS ? 'tip.x' : 'tip.' + n;
    for (let i = 1; i <= 3; i++) { const k = key + '.' + i; if (t(k) !== k) this.ui.log('tip', k); }
    // 計画のうちに：宛先のポートがまだ無ければ知らせる（新しい宛先の日など）
    const have = new Set(w.lists.pads.map((p) => p.cfg.dest));
    for (const d of w.def.dests) if (!have.has(d)) this.ui.log('bad', 'log.noPad', { s: DESTS[d].sym });
  }

  /** 確認・撮影用：__dev.goto('play', { day: 3, layout: 'demo' | 'none', run: true, t: 60, money }) */
  devGoto(name, opts = {}) {
    if (name === 'title') { this.reset(); this.setState('title'); return this.state; }
    const n = opts.day || 1;
    let layout;
    if (opts.layout === 'demo') layout = { ...demoLayout(), money: opts.money ?? 5000, upg: {} };
    else if (opts.layout === 'none') layout = { b: [], robots: [], money: opts.money ?? 3000, upg: {} };
    else layout = { ...DAY1_LAYOUT, robots: [[4, 5]], money: opts.money ?? (n === 1 ? START_MONEY : 3000), upg: {} };
    this.enterDay(n, layout);
    if (name === 'brief') return this.state;
    this.setState('play');
    if (opts.run) this.beginDay();
    // 途中の時刻へ：1 秒ずつ進めて、AI の見回り（予測・注意）もふつうに遊んだときと同じように通す
    if (opts.t) for (let s = 0; s < opts.t; s++) { this.advanceSim(Math.min(1, opts.t - s)); this.analyzer.update(Math.min(1, opts.t - s)); }
    if (name === 'paused') this.setState('paused');
    if (name === 'report') { this.beginDay(); this.advanceSim(DAY_LEN + 1); this._openReport(); }
    return this.state;
  }

  // ------------------------------------------------------------------ 1 コマ
  reset() {
    this.loadDemo();
    this._continueLabel();
  }

  step(dt) {
    const input = this.input;
    input.update(dt);
    this.time += dt;
    this[`update_${this.state}`]?.(dt);
    this.guide.step(dt);
    this._ambience(dt);
    this.rig.update(dt);
    this.audio.listen(this.camera);
    this.audio.tick(dt);
    input.endFrame();
  }

  /** シミュレーションを dt 秒進める（1/60 秒より細かく刻む）。出来事を音・画面に回す。 */
  advanceSim(dt) {
    const w = this.world;
    if (dt > 0) {
      const n = Math.max(1, Math.ceil(dt / (1 / 60) - 1e-6));
      for (let i = 0; i < n; i++) w.step(dt / n);
      this.simDt = (this.simDt || 0) + dt;
    }
    const evs = w.events;
    if (evs.length) {
      w.events = [];
      if (this.state !== 'title') for (const e of evs) this._event(e);
    }
    if (this.shipAcc?.size) {
      for (const [b, a] of this.shipAcc) this.ui.float(b.x, 1.1, b.y, (a.v >= 0 ? '+' : '') + yen(a.v), a.bad ? 'bad' : a.exp ? 'exp' : 'ok');
      this.shipAcc.clear();
    }
  }

  _event(e) {
    const w = this.world;
    const at = (b) => (b ? { x: b.x, y: 0.5, z: b.y } : null);
    this.analyzer.onEvent(e);
    switch (e.type) {
      case 'ship': {
        const b = e.b;
        if (e.ok) this.audio.sfx('ship', { pos: at(b), pitch: Math.pow(2, PENTA[e.dest] / 12) * (e.exp ? 1.5 : 1), minGap: 0.05 });
        else this.audio.sfx('mis', { pos: at(b) });
        // ドローン 1 機ぶん（同じポートの同じ時）をまとめて 1 つの数字にする
        const acc = this.shipAcc || (this.shipAcc = new Map());
        const a = acc.get(b) || { v: 0, bad: false, exp: false };
        a.v += e.value; a.bad ||= !e.ok; a.exp ||= e.exp;
        acc.set(b, a);
        break;
      }
      case 'droneUp': this.audio.sfx('drone', { pos: at(e.b), minGap: 0.2 }); break;
      case 'truck': this.audio.sfx('truck', { pos: at(e.dock), minGap: 0.5 }); break;
      case 'unload': this.audio.sfx('beep', { pos: at(e.dock), minGap: 0.3 }); break;
      case 'arm': this.audio.sfx('servo', { pos: at(e.b), minGap: 0.09 }); break;
      case 'pick': case 'drop': this.audio.sfx('thud', { pos: { x: e.r.x, y: 0.4, z: e.r.y }, minGap: 0.08 }); break;
      case 'relabel': case 'robotRead': this.audio.sfx('scan', { pos: e.b ? at(e.b) : { x: e.r.x, y: 0.5, z: e.r.y }, minGap: 0.2 }); break;
      case 'charge': this.audio.sfx('charge', { pos: { x: e.r.x, y: 0.3, z: e.r.y }, minGap: 0.3 }); break;
      case 'hire': this.ui.log('good', 'log.hire', { n: String(e.r.no).padStart(2, '0') }); this.audio.sfx('hire'); break;
      case 'dayEnd':
        this.ui.log('info', e.cleared ? 'log.cleared' : 'log.dayEnd');
        this.endT = 1.8;
        this.audio.sfx('dayEnd');
        if (this.controls.path) this.controls.path = null;
        break;
    }
  }

  update_title(dt) {
    if (this.input.menu.back && this.screens.back()) this.audio.sfx('ui_back');
    const w = this.world;
    this.advanceSim(dt);
    if (w.ended) this.loadDemo();
  }

  update_confirm() {
    if (this.input.menu.back) { this.audio.sfx('ui_back'); this.setState('title'); }
  }

  update_brief() {
    if (this.input.menu.back || this.input.menu.start) { this.audio.sfx('ui_ok'); this.onAction('briefOk'); }
  }

  update_paused() {
    const input = this.input;
    if (input.menu.back || input.menu.start || input.pressed('pause')) {
      if (this.screens.top !== this.screens.modals.pause) { this.screens.back(); this.audio.sfx('ui_back'); }
      else this.setState('play');
    }
  }

  update_report() {
    if (this.input.menu.back && this.screens.top !== this.screens.modals.report) { this.screens.back(); this.audio.sfx('ui_back'); }
  }

  update_ending() {}

  /** 環境音：工場のうなり・ベルトの音（数に合わせて）・嵐の雨。 */
  _ambience(dt) {
    this.ambT = (this.ambT || 0) - dt;
    if (this.ambT > 0) return;
    this.ambT = 0.5;
    const w = this.world;
    const belts = Math.min(1, w.lists.belts.length / 45);
    const busy = this.state === 'title' ? 0.6 : w.running && !this.simPaused ? 1 : 0.35;
    this.audio.setAmbience({ hum: 0.7, belts: belts * busy, rain: w.storm ? 1 : 0, wind: w.storm ? 0.8 : 0.15 });
  }

  _tickSim(dt) {
    const w = this.world;
    const sp = this.simPaused || !w.running ? 0 : SPEEDS[this.speedI];
    this.advanceSim(dt * sp);
    this.analyzer.update(dt * sp);
    if (this.endT > 0 && (this.endT -= dt) <= 0) this._openReport();
  }

  update_play(dt) {
    const input = this.input, c = this.controls;
    // Esc：まず道具・選択・線引きをやめる。何もなければメニュー。Start ボタンはすぐメニュー
    if (input.menu.start || (input.pressed('pause') && !(input.keysPressed.has('Escape') && c.cancel()))) { this.setState('paused'); return; }
    if (input.pressed('back')) { if (c.cancel()) this.audio.sfx('ui_back'); }
    if (input.pressed('help')) { this.ui.toggleGuide(); this.audio.sfx('tool'); }
    if (input.pressed('simPause')) this.togglePause();
    if (input.pressed('speed')) this.cycleSpeed();
    if (input.pressed('analysis')) this.toggleAnalysis();
    c.update(dt);
    this._tickSim(dt);
  }

  update_inspect(dt) {
    const input = this.input;
    if (input.menu.back || !this.controls.selected) { this.controls.select(null); this.audio.sfx('ui_back'); this.setState('play'); return; }
    if (input.menu.start) { this.setState('paused'); return; }
    this._tickSim(dt);
  }

  _openReport() {
    this.endT = -1;
    const w = this.world, s = w.stats;
    const tot = s.delivered + s.mis;
    const acc = tot ? s.delivered / tot : 1;
    const ex = s.expOn + s.expLate;
    const pass = s.delivered >= w.quota;
    const stars = [pass, pass && acc >= 0.97 && (!ex || s.expOn / ex >= 0.85), pass && s.delivered >= Math.ceil(w.totalPkgs * 0.97)];
    if (pass) {
      const n = stars.filter(Boolean).length;
      const d = this.save.data;
      d.stars[w.day] = Math.max(d.stars[w.day] || 0, n);
      this.save.save();
    }
    this.report = { n: w.day, s, quota: w.quota, total: w.totalPkgs, stars, pass, cleared: s.unprocessed === 0, verdict: this.analyzer.verdict(s) };
    this._fillReport();
    this.controls.select(null);
    this.controls.setTool('select');
    this.ui.hideGuide();
    this.setState('report');
    this.ui.refresh();
    this.audio.sfx(pass ? 'clear' : 'fail');
  }

  _fillReport() {
    if (!this.report) return;
    const w = this.world;
    fillReport(this.screens, { ...this.report, money: w.money, upg: w.upg });
  }

  render(dt) {
    const w = this.world;
    const f = w.running || w.ended ? w.t / DAY_LEN : 0.04;
    // 嵐：空が暗くなり、ときどき稲光と雷の音
    this.stormK = damp(this.stormK || 0, w.storm ? 1 : 0, 1.2, dt);
    this.view.env.setTime(f, this.stormK);
    let flash = 0;
    if (w.storm && w.running && !this.simPaused && this.state === 'play') {
      this.boltT = (this.boltT ?? 3) - dt;
      if (this.boltT <= 0) { this.boltT = 4 + Math.random() * 6; this.bolt = 0.35; this.audio.sfx('thunder'); }
    }
    if (this.bolt > 0) { this.bolt -= dt; flash = Math.max(0, this.bolt / 0.35) * (Math.sin(this.bolt * 60) > -0.3 ? 0.55 : 0.15); }
    this.renderer.setFx({ flash, flashColor: '#e4ecff' });
    this.view.sync(dt, this.simDt || 0, this.rig);
    this.overlay.update(dt, this.state === 'play' || this.state === 'inspect' ? this.controls : null, w, this.analysis && (this.state === 'play' || this.state === 'inspect'));
    this.ui.update(dt);
    this.simDt = 0;
    this.renderer.render(dt);
    this.guide.render(dt);
  }

  snapshot() {
    const w = this.world;
    return {
      state: this.state, day: w.day, t: +w.t.toFixed(1), running: w.running, ended: w.ended, money: Math.round(w.money),
      delivered: w.stats.delivered, mis: w.stats.mis, quota: w.quota, total: w.totalPkgs, pkgs: w.packages.size,
      robots: w.robots.length, buildings: w.buildings.length, tool: this.controls.tool, cursor: [this.controls.cursor.x, this.controls.cursor.y],
      speed: this.simPaused ? 0 : SPEEDS[this.speedI], cam: [+this.rig.target.x.toFixed(2), +this.rig.target.z.toFixed(2), +this.rig.dist.toFixed(1)],
    };
  }
}
