import {
  socket, esc, byId, cardHtml, backHtml, pileHtml, pileChip, bookProgress, badges, where,
  scoreGridHtml, roundTableHtml, cardText, cardValue, rankText, isWild, isThree,
} from '/g/hand-and-foot/ui.js';
import { claimSeat, code, toast } from '/lib/room.js';

const app = document.getElementById('app');
let state = null;
let me = undefined; // undefined until the server has told us who we are
let lastBuzz = null;

// Local UI state. Card ids are kept as strings (they come back from data attributes).
let sel = new Set();     // tapped cards
let batch = [];          // [{ rank, cardIds }] built so far, not yet sent
let takeMode = false;    // building the batch for a take-5
let turnKey = '';

claimSeat((playerId) => { me = playerId; render(); });
socket.on('state', (s) => {
  state = s;
  const key = `${s.round}:${s.turnId}:${s.stage}`;
  if (isMyDraw() && lastBuzz !== key && navigator.vibrate) navigator.vibrate(120);
  if (isMyDraw()) lastBuzz = key;
  render();
});

const myTurn = () => state.phase === 'playing' && state.turnId === me;
const isMyDraw = () => myTurn() && state.stage === 'draw';
const isMyPlay = () => myTurn() && state.stage === 'play';

function render() {
  if (!state || me === undefined) return;
  const joining = !me || !byId(state, me);
  // Don't rebuild the join form while someone is typing into it.
  if (joining && state.phase === 'lobby' && document.getElementById('join')) return;
  app.innerHTML = joining ? joinView() : state.phase === 'lobby' ? lobbyView() : gameView();
}

const logo = '<div class="logo"><span>♠</span> HAND &amp; FOOT <span>♥</span></div>';

function joinView() {
  if (state.phase !== 'lobby') {
    return `<div class="center">${logo}
      <p class="muted">A game is in progress.<br>You can join when the table returns to the lobby.</p>
    </div>`;
  }
  return `<form class="center" id="join">${logo}
    <input id="name" maxlength="16" placeholder="Your name" autocomplete="nickname" autofocus>
    <button class="big" type="submit">Join the table</button>
  </form>`;
}

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'join') return;
  e.preventDefault();
  socket.emit('join', { name: document.getElementById('name').value });
});

function lobbyView() {
  const n = state.players.length;
  return `<div class="center">${logo}
    <p>You're in! Waiting for everyone to join…</p>
    <p class="muted">Room code <b class="code">${esc(code)}</b> · <a href="/r/${esc(code)}/board" target="_blank">table screen</a></p>
    <button class="ghost" data-share>Invite people</button>
    <ul class="names">${state.players.map((p) => `<li class="${p.id === me ? 'me' : ''}">${esc(p.name)}</li>`).join('')}</ul>
    <button class="big" data-emit="start" ${n < 2 ? 'disabled' : ''}>Start game (${n} player${n === 1 ? '' : 's'})</button>
    <button class="ghost" data-emit="leave">Leave</button>
  </div>`;
}

// ---- card lookup and batch building --------------------------------------

// Every card the player can tap right now: their cards, plus the discard top
// while building a take-5.
function available() {
  const map = new Map((state.you?.cards ?? []).map((c) => [String(c.id), c]));
  if (takeMode && state.discardTop) map.set(String(state.discardTop.id), state.discardTop);
  return map;
}

// Reset on a new turn/stage; drop anything that is no longer in reach (cards
// that were laid down, a turn that passed).
function sync() {
  const key = `${state.round}:${state.turnId}:${state.stage}:${state.phase}`;
  if (key !== turnKey) { turnKey = key; sel = new Set(); batch = []; takeMode = false; }
  if (!isMyDraw()) takeMode = false;
  const map = available();
  for (const id of [...sel]) if (!map.has(id)) sel.delete(id);
  batch = batch.filter((e) => e.cardIds.every((id) => map.has(String(id))));
  return map;
}

const inBatch = (id) => batch.some((e) => e.cardIds.some((x) => String(x) === id));
const sumValue = (ids, map) => ids.reduce((s, id) => s + cardValue(map.get(String(id))), 0);

