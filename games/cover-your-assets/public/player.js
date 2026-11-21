import { socket, esc, byId, dollars, short, cardHtml, setHtml, stackHtml, backHtml, setName, badges } from './ui.js';
import { claimSeat, code } from '/lib/room.js';

const app = document.getElementById('app');
let state = null;
let me = undefined; // undefined until the server has told us who we are
let lastMove = null;

// Local UI state: what the player has tapped. Ids are kept as strings (they
// come back from data attributes) and mapped to cards when needed.
let picked = [];
let discardPicked = null; // id of the discard top we selected
let stealOpen = false;

claimSeat((playerId) => {
  me = playerId;
  render();
});
socket.on('state', (s) => {
  state = s;
  const key = `${s.round}:${s.log.at(-1)?.id}`;
  if (isMyMove() && lastMove !== key && navigator.vibrate) navigator.vibrate(120);
  if (isMyMove()) lastMove = key;
  render();
});

const isMyMove = () => state.phase === 'playing' && (state.battle ? state.battle.toMoveId === me : state.turnId === me);
const myFreeTurn = () => state.phase === 'playing' && !state.battle && state.turnId === me;

// Two cards make a set when they match, or one is wild; never two wilds.
const canPair = (a, b) => !(a.kind === 'wild' && b.kind === 'wild') && (a.kind === 'wild' || b.kind === 'wild' || a.asset === b.asset);
// A card can play in a battle over `asset` if it matches or is wild.
const canMatch = (card, asset) => card.kind === 'wild' || card.asset === asset;

function render() {
  if (!state || me === undefined) return;
  const joining = !me || !byId(state, me);
  // Don't rebuild the join form while someone is typing into it.
  if (joining && state.phase === 'lobby' && document.getElementById('join')) return;
  app.innerHTML = joining ? joinView() : state.phase === 'lobby' ? lobbyView() : gameView();
}

const logo = '<div class="logo">COVER YOUR <span>ASSETS</span></div>';

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
  const mode = (m, title, sub) => `<button aria-pressed="${state.mode === m}" data-emit="setMode" data-arg='{"mode":"${m}"}'>${title}<small>${sub}</small></button>`;
  return `<div class="center">${logo}
    <p>You're in! Waiting for everyone to join…</p>
    <p class="muted">Room code <b class="code">${esc(code)}</b> · <a href="/r/${esc(code)}/board" target="_blank">table screen</a></p>
    <button class="ghost" data-share>Invite people</button>
    <ul class="names">${state.players.map((p) => `<li class="${p.id === me ? 'me' : ''}">${esc(p.name)}</li>`).join('')}</ul>
    <div class="seg" role="group" aria-label="Game length">
      ${mode('classic', 'Classic', `First to ${dollars(state.targetScore)}`)}
      ${mode('quick', 'Quick', 'One round')}
    </div>
    <button class="big" data-emit="start" ${n < 2 ? 'disabled' : ''}>Start game (${n} player${n === 1 ? '' : 's'})</button>
    <button class="ghost" data-emit="leave">Leave</button>
  </div>`;
}

// ---- selection ----------------------------------------------------------

function handCards() {
  return [...(state.you?.hand ?? [])].sort((a, b) => a.value - b.value || a.asset.localeCompare(b.asset));
}

// Drop selections that no longer make sense (card played, turn passed).
function syncSelection(hand) {
  const ids = new Set(hand.map((c) => String(c.id)));
  picked = myFreeTurn() ? picked.filter((id) => ids.has(id)) : [];
  if (!myFreeTurn() || state.discardTop?.id === undefined || String(state.discardTop.id) !== discardPicked) discardPicked = null;
  if (!picked.length) stealOpen = false;
}

// Everything the selection allows right now.
function options(hand) {
  const sel = picked.map((id) => hand.find((c) => String(c.id) === id)).filter(Boolean);
  const mine = byId(state, me);
  const top = state.discardTop;
  const targets = sel.length === 1 && mine.stack.length >= 1
    ? state.players.filter((p) => p.id !== me && p.stack.length >= 2 && canMatch(sel[0], p.stack.at(-1).asset))
    : [];
  return {
    sel,
    pair: sel.length === 2 && canPair(sel[0], sel[1]),
    pairDiscard: sel.length === 1 && !!top && canPair(sel[0], top),
    discard: sel.length === 1,
    targets,
  };
}

