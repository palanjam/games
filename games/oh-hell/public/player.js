import { socket, esc, byId, cardHtml, sortHand, cardText, badges, trumpHtml, playsHtml, scoreGridHtml, roundResultsHtml, patternLabel } from './ui.js';
import { claimSeat, code } from '/lib/room.js';

const app = document.getElementById('app');
let state = null;
let me = undefined; // undefined until the server has told us who we are
let lastBuzz = null;

claimSeat((playerId) => {
  me = playerId;
  render();
});
socket.on('state', (s) => {
  state = s;
  const key = `${s.round}:${s.stage}:${s.trick.length}:${s.log.at(-1)?.id}`;
  if (myTurn() && lastBuzz !== key && navigator.vibrate) navigator.vibrate(120);
  if (myTurn()) lastBuzz = key;
  render();
});

const myTurn = () => state.phase === 'playing' && state.turnId === me;
const waiting = () => !!me && (state.waiting ?? []).some((w) => w.id === me);
const name = (id) => esc(byId(state, id)?.name ?? '?');

function render() {
  if (!state || me === undefined) return;
  const joining = !me || (!byId(state, me) && !waiting());
  // Keep the join form while someone types; rebuild it (keeping the name)
  // only when the game starts or returns to the lobby, as its note changes.
  const form = document.getElementById('join');
  if (joining && form?.dataset.lobby === String(state.phase === 'lobby')) return;
  const typed = form ? document.getElementById('name')?.value : '';
  app.innerHTML = joining ? joinView() : waiting() ? waitingView() : state.phase === 'lobby' ? lobbyView() : gameView();
  const input = document.getElementById('name');
  if (typed && input) input.value = typed;
}

const logo = '<div class="logo"><span>♠</span> OH HELL <span>♥</span></div>';

function joinView() {
  const note = state.phase === 'lobby'
    ? ''
    : '<p class="muted">A game is in progress.<br>Join now and you\'ll be dealt in at the start of the next round.</p>';
  return `<form class="center" id="join" data-lobby="${state.phase === 'lobby'}">${logo}
    ${note}
    <input id="name" maxlength="16" placeholder="Your name" autocomplete="nickname" autofocus>
    <button class="big" type="submit">Join the table</button>
  </form>`;
}

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'join') return;
  e.preventDefault();
  socket.emit('join', { name: document.getElementById('name').value });
});

function patternPicker() {
  return `<div class="patterns">${(state.patterns ?? []).map((m) => {
    const [title, sub] = patternLabel[m] ?? [m, ''];
    return `<button aria-pressed="${state.pattern === m}" data-emit="setPattern" data-arg='{"pattern":"${esc(m)}"}'>${esc(title)}<small>${esc(sub)}</small></button>`;
  }).join('')}</div>`;
}

function lobbyView() {
  const n = state.players.length;
  return `<div class="center">${logo}
    <p>You're in! Waiting for everyone to join…</p>
    <p class="muted">Room code <b class="code">${esc(code)}</b> · <a href="/r/${esc(code)}/board" target="_blank">table screen</a></p>
    <button class="ghost" data-share>Invite people</button>
    <ul class="names">${state.players.map((p) => `<li class="${p.id === me ? 'me' : ''}">${esc(p.name)}</li>`).join('')}</ul>
    <h3 class="muted">Deal pattern</h3>
    ${patternPicker()}
    <button class="big" data-emit="start" ${n < 3 ? 'disabled' : ''}>Start game (${n} player${n === 1 ? '' : 's'})</button>
    <p class="hint">Oh Hell needs 3 to 7 players.</p>
    <button class="ghost" data-emit="leave">Leave</button>
  </div>`;
}

function waitingView() {
  return `<div class="center">${logo}
    <p>You're in! You'll be dealt in at the start of the next round.</p>
    <p class="muted">Current scores</p>
    <ul class="names">${[...state.players].sort((a, b) => b.score - a.score).map((p) => `<li>${esc(p.name)} <b>${p.score}</b></li>`).join('')}</ul>
    <button class="ghost" data-emit="leave">Leave</button>
  </div>`;
}

function gameView() {
  const p = byId(state, me);
  const over = state.phase === 'roundOver' || state.phase === 'gameOver';
  const bidding = myTurn() && state.stage === 'bid';
  const playing = myTurn() && state.stage === 'play';
  return `
    <header class="top">
      <span>Round <b>${state.round}</b>/${state.rounds}</span>
      <span>${state.handSize} card${state.handSize === 1 ? '' : 's'}</span>
      ${trumpHtml(state)}
    </header>
    <section class="banner ${bidding || playing ? 'go' : ''}">${bannerText()}</section>
    ${over ? resultsView() : ''}
    ${over ? '' : trickView()}
    ${bidding ? bidView() : ''}
    <div class="mybid"><span>Bid <b>${p.bid ?? '–'}</b></span><span>Won <b>${p.tricks ?? 0}</b></span><span>Total <b>${p.score}</b></span></div>
    ${over ? '' : handView(playing)}
    <section class="others">${state.players.filter((q) => q.id !== me).map(otherRow).join('')}</section>
    <footer class="log">${state.log.slice(-4).reverse().map((l) => `<div>${esc(l.text)}</div>`).join('')}</footer>`;
}