// What the current selection would become: a batch entry for one rank, or
// wilds waiting for a pile to be tapped.
function describe(map) {
  const cards = [...sel].map((id) => map.get(id));
  if (!cards.length) return { empty: true };
  if (cards.some(isThree)) return { error: '3s can never be melded. Discard them.' };
  const naturals = cards.filter((c) => !isWild(c));
  const ranks = [...new Set(naturals.map((c) => c.rank))];
  if (ranks.length > 1) return { error: 'Pick naturals of one rank (plus wilds).' };
  const ids = cards.map((c) => c.id);
  if (!ranks.length) return { wildsOnly: true, cardIds: ids };
  return { rank: ranks[0], cardIds: ids };
}

function addEntry(rank, cardIds) {
  const found = batch.find((e) => e.rank === rank);
  if (found) found.cardIds.push(...cardIds);
  else batch.push({ rank, cardIds: [...cardIds] });
  sel = new Set();
}

// The batch as it would be sent: what has been added, plus a valid pending selection.
function effectiveBatch(map) {
  const d = describe(map);
  const out = batch.map((e) => ({ rank: e.rank, cardIds: [...e.cardIds] }));
  if (d.rank !== undefined) {
    const found = out.find((e) => e.rank === d.rank);
    if (found) found.cardIds.push(...d.cardIds);
    else out.push({ rank: d.rank, cardIds: d.cardIds });
  }
  return out;
}

// ---- events -----------------------------------------------------------------

document.addEventListener('click', (e) => {
  if (!state) return;
  const card = e.target.closest('[data-card]');
  if (card) {
    if (!(isMyPlay() || takeMode)) return;
    const id = card.dataset.card;
    if (sel.has(id)) sel.delete(id); else sel.add(id);
    return render();
  }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const map = sync();
  const act = btn.dataset.act;
  if (act === 'take') { takeMode = true; sel = new Set(); batch = []; }
  else if (act === 'cancel') { takeMode = false; sel = new Set(); batch = []; }
  else if (act === 'clear') { sel = new Set(); batch = []; }
  else if (act === 'unbatch') batch.splice(Number(btn.dataset.i), 1);
  else if (act === 'add') {
    const d = describe(map);
    if (d.error) toast(d.error);
    else if (d.rank !== undefined) addEntry(d.rank, d.cardIds);
    else toast(d.wildsOnly ? 'Tap one of your piles to add these wilds to it.' : 'Select some cards first.');
  } else if (act === 'pile') {
    const rank = Number(btn.dataset.rank);
    const d = describe(map);
    if (d.empty) toast('Select cards first, then tap the pile.');
    else if (d.error) toast(d.error);
    else if (d.rank !== undefined && d.rank !== rank) toast(`Those cards are not ${rankText(rank)}s.`);
    else addEntry(rank, d.cardIds);
  } else if (act === 'lay' || act === 'pickup') {
    const melds = effectiveBatch(map);
    if (!melds.length) toast('Nothing to lay down yet.');
    else if (act === 'pickup' && !melds.some((m) => m.cardIds.some((id) => String(id) === String(state.discardTop?.id)))) {
      toast('The top discard must be part of your batch.');
    } else socket.emit(act === 'lay' ? 'meld' : 'pickup', { melds });
    return; // keep the batch until the server answers; sync() prunes it
  } else if (act === 'discard') {
    if (sel.size !== 1) return toast('Select one card to discard.');
    const card = map.get([...sel][0]);
    sel = new Set();
    batch = [];
    socket.emit('discard', { cardId: card.id });
    return;
  }
  render();
});

// ---- game view ----------------------------------------------------------------

function sortHand(cards) {
  const group = (c) => (c.joker ? 0 : c.rank === 2 ? 1 : c.rank === 3 ? 2 : 3);
  return [...cards].sort((a, b) => group(a) - group(b)
    || (a.rank ?? 0) - (b.rank ?? 0) || String(a.suit).localeCompare(String(b.suit)));
}

