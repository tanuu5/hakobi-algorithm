// 日の説明・日報・確認・エンディングの画面（Screens.addModal で足す）。中のボタンは data-act（Game.onAction が受ける）。
import { t } from '../../core/i18n.js';
import { ICONS, destIcon } from './icons.js';
import { DESTS, UPGRADES, EXP_TIME, DEFS, ROBOT_COST } from '../sim/consts.js';
import { CAMPAIGN_DAYS } from '../sim/days.js';
import { yen } from './GameUI.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tt = (k, v) => esc(t(k, v));

export function addPanels(screens) {
  screens.addModal('brief', `<section id="m-brief" class="modal hidden"><div class="card wide brief" data-scroll></div></section>`);
  screens.addModal('report', `<section id="m-report" class="modal hidden"><div class="card wide report" data-scroll></div></section>`);
  screens.addModal('confirm', `<section id="m-confirm" class="modal hidden"><div class="card"><h2 data-i18n="confirm.title">${tt('confirm.title')}</h2><p data-i18n="confirm.body">${tt('confirm.body')}</p>
    <button data-act="confirmNew" data-i18n="confirm.yes">${tt('confirm.yes')}</button><button data-act="back" data-i18n="ui.back">${tt('ui.back')}</button></div></section>`);
  screens.addModal('ending', `<section id="m-ending" class="modal hidden"><div class="card wide ending" data-scroll></div></section>`);
}

const boss = (text) => `<div class="msg boss"><span class="av">${ICONS.boss}</span><p><b>${tt('ui.boss')}</b>${esc(text)}</p></div>`;
const ai = (text) => `<div class="msg ai"><span class="av">${ICONS.ai}</span><p><b>HAKOBI</b>${esc(text)}</p></div>`;

/** 日の説明。info：{ n, def, total, quota, grant, newTools } */
export function fillBrief(screens, info) {
  const { n, def, total, quota, grant, guide } = info;
  const story = n <= CAMPAIGN_DAYS ? n : 'x';
  const news = [];
  for (const k of def.news || []) news.push(`<li><span class="ni">${newsIcon(k)}</span><span>${esc(t('news.' + k, { s: EXP_TIME }))}</span></li>`);
  // 新しい道具（1 日目は、最初に使うものだけ）
  const tools = n === 1 ? ['belt', 'shelf', 'charger'] : (def.newTools || []);
  for (const tool of tools) news.push(`<li><span class="ni">${ICONS[tool]}</span><span><b>${tt('tool.' + tool)}</b>${tt('desc.' + tool)}</span></li>`);
  const dests = def.dests.map((d) => `<span class="dchip" style="--c:${DESTS[d].color}">${destIcon(d, DESTS[d].color)}${DESTS[d].key}</span>`).join('');
  const html = `
    <div class="b-head"><span class="b-day">${tt(n > CAMPAIGN_DAYS ? 'hud.dayOver' : 'hud.day', { n })}</span><h2>${tt('brief.title.' + story, { n })}</h2></div>
    <div class="chat">${boss(t('brief.boss.' + story, { s: EXP_TIME }))}${ai(t('brief.ai.' + story))}</div>
    ${guide ? `<div class="brief-guide"><div class="gview"></div><p class="gcap"><b>${tt('guide.howtoLabel')}</b>${tt('guide.' + guide)}</p></div>` : ''}
    ${news.length ? `<h3>${tt('brief.new')}</h3><ul class="news">${news.join('')}</ul>` : ''}
    <div class="goal">
      <div><span>${tt('brief.dests')}</span><span class="dchips">${dests}</span></div>
      <div><span>${tt('brief.total')}</span><b>${total}</b></div>
      <div><span>${tt('brief.quota')}</span><b class="q">${quota}</b></div>
      ${grant ? `<div><span>${tt('brief.grant')}</span><b class="plus">+${yen(grant)}</b></div>` : ''}
    </div>
    <p class="tip">${tt('brief.tip.' + story)}</p>
    <button data-act="briefOk" class="primary">${tt('brief.ok')}</button>`;
  screens.modals.brief.querySelector('.card').innerHTML = html;
}

function newsIcon(k) {
  if (k === 'destC') return destIcon(2, DESTS[2].color);
  if (k === 'destD') return destIcon(3, DESTS[3].color);
  if (k === 'express') return `<span class="expmark">!</span>`;
  if (k === 'unknown') return `<span class="unkmark">?</span>`;
  if (k === 'storm') return ICONS.bolt;
  if (k === 'rush') return ICONS.truck;
  if (k.startsWith('dock')) return ICONS.truck;
  if (k.startsWith('zone')) return ICONS.box;
  if (k === 'robots') return ICONS.robot;
  return ICONS.ai;
}

