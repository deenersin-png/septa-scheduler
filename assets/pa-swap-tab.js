// ==========================================================================
// Paddle App — the SWAP tab (home.html, fourth tab after Today, Schedule
// and Alerts).
//
//   BOARD       offers in a district (the user's own by default), each
//               checked against the user's own week: green fits, red not
//               eligible with the reason, yellow no run on record for a day
//               that decides it — enter it, and it is checked again
//   MY OFFERS   what I posted, who is interested, pick one, contact, arranged
//   INTERESTED  offers I said "I'm interested" in, and where they stand
//   + NEW OFFER the four-question guided flow
//
// The app only connects operators. Nothing here approves a swap; "arranged"
// always comes with the reminder that the dispatcher must approve it.
//
// The database is passed in (deps.store, default pa-swap-store.js) so the
// screens can be driven against a stand-in without Firebase.
// ==========================================================================

import * as S from './pa-schedule.js';
import * as A from './pa-assignments.js';
import * as E from './pa-edit-sheet.js';
import * as W from './pa-swap.js';
import * as U from './pa-swap-ui.js';
import * as realStore from './pa-swap-store.js';

const { el, button, field } = U;

export const PENDING_KEY = 'pa_swap_pending';
const MANUAL_PREFIX = 'pa_swap_manual_v1_';
const NAME_KEY = 'pa_swap_name';
const PUSH_KEY = 'pa_swap_push';
const LOAD_MS = 15000;

const withTimeout = (p, ms = LOAD_MS) => Promise.race([p, new Promise((_, rej) =>
  setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms))]);

const errText = e => (e && e.code === 'timeout') ? 'No answer from the server. Check your signal and try again.'
  : (e && e.code === 'permission-denied') ? 'The server refused that (permission denied).'
  : 'Something went wrong. Try again.';

