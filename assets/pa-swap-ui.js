// ==========================================================================
// Paddle App — swap scorecards and small form pieces.
//
// Shared by the public board (swap.html) and the SWAP tab (pa-swap-tab.js),
// so an offer looks the same everywhere: run number, route, start, finish,
// pay, and what the poster wants in return — the paddle viewer's style.
// DOM only; no Firebase.
// ==========================================================================

import { fmtClock, dayLabel } from './pa-schedule.js';
import * as W from './pa-swap.js';

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function button(cls, text, onClick) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** A labelled input in the account form style. */
export function field(parent, label, attrs = {}) {
  const wrap = el('div', 'pa-field');
  wrap.appendChild(el('label', 'pa-label', label));
  const i = el(attrs.tag === 'select' ? 'select' : 'input', attrs.tag === 'select' ? 'pa-select' : 'pa-input');
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'tag' || k === 'options') return;
    if (k === 'value') i.value = v; else i.setAttribute(k, v);
  });
  (attrs.options || []).forEach(([v, t]) => { const o = el('option', null, t); o.value = v; i.appendChild(o); });
  if (attrs.tag === 'select' && attrs.value != null) i.value = attrs.value;
  wrap.appendChild(i);
  parent.appendChild(wrap);
  return i;
}

const BADGE = { green: 'FITS', red: 'NOT ELIGIBLE', yellow: 'CHECK', mine: 'YOURS' };

function stat(label, value, cls) {
  const s = el('div', 'stat');
  s.appendChild(el('div', 'k', label));
  s.appendChild(el('div', 'v' + (cls ? ' ' + cls : ''), value));
  return s;
}

/**
 * One offer, Paddle style.
 *   check  — checkOffer()'s answer (or guestCheck())
 *   opts.actions — nodes for the footer (e.g. the "I'm interested" button)
 *   opts.menu    — [[label, onClick], ...] behind the ⋯ button (report, block)
 *   opts.guest   — show the guest badge text
 */
export function scorecard(offer, check, opts = {}) {
  const g = offer.give || {};
  const c = check || W.guestCheck();
  const closed = offer.status && !['open', 'matched'].includes(offer.status);
  const card = el('div', 'sw-card ' + c.color + (closed ? ' closed' : ''));
  card.dataset.offer = offer.id || '';

  const top = el('div', 'sw-top');
  const run = el('div', 'sw-run'); run.appendChild(el('small', null, 'RUN')); run.appendChild(document.createTextNode(g.runNo || '?'));
  top.appendChild(run);
  top.appendChild(el('div', 'sw-when', W.fmtDay(g.date).toUpperCase() + ' · ' + dayLabel(g.dayType)));
  const badge = opts.guest ? 'SIGN IN TO CHECK' : (offer.status && offer.status !== 'open' && c.color !== 'mine')
    ? W.STATUS_LABELS[offer.status].toUpperCase() : BADGE[c.color];
  top.appendChild(el('span', 'sw-badge ' + c.color, badge));
  card.appendChild(top);
  card.appendChild(el('div', 'sw-head', W.headline(offer)));

  const chips = el('div', 'chips');
  chips.appendChild(el('span', 'chip amber', g.routeLabel || (g.routes || []).join(' / ') || 'Route ?'));
  const sh = W.shiftOf(g.reportMin);
  if (sh) chips.appendChild(el('span', 'chip' + (sh === 'night' ? ' violet' : ''), W.SHIFTS[sh]));
  if (g.swing) chips.appendChild(el('span', 'chip', 'Swing'));
  card.appendChild(chips);

  const stats = el('div', 'stats');
  stats.appendChild(stat('Start', fmtClock(g.reportMin)));
  stats.appendChild(stat('Finish', fmtClock(g.finishMin)));
  stats.appendChild(stat('Pay', g.payHours ? g.payHours.toFixed(2) + ' h' : '—', 'pay'));
  stats.appendChild(stat('Week of', W.fmtDay(offer.weekStart || W.weekOf(g.date)).slice(4)));
  card.appendChild(stats);

  const wants = el('div', 'sw-wants');
  wants.appendChild(el('span', 'k', 'Wants in return'));
  wants.appendChild(document.createTextNode(W.describeWants(offer)));
  card.appendChild(wants);

  const prefs = W.describePrefs(offer.prefs);
  if (prefs.length) {
    const p = el('div', 'sw-prefs');
    prefs.forEach(t => p.appendChild(el('span', null, t)));
    card.appendChild(p);
  }
  if (offer.prefs && offer.prefs.note) card.appendChild(el('div', 'sw-note', '“' + offer.prefs.note + '”'));
  if (c.reason && c.color !== 'mine') card.appendChild(el('div', 'sw-reason ' + c.color, c.reason));

  const foot = el('div', 'sw-foot');
  foot.appendChild(el('div', 'sw-by', 'Posted by ' + (offer.posterName || 'an operator') + (offer.depotLabel ? ' · ' + offer.depotLabel : '')));
  (opts.actions || []).forEach(n => foot.appendChild(n));
  let menu = null;
  if (opts.menu && opts.menu.length) {
    const more = button('sw-more', '⋯', () => { menu.hidden = !menu.hidden; });
    more.setAttribute('aria-label', 'More: report or block');
    foot.appendChild(more);
    menu = el('div', 'sw-menu'); menu.hidden = true;
    opts.menu.forEach(([label, fn]) => menu.appendChild(button('rowbtn', label, fn)));
  }
  card.appendChild(foot);
  if (menu) card.appendChild(menu);
  return card;
}