/** 日報。r：{ n, s(stats), quota, total, stars:[b1,b2,b3], pass, verdict, money, upg, perfDay, best, last } */
export function fillReport(screens, r) {
  const s = r.s;
  const tot = s.delivered + s.mis;
  const acc = tot ? Math.floor((s.delivered / tot) * 100) : 100;
  const ex = s.expOn + s.expLate;
  const lead = s.leadN ? (s.lead / s.leadN).toFixed(1) : '—';
  const profit = s.revenue - s.opex;
  const pct = Math.min(100, (s.delivered / Math.max(1, r.quota)) * 100);
  const star = (on, key, vars) => `<li class="${on ? 'on' : ''}"><span class="st">${ICONS.star}</span><span>${tt(key, vars)}</span></li>`;
  const util = s.robotT ? Math.round((s.robotBusy / s.robotT) * 100) + '%' : '—';
  const rows = [
    ['rp.delivered', `${s.delivered} / ${r.total}`],
    ['rp.mis', s.mis, s.mis > 0 ? 'bad' : ''],
    ['rp.acc', acc + '%', acc < 97 ? 'bad' : ''],
    ...(ex ? [['rp.exp', `${s.expOn} / ${ex}`, s.expLate > s.expOn * 0.2 ? 'bad' : '']] : []),
    ['rp.lead', t('rp.sec', { n: lead })],
    ['rp.left', s.unprocessed, s.unprocessed > 0 ? 'warn' : ''],
    ['rp.util', util],
    ['rp.revenue', yen(s.revenue)],
    ['rp.opex', '-' + yen(s.opex).replace('¥', '¥')],
    ['rp.profit', yen(profit), profit < 0 ? 'bad' : 'good'],
  ];
  const ups = r.pass ? Object.entries(UPGRADES).map(([k, U]) => {
    const lv = r.upg[k] || 0;
    const max = lv >= U.costs.length;
    const cost = max ? 0 : U.costs[lv];
    const can = !max && r.money >= cost;
    return `<div class="up ${max ? 'max' : ''}"><div class="un"><b>${tt('upg.' + k)}</b><small>${tt('upgd.' + k)}</small></div>
      <span class="lv">${'●'.repeat(lv)}${'○'.repeat(U.costs.length - lv)}</span>
      <button data-act="buy" data-k="${k}" ${can ? '' : 'disabled'}>${max ? tt('upg.max') : yen(cost)}</button></div>`;
  }).join('') : '';
  const html = `
    <h2>${tt('rp.title', { n: r.n })}</h2>
    <p class="rp-result ${r.pass ? 'pass' : 'fail'}">${tt(r.pass ? (r.cleared ? 'rp.cleared' : 'rp.pass') : 'rp.fail')}</p>
    <div class="rp-bar"><i style="width:${pct}%"></i><span>${s.delivered} / ${r.quota}</span></div>
    <ul class="stars">${star(r.stars[0], 'rp.star1', { q: r.quota })}${star(r.stars[1], 'rp.star2')}${star(r.stars[2], 'rp.star3')}</ul>
    <table class="rp-stats">${rows.map(([k, v, c]) => `<tr class="${c || ''}"><th>${tt(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
    ${ai(t(r.verdict))}
    ${boss(t(r.pass ? 'rp.bossPass.' + (r.n % 4) : 'rp.bossFail'))}
    ${r.pass ? `<div class="upgrades"><h3>${tt('upg.title')} <span class="money">${tt('upg.money', { m: yen(r.money) })}</span></h3>${ups}</div>` : ''}
    <div class="rp-btns">
      ${r.pass ? `<button data-act="nextDay" class="primary">${tt('rp.next')}</button>` : ''}
      <button data-act="retryKeep">${tt('rp.retryKeep')}</button>
      <button data-act="retryStart">${tt('rp.retryStart')}</button>
    </div>`;
  const card = screens.modals.report.querySelector('.card');
  const sc = card.scrollTop;
  card.innerHTML = html;
  card.scrollTop = sc;
}

export function fillEnding(screens, info) {
  const html = `
    <h2>${tt('end.title')}</h2>
    <div class="chat">${boss(t('end.boss'))}${ai(t('end.ai'))}</div>
    <p class="end-stars">${ICONS.star}<b>${info.stars}</b> / ${info.max}</p>
    <p class="tip">${tt('end.more')}</p>
    <button data-act="overtime" class="primary">${tt('end.go')}</button>
    <button data-act="toTitle">${tt('pause.toTitle')}</button>`;
  screens.modals.ending.querySelector('.card').innerHTML = html;
}