function hint(o) {
  if (discardPicked && !o.sel.length) return 'Pick a hand card to pair with the discard.';
  if (!o.sel.length) return 'Tap cards in your hand to select them.';
  if (o.sel.length === 2) return o.pair ? 'These two make a set.' : "Those two can't make a set.";
  if (discardPicked && !o.pairDiscard) return "That card can't pair with the discard.";
  return 'Pair it with the discard, discard it, or steal a set.';
}

document.addEventListener('click', (e) => {
  if (!state) return;
  const card = e.target.closest('[data-card]');
  if (card) {
    const id = card.dataset.card;
    picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(-2);
    stealOpen = false;
    return render();
  }
  if (e.target.closest('[data-discard]')) {
    const id = String(state.discardTop.id);
    discardPicked = discardPicked === id ? null : id;
    return render();
  }
  if (e.target.closest('[data-steal]')) { stealOpen = true; return render(); }
  if (e.target.closest('[data-close]')) { stealOpen = false; return render(); }
  // room.js has already emitted by now. Close the steal sheet right away: a
  // rejected challenge only sends a 'problem' toast, with no state to re-render.
  if (e.target.closest('[data-emit]') && stealOpen) { stealOpen = false; render(); }
});

// ---- play view ----------------------------------------------------------

const arg = (o) => esc(JSON.stringify(o));

function gameView() {
  const p = byId(state, me);
  const hand = handCards();
  syncSelection(hand);
  const over = state.phase === 'roundOver' || state.phase === 'gameOver';
  const free = myFreeTurn();
  const o = options(hand);
  return `
    <header class="top">
      <span>Round ${state.round}</span>
      <span>Deck <b>${state.deckCount}</b></span>
      <span>Total <b>${dollars(p.score)}</b></span>
    </header>
    <section class="banner ${isMyMove() ? 'go' : ''}">${bannerText(p)}</section>
    ${state.battle ? battleView(hand) : ''}
    ${over ? resultsView() : ''}
    <section class="table">
      <button class="cardbtn discard ${discardPicked ? 'sel' : ''}" data-discard ${free && state.discardTop ? '' : 'disabled'} aria-label="Top of the discard pile">
        ${state.discardTop ? cardHtml(state.discardTop) : '<span class="card empty"></span>'}
      </button>
      <div class="pile">
        <b>Discard</b> <span class="muted">${state.discardCount} card${state.discardCount === 1 ? '' : 's'}</span>
        ${free ? '<small class="muted">Tap it to aim at it</small>' : ''}
      </div>
      <div class="deck">${backHtml()}<span>${state.deckCount}</span></div>
    </section>
    <section class="mine">
      <div class="row"><h2>${esc(p.name)} ${badges(state, p)}</h2><span class="pts">${dollars(p.stackValue)}</span></div>
      <div class="mystack">${stackHtml(p.stack)}</div>
      <div class="hand">${hand.map((c) => handCard(c, free)).join('') || '<span class="muted">No cards in hand</span>'}</div>
    </section>
    ${free ? actionsView(o) : ''}
    <section class="others">
      ${state.players.filter((q) => q.id !== me).map(otherRow).join('')}
    </section>
    <footer class="log">${state.log.slice(-4).reverse().map((l) => `<div>${esc(l.text)}</div>`).join('')}</footer>
    ${free && stealOpen && o.targets.length ? stealSheet(o) : ''}`;
}

function handCard(c, free) {
  const on = picked.includes(String(c.id));
  return `<button class="cardbtn ${on ? 'sel' : ''}" data-card="${esc(c.id)}" aria-pressed="${on}" ${free ? '' : 'disabled'}>${cardHtml(c)}</button>`;
}

function bannerText(p) {
  if (state.phase === 'gameOver') {
    return state.winners.includes(me) ? '🏆 You win!' : `${state.winners.map((id) => esc(byId(state, id)?.name ?? '?')).join(' & ')} won`;
  }
  if (state.phase === 'roundOver') return `Round over: you scored ${dollars(p.roundScore)}`;
  if (state.battle) {
    const mover = byId(state, state.battle.toMoveId);
    return state.battle.toMoveId === me ? 'Your move in the battle!' : `Waiting for ${esc(mover?.name ?? '?')} in the battle…`;
  }
  if (state.turnId === me) return 'Your turn: make a set, discard or steal';
  const turn = byId(state, state.turnId);
  return turn ? `${esc(turn.name)} is playing…` : '…';
}

