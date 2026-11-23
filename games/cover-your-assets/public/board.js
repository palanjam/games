import { socket, esc, byId, dollars, cardHtml, setHtml, stackHtml, backHtml, setName, modeText, badges } from './ui.js';
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

const logo = (cls = '') => `<div class="logo ${cls}">COVER YOUR <span>ASSETS</span></div>`;

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
        <p class="muted">${esc(modeText(state))}</p>
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
  const cols = n <= 2 ? n : n <= 4 ? 2 : 3;
  // Fewer players means more room, so their sets can be bigger.
  const top = n <= 2 ? 8 : n <= 4 ? 6.2 : 4.8;
  return `<div class="table" style="--cols:${cols};--cw-top:${top}rem;--cw-low:${(top * 0.55).toFixed(2)}rem">
    <header class="bar">
      ${logo()}
      <div class="banner">${banner()}</div>
    </header>
    <section class="centre">
      <div class="pile"><div class="deck">${backHtml()}</div><span>Deck <b>${state.deckCount}</b></span></div>
      <div class="pile">${state.discardTop ? cardHtml(state.discardTop) : '<span class="card empty"></span>'}<span>Discard <b>${state.discardCount}</b></span></div>
      ${state.battle ? battle() : ''}
    </section>
    <section class="grid">${state.players.map(panel).join('')}</section>
    <aside class="side">
      <div class="mini-join">${info.qrSvg}<span>${esc(info.joinUrl)}</span></div>
      <h3>${state.mode === 'quick' ? 'Round scores' : `Scores <small class="muted">to ${dollars(state.targetScore)}</small>`}</h3>
      <ol class="scores">${scoreRows()}</ol>
      ${waitingLine()}
      <h3>Table talk</h3>
      <div class="log">${state.log.slice(-12).reverse().map((l) => `<div>${esc(l.text)}</div>`).join('')}</div>
      <button class="ghost" data-emit="newGame" data-confirm="Abandon this game and return to the lobby?">Back to lobby</button>
    </aside>
  </div>`;
}

// Remove button for a seated or waiting player, with a confirm so nobody gets booted by accident.
const kick = (p, text) => `<button class="x" title="Remove" data-emit="kick" data-arg="${esc(JSON.stringify({ playerId: p.id }))}" data-confirm="${esc(text)}">×</button>`;

function waitingLine() {
  if (!state.waiting?.length) return '';
  return `<p class="joining muted">Joining next round: ${state.waiting.map((w) => `<span class="wchip">${esc(w.name)} ${kick(w, `Remove ${w.name}?`)}</span>`).join(' ')}</p>`;
}

const name = (id) => esc(byId(state, id)?.name ?? '?');

function banner() {
  if (state.phase === 'gameOver') {
    const names = state.winners.map(name).join(' & ');
    return `<span class="win">🏆 ${names} win${state.winners.length > 1 ? '' : 's'}!</span>
      <button data-emit="newGame">New game</button>`;
  }
  if (state.phase === 'roundOver') {
    return `Round ${state.round} over <button data-emit="nextRound">Next round ▶</button>`;
  }
  const actorId = state.battle?.toMoveId ?? state.turnId;
  const actor = byId(state, actorId);
  const text = state.battle
    ? `<span><b>${name(state.battle.challengerId)}</b> challenges <b>${name(state.battle.defenderId)}</b>: ${name(actorId)} to play</span>`
    : actor ? `<span><b>${esc(actor.name)}</b>'s turn</span>` : '';
  const help = actor && !actor.connected
    ? ` <button class="ghost" data-emit="autoplay">${esc(actor.name)} is offline: ${state.battle ? 'give up for them' : 'discard for them'}</button>`
    : '';
  return `<span class="muted">Round ${state.round}</span> ${text}${help}`;
}

function battle() {
  const b = state.battle;
  return `<div class="battle">
    <div class="vs">⚔ <b>${name(b.challengerId)}</b> vs <b>${name(b.defenderId)}</b>
      <small class="muted">${esc(setName(b.set))} set</small></div>
    <div class="bset">${setHtml(b.set, 'top')}</div>
    <div class="plays">${b.plays.map((pl) => `<div class="play"><small>${name(pl.playerId)}</small>${cardHtml(pl.card)}</div>`).join('')}</div>
  </div>`;
}

function panel(p) {
  const classes = ['panel'];
  if (state.phase === 'playing') {
    if (state.battle) {
      if (state.battle.challengerId === p.id) classes.push('attacker');
      if (state.battle.defenderId === p.id) classes.push('defender');
      if (state.battle.toMoveId === p.id) classes.push('turn');
    } else if (state.turnId === p.id) classes.push('turn');
  }
  if (state.winners.includes(p.id)) classes.push('winner');
  return `<article class="${classes.join(' ')}">
    <div class="head">
      <h2>${esc(p.name)}</h2>
      ${badges(state, p)}
      <span class="spacer"></span>
      <span class="hs">${dollars(p.stackValue)}</span>
      ${kick(p, `Remove ${p.name} from the game?`)}
    </div>
    <div class="body">${stackHtml(p.stack)}</div>
    <div class="foot"><b>${p.stack.length}</b> set${p.stack.length === 1 ? '' : 's'} · <b>${p.handCount}</b> in hand${state.mode === 'quick' ? '' : ` · Total <b>${dollars(p.score)}</b>`}</div>
  </article>`;
}

// Classic: bars toward the target (banked score, plus this round's stack in a
// lighter shade while it is still being played). Quick: this round only.
function scoreRows() {
  const live = state.phase === 'playing';
  const quick = state.mode === 'quick';
  const value = (p) => (quick ? p.stackValue : p.score);
  const scale = quick ? Math.max(1, ...state.players.map((p) => p.stackValue)) : state.targetScore;
  return [...state.players]
    .sort((a, b) => value(b) + (live && !quick ? b.stackValue : 0) - (value(a) + (live && !quick ? a.stackValue : 0)))
    .map((p) => {
      const pct = (v) => Math.min(100, (v / scale) * 100);
      const extra = !quick && live ? `<i class="live" style="left:${pct(p.score)}%;width:${Math.min(pct(p.stackValue), 100 - pct(p.score))}%"></i>` : '';
      return `<li><span>${esc(p.name)}</span><b>${dollars(value(p))}</b><i style="width:${pct(value(p))}%"></i>${extra}</li>`;
    })
    .join('');
}
