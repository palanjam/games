import {
  socket, esc, byId, cardHtml, backHtml, badges, bookProgress, where, scoreGridHtml, roundTableHtml,
  rankText, isWild,
} from '/g/hand-and-foot/ui.js';
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

const logo = (cls = '') => `<div class="logo ${cls}"><span>♠</span> HAND &amp; FOOT <span>♥</span></div>`;
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
  const cols = n <= 4 ? 2 : 3;
  const cw = n <= 2 ? 3.6 : n <= 4 ? 3 : 2.6;
  const over = state.phase === 'roundOver' || state.phase === 'gameOver';
  return `<div class="table" style="--cols:${cols};--pcw:${cw}rem">
    <header class="bar">
      ${logo()}
      <div class="banner">${banner()}</div>
    </header>
    <section class="centre">
      <div class="roundbox"><small>Round</small><b>${state.round}<i>/${state.rounds}</i></b></div>
      <div class="openbox"><small>Opening min</small><b>${state.openingMin}</b></div>
      <div class="pile"><div class="deck">${backHtml()}</div><span>Stock <b>${state.stockCount}</b></span></div>
      <div class="pile">${state.discardTop ? cardHtml(state.discardTop) : '<span class="card empty"></span>'}
        <span>Discard <b>${state.discardCount}</b>${state.discardTop && state.discardBlocked ? ` <span class="blocked">${state.discardCount < 5 ? 'under 5' : 'blocked'}</span>` : ''}</span></div>
    </section>
    <section class="grid">${state.players.map(panel).join('')}</section>
    <aside class="side">
      <div class="mini-join">${esc(info.joinUrl)}</div>
      ${over ? `<h3>Round ${state.round}</h3>${roundTableHtml(state)}` : ''}
      <h3>Scores <small class="muted">highest wins</small></h3>
      ${scoreGridHtml(state)}
      ${state.waiting.length ? `<p class="muted waiting">Joining next round: ${state.waiting.map((w) => `${esc(w.name)} ${removeBtn(w.id, `Remove ${w.name}?`)}`).join(', ')}</p>` : ''}
      ${over ? '' : `<h3>Table talk</h3>
      <div class="log">${state.log.slice(-8).reverse().map((l) => `<div>${esc(l.text)}</div>`).join('')}</div>`}
      <button class="ghost" data-emit="newGame" data-confirm="Abandon this game and return to the lobby?">Back to lobby</button>
    </aside>
  </div>`;
}

const removeBtn = (id, confirmText) => `<button class="x" title="Remove" data-emit="kick" data-arg="${esc(JSON.stringify({ playerId: id }))}" data-confirm="${esc(confirmText)}">×</button>`;

function banner() {
  if (state.phase === 'gameOver') {
    if (!state.winners.length) return 'Game over <button data-emit="newGame">New game</button>';
    const names = state.winners.map(name).join(' & ');
    return `<span class="win">🏆 ${names} win${state.winners.length > 1 ? '' : 's'}!</span>
      <button data-emit="newGame">New game</button>`;
  }
  if (state.phase === 'roundOver') {
    const out = state.abandoned ? 'Not enough players. ' : state.outId ? `${name(state.outId)} went out. ` : 'The stock ran out. ';
    return `${out}Round ${state.round} over <button data-emit="nextRound">Next round ▶</button>`;
  }
  const actor = byId(state, state.turnId);
  const text = actor ? `<span><b>${esc(actor.name)}</b> is ${state.stage === 'draw' ? 'drawing' : 'playing'}</span>` : '';
  const help = actor && !actor.connected
    ? ` <button class="ghost" data-emit="autoplay">${esc(actor.name)} is offline: play for them</button>`
    : '';
  return `${text}${help}`;
}

// One pile as a single face-up card with its size and book state.
function pileTile(q) {
  const face = q.cards.find((c) => !isWild(c)) ?? q.cards[0];
  const wilds = q.cards.filter(isWild).length;
  return `<span class="bpile ${q.book ?? ''}">${cardHtml(face)}
    <span class="n">×${q.cards.length}${wilds ? ` <small>${wilds}w</small>` : ''}</span>
    <em>${q.book ? (q.book === 'clean' ? 'CLEAN' : 'DIRTY') : `${rankText(q.rank)} ${q.cards.length}/7`}</em></span>`;
}

function panel(p) {
  const classes = ['panel'];
  if (state.phase === 'playing' && state.turnId === p.id) classes.push('turn');
  if (state.winners.includes(p.id)) classes.push('winner');
  return `<article class="${classes.join(' ')}">
    <div class="head">
      <h2>${esc(p.name)}</h2>
      ${removeBtn(p.id, `Remove ${p.name} from the game?`)}
      ${badges(state, p)}
      <span class="hs">${p.score}</span>
    </div>
    <div class="stats"><span><b>${where(p)}</b></span>${p.opened ? '' : '<span>not open</span>'}${bookProgress(p)}</div>
    <div class="body"><div class="bpiles">${p.piles.map(pileTile).join('') || '<span class="muted">No piles yet</span>'}</div></div>
  </article>`;
}