function actionsView(o) {
  const mark = discardPicked && o.pairDiscard ? ' primary' : '';
  return `<section class="actions">
    <p class="hint">${hint(o)}</p>
    <button data-emit="pair" ${o.pair ? `data-arg="${arg({ cardIds: o.sel.map((c) => c.id) })}"` : 'disabled'}>Make a set</button>
    <button class="${mark}" data-emit="pairDiscard" ${o.pairDiscard ? `data-arg="${arg({ cardId: o.sel[0].id })}"` : 'disabled'}>Pair with discard</button>
    <button data-emit="discard" ${o.discard ? `data-arg="${arg({ cardId: o.sel[0].id })}"` : 'disabled'}>Discard</button>
    <button data-steal ${o.targets.length ? '' : 'disabled'}>Steal…</button>
  </section>`;
}

function stealSheet(o) {
  const card = o.sel[0];
  return `<div class="sheet"><div class="sheet-body">
    <h3>Steal with ${esc(card.name)} from…</h3>
    ${o.targets.map((q) => `<button data-emit="challenge" data-arg="${arg({ targetId: q.id, cardId: card.id })}">
      <span>${esc(q.name)}</span><small>${esc(setName(q.stack.at(-1)))} set · ${short(q.stack.at(-1).value)}</small>
    </button>`).join('')}
    <button class="ghost" data-close>Cancel</button>
  </div></div>`;
}

function battleView(hand) {
  const b = state.battle;
  const name = (id) => esc(byId(state, id)?.name ?? '?');
  const mine = b.toMoveId === me;
  const eligible = hand.filter((c) => canMatch(c, b.asset));
  return `<section class="battle">
    <div class="vs"><b>${name(b.challengerId)}</b> is stealing from <b>${name(b.defenderId)}</b></div>
    <div class="contested">${setHtml(b.set, 'top')}</div>
    ${b.plays.length ? `<div class="plays">${b.plays.map((pl) => `<div class="play"><small>${name(pl.playerId)}</small>${cardHtml(pl.card)}</div>`).join('')}</div>` : ''}
    ${mine ? `<div class="respond">
      <p class="hint">Play a matching card or a wild, or give up.</p>
      <div class="hand">${eligible.map((c) => `<button class="cardbtn" data-emit="respond" data-arg="${arg({ cardId: c.id })}">${cardHtml(c)}</button>`).join('')}</div>
      <button class="danger" data-emit="fold">Give up</button>
    </div>` : ''}
  </section>`;
}

function otherRow(q) {
  const cls = ['other'];
  if (state.phase === 'playing' && (state.battle ? state.battle.toMoveId === q.id : state.turnId === q.id)) cls.push('turn');
  const top = q.stack.at(-1);
  return `<div class="${cls.join(' ')}">
    <div class="row"><b class="oname">${esc(q.name)}</b> ${badges(state, q)}<span class="spacer"></span><span class="pts">${dollars(q.stackValue)}</span></div>
    <div class="orow">
      <div class="otop">${top ? setHtml(top, 'top') : '<span class="muted nostack">No sets</span>'}</div>
      <div class="ostats"><span><b>${q.stack.length}</b> set${q.stack.length === 1 ? '' : 's'}</span><span><b>${q.handCount}</b> in hand</span></div>
    </div>
  </div>`;
}

function resultsView() {
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const next = state.phase === 'gameOver'
    ? '<button class="big" data-emit="newGame">New game</button>'
    : '<button class="big" data-emit="nextRound">Next round</button>';
  return `<section class="results">
    <table>
      <tr class="muted"><th></th><th class="r">Round</th><th class="r">Total</th></tr>
      ${ranked.map((q) => `<tr class="${q.id === me ? 'me' : ''}">
        <td>${state.winners.includes(q.id) ? '🏆 ' : ''}${esc(q.name)}</td><td class="r">+${dollars(q.roundScore)}</td><td class="r"><b>${dollars(q.score)}</b></td>
      </tr>`).join('')}
    </table>
    ${next}
  </section>`;
}