function bannerText() {
  if (state.phase === 'gameOver') {
    if (!state.winners.length) return 'Game over';
    return state.winners.includes(me) ? '🏆 You win!' : `${state.winners.map(name).join(' & ')} won`;
  }
  if (state.phase === 'roundOver') return `Round ${state.round} over`;
  if (state.turnId === me) return state.stage === 'bid' ? 'Your turn: place your bid' : 'Your turn: play a card';
  return `${name(state.turnId)} is ${state.stage === 'bid' ? 'bidding' : 'playing'}…`;
}

function trickView() {
  const cur = state.trick.length
    ? playsHtml(state, state.trick)
    : `<span class="none">${state.stage === 'bid' ? 'Bidding…' : 'No cards played yet'}</span>`;
  const led = state.ledSuit && state.trick.length ? ` <span class="muted">· led ${esc(cardText({ rank: '', suit: state.ledSuit }))}</span>` : '';
  const last = state.lastTrick
    ? `<div class="trickbox last"><h3>Last trick: ${name(state.lastTrick.winnerId)} won</h3>${playsHtml(state, state.lastTrick.plays, state.lastTrick.winnerId)}</div>`
    : '';
  return `<section class="trickbox"><h3>This trick${led}</h3>${cur}</section>${last}`;
}

function bidView() {
  const buttons = Array.from({ length: state.handSize + 1 }, (_, i) => {
    const blocked = state.forbiddenBid === i;
    return `<button data-emit="bid" data-arg='{"bid":${i}}' ${blocked ? 'disabled' : ''}>${i}</button>`;
  }).join('');
  const hint = state.forbiddenBid !== null && state.forbiddenBid !== undefined
    ? `You can't bid ${state.forbiddenBid}: bids would total ${state.handSize}.`
    : `Bids so far: ${state.bidTotal} of ${state.handSize} tricks.`;
  return `<section class="bids">${buttons}</section><p class="hint">${hint}</p>`;
}

function handView(playing) {
  const hand = state.you?.hand ?? [];
  if (!hand.length) return '<section class="mine"><span class="muted">No cards in hand</span></section>';
  const ok = new Set((state.you?.playable ?? []).map(String));
  const cards = sortHand(hand).map((c) => {
    const can = playing && ok.has(String(c.id));
    const cls = ['cardbtn', playing ? (can ? 'ok' : 'dim') : ''].join(' ');
    return `<button class="${cls}" data-emit="play" data-arg='{"cardId":${JSON.stringify(c.id)}}' ${can ? '' : 'disabled'} aria-label="${esc(cardText(c))}">${cardHtml(c)}</button>`;
  }).join('');
  return `<section class="mine"><div class="hand">${cards}</div></section>`;
}

function otherRow(q) {
  const cls = ['other'];
  if (state.phase === 'playing' && state.turnId === q.id) cls.push('turn');
  return `<div class="${cls.join(' ')}"><div class="row"><b class="oname">${esc(q.name)}</b> ${badges(state, q)}<span class="spacer"></span>
    <span class="ostats">bid <b>${q.bid ?? '–'}</b> · won <b>${q.tricks ?? 0}</b> · <b>${q.score}</b> pts · ${q.cardCount} card${q.cardCount === 1 ? '' : 's'}</span></div></div>`;
}

function resultsView() {
  const next = state.phase === 'gameOver'
    ? '<button class="big" data-emit="newGame">New game</button>'
    : '<button class="big" data-emit="nextRound">Next round</button>';
  const lt = state.lastTrick ? `<div class="trickbox last"><h3>Last trick: ${name(state.lastTrick.winnerId)} won</h3>${playsHtml(state, state.lastTrick.plays, state.lastTrick.winnerId)}</div>` : '';
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  return `<section class="results">
    <h3>This round</h3>
    ${roundResultsHtml(state, me)}
    ${lt}
    <h3>Scores</h3>
    ${scoreGridHtml(state)}
    ${state.phase === 'gameOver' ? `<p class="muted center-text">${ranked.map((q) => `${esc(q.name)} ${q.score}`).join(' · ')}</p>` : ''}
    ${next}
  </section>`;
}