function gameView() {
  const map = sync();
  const p = byId(state, me);
  const over = state.phase === 'roundOver' || state.phase === 'gameOver';
  return `
    <header class="top">
      <span>Round <b>${state.round}</b>/${state.rounds}</span>
      <span class="minchip">${p.opened ? 'Opened' : `Open with ${state.openingMin}+`}</span>
      <span>Total <b>${p.score}</b></span>
    </header>
    <section class="banner ${isMyDraw() || isMyPlay() ? 'go' : ''}">${bannerText()}</section>
    ${over ? resultsView() : ''}
    <section class="table">
      <div class="pile">${backHtml()}<small class="muted">Stock (${state.stockCount})</small></div>
      <div class="pile">${state.discardTop ? cardHtml(state.discardTop) : '<span class="card empty"></span>'}
        <small class="muted">Discard (${state.discardCount})${state.discardTop && state.discardBlocked ? (state.discardCount < 5 ? ' · under 5' : ' · blocked') : ''}</small></div>
    </section>
    ${isMyDraw() && !takeMode ? drawView() : ''}
    ${over ? '' : (isMyPlay() || takeMode) ? batchView(map) : ''}
    ${over ? '' : handView(p, map)}
    ${isMyPlay() || takeMode ? dock(p, map) : ''}
    ${myPiles(p)}
    <section class="others">
      ${state.players.filter((q) => q.id !== me).map(otherRow).join('')}
    </section>
    <footer class="log">${state.log.slice(-4).reverse().map((l) => `<div>${esc(l.text)}</div>`).join('')}</footer>`;
}

function bannerText() {
  if (state.phase === 'gameOver') {
    if (!state.winners.length) return 'Game over';
    return state.winners.includes(me) ? '🏆 You win!' : `${state.winners.map((id) => esc(byId(state, id)?.name ?? '?')).join(' & ')} won`;
  }
  if (state.phase === 'roundOver') {
    const out = state.outId ? byId(state, state.outId) : null;
    return out ? `Round ${state.round} over: ${esc(out.name)} went out` : `Round ${state.round} over`;
  }
  const turn = byId(state, state.turnId);
  if (state.turnId === me) {
    if (takeMode) return 'Taking 5: lay down a batch that uses the top card';
    return state.stage === 'draw' ? 'Your turn: draw' : 'Lay down, then discard';
  }
  return `${esc(turn?.name ?? '?')} is ${state.stage === 'draw' ? 'drawing' : 'playing'}…`;
}

function drawView() {
  const top = state.discardTop;
  const blocked = state.discardBlocked || !top;
  return `<section class="draws">
    <button class="big" data-emit="draw" data-arg="{}">Draw 3</button>
    <button class="big alt" data-act="take" ${blocked ? 'disabled' : ''}>${blocked ? (!top ? 'No discard' : state.discardCount < 5 ? `Take 5 (only ${state.discardCount})` : `Blocked (${esc(cardText(top))})`) : 'Take 5'}</button>
  </section>`;
}

// The batch being built: one tray per pile, each with its points.
function batchView(map) {
  const d = describe(map);
  const entries = effectiveBatch(map);
  const mine = byId(state, me);
  const total = entries.reduce((s, e) => s + sumValue(e.cardIds, map), 0);
  // Added entries (each removable) and the pending selection are separate
  // rows, so × only ever removes what was actually added.
  const row = (e, idx) => {
    const isPending = idx < 0;
    const existing = mine.piles.find((q) => q.rank === e.rank);
    const added = isPending && batch.some((b) => b.rank === e.rank);
    const place = added ? `more ${rankText(e.rank)}s for the batch` : existing ? `onto your pile of ${existing.cards.length}` : 'new pile';
    return `<div class="bentry ${isPending ? 'pend' : ''}">
      <span class="bhead"><b>${rankText(e.rank)}</b> <small>${place}${isPending ? ' · not added yet' : ''}</small></span>
      <span class="bcards">${e.cardIds.map((id) => cardHtml(map.get(String(id)))).join('')}</span>
      <span class="bpts">${sumValue(e.cardIds, map)}</span>
      ${isPending ? '' : `<button class="x" data-act="unbatch" data-i="${idx}" aria-label="Remove">×</button>`}
    </div>`;
  };
  const rows = batch.map((e, i) => row(e, i)).join('')
    + (d.rank !== undefined ? row({ rank: d.rank, cardIds: d.cardIds }, -1) : '');
  const short = !mine.opened && entries.length && total < state.openingMin;
  const hint = entries.length ? '' : (takeMode
    ? `<p class="hint">Select cards from your hand that go with the <b>${esc(cardText(state.discardTop))}</b> on top of the discard pile (tap it below to include it), then tap Add.</p>`
    : '<p class="hint">Select cards of one rank (plus wilds) and tap Add. Wilds alone go onto a pile: tap the pile.</p>');
  return `<section class="batch">
    <div class="row"><h3>Batch</h3><span class="spacer"></span>
      <span class="btotal ${short ? 'short' : ''}">${total} pts${mine.opened ? '' : ` / ${state.openingMin} to open`}</span></div>
    ${rows}${hint}
  </section>`;
}

