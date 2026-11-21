import { socket, esc, byId, cardHtml, backHtml, meldHtml, deadwoodHtml, laidHtml, badges, scoreGridHtml, cardText, wildText } from './ui.js';
import { arrange } from '/g/five-crowns/melds.js';
import { claimSeat, code } from '/lib/room.js';

const app = document.getElementById('app');
let state = null;
let me = undefined; // undefined until the server has told us who we are
let lastBuzz = null;

// Local UI state: the card tapped for discarding. Kept as a string because it
// comes back from a data attribute.
let picked = null;

claimSeat((playerId) => {
  me = playerId;
  render();
});
socket.on('state', (s) => {
  state = s;
  const key = `${s.round}:${s.stage}:${s.log.at(-1)?.id}`;
  if (isMyDraw() && lastBuzz !== key && navigator.vibrate) navigator.vibrate(120);
  if (isMyDraw()) lastBuzz = key;
  render();
});

const myTurn = () => state.phase === 'playing' && state.turnId === me;
const isMyDraw = () => myTurn() && state.stage === 'draw';
const myDiscard = () => myTurn() && state.stage === 'discard';

function render() {
  if (!state || me === undefined) return;
  const joining = !me || !byId(state, me);
  // Don't rebuild the join form while someone is typing into it.
  if (joining && state.phase === 'lobby' && document.getElementById('join')) return;
  app.innerHTML = joining ? joinView() : state.phase === 'lobby' ? lobbyView() : gameView();
}

const logo = '<div class="logo"><span>♛</span> FIVE CROWNS <span>♛</span></div>';

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

// ---- selection ----------------------------------------------------------

// Drop a selection that no longer makes sense (card gone, turn passed).
function syncSelection(hand) {
  if (!myDiscard() || !hand.some((c) => String(c.id) === picked)) picked = null;
}

document.addEventListener('click', (e) => {
  if (!state) return;
  const card = e.target.closest('[data-card]');
  if (!card) return;
  picked = picked === card.dataset.card ? null : card.dataset.card;
  render();
});

// Emitting discard clears the selection at once; the next state re-renders.
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-emit="discard"]')) picked = null;
});

// ---- play view ----------------------------------------------------------

const arg = (o) => esc(JSON.stringify(o));

