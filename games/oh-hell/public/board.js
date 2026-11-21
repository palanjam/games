import { socket, esc, byId, cardHtml, badges, trumpHtml, playsHtml, scoreGridHtml, roundResultsHtml, patternLabel } from './ui.js';
import { roomInfo } from '/lib/room.js';

const app = document.getElementById('app');
let state = null;
let info = { code: '', joinUrl: '', qrSvg: '' };

roomInfo.then((i) => { if (i) { info = i; render(); } });
socket.on('state', (s) => { state = s; render(); });

function render() {
  if (!state) return;
  app.innerHTML = state.phase === 'lobby' ? lobbyView() : tableView();
}

const logo = (cls = '') => `<div class="logo ${cls}"><span>♠</span> OH HELL <span>♥</span></div>`;
const name = (id) => esc(byId(state, id)?.name ?? '?');

function lobbyView() {
  const n = state.players.length;
  const patterns = (state.patterns ?? []).map((m) => {
    const [title, sub] = patternLabel[m] ?? [m, ''];
    return `<button aria-pressed="${state.pattern === m}" data-emit="setPattern" data-arg='{"pattern":"${esc(m)}"}'>${esc(title)}<small>${esc(sub)}</small></button>`;
  }).join('');
  return `<div class="lobby">
    ${logo('huge')}
    <div class="join">
      <div class="qr">${info.qrSvg}</div>
      <div>
        <p class="muted">Scan with your phone, or open</p>
        <p class="url">${esc(info.joinUrl)}</p>
        <p class="muted">Room code <b class="code">${esc(info.code)}</b></p>
      </div>
    </div>
    <ul class="chips">${state.players.map((p) => `<li>${esc(p.name)}${p.connected ? '' : ' <span class="badge offline">Offline</span>'}
      <button class="x" title="Remove" data-emit="kick" data-arg="${esc(JSON.stringify({ playerId: p.id }))}">×</button></li>`).join('')
      || '<li class="muted">Waiting for players…</li>'}</ul>
    <div class="patterns">${patterns}</div>
    <button class="big" data-emit="start" ${n < 3 ? 'disabled' : ''}>Start game</button>
    <p class="muted">3 to 7 players</p>
  </div>`;
}

function tableView() {
  const n = state.players.length;
  const cols = n <= 4 ? n : n <= 6 ? 3 : 4;
  const over = state.phase === 'roundOver' || state.phase === 'gameOver';
  return `<div class="table" style="--cols:${cols}">
    <header class="bar">
      ${logo()}
      <div class="banner">${banner()}</div>
    </header>
    <section class="main">
      <div class="roundbox"><small>Round</small><b>${state.round}<i>/${state.rounds}</i></b><small>${state.handSize} card${state.handSize === 1 ? '' : 's'}</small></div>
      <div class="trumpbox">${state.trumpCard ? cardHtml(state.trumpCard) : ''}${trumpHtml(state)}</div>
      <div class="trick">${over ? roundBox() : trickBox()}</div>
    </section>
    <section class="grid">${state.players.map(panel).join('')}</section>
    <aside class="side">
      <div class="mini-join">${esc(info.joinUrl)}</div>
      <h3>Scores</h3>
      <div class="scores">${scoreGridHtml(state)}</div>
      <h3>Table talk</h3>
      <div class="log">${state.log.slice(-8).reverse().map((l) => `<div>${esc(l.text)}</div>`).join('')}</div>
      <button class="ghost" data-emit="newGame" data-confirm="Abandon this game and return to the lobby?">Back to lobby</button>
    </aside>
  </div>`;
}

function trickBox() {
  const cur = state.trick.length
    ? playsHtml(state, state.trick)
    : `<span class="none">${state.stage === 'bid' ? 'Bidding…' : 'Waiting for the lead'}</span>`;
  return `<h3>This trick</h3>${cur}${lastTrickHtml()}`;
}

function lastTrickHtml() {
  return state.lastTrick
    ? `<div class="lt"><h3>Last trick: ${name(state.lastTrick.winnerId)} won</h3>${playsHtml(state, state.lastTrick.plays, state.lastTrick.winnerId)}</div>`
    : '';
}

function roundBox() {
  return `<h3>Round ${state.round} results</h3><div class="rres">${roundResultsHtml(state)}</div>${lastTrickHtml()}`;
}

function banner() {
  if (state.phase === 'gameOver') {
    if (!state.winners.length) return 'Game over <button data-emit="newGame">New game</button>';
    return `<span class="win">🏆 ${state.winners.map(name).join(' & ')} win${state.winners.length > 1 ? '' : 's'}!</span>
      <button data-emit="newGame">New game</button>`;
  }
  if (state.phase === 'roundOver') return `Round ${state.round} over <button data-emit="nextRound">Next round ▶</button>`;
  const actor = byId(state, state.turnId);
  const text = actor ? `<span><b>${esc(actor.name)}</b> is ${state.stage === 'bid' ? 'bidding' : 'playing'}</span>` : '';
  const hook = state.stage === 'bid' && state.forbiddenBid != null ? ` <span class="muted">(can't bid ${state.forbiddenBid})</span>` : '';
  const help = actor && !actor.connected
    ? ` <button class="ghost" data-emit="autoplay">${esc(actor.name)} is offline: play for them</button>`
    : '';
  return `${text}${hook}${help}`;
}

function panel(p) {
  const classes = ['panel'];
  if (state.phase === 'playing' && state.turnId === p.id) classes.push('turn');
  if (state.winners.includes(p.id)) classes.push('winner');
  const on = p.bid !== null && p.bid !== undefined && p.tricks === p.bid ? 'on' : '';
  return `<article class="${classes.join(' ')}">
    <div class="head"><h2>${esc(p.name)}</h2>${badges(state, p)}<span class="hs">${p.score}</span></div>
    <div class="stats"><span>Bid <b>${p.bid ?? '–'}</b></span><span class="${on}">Won <b>${p.tricks ?? 0}</b></span><span><b>${p.cardCount}</b> cards</span></div>
  </article>`;
}
