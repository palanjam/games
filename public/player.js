import { socket, esc, byId, beginCards, endCards, handHtml, STATUS, pendingText } from './ui.js';

// `?seat=2` gives a separate identity, handy for testing several players in one browser.
const KEY = `flip7-token${new URLSearchParams(location.search).get('seat') ?? ''}`;
const store = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} },
};

const app = document.getElementById('app');
let state = null;
let me = undefined; // undefined until the server has told us who we are
let lastTurn = null;

socket.on('connect', () => socket.emit('hello', { token: store.get() }));
socket.on('you', ({ playerId, token }) => {
  me = playerId;
  store.set(token ?? null);
  render();
});
socket.on('state', (s) => {
  state = s;
  const myMove = s.turnId === me && !s.pending || s.pending?.chooserId === me;
  if (myMove && lastTurn !== `${s.round}:${s.log.at(-1)?.id}` && navigator.vibrate) navigator.vibrate(120);
  if (myMove) lastTurn = `${s.round}:${s.log.at(-1)?.id}`;
  render();
});

function render() {
  if (!state || me === undefined) return;
  const joining = !me || !byId(state, me);
  // Don't rebuild the join form while someone is typing into it.
  if (joining && state.phase === 'lobby' && document.getElementById('join')) return;
  beginCards(state);
  app.innerHTML = joining ? joinView() : state.phase === 'lobby' ? lobbyView() : gameView();
  endCards();
}

function joinView() {
  if (state.phase !== 'lobby') {
    return `<div class="center">
      <div class="logo">FLIP <span>7</span></div>
      <p class="muted">A game is in progress.<br>You can join when the table returns to the lobby.</p>
    </div>`;
  }
  return `<form class="center" id="join">
    <div class="logo">FLIP <span>7</span></div>
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
  return `<div class="center">
    <div class="logo">FLIP <span>7</span></div>
    <p>You're in! Waiting for everyone to join…</p>
    <ul class="names">${state.players.map((p) => `<li class="${p.id === me ? 'me' : ''}">${esc(p.name)}</li>`).join('')}</ul>
    <button class="big" data-emit="start" ${n < 2 ? 'disabled' : ''}>Start game (${n} player${n === 1 ? '' : 's'})</button>
    <button class="ghost" data-emit="leave">Leave</button>
  </div>`;
}

function gameView() {
  const p = byId(state, me);
  const myTurn = state.phase === 'playing' && state.turnId === me && !state.pending;
  return `
    <header class="top">
      <span>Round ${state.round}</span>
      <span>Total <b>${p.score}</b> / ${state.targetScore}</span>
    </header>
    <section class="banner ${myTurn || state.pending?.chooserId === me ? 'go' : ''}">${bannerText(p, myTurn)}</section>
    <section class="mine">
      <div class="row">
        <h2>${esc(p.name)} ${badges(p)}</h2>
        <span class="pts">${p.handScore} <small>pts</small></span>
      </div>
      <div class="hand">${handHtml(p)}</div>
    </section>
    ${myTurn ? `<section class="actions">
      <button class="hit" data-emit="hit">HIT</button>
      <button class="stay" data-emit="stay">STAY</button>
    </section>` : ''}
    ${state.phase === 'roundOver' || state.phase === 'gameOver' ? resultsView() : ''}
    <section class="others">
      ${state.players.filter((q) => q.id !== me).map(otherRow).join('')}
    </section>
    <footer class="log">${state.log.slice(-4).reverse().map((l) => `<div>${esc(l.text)}</div>`).join('')}</footer>
    ${state.pending?.chooserId === me ? chooser() : ''}`;
}

function bannerText(p, myTurn) {
  if (state.phase === 'gameOver') {
    return state.winners.includes(me) ? '🏆 You win!' : `${state.winners.map((id) => esc(byId(state, id).name)).join(' & ')} won`;
  }
  if (state.phase === 'roundOver') return `Round over — you scored ${p.roundScore}`;
  if (state.pending) return state.pending.chooserId === me ? 'Make your choice!' : esc(pendingText(state));
  if (myTurn) return 'Your turn — hit or stay?';
  if (p.status === 'busted') return 'Bust! Better luck next round.';
  if (p.status === 'stayed' || p.status === 'frozen') return `Banked ${p.handScore} — watching the others`;
  const turn = byId(state, state.turnId);
  return turn ? `Waiting for ${esc(turn.name)}…` : '…';
}

function badges(p) {
  const out = [];
  if (STATUS[p.status]) out.push(`<span class="badge ${p.status}">${STATUS[p.status]}</span>`);
  if (state.dealerId === p.id) out.push('<span class="badge dealer">Dealer</span>');
  if (!p.connected) out.push('<span class="badge offline">Offline</span>');
  return out.join(' ');
}

function otherRow(p) {
  const turn = state.turnId === p.id ? ' turn' : '';
  return `<div class="other${turn}">
    <div class="row">
      <b>${esc(p.name)}</b> ${badges(p)}
      <span class="spacer"></span>
      <span class="pts">${p.handScore}</span>
      <span class="total">Total ${p.score}</span>
    </div>
    <div class="hand mini">${handHtml(p)}</div>
  </div>`;
}

function chooser() {
  const pend = state.pending;
  const title = pend.kind === 'secondChance'
    ? 'Give your extra Second Chance to…'
    : pend.card.value === 'freeze'
      ? 'Freeze who? They bank their points and are out of the round.'
      : 'Flip Three on who? They must flip three cards.';
  const opts = pend.options.map((id) => {
    const q = byId(state, id);
    const arg = esc(JSON.stringify({ targetId: id }));
    return `<button data-emit="choose" data-arg="${arg}">
      ${id === me ? 'Me' : esc(q.name)} <small>${q.handScore} pts · ${q.numbers.length} cards</small>
    </button>`;
  });
  return `<div class="sheet"><div class="sheet-body">
    <h3>${title}</h3>
    ${opts.join('')}
  </div></div>`;
}

function resultsView() {
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const next = state.phase === 'gameOver'
    ? '<button class="big" data-emit="newGame">New game</button>'
    : '<button class="big" data-emit="nextRound">Next round</button>';
  return `<section class="results">
    <table>${ranked.map((q) => `<tr class="${q.id === me ? 'me' : ''}">
      <td>${esc(q.name)}</td><td class="r">+${q.roundScore}</td><td class="r"><b>${q.score}</b></td>
    </tr>`).join('')}</table>
    ${next}
  </section>`;
}