function handView(p, map) {
  const you = state.you;
  const cards = sortHand(you?.cards ?? []).filter((c) => !inBatch(String(c.id)));
  const top = takeMode && state.discardTop && !inBatch(String(state.discardTop.id)) ? state.discardTop : null;
  const interactive = isMyPlay() || takeMode;
  const btn = (c, extra = '') => {
    const id = String(c.id);
    const cls = ['cardbtn', extra];
    if (sel.has(id)) cls.push('sel');
    return `<button class="${cls.join(' ')}" data-card="${esc(id)}" aria-pressed="${sel.has(id)}" ${interactive ? '' : 'disabled'}>${cardHtml(c)}</button>`;
  };
  // Cards of the same rank sit together, with a gap between ranks.
  const groups = [];
  for (const c of cards) {
    const k = c.joker ? 'J' : c.rank;
    if (groups.at(-1)?.k === k) groups.at(-1).cards.push(c);
    else groups.push({ k, cards: [c] });
  }
  const status = you.inFoot
    ? '<span class="tag foot">In your foot</span>'
    : `<span class="tag">Hand · foot waits (${you.footCount})</span>`;
  return `<section class="mine">
    <div class="row"><h2>${esc(p.name)} ${badges(state, p)}</h2><span class="spacer"></span>${status}</div>
    <div class="hand">
      ${top ? `<span class="fromdiscard"><small>Discard top</small>${btn(top, 'topc')}</span>` : ''}
      ${groups.map((g) => `<span class="rankgrp">${g.cards.map((c) => btn(c)).join('')}</span>`).join('')
        || '<span class="muted">No cards</span>'}
    </div>
  </section>`;
}

// Sticky action bar: what the selection is, and the buttons.
function dock(p, map) {
  const d = describe(map);
  const entries = effectiveBatch(map);
  const you = state.you;
  const mineIds = new Set(you.cards.map((c) => String(c.id)));
  const handUsed = entries.reduce((n, e) => n + e.cardIds.filter((id) => mineIds.has(String(id))).length, 0);
  // A take-5 also brings the other 4 discards into the hand.
  const incoming = takeMode ? 4 : 0;
  const remaining = you.cards.length - handUsed + incoming;
  const canOut = p.canGoOut;
  const canOutAfter = entries.length ? booksReady(p, entries, map) : canOut;
  // One card picked with nothing batched is a discard (or a single card for a pile).
  const singleDiscard = sel.size === 1 && !takeMode && !batch.length;
  let hint;
  let warn = false;
  if (d.error) { hint = d.error; warn = true; }
  else if (d.wildsOnly) hint = `${sel.size} wild${sel.size === 1 ? '' : 's'} selected: tap one of your piles below to add ${sel.size === 1 ? 'it' : 'them'}.`;
  else if (!singleDiscard && entries.length && you.inFoot && remaining <= 0) { hint = 'Keep at least one card to discard.'; warn = true; }
  else if (!singleDiscard && entries.length && you.inFoot && !canOutAfter && remaining < 2) { hint = 'Until you hold 2 clean + 1 dirty book, a lay-down must leave at least 2 cards.'; warn = true; }
  else if (!singleDiscard && entries.length && !you.inFoot && remaining <= 0) hint = 'This empties your hand: you pick up your foot and keep playing.';
  else if (singleDiscard) hint = you.inFoot && you.cards.length === 1 && !canOut
    ? 'You cannot discard your last card until you hold 2 clean + 1 dirty book.'
    : !you.inFoot && you.cards.length === 1 ? 'Discarding your last hand card picks up your foot (you play it next turn).'
    : you.inFoot && you.cards.length === 1 ? 'Discarding your last card goes out!' : 'Discard this card, or add it to a pile.';
  else if (sel.size) hint = `${sel.size} selected · ${sumValue([...sel], map)} pts`;
  else hint = takeMode ? 'Build your batch.' : 'Tap cards to select them.';

  const lastBlocked = you.inFoot && you.cards.length === 1 && !canOut;
  const canAdd = d.rank !== undefined;
  const discardOk = sel.size === 1 && !takeMode && !lastBlocked && !batch.length;
  const goOut = discardOk && you.inFoot && you.cards.length === 1;
  const topId = String(state.discardTop?.id);
  const hasTop = entries.some((e) => e.cardIds.some((id) => String(id) === topId));
  return `<section class="dock">
    <p class="hint ${warn ? 'warn' : ''}">${esc(hint)}</p>
    <div class="dockbtns">
      <button data-act="add" ${canAdd ? '' : 'disabled'}>Add</button>
      ${takeMode
        ? `<button class="go" data-act="pickup" ${hasTop ? '' : 'disabled'}>Take 5</button>
           <button class="ghost" data-act="cancel">Cancel</button>`
        : `<button class="go" data-act="lay" ${entries.length ? '' : 'disabled'}>Lay down</button>
           <button class="${goOut ? 'out' : 'alt'}" data-act="discard" ${discardOk ? '' : 'disabled'}>${goOut ? 'Go out' : 'Discard'}</button>`}
    </div>
    ${(batch.length || sel.size) ? '<button class="linkbtn" data-act="clear">Clear selection</button>' : ''}
  </section>`;
}