function gameView() {
  const p = byId(state, me);
  const hand = state.you?.hand ?? [];
  syncSelection(hand);
  const over = state.phase === 'roundOver' || state.phase === 'gameOver';
  return `
    <header class="top">
      <span>Round <b>${state.round}</b>/${state.rounds}</span>
      <span class="wildchip">Wild: <b>${esc(wildText(state.wildRank))}</b></span>
      <span>Total <b>${p.score}</b></span>
    </header>
    <section class="banner ${isMyDraw() || myDiscard() ? 'go' : ''} ${state.outId && !over ? 'last' : ''}">${bannerText()}</section>
    ${over ? resultsView() : ''}
    <section class="table">
      <div class="pile">${state.discardTop ? cardHtml(state.discardTop, state.wildRank) : '<span class="card empty"></span>'}<small class="muted">Discard (${state.discardCount})</small></div>
      <div class="pile">${backHtml()}<small class="muted">Deck (${state.deckCount})</small></div>
    </section>
    ${isMyDraw() ? drawView() : ''}
    ${over ? '' : handView(p, hand)}
    ${myDiscard() ? discardActions(hand) : ''}
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
  if (state.phase === 'roundOver') return `Round ${state.round} over`;
  const turn = byId(state, state.turnId);
  const last = state.outId ? '<b class="lastturn">Last turn!</b> ' : '';
  if (state.turnId === me) return `${last}${state.stage === 'draw' ? 'Your turn: draw a card' : 'Now discard a card'}`;
  return `${last}${esc(turn?.name ?? '?')} is ${state.stage === 'draw' ? 'drawing' : 'discarding'}…`;
}

function drawView() {
  const top = state.discardTop;
  return `<section class="draws">
    <button class="big" data-emit="draw" data-arg='{"from":"deck"}'>Draw from deck</button>
    <button class="big alt" data-emit="draw" data-arg='{"from":"discard"}' ${top ? '' : 'disabled'}>${top ? `Take ${esc(cardText(top))}` : 'No discard'}</button>
  </section>`;
}

// Hand grouped by the solver: melds as tight groups, then leftovers with
// their penalty. During the discard stage each card is a tap target.
function handView(p, hand) {
  if (!hand.length) return '<section class="mine"><span class="muted">No cards in hand</span></section>';
  const a = arrange(hand, state.wildRank);
  const tappable = myDiscard();
  const wrap = (c, html) => {
    const cls = ['cardbtn'];
    if (picked === String(c.id)) cls.push('sel');
    if (state.you.drawnId !== null && String(state.you.drawnId) === String(c.id)) cls.push('drawn');
    return `<button class="${cls.join(' ')}" data-card="${esc(c.id)}" aria-pressed="${picked === String(c.id)}" ${tappable ? '' : 'disabled'}>${html}</button>`;
  };
  return `<section class="mine">
    <div class="row"><h2>${esc(p.name)} ${badges(state, p)}</h2>
      <span class="left">${a.points === 0 ? '<b class="ok">All melded</b>' : `Left over <b>${a.points}</b>`}</span></div>
    <div class="hand">
      ${a.melds.map((m) => meldHtml(m, state.wildRank, wrap)).join('')}
      ${deadwoodHtml(a.deadwood, state.wildRank, a.points, wrap)}
    </div>
  </section>`;
}

function discardActions(hand) {
  const card = hand.find((c) => String(c.id) === picked);
  let leftover = null;
  if (card) leftover = arrange(hand.filter((c) => c !== card), state.wildRank).points;
  const a = card ? { cardId: card.id } : null;
  const hint = !card ? 'Tap a card to discard it.'
    : leftover === 0 ? `Discard ${esc(cardText(card))} and your whole hand melds: you can go out!`
    : `Discarding ${esc(cardText(card))} leaves ${leftover} point${leftover === 1 ? '' : 's'}.`;
  return `<section class="actions">
    <p class="hint">${hint}</p>
    <button data-emit="discard" ${a ? `data-arg="${arg({ ...a, goOut: false })}"` : 'disabled'}>Discard</button>
    <button class="out" data-emit="discard" ${a && leftover === 0 ? `data-arg="${arg({ ...a, goOut: true })}"` : 'disabled'}>Discard &amp; go out</button>
  </section>`;
}

function otherRow(q) {
  const cls = ['other'];
  if (state.phase === 'playing' && state.turnId === q.id) cls.push('turn');
  const status = q.lastTurnDone ? '<span class="badge out">Done</span>' : '';
  return `<div class="${cls.join(' ')}">
    <div class="row"><b class="oname">${esc(q.name)}</b> ${badges(state, q)} ${status}<span class="spacer"></span>
      <span class="ostats"><b>${q.handCount}</b> cards · <b>${q.score}</b> pts</span></div>
    ${q.laid ? `<div class="olaid">${laidHtml(q.laid, state.wildRank)}</div>` : ''}
  </div>`;
}

function resultsView() {
  const next = state.phase === 'gameOver'
    ? '<button class="big" data-emit="newGame">New game</button>'
    : '<button class="big" data-emit="nextRound">Next round</button>';
  const ranked = [...state.players].sort((a, b) => a.score - b.score);
  return `<section class="results">
    ${state.players.map((q) => `<div class="res ${q.id === me ? 'me' : ''}">
      <div class="row"><b>${state.winners.includes(q.id) ? '🏆 ' : ''}${esc(q.name)}</b> ${badges(state, q)}<span class="spacer"></span>
        <span class="rpts">${q.laid ? `+${q.laid.points}` : ''}</span></div>
      ${q.laid ? laidHtml(q.laid, state.wildRank) : ''}
    </div>`).join('')}
    <h3>Scores <small class="muted">lowest wins</small></h3>
    ${scoreGridHtml(state)}
    ${state.phase === 'gameOver' ? `<p class="muted center-text">${ranked.map((q) => `${esc(q.name)} ${q.score}`).join(' · ')}</p>` : ''}
    ${next}
  </section>`;
}