/** The report form, inline under a card. Resolves through onSend(reason, note). */
export function reportPanel(onSend, onCancel) {
  const p = el('div', 'sw-panel');
  p.appendChild(el('span', 'k', 'Report this offer'));
  const reason = field(p, 'Reason', { tag: 'select', options: Object.entries(W.REPORT_REASONS) });
  const note = field(p, 'Details (optional)', { maxlength: '280' });
  const msg = el('div', 'msgline');
  const acts = el('div', 'sw-acts');
  const send = button('pa-submit', 'Send report', async () => {
    send.disabled = true;
    try { await onSend(reason.value, note.value); msg.className = 'msgline ok'; msg.textContent = 'Thanks. An admin will look at it.'; setTimeout(onCancel, 1200); }
    catch (e) { send.disabled = false; msg.className = 'msgline err'; msg.textContent = e && e.code === 'permission-denied' ? 'You already reported this offer.' : 'Could not send. Try again.'; }
  });
  acts.append(send, button('pa-ghost', 'Cancel', onCancel));
  p.append(acts, msg);
  return p;
}

/** Contact links: tel: / mailto:. */
export function contactLine(c) {
  const box = el('div', 'sw-contact');
  if (!c || (!c.phone && !c.email)) { box.textContent = 'No contact left yet.'; return box; }
  if (c.phone) { const a = el('a', null, c.phone); a.href = 'tel:' + c.phone.replace(/[^\d+]/g, ''); box.appendChild(a); }
  if (c.phone && c.email) box.appendChild(document.createTextNode(' · '));
  if (c.email) { const a = el('a', null, c.email); a.href = 'mailto:' + c.email; box.appendChild(a); }
  return box;
}

/** Inline phone / email entry; returns { node, value() }. */
export function contactFields(parent, initial, label) {
  const p = el('div', 'sw-panel');
  p.appendChild(el('span', 'k', label || 'How should they reach you?'));
  const row = el('div', 'sw-row');
  const phone = field(row, 'Phone', { type: 'tel', autocomplete: 'tel', maxlength: '30', value: initial.phone || '' });
  const email = field(row, 'Email', { type: 'email', autocomplete: 'email', maxlength: '120', value: initial.email || '' });
  p.appendChild(row);
  p.appendChild(el('div', 'hint', 'Shared only with the one person matched with you.'));
  parent.appendChild(p);
  return { node: p, value: () => ({ phone: phone.value.trim(), email: email.value.trim() }) };
}