// Whether the player would hold 2 clean + 1 dirty book after laying down
// `entries` (mirrors the engine's planMelds book count).
function booksReady(p, entries, map) {
  const piles = new Map(p.piles.map((q) => [q.rank, [...q.cards]]));
  for (const e of entries) {
    piles.set(e.rank, [...(piles.get(e.rank) ?? []), ...e.cardIds.map((id) => map.get(String(id))).filter(Boolean)]);
  }
  let clean = 0;
  let dirty = 0;
  for (const cards of piles.values()) {
    if (cards.length < 7) continue;
    if (cards.some(isWild)) dirty++; else clean++;
  }
  return clean >= 2 && dirty >= 1;
}

// Your piles: tappable, so wilds (and cards) can be added to them.
function myPiles(p) {
  const tappable = isMyPlay() || takeMode;
  const you = state.you;
  const ready = p.canGoOut;
  const note = ready
    ? '<b class="ok">You can go out</b>'
    : you?.inFoot ? 'Need 2 clean + 1 dirty before you can discard your last card' : 'Go out needs 2 clean + 1 dirty book';
  return `<section class="piles">
    <div class="row"><h3>Your piles</h3><span class="spacer"></span>${bookProgress(p)}</div>
    <p class="hint">${note}</p>
    ${p.piles.length ? p.piles.map((q) => `<button class="pilebtn" data-act="pile" data-rank="${q.rank}" ${tappable ? '' : 'disabled'}>${pileHtml(q)}</button>`).join('')
      : '<p class="muted">No piles yet. A new pile needs 3+ cards, at least 2 natural.</p>'}
  </section>`;
}

function otherRow(q) {
  const cls = ['other'];
  if (state.phase === 'playing' && state.turnId === q.id) cls.push('turn');
  return `<div class="${cls.join(' ')}">
    <div class="row"><b class="oname">${esc(q.name)}</b> ${badges(state, q)}<span class="spacer"></span>
      <span class="ostats"><b>${q.score}</b> pts</span></div>
    <div class="row ostat2"><span class="muted">${where(q)}${q.opened ? '' : ' · not open'}</span><span class="spacer"></span>${bookProgress(q)}</div>
    ${q.piles.length ? `<div class="chips">${q.piles.map(pileChip).join('')}</div>` : ''}
  </div>`;
}

function resultsView() {
  const next = state.phase === 'gameOver'
    ? '<button class="big" data-emit="newGame">New game</button>'
    : '<button class="big" data-emit="nextRound">Next round</button>';
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  return `<section class="results">
    <h3>Round ${state.round}</h3>
    ${roundTableHtml(state)}
    <h3>Scores <small class="muted">highest wins</small></h3>
    ${scoreGridHtml(state)}
    ${state.phase === 'gameOver' ? `<p class="muted center-text">${ranked.map((q) => `${esc(q.name)} ${q.score}`).join(' · ')}</p>` : ''}
    ${next}
  </section>`;
}
