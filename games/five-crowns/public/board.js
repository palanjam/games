import { socket, esc, byId, cardHtml, backHtml, laidHtml, badges, scoreGridHtml, wildText } from './ui.js';
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

const logo = (cls = '') => `<div class="logo ${cls}"><span>♛</span> FIVE CROWNS</div>`;
const name = (id) => esc(byId(state, id)?.name ?? '?');

function lobbyView() {
  const n = state.players.length;
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
    <button class="big" data-emit="start" ${n < 2 ? 'disabled' : ''}>Start game</button>
  </div>`;
}

function tableView() {
  const n = state.players.length;
  const cols = n <= 4 ? 2 : n <= 6 ? 3 : 4;
  // Fewer players means more room, so their cards can be bigger.
  const cw = n <= 2 ? 3.4 : n <= 4 ? 2.7 : n <= 6 ? 2.2 : 1.9;
  return `<div class="table" style="--cols:${cols};--pcw:${cw}rem">
    <header class="bar">
      ${logo()}
      <div class="banner">${banner()}</div>
    </header>
    <section class="centre">
      <div class="roundbox"><small>Round</small><b>${state.round}<i>/${state.rounds}</i></b></div>
      <div class="wildbox"><small>Wild</small><b>${esc(wildText(state.wildRank))}</b><small>+ Jokers</small></div>
      <div class="pile"><div class="deck">${backHtml()}</div><span>Deck <b>${state.deckCount}</b></span></div>
      <div class="pile">${state.discardTop ? cardHtml(state.discardTop, state.wildRank) : '<span class="card empty"></span>'}<span>Discard <b>${state.discardCount}</b></span></div>
    </section>
    <section class="grid">${state.players.map(panel).join('')}</section>
    <aside class="side">
      <div class="mini-join">${esc(info.joinUrl)}</div>
      <h3>Scores <small class="muted">lowest wins</small></h3>
      ${scoreGridHtml(state)}
      <h3>Table talk</h3>
      <div class="log">${state.log.slice(-8).reverse().map((l) => `<div>${esc(l.text)}</div>`).join('')}</div>
      <button class="ghost" data-emit="newGame" data-confirm="Abandon this game and return to the lobby?">Back to lobby</button>
    </aside>
  </div>`;
}

function banner() {
  if (state.phase === 'gameOver') {
    // Winners who leave after the game are dropped from the list, so it can end up empty.
    if (!state.winners.length) return 'Game over <button data-emit="newGame">New game</button>';
    const names = state.winners.map(name).join(' & ');
    return `<span class="win">🏆 ${names} win${state.winners.length > 1 ? '' : 's'}!</span>
      <button data-emit="newGame">New game</button>`;
  }
  if (state.phase === 'roundOver') {
    return `Round ${state.round} over <button data-emit="nextRound">Next round ▶</button>`;
  }
  const actor = byId(state, state.turnId);
  const last = state.outId ? `<span class="lastturn">Last turn! ${name(state.outId)} is out</span>` : '';
  const text = actor ? `<span><b>${esc(actor.name)}</b> is ${state.stage === 'draw' ? 'drawing' : 'discarding'}</span>` : '';
  const help = actor && !actor.connected
    ? ` <button class="ghost" data-emit="autoplay">${esc(actor.name)} is offline: play for them</button>`
    : '';
  return `${last} ${text}${help}`;
}

function panel(p) {
  const classes = ['panel'];
  if (state.phase === 'playing' && state.turnId === p.id) classes.push('turn');
  if (state.winners.includes(p.id)) classes.push('winner');
  const body = p.laid
    ? laidHtml(p.laid, state.wildRank)
    : `<span class="backs" style="--n:${p.handCount}">${Array.from({ length: p.handCount }, backHtml).join('')}</span>`;
  // The player who went out already shows an Out badge; Done would only crowd the header.
  const status = p.lastTurnDone && p.id !== state.outId ? '<span class="badge out">Done</span>' : '';
  return `<article class="${classes.join(' ')}">
    <div class="head">
      <h2>${esc(p.name)}</h2>
      ${badges(state, p)} ${status}
      <span class="hs">${p.score}</span>
    </div>
    <div class="body">${body}</div>
    <div class="foot">${p.laid ? `<b>${p.laid.points}</b> pts this round` : `<b>${p.handCount}</b> cards`}</div>
  </article>`;
}