export function mount(root, deps) {
  const store = deps.store || realStore;
  const st = {
    view: 'board', district: '', districts: [], seasons: [], blocks: new Map(),
    interestedIds: new Set(), pending: null, wizard: null, token: 0
  };

  const user = () => deps.getUser();
  const profile = () => deps.getProfile() || {};
  const overrides = () => (deps.getOverrides && deps.getOverrides()) || {};
  const today = () => S.todayIso();
  const uid = () => (user() ? user().uid : null);

  // ---- the operator's own week ------------------------------------------

  const manualKey = () => MANUAL_PREFIX + uid();
  function manual() { try { return JSON.parse(localStorage.getItem(manualKey()) || '{}'); } catch (_) { return {}; } }
  function setManual(date, v) {
    const m = manual();
    if (v) m[date] = v; else delete m[date];
    // Keep only days still to come.
    Object.keys(m).forEach(d => { if (d < W.weekOf(today())) delete m[d]; });
    try { localStorage.setItem(manualKey(), JSON.stringify(m)); } catch (_) {}
  }

  function myName() {
    let saved = '';
    try { saved = localStorage.getItem(NAME_KEY) || ''; } catch (_) {}
    return saved || profile().displayName || (user() && user().displayName) || '';
  }
  function rememberName(n) { try { localStorage.setItem(NAME_KEY, n); } catch (_) {} }

  async function lookupCard(date, runNo) {
    const { slug } = await E.slugForDate(profile().depotKey, date);
    if (!slug) return null;
    const run = await S.getRun(slug, S.dayTypeFor(date, overrides()), String(runNo).trim());
    return run ? W.runCard(run, date) : null;
  }

  const bareCard = (date, runNo, dayType) => ({ date, dayType: dayType || '', runNo: String(runNo), routeLabel: '', routes: [],
    owl: false, reportMin: null, finishMin: null, payHours: 0, swing: false });

  /** { known, card, away, manual } for one date. */
  async function dayInfo(date) {
    const m = manual()[date];
    if (m) {
      if (m.off) return { known: true, card: null, manual: true };
      let c = null; try { c = await lookupCard(date, m.runNo); } catch (_) {}
      return { known: true, card: c || bareCard(date, m.runNo), manual: true };
    }
    const r = A.resolve(date, overrides());
    if (r.unregistered) return { known: false, card: null };
    if (r.status === 'vacation') return { known: true, card: null, away: true };
    if (r.off || !r.runNo) return { known: true, card: null };
    let run = null; try { run = await E.runFor(r, date, profile().depotKey); } catch (_) {}
    return { known: true, card: W.runCard(run, date) || bareCard(date, r.runNo, r.dayType) };
  }

  async function daysFor(dates) {
    const all = [...new Set(dates.flatMap(d => [S.addDays(d, -1), d, S.addDays(d, 1)]))];
    const infos = await Promise.all(all.map(d => dayInfo(d).catch(() => ({ known: false, card: null }))));
    return new Map(all.map((d, i) => [d, infos[i]]));
  }

  async function meFor(offers) {
    const days = await daysFor(offers.flatMap(W.offerDates));
    const myKey = await myDistrictKey();
    return {
      uid: uid(), depotKey: myKey,
      seasonFor: d => { const s = S.seasonFor(st.seasons, d); return s ? s.id : null; },
      day: d => days.get(d) || { known: false, card: null }
    };
  }

  async function myDistrictKey() {
    try { const r = await E.slugForDate(profile().depotKey, today()); if (r && r.slug) return S.depotKeyOf(r.slug); } catch (_) {}
    return profile().depotKey || '';
  }

  async function loadDistricts() {
    if (st.districts.length) return;
    st.seasons = await S.loadSeasons();
    const season = S.seasonFor(st.seasons, today());
    const list = season ? await S.loadManifest(season) : [];
    st.districts = list.map(d => ({ key: S.depotKeyOf(d.name), label: d.label }));
    if (!st.district) {
      const mine = await myDistrictKey();
      st.district = (st.districts.find(d => W.sameDepot(d.key, mine)) || st.districts[0] || {}).key || mine;
    }
  }

  // ---- frame ---------------------------------------------------------------

  let counts = { mine: 0, interested: 0 };
  const segCounts = {};

  function drawCounts() {
    Object.entries(segCounts).forEach(([v, span]) => { const n = counts[v] || 0; span.hidden = !n; span.textContent = String(n); });
  }

  function frame() {
    root.innerHTML = '';
    const seg = el('div', 'sw-seg');
    [['board', 'BOARD'], ['mine', 'MY OFFERS'], ['interested', 'INTERESTED']].forEach(([v, t]) => {
      const b = button(st.view === v ? 'on' : '', t, () => go(v));
      if (v !== 'board') { segCounts[v] = el('span', 'n'); b.appendChild(segCounts[v]); }
      seg.appendChild(b);
    });
    drawCounts();
    root.appendChild(seg);
    const body = el('div');
    root.appendChild(body);
    return body;
  }

  function loading(body, text) { body.innerHTML = ''; body.appendChild(el('div', 'sw-empty', text || 'Loading…')); }
  function failed(body, e, retry) {
    body.innerHTML = '';
    const box = el('div', 'sw-empty', errText(e));
    const b = button('pa-ghost', 'Try again', retry); b.style.marginTop = '12px';
    box.appendChild(b);
    body.appendChild(box);
  }

  function go(v, opts = {}) {
    st.view = v;
    if (v !== 'new') st.wizard = null;
    const t = ++st.token;
    const live = () => t === st.token;
    if (v === 'board') return renderBoard(live, opts);
    if (v === 'mine') return renderMine(live);
    if (v === 'interested') return renderInterested(live);
    if (v === 'new') return renderWizard(opts.offer || null);
  }

  // ---- BOARD ---------------------------------------------------------------

  async function renderBoard(live) {
    const body = frame();
    const bar = el('div', 'sw-bar');
    body.appendChild(bar);
    const list = el('div');
    body.appendChild(list);
    loading(list, 'Loading offers…');
    try {
      await withTimeout(loadDistricts());
    } catch (e) { if (live()) failed(list, e, () => go('board')); return; }
    if (!live()) return;

    const sel = field(bar, 'District', { tag: 'select', options: st.districts.map(d => [d.key, d.label]), value: st.district });
    sel.addEventListener('change', () => { st.district = sel.value; go('board'); });
    bar.appendChild(button('pa-submit', '+ New offer', () => go('new')));

    let offers, me, extra = null;
    try {
      const [o, blocks, interested] = await withTimeout(Promise.all([
        store.listBoard(st.district, today()),
        store.listBlocks(uid()).catch(() => new Map()),
        store.interestedOffers(uid()).catch(() => [])
      ]));
      offers = o; st.blocks = blocks;
      st.interestedIds = new Set(interested.map(r => r.offer.id));
      // The offer a guest tapped on the public board, carried through sign-up.
      if (st.pending && !offers.some(x => x.id === st.pending)) {
        extra = await store.getOffer(st.pending).catch(() => null);
      }
      me = await meFor(extra ? [extra, ...offers] : offers);
    } catch (e) { if (live()) failed(list, e, () => go('board')); return; }
    if (!live()) return;

    list.innerHTML = '';
    let opened = null;
    if (st.pending) {
      opened = extra || offers.find(x => x.id === st.pending) || null;
      try { localStorage.removeItem(PENDING_KEY); } catch (_) {}
      st.pending = null;
    }
    if (opened) {
      list.appendChild(el('div', 'sw-sub', 'The offer you opened'));
      list.appendChild(offerCard(opened, me, true));
    }
    const shown = offers.filter(o => !st.blocks.has(o.posterUid) && (!opened || o.id !== opened.id));
    if (opened && shown.length) list.appendChild(el('div', 'sw-sub', 'All open offers'));
    if (!shown.length && !opened) {
      list.appendChild(el('div', 'sw-empty', 'No open offers in this district yet. Post one with + New offer.'));
    }
    shown.forEach(o => list.appendChild(offerCard(o, me, false)));
  }

  function offerCard(o, me, highlight) {
    const check = W.checkOffer(o, me, today());
    const actions = [];
    let card;
    const menu = check.color === 'mine' ? null : [
      ['Report', () => { const p = card.querySelector('.sw-panel'); if (p) p.remove(); card.appendChild(U.reportPanel(
        (reason, note) => store.reportOffer(o.id, uid(), reason, note), () => { const x = card.querySelector('.sw-panel'); if (x) x.remove(); })); }],
      ['Block ' + (o.posterName || 'poster'), async () => {
        if (!confirm('Hide every offer from ' + (o.posterName || 'this operator') + '? You can undo this in My Offers.')) return;
        await store.block(uid(), o.posterUid, o.posterName).catch(() => {});
        go('board');
      }]
    ];
    if (check.color === 'mine') {
      actions.push(button('pa-ghost', 'Manage', () => go('mine')));
    } else if (st.interestedIds.has(o.id)) {
      const b = button('pa-ghost', 'Interest sent ✓', () => go('interested'));
      actions.push(b);
    } else if (check.color === 'green') {
      actions.push(button('pa-submit', 'I’m interested', () => interestPanel(card, o, check)));
    } else if (check.color === 'yellow') {
      // The run entry below opens by itself; interest waits for the recheck.
      const b = button('pa-ghost', 'Check first'); b.disabled = true; actions.push(b);
    } else {
      const b = button('pa-ghost', 'Not eligible'); b.disabled = true; actions.push(b);
    }
    card = U.scorecard(o, check, { actions, menu });
    if (highlight) card.style.boxShadow = '0 0 0 1px rgba(245,166,35,.45)';
    if (check.color === 'yellow') manualPanel(card, check.needs);
    else if (check.color !== 'mine') entryLine(card, o);
    return card;
  }

  // Days of this offer the operator typed in by hand, as one line with a
  // way to change them. Without it a mistyped run could never be fixed.
  function entryLine(card, o) {
    const m = manual();
    const dates = [...new Set(W.offerDates(o).flatMap(d => [S.addDays(d, -1), d, S.addDays(d, 1)]))].filter(d => m[d]).sort();
    if (!dates.length) return;
    const line = el('div', 'sw-status');
    line.append('You entered: ' + dates.map(d => W.shortDay(d) + ' ' + (m[d].off ? 'off' : 'run ' + m[d].runNo)).join(', ') + ' ');
    line.appendChild(button('rowbtn', 'Change', () => { line.remove(); manualPanel(card, dates, true); }));
    card.appendChild(line);
  }

  // Yellow: ask which run they hold (or that they are off), then check again.
  // `editing` reopens days already entered, with a way back to the schedule.
  function manualPanel(card, needs, editing) {
    const old = card.querySelector('.sw-panel.manual');
    if (old) return;
    const m = manual();
    const p = el('div', 'sw-panel manual');
    p.appendChild(el('span', 'k', editing ? 'Change what you entered' : 'Your run that day'));
    p.appendChild(el('div', 'hint', editing
      ? 'Fix the run number, mark the day off, or clear it to go back to your schedule.'
      : 'Your schedule has nothing for ' + needs.map(W.longDay).join(' or ') + '. Enter the run you hold (or say you\'re off) and the offer is checked again. This stays on this phone and does not change your schedule.'));
    for (const d of needs) {
      const row = el('div', 'sw-row');
      const inp = field(row, W.longDay(d) + ' ' + W.fmtDay(d).slice(4) + ' run #', { inputmode: 'numeric', maxlength: '8', placeholder: 'e.g. 209', value: (m[d] && m[d].runNo) || '' });
      const msg = el('div', 'msgline');
      row.appendChild(button('pa-ghost', 'Check', async () => {
        const v = inp.value.trim();
        if (!v) { msg.className = 'msgline err'; msg.textContent = 'Enter a run number.'; return; }
        msg.className = 'msgline'; msg.textContent = 'Looking it up…';
        let c = null; try { c = await lookupCard(d, v); } catch (_) {}
        if (!c) { msg.className = 'msgline err'; msg.textContent = 'Run ' + v + ' is not in the ' + W.longDay(d) + ' paddle for your district.'; return; }
        setManual(d, { runNo: v });
        go(st.view);
      }));
      row.appendChild(button('pa-ghost', 'I\'m off', () => { setManual(d, { off: true }); go(st.view); }));
      if (m[d]) row.appendChild(button('pa-ghost', 'Clear', () => { setManual(d, null); go(st.view); }));
      p.append(row, msg);
    }
    if (editing) {
      const acts = el('div', 'sw-acts');
      acts.appendChild(button('pa-ghost', 'Close', () => go(st.view)));
      p.appendChild(acts);
    }
    card.appendChild(p);
  }

  function interestPanel(card, o, check) {
    const old = card.querySelector('.sw-panel');
    if (old) { old.remove(); return; }
    const p = el('div', 'sw-panel');
    const mine = check.myCard;
    const w = o.wants[check.want];
    p.appendChild(el('span', 'k', 'The swap'));
    const line = el('div', 'sw-pick');
    line.innerHTML = '';
    line.append('You take ', strong('run ' + o.give.runNo), ' on ' + W.longDay(o.give.date) + '. ');
    line.append((o.posterName || 'The poster') + ' takes your ', strong('run ' + mine.runNo),
      ' on ' + W.longDay(w.type === 'day' ? w.date : o.give.date)
      + (mine.reportMin != null ? ' (' + S.fmtClock(mine.reportMin) + '–' + S.fmtClock(mine.finishMin) + ')' : '') + '.');
    p.appendChild(line);
    const name = field(p, 'Your name on the board', { maxlength: '60', value: myName(), autocomplete: 'name' });
    const contact = U.contactFields(p, realStore.lastContact(), 'How should ' + (o.posterName || 'the poster') + ' reach you?');
    const note = field(p, 'Message (optional)', { maxlength: '140' });
    const msg = el('div', 'msgline');
    const acts = el('div', 'sw-acts');
    const send = button('pa-submit', 'Send interest', async () => {
      const c = contact.value(), n = name.value.trim();
      if (!n) { msg.className = 'msgline err'; msg.textContent = 'Enter the name to show the poster.'; return; }
      if (!c.phone && !c.email) { msg.className = 'msgline err'; msg.textContent = 'Leave a phone number or an email, so they can reach you if they pick you.'; return; }
      send.disabled = true; msg.className = 'msgline'; msg.textContent = 'Sending…';
      try {
        await withTimeout(store.saveContact(o.id, uid(), { name: n, ...c }));
        await withTimeout(store.expressInterest(o.id, uid(), {
          name: n, run: mine, wantIndex: check.want, color: 'green', reason: check.reason || '', note: note.value.trim().slice(0, 140)
        }));
        rememberName(n); realStore.rememberContact(c);
        msg.className = 'msgline ok'; msg.textContent = 'Sent. ' + (o.posterName || 'The poster') + ' will see it and can pick you.';
        st.interestedIds.add(o.id);
        setTimeout(() => go('interested'), 900);
      } catch (e) { send.disabled = false; msg.className = 'msgline err'; msg.textContent = errText(e); }
    });
    acts.append(send, button('pa-ghost', 'Cancel', () => p.remove()));
    p.append(acts, msg);
    card.appendChild(p);
  }

  const strong = t => el('b', null, t);

  // ---- MY OFFERS -----------------------------------------------------------

  async function renderMine(live) {
    const body = frame();
    const top = el('div', 'sw-bar');
    top.appendChild(button('pa-submit', '+ New offer', () => go('new')));
    body.appendChild(top);
    pushLine(body);
    const list = el('div');
    body.appendChild(list);
    loading(list, 'Loading your offers…');
    let rows;
    try {
      const [offers, blocks] = await withTimeout(Promise.all([store.myOffers(uid()), store.listBlocks(uid()).catch(() => new Map())]));
      st.blocks = blocks;
      rows = await withTimeout(Promise.all(offers.map(async o => ({
        o,
        interest: ['open', 'matched', 'arranged'].includes(o.status) ? await store.listInterest(o.id).catch(() => []) : [],
        contact: ['matched', 'arranged'].includes(o.status) && o.matchedUid ? await store.readContact(o.id, o.matchedUid) : null
      }))));
    } catch (e) { if (live()) failed(list, e, () => go('mine')); return; }
    if (!live()) return;
    list.innerHTML = '';
    const t = today();
    const current = rows.filter(r => !W.isExpired(r.o, t) || r.o.status === 'arranged');
    if (!current.length) list.appendChild(el('div', 'sw-empty', 'You have no offers. Tap + New offer to post one.'));
    current.forEach(r => list.appendChild(mineCard(r)));
    blocksSection(list);
    setCounts({ mine: rows.reduce((n, r) => n + (r.o.status === 'open' ? r.interest.filter(i => !st.blocks.has(i.uid)).length : 0), 0) });
  }

  function mineCard({ o, interest, contact }) {
    const actions = [];
    const st_ = o.status;
    if (st_ === 'open') {
      actions.push(button('pa-ghost', 'Edit', () => go('new', { offer: o })));
      actions.push(button('pa-ghost pa-danger', 'Cancel', async () => {
        if (!confirm('Cancel this offer? It comes off the board.')) return;
        await store.cancelOffer(o.id).catch(e => alert(errText(e))); go('mine');
      }));
    } else if (st_ === 'cancelled' || st_ === 'hidden') {
      actions.push(button('pa-ghost', 'Delete', async () => { await store.deleteOffer(o.id).catch(e => alert(errText(e))); go('mine'); }));
    }
    const card = U.scorecard(o, { color: 'mine', reason: '' }, { actions });
    const box = el('div', 'sw-status');
    if (st_ === 'hidden') box.textContent = 'Hidden after reports from other operators. An admin will review it.';
    if (st_ === 'cancelled') box.textContent = 'Cancelled.';
    card.appendChild(box);

    if (st_ === 'open') {
      const people = interest.filter(i => !st.blocks.has(i.uid));
      box.textContent = people.length ? people.length + ' interested. Pick one to share contact details.' : 'On the board. Nobody interested yet.';
      people.forEach(i => card.appendChild(interestRow(o, i)));
    }
    if (st_ === 'matched' || st_ === 'arranged') {
      box.innerHTML = '';
      box.append(st_ === 'matched' ? 'Talking with ' : 'Arranged with ', strong(o.matchedName || 'operator'), '. ');
      const mi = interest.find(i => i.uid === o.matchedUid);
      if (mi && mi.run) box.append('They give run ' + mi.run.runNo + ' on ' + W.longDay(mi.run.date) + '. ');
      box.appendChild(U.contactLine(contact));
      card.appendChild(remind());
      const acts = el('div', 'sw-acts');
      if (st_ === 'matched') {
        acts.appendChild(button('pa-submit', 'Mark arranged', () => arrangedConfirm(card, o)));
        acts.appendChild(button('pa-ghost', 'Back to board', async () => {
          if (!confirm('Stop talking with ' + (o.matchedName || 'them') + ' and put the offer back on the board?')) return;
          await store.unpick(o.id).catch(e => alert(errText(e))); go('mine');
        }));
      }
      acts.appendChild(button('pa-ghost', 'Delete', async () => {
        if (!confirm('Delete this offer from your list?')) return;
        await store.deleteOffer(o.id).catch(e => alert(errText(e))); go('mine');
      }));
      card.appendChild(acts);
    }
    return card;
  }

  function interestRow(o, i) {
    const row = el('div', 'sw-int');
    row.appendChild(el('span', 'sw-dot ' + (i.color || '')));
    const who = el('div');
    who.appendChild(el('span', 'who', i.name || 'Operator'));
    const r = i.run;
    who.appendChild(el('small', null, r
      ? 'Gives ' + W.shortDay(r.date) + ' run ' + r.runNo + (r.routeLabel ? ' · ' + r.routeLabel : '')
        + (r.reportMin != null ? ' · ' + S.fmtClock(r.reportMin) + '–' + S.fmtClock(r.finishMin) : '') + (r.payHours ? ' · ' + r.payHours.toFixed(2) + ' h' : '')
      : 'No run given'));
    if (i.note) who.appendChild(el('small', null, '“' + i.note + '”'));
    row.appendChild(who);
    const acts = el('div', 'sw-acts'); acts.style.marginTop = '0';
    acts.appendChild(button('rowbtn', 'Pick', () => pickPanel(row, o, i)));
    acts.appendChild(button('rowbtn rm', 'Dismiss', async () => { await store.dismissInterest(o.id, i.uid).catch(() => {}); go('mine'); }));
    acts.appendChild(button('rowbtn rm', 'Block', async () => {
      if (!confirm('Block ' + (i.name || 'this operator') + '? Their interest and offers will be hidden from you.')) return;
      await store.block(uid(), i.uid, i.name).catch(() => {}); go('mine');
    }));
    row.appendChild(acts);
    return row;
  }

  function pickPanel(row, o, i) {
    const next = row.nextElementSibling;
    if (next && next.classList.contains('sw-panel')) { next.remove(); return; }
    const p = el('div', 'sw-panel');
    p.appendChild(el('div', 'hint', 'Picking ' + (i.name || 'them') + ' takes the offer off the board and shares contact details between just the two of you.'));
    const name = field(p, 'Your name', { maxlength: '60', value: myName() });
    const contact = U.contactFields(p, realStore.lastContact(), 'How should ' + (i.name || 'they') + ' reach you?');
    const msg = el('div', 'msgline');
    const acts = el('div', 'sw-acts');
    const ok = button('pa-submit', 'Pick ' + (i.name || 'them'), async () => {
      const c = contact.value();
      if (!c.phone && !c.email) { msg.className = 'msgline err'; msg.textContent = 'Leave a phone number or an email.'; return; }
      ok.disabled = true;
      try {
        await withTimeout(store.saveContact(o.id, uid(), { name: name.value.trim() || myName(), ...c }));
        await withTimeout(store.pickInterested(o.id, { uid: i.uid, name: i.name || 'Operator' }));
        realStore.rememberContact(c); rememberName(name.value.trim());
        go('mine');
      } catch (e) { ok.disabled = false; msg.className = 'msgline err'; msg.textContent = errText(e); }
    });
    acts.append(ok, button('pa-ghost', 'Cancel', () => p.remove()));
    p.append(acts, msg);
    row.after(p);
  }

  const remind = () => el('div', 'sw-remind', W.DISPATCH_REMINDER);

  function arrangedConfirm(card, o) {
    const old = card.querySelector('.sw-panel.arr');
    if (old) { old.remove(); return; }
    const p = el('div', 'sw-panel arr');
    p.appendChild(el('div', 'sw-remind', 'Have you both agreed? ' + W.DISPATCH_REMINDER + ' Go to the dispatcher together, or as your depot requires.'));
    const acts = el('div', 'sw-acts');
    acts.append(button('pa-submit', 'Yes, mark arranged', async () => {
      try { await withTimeout(store.markArranged(o.id, uid())); go(st.view); } catch (e) { alert(errText(e)); }
    }), button('pa-ghost', 'Not yet', () => p.remove()));
    p.appendChild(acts);
    card.appendChild(p);
  }

  function blocksSection(list) {
    if (!st.blocks.size) return;
    const box = el('div', 'card sect');
    box.appendChild(el('h2', 'k', 'Blocked'));
    st.blocks.forEach((name, other) => {
      const r = el('div', 'win');
      r.appendChild(el('div', 'win-d', name || 'Operator'));
      r.appendChild(button('rowbtn', 'Unblock', async () => { await store.unblock(uid(), other).catch(() => {}); go(st.view); }));
      box.appendChild(r);
    });
    list.appendChild(box);
  }

  function pushLine(body) {
    let done = false;
    try { done = localStorage.getItem(PUSH_KEY) === '1'; } catch (_) {}
    if (done) return;
    const line = el('div', 'hint');
    line.style.margin = '0 0 12px';
    if (!store.pushConfigured()) {
      line.textContent = 'Phone alerts for swaps are not switched on yet. Check this tab for new interest.';
      body.appendChild(line);
      return;
    }
    const b = button('pa-ghost', 'Get swap alerts on this phone', async () => {
      b.disabled = true;
      const r = await store.registerPush(uid()).catch(() => ({ ok: false, reason: 'error' }));
      if (r.ok) { try { localStorage.setItem(PUSH_KEY, '1'); } catch (_) {} line.textContent = 'Swap alerts are on for this phone.'; b.remove(); }
      else { b.disabled = false; line.textContent = r.reason === 'denied' ? 'Notifications are blocked for this site in your browser settings.' : 'This browser cannot get alerts. On iPhone, add the app to your Home Screen first.'; }
    });
    body.append(b, line);
  }

  // ---- INTERESTED ----------------------------------------------------------

  async function renderInterested(live) {
    const body = frame();
    const list = el('div');
    body.appendChild(list);
    loading(list, 'Loading…');
    let rows;
    try {
      rows = await withTimeout(store.interestedOffers(uid()));
      rows = await withTimeout(Promise.all(rows.map(async r => ({
        ...r,
        contact: ['matched', 'arranged'].includes(r.offer.status) && r.offer.matchedUid === uid()
          ? await store.readContact(r.offer.id, r.offer.posterUid) : null
      }))));
    } catch (e) { if (live()) failed(list, e, () => go('interested')); return; }
    if (!live()) return;
    list.innerHTML = '';
    st.interestedIds = new Set(rows.map(r => r.offer.id));
    const t = today();
    const current = rows.filter(r => !W.isExpired(r.offer, t) || r.offer.status === 'arranged');
    if (!current.length) list.appendChild(el('div', 'sw-empty', 'You have not said "I\'m interested" to any offer. Find one on the BOARD.'));
    current.forEach(r => list.appendChild(interestedCard(r)));
    setCounts({ interested: rows.filter(r => r.offer.status === 'matched' && r.offer.matchedUid === uid()).length });
  }

  function interestedCard({ offer: o, interest: i, contact }) {
    const me = uid();
    const pickedMe = o.matchedUid === me;
    const actions = [];
    const withdraw = button('pa-ghost', o.status === 'open' ? 'Withdraw' : 'Remove', async () => {
      await store.withdrawInterest(o.id, me).catch(() => {}); go('interested');
    });
    if (!(pickedMe && (o.status === 'matched' || o.status === 'arranged'))) actions.push(withdraw);
    const color = pickedMe ? 'green' : o.status === 'open' ? (i.color || 'yellow') : 'red';
    const card = U.scorecard(o, { color, reason: '' }, { actions });
    const box = el('div', 'sw-status');
    const poster = o.posterName || 'The poster';
    if (o.status === 'open') box.append('Waiting for ', strong(poster), ' to pick. ' + (i.run ? 'You offered run ' + i.run.runNo + ' on ' + W.longDay(i.run.date) + '.' : ''));
    else if (o.status === 'cancelled') box.textContent = poster + ' cancelled this offer.';
    else if (!pickedMe) box.textContent = poster + ' picked someone else.';
    else {
      if (o.status === 'arranged') box.append(o.arrangedBy === me ? 'You marked this arranged with ' : '', strong(poster), o.arrangedBy === me ? '. ' : ' marked this arranged. ');
      else box.append(strong(poster), ' picked you. Reach them: ');
      box.appendChild(U.contactLine(contact));
    }
    card.appendChild(box);
    if (pickedMe && (o.status === 'matched' || o.status === 'arranged')) {
      card.appendChild(remind());
      if (o.status === 'matched') {
        const acts = el('div', 'sw-acts');
        acts.appendChild(button('pa-submit', 'Mark arranged', () => arrangedConfirm(card, o)));
        card.appendChild(acts);
      }
    }
    return card;
  }

  // ---- NEW OFFER (and edit) ------------------------------------------------

  const TIME_OPTS = (from, to) => {
    const out = [['', 'Any time']];
    for (let m = from; m <= to; m += 30) out.push([String(m), S.fmtClock(m) + (m >= 1440 ? ' (next day)' : '')]);
    return out;
  };

  async function renderWizard(offer) {
    const w = st.wizard = offer ? {
      id: offer.id, step: 1, kind: offer.kind, weekStart: offer.weekStart, date: offer.give.date, give: offer.give,
      wants: offer.wants.map(x => ({ ...x })), prefs: { ...offer.prefs, excludeRoutes: [...(offer.prefs.excludeRoutes || [])] },
      days: null, routes: null
    } : {
      step: 1, kind: null, weekStart: W.weekOf(today()), date: null, give: null, wants: [],
      prefs: { flexible: false, excludeRoutes: [], earliestMin: null, latestMin: null, note: '' }, days: null, routes: null
    };
    drawStep();
  }

  async function loadWeek(w) {
    const dates = W.weekDates(w.weekStart);
    w.days = await daysFor(dates);
  }

  function drawStep() {
    const w = st.wizard;
    const body = frame();
    const card = el('div', 'card');
    body.appendChild(card);
    card.appendChild(el('div', 'sw-step', (w.id ? 'Edit offer · ' : 'New offer · ') + 'Step ' + w.step + ' of 4'));
    const nav = el('div', 'sw-nav');
    const back = button('pa-ghost', w.step === 1 ? 'Cancel' : 'Back', () => {
      if (w.step === 1) { st.wizard = null; go(w.id ? 'mine' : 'board'); } else { w.step--; drawStep(); }
    });
    const next = button('pa-submit', w.step === 4 ? (w.id ? 'Save changes' : 'Post offer') : 'Next');
    const msg = el('div', 'msgline');
    const content = el('div');
    card.append(content, nav, msg);
    nav.append(back, next);
    const fail = t => { msg.className = 'msgline err'; msg.textContent = t; };

    if (w.step === 1) {
      content.appendChild(el('div', 'sw-q', 'What do you want to change?'));
      [['give', 'Give up a working day or shift', 'Hand over one of your runs, for a run on another day this week or a different shift the same day.'],
       ['dayoff', 'Get a specific day off', 'Hand over your run that day and work someone\'s run on one of your off days instead.']]
        .forEach(([k, t, d]) => {
          const b = button('sw-big' + (w.kind === k ? ' on' : ''), null, () => { w.kind = k; if (k === 'dayoff') w.wants = w.wants.filter(x => x.type === 'day'); w.step = 2; drawStep(); });
          b.appendChild(el('b', null, t)); b.appendChild(document.createTextNode(d));
          content.appendChild(b);
        });
      content.appendChild(el('div', 'hint', 'Every swap trades two real runs inside one work week (Sunday to Saturday). Whoever gives up a day off works a run in return.'));
      next.hidden = true;
      return;
    }

    if (w.step === 2) {
      content.appendChild(el('div', 'sw-q', w.kind === 'dayoff' ? 'Which day do you want off?' : 'Which day are you giving up?'));
      content.appendChild(el('div', 'sw-sub', 'Week'));
      const weeks = el('div', 'sw-chips');
      W.weekChoices(today()).forEach((ws, i) => {
        const b = button('sw-chip' + (ws === w.weekStart ? ' on' : ''), i === 0 ? 'This week' : W.fmtDay(ws).slice(4) + '–' + W.fmtDay(S.addDays(ws, 6)).slice(4), () => {
          if (ws === w.weekStart) return;
          w.weekStart = ws; w.date = null; w.give = null; w.wants = []; w.days = null; drawStep();
        });
        weeks.appendChild(b);
      });
      content.appendChild(weeks);
      content.appendChild(el('div', 'sw-sub', 'Day'));
      const grid = el('div', 'sw-days');
      content.appendChild(grid);
      const picked = el('div', 'sw-pick');
      content.appendChild(picked);
      const draw = () => {
        grid.innerHTML = '';
        W.weekDates(w.weekStart).forEach(d => {
          const info = w.days && w.days.get(d);
          const sub = !info ? '…' : !info.known ? '?' : info.away ? 'VAC' : info.card ? info.card.runNo : 'OFF';
          const b = button('sw-chip' + (d === w.date ? ' on' : ''), null, () => {
            w.date = d; w.give = info && info.card ? info.card : null; w.wants = w.wants.filter(x => x.type !== 'day' || x.date !== d); draw();
          });
          b.appendChild(document.createTextNode(W.shortDay(d)));
          b.appendChild(el('small', null, sub));
          b.disabled = d < today() || !info || (info.known && !info.card);
          grid.appendChild(b);
        });
        picked.innerHTML = '';
        if (!w.date) { picked.textContent = 'Days marked OFF or VAC have no run to give.'; return; }
        const info = w.days.get(w.date);
        if (w.give) {
          const g = w.give;
          picked.append(W.longDay(w.date) + ' · ', strong('run ' + g.runNo), (g.routeLabel ? ' · ' + g.routeLabel : '')
            + (g.reportMin != null ? ' · ' + S.fmtClock(g.reportMin) + '–' + S.fmtClock(g.finishMin) : '') + (g.payHours ? ' · ' + g.payHours.toFixed(2) + ' h' : ''));
          if (info && info.manual) {
            picked.append(' (entered by you) ');
            picked.appendChild(button('rowbtn', 'Change', async () => {
              setManual(w.date, null);
              const fresh = await dayInfo(w.date).catch(() => ({ known: false, card: null }));
              w.days.set(w.date, fresh); w.give = fresh.card; draw();
            }));
          }
        } else {
          picked.textContent = 'Your schedule has no run for ' + W.longDay(w.date) + '. Enter it:';
          const row = el('div', 'sw-row');
          const inp = field(row, 'Run #', { inputmode: 'numeric', maxlength: '8', placeholder: 'e.g. 209' });
          row.appendChild(button('pa-ghost', 'Look up', async () => {
            let c = null; try { c = await lookupCard(w.date, inp.value.trim()); } catch (_) {}
            if (!c) { fail('Run ' + inp.value.trim() + ' is not in the ' + W.longDay(w.date) + ' paddle for your district.'); return; }
            setManual(w.date, { runNo: inp.value.trim() });
            w.days.set(w.date, { known: true, card: c, manual: true }); w.give = c; msg.textContent = ''; draw();
          }));
          picked.appendChild(row);
        }
      };
      draw();
      if (!w.days) loadWeek(w).then(() => { if (st.wizard === w && w.step === 2) drawStep(); }).catch(() => fail('Could not load your schedule for that week.'));
      next.addEventListener('click', () => {
        if (!w.days) return fail('Still loading your week…');
        if (!w.give) return fail('Pick a day you work.');
        w.step = 3; drawStep();
      });
      return;
    }

    if (w.step === 3) {
      content.appendChild(el('div', 'sw-q', 'What would you take in return?'));
      content.appendChild(el('div', 'hint', 'Pick as many as you like. All in the week of ' + W.fmtDay(w.weekStart).slice(4) + '.'));
      const isOn = x => w.wants.some(y => y.type === x.type && (x.type === 'day' ? y.date === x.date : y.shift === x.shift));
      const toggle = x => { w.wants = isOn(x) ? w.wants.filter(y => !(y.type === x.type && (x.type === 'day' ? y.date === x.date : y.shift === x.shift))) : [...w.wants, x]; drawStep(); };
      const freeDays = W.weekDates(w.weekStart).filter(d => d !== w.date && d >= today()
        && !((w.days.get(d) || {}).card) && !((w.days.get(d) || {}).away));
      content.appendChild(el('div', 'sw-sub', w.kind === 'dayoff' ? 'I\'ll work any run on' : 'Any run on (a day you\'re off)'));
      const grid = el('div', 'sw-days');
      W.weekDates(w.weekStart).forEach(d => {
        const info = w.days.get(d) || {};
        const x = { type: 'day', date: d };
        const b = button('sw-chip' + (isOn(x) ? ' on' : ''), null, () => { w.prefs.flexible = false; toggle(x); });
        b.appendChild(document.createTextNode(W.shortDay(d)));
        b.appendChild(el('small', null, d === w.date ? 'GIVING' : info.away ? 'VAC' : info.card ? 'WORK' : d < today() ? 'PAST' : 'OFF'));
        b.disabled = !freeDays.includes(d);
        grid.appendChild(b);
      });
      content.appendChild(grid);
      if (freeDays.length > 1) {
        const flex = button('sw-chip' + (w.prefs.flexible ? ' on' : ''), 'Flexible: any day I\'m off', () => {
          w.prefs.flexible = !w.prefs.flexible;
          w.wants = w.wants.filter(x => x.type !== 'day');
          if (w.prefs.flexible) freeDays.forEach(d => w.wants.push({ type: 'day', date: d }));
          drawStep();
        });
        flex.style.marginTop = '8px';
        content.appendChild(flex);
      }
      if (w.kind === 'give') {
        content.appendChild(el('div', 'sw-sub', 'Or a different shift on ' + W.longDay(w.date)));
        const chips = el('div', 'sw-chips');
        const own = W.shiftOf(w.give.reportMin);
        [...Object.keys(W.SHIFTS), 'any'].forEach(s => {
          if (s === own) return;
          const x = { type: 'shift', shift: s };
          chips.appendChild(button('sw-chip' + (isOn(x) ? ' on' : ''), s === 'any' ? 'Any different shift' : W.SHIFTS[s], () => toggle(x)));
        });
        content.appendChild(chips);
      }
      next.addEventListener('click', () => { if (!w.wants.length) return fail('Pick at least one.'); w.step = 4; drawStep(); });
      return;
    }

    // step 4: preferences, then post
    content.appendChild(el('div', 'sw-q', 'Anything you won\'t take?'));
    content.appendChild(el('div', 'sw-sub', 'Routes to exclude'));
    const routesBox = el('div', 'sw-chips');
    content.appendChild(routesBox);
    const drawRoutes = () => {
      routesBox.innerHTML = '';
      const list = [...(w.routes || []), W.OWL];
      list.forEach(r => {
        const on = w.prefs.excludeRoutes.includes(r);
        routesBox.appendChild(button('sw-chip' + (on ? ' on' : ''), r === W.OWL ? 'Night liners' : r, () => {
          w.prefs.excludeRoutes = on ? w.prefs.excludeRoutes.filter(x => x !== r) : [...w.prefs.excludeRoutes, r];
          drawRoutes();
        }));
      });
      if (!w.routes) routesBox.appendChild(el('span', 'hint', 'Loading routes…'));
    };
    drawRoutes();
    if (!w.routes) districtRoutes(w.date).then(r => { w.routes = r; drawRoutes(); }).catch(() => { w.routes = []; drawRoutes(); });

    content.appendChild(el('div', 'sw-sub', 'Time window'));
    const tw = el('div', 'sw-row');
    const early = field(tw, 'Start no earlier than', { tag: 'select', options: TIME_OPTS(180, 780), value: w.prefs.earliestMin != null ? String(w.prefs.earliestMin) : '' });
    const late = field(tw, 'Finish by', { tag: 'select', options: TIME_OPTS(600, 1560), value: w.prefs.latestMin != null ? String(w.prefs.latestMin) : '' });
    early.addEventListener('change', () => { w.prefs.earliestMin = early.value === '' ? null : +early.value; });
    late.addEventListener('change', () => { w.prefs.latestMin = late.value === '' ? null : +late.value; });
    content.appendChild(tw);
    content.appendChild(el('div', 'sw-sub', 'Note (optional)'));
    const note = field(content, 'Short note for the board', { maxlength: '140', value: w.prefs.note || '' });
    note.addEventListener('input', () => { w.prefs.note = note.value; });
    const name = field(content, 'Your name on the board', { maxlength: '60', value: myName(), autocomplete: 'name' });
    content.appendChild(el('div', 'hint', 'Only this name is shown. Phone or email is shared later, only with the one person you pick.'));

    next.addEventListener('click', async () => {
      const posterName = name.value.trim();
      if (!posterName) return fail('Enter the name to show on the board.');
      const built = W.buildOffer({ kind: w.kind, give: w.give, wants: w.wants, prefs: w.prefs },
        { day: d => (w.days && w.days.get(d)) || { known: false, card: null } }, today());
      if (built.error) return fail(built.error);
      next.disabled = true; msg.className = 'msgline'; msg.textContent = 'Saving…';
      try {
        const info = await E.slugForDate(profile().depotKey, w.give.date);
        if (!info || !info.season) throw Object.assign(new Error('no season'), { code: 'no-season' });
        const fields = {
          ...built.doc,
          posterUid: uid(), posterName,
          depotKey: info.slug ? S.depotKeyOf(info.slug) : profile().depotKey,
          depotLabel: (info.district && info.district.label) || profile().depotLabel || profile().depotKey,
          seasonId: info.season.id, seasonLabel: info.season.label
        };
        rememberName(posterName);
        if (w.id) await withTimeout(store.editOffer(w.id, fields)); else await withTimeout(store.createOffer(fields));
        st.wizard = null;
        go('mine');
      } catch (e) {
        next.disabled = false;
        fail(e && e.code === 'no-season' ? 'That week is not in a picking the app knows yet.' : errText(e));
      }
    });
  }

  const routeCache = new Map();
  async function districtRoutes(date) {
    const { slug } = await E.slugForDate(profile().depotKey, date);
    if (!slug) return [];
    if (!routeCache.has(slug)) {
      routeCache.set(slug, Promise.all(['weekday', 'saturday', 'sunday'].map(dt => S.loadPaddle(slug, dt).catch(() => new Map())))
        .then(maps => {
          const set = new Set();
          maps.forEach(m => m.forEach(row => { for (let i = 1; i <= 10; i++) if (row['r' + i]) S.routesOfLabel(row['r' + i]).forEach(r => set.add(r)); }));
          return [...set].filter(r => /^[A-Z0-9]{1,4}$/i.test(r) && r.toLowerCase() !== 'r1')
            .sort((a, b) => (parseInt(a, 10) || 999) - (parseInt(b, 10) || 999) || a.localeCompare(b));
        }));
    }
    return routeCache.get(slug);
  }

  // ---- counts for the tab badge -------------------------------------------

  function setCounts(c) {
    counts = { ...counts, ...c };
    drawCounts();
    if (deps.onBadge) deps.onBadge(counts.mine + counts.interested);
  }

  /** Cheap-ish refresh of the badge without drawing anything. */
  async function refreshBadge() {
    if (!uid()) return;
    try {
      const [offers, mine, blocks] = await withTimeout(Promise.all([
        store.interestedOffers(uid()), store.myOffers(uid()), store.listBlocks(uid()).catch(() => new Map())]));
      const open = mine.filter(o => o.status === 'open' && !W.isExpired(o, today()));
      const lists = await Promise.all(open.map(o => store.listInterest(o.id).catch(() => [])));
      setCounts({
        mine: lists.reduce((n, l) => n + l.filter(i => !blocks.has(i.uid)).length, 0),
        interested: offers.filter(r => r.offer.status === 'matched' && r.offer.matchedUid === uid()).length
      });
    } catch (_) { /* the badge is a nicety */ }
  }

  return {
    state: st,
    /** Open the tab. params: { offer: id, new: bool } from the URL or the board. */
    show(params = {}) {
      let pending = params.offer || null;
      if (!pending) { try { pending = localStorage.getItem(PENDING_KEY); } catch (_) {} }
      if (pending) st.pending = pending;
      if (params.new) return go('new');
      if (st.view === 'new' && st.wizard) return drawStep();
      return go(st.pending ? 'board' : st.view);
    },
    refreshBadge,
    reset() { st.view = 'board'; st.wizard = null; st.pending = null; st.districts = []; st.district = ''; counts = { mine: 0, interested: 0 }; root.innerHTML = ''; }
  };
}
