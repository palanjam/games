import { socket, esc, byId, beginCards, endCards, handHtml, STATUS, pendingText } from './ui.js';
import { roomInfo } from '/lib/room.js';

const app = document.getElementById('app');
let state = null;
let info = { joinUrl: '', qrSvg: '' };

roomInfo.then((i) => { if (i) { info = i; render(); } });
socket.on('state', (s) => { state = s; render(); });

function render() {
  if (!state) return;
  beginCards(state);
  app.innerHTML = state.phase === 'lobby' ? lobbyView() : tableView();
  endCards();
}

function lobbyView() {
  const n = state.players.length;
  return `<div class="lobby">
    <div class="logo huge">FLIP <span>7</span></div>
    <div class="join">
      <div class="qr">${info.qrSvg}</div>
      <div>
        <p class="muted">Scan with your phone, or open</p>
        <p class="url">${esc(info.joinUrl)}</p>
        <p class="muted">Room code <b class="code">${esc(info.code ?? '')}</b></p>
        <p class="muted">First to ${state.targetScore} points wins.</p>
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
  const cols = n <= 2 ? n : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  return `<div class="table" style="--cols:${cols}">
    <header class="bar">
      <div class="logo">FLIP <span>7</span></div>
      <div class="banner">${banner()}</div>
      <div class="deck"><div class="card back"><b>7</b></div><span>${state.deckCount}</span></div>
    </header>
    <section class="grid">${state.players.map(panel).join('')}</section>
    <aside class="side">
      <div class="mini-join">${info.qrSvg}<span>${esc(info.joinUrl)}</span></div>
      ${waitingLine()}
      <h3>Scores <small class="muted">to ${state.targetScore}</small></h3>
      <ol class="scores">${scoreRows()}</ol>
      <h3>Table talk</h3>
      <div class="log">${state.log.slice(-12).reverse().map((l) => `<div>${esc(l.text)}</div>`).join('')}</div>
      <button class="ghost" data-emit="newGame" data-confirm="Abandon this game and return to the lobby?">Back to lobby</button>
    </aside>
  </div>`;
}

function removeBtn(id, confirm) {
  return `<button class="x" title="Remove" data-emit="kick" data-arg="${esc(JSON.stringify({ playerId: id }))}" data-confirm="${esc(confirm)}">×</button>`;
}

function waitingLine() {
  if (!state.waiting?.length) return '';
  return `<p class="muted joining">Joining next round: ${state.waiting.map((w) => `${esc(w.name)} ${removeBtn(w.id, `Remove ${w.name}?`)}`).join(', ')}</p>`;
}

function banner() {
  if (state.phase === 'gameOver') {
    const names = state.winners.map((id) => esc(byId(state, id).name)).join(' & ');
    return `<span class="win">🏆 ${names} win${state.winners.length > 1 ? '' : 's'}!</span>
      <button data-emit="newGame">New game</button>`;
  }
  if (state.phase === 'roundOver') {
    return `Round ${state.round} over <button data-emit="nextRound">Next round ▶</button>`;
  }
  const actorId = state.pending?.chooserId ?? state.turnId;
  const actor = byId(state, actorId);
  const text = state.pending ? esc(pendingText(state)) : actor ? `<span><b>${esc(actor.name)}</b>, hit or stay?</span>` : '';
  const help = actor && !actor.connected
    ? ` <button class="ghost" data-emit="autoplay">${esc(actor.name)} is offline — ${state.pending ? 'choose randomly' : 'stay for them'}</button>`
    : '';
  return `<span class="muted">Round ${state.round}</span> ${text}${help}`;
}

function panel(p) {
  const classes = ['panel', p.status];
  if (state.phase === 'playing' && (state.pending ? state.pending.chooserId === p.id : state.turnId === p.id)) classes.push('turn');
  const over = state.phase !== 'playing';
  return `<article class="${classes.join(' ')}">
    <div class="head">
      <h2>${esc(p.name)}</h2>
      ${removeBtn(p.id, `Remove ${p.name} from the game?`)}
      ${STATUS[p.status] ? `<span class="badge ${p.status}">${STATUS[p.status]}</span>` : ''}
      ${state.dealerId === p.id ? '<span class="badge dealer">Dealer</span>' : ''}
      ${p.connected ? '' : '<span class="badge offline">Offline</span>'}
      <span class="spacer"></span>
      <span class="hs">${over ? `+${p.roundScore}` : p.handScore}</span>
    </div>
    <div class="hand">${handHtml(p)}</div>
    <div class="foot">Total <b>${p.score}</b></div>
  </article>`;
}

function scoreRows() {
  return [...state.players]
    .sort((a, b) => b.score - a.score)
    .map((p) => {
      const pct = Math.min(100, (p.score / state.targetScore) * 100);
      return `<li><span>${esc(p.name)}</span><b>${p.score}</b><i style="width:${pct}%"></i></li>`;
    })
    .join('');
}
