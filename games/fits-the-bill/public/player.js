import { socket, esc, byId, logoHtml, promptHtml, answerHtml, scoresHtml, waitingFor } from '/g/fits-the-bill/ui.js';
import { claimSeat, code } from '/lib/room.js';

const app = document.getElementById('app');
let state = null;
let me = undefined; // undefined until the server says who we are
let sel = null;     // tapped card / submission id (string)
let selKey = '';

claimSeat((playerId) => { me = playerId; render(); });
socket.on('state', (s) => {
  const prevKey = key(state);
  state = s;
  if (key(s) !== prevKey) sel = null;
  const mine = s.phase === 'playing' && s.stage === 'submit' && s.judgeId !== me && s.you?.submittedId == null;
  if (mine && prevKey !== key(s) && navigator.vibrate) navigator.vibrate(100);
  render();
});
const key = (s) => (s ? `${s.round}:${s.phase}:${s.stage}` : '');

function render() {
  if (!state || me === undefined) return;
  const joining = !me || !byId(state, me);
  if (joining && state.phase === 'lobby' && document.getElementById('join')) return;
  app.innerHTML = joining ? joinView() : state.phase === 'lobby' ? lobbyView() : gameView();
}

function joinView() {
  if (state.phase !== 'lobby') {
    return `<div class="center">${logoHtml()}
      <p class="muted">A game is in progress.<br>You can join when the table returns to the lobby.</p></div>`;
  }
  return `<form class="center" id="join">${logoHtml()}
    <input id="name" maxlength="16" placeholder="Your name" autocomplete="nickname" autofocus>
    <button class="big" type="submit">Join the table</button></form>`;
}
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'join') return;
  e.preventDefault();
  socket.emit('join', { name: document.getElementById('name').value });
});

function lobbyView() {
  const n = state.players.length;
  const t = state.target;
  const set = (v) => esc(JSON.stringify({ target: v }));
  return `<div class="center">${logoHtml()}
    <p>You're in! Waiting for everyone to join…</p>
    <p class="muted">Room code <b class="code">${esc(code)}</b> · <a href="/r/${esc(code)}/board" target="_blank">table screen</a></p>
    <button class="ghost" data-share>Invite people</button>
    <ul class="names">${state.players.map((p) => `<li class="${p.id === me ? 'me' : ''}">${esc(p.name)}</li>`).join('')}</ul>
    <div class="target"><button data-emit="setTarget" data-arg="${set(t - 1)}" ${t <= 3 ? 'disabled' : ''}>−</button>
      <div><b>${t}</b><small>points to win</small></div>
      <button data-emit="setTarget" data-arg="${set(t + 1)}" ${t >= 15 ? 'disabled' : ''}>+</button></div>
    <button class="big" data-emit="start" ${n < 3 ? 'disabled' : ''}>Start game (${n} player${n === 1 ? '' : 's'})</button>
    <button class="ghost" data-emit="leave">Leave</button></div>`;
}

const nameOf = (id) => esc(byId(state, id)?.name ?? '?');

function gameView() {
  const iAmJudge = state.judgeId === me;
  let body = '';
  if (state.phase === 'playing') body = state.stage === 'submit' ? submitView(iAmJudge) : judgeView(iAmJudge);
  else body = overView();
  return `<div class="top"><div class="logo" style="font-size:1.1rem">FITS <span>the</span> BILL</div><span class="spacer"></span>
      <span>Round <b>${state.round}</b> · first to <b>${state.target}</b></span></div>
    ${state.phase === 'gameOver' ? '' : promptHtml(state.prompt, esc)}
    ${body}
    <h3 class="sec">Scores</h3>${scoresHtml(state, esc)}
    ${state.phase === 'gameOver' ? '' : `<button class="ghost" data-emit="leave" data-confirm="Leave the game?">Leave</button>`}`;
}

function submitView(iAmJudge) {
  const waiting = waitingFor(state);
  if (iAmJudge) {
    return `<div class="status">You're judging<small>Waiting for ${waiting.length} player${waiting.length === 1 ? '' : 's'} to play: ${waiting.map((p) => esc(p.name)).join(', ')}</small></div>`;
  }
  const hand = state.you?.hand ?? [];
  if (state.you?.submittedId != null) {
    const card = state.you.submitted;
    return `<div class="status">Played. Waiting for ${waiting.length} more<small>${nameOf(state.judgeId)} will judge</small></div>
      ${card ? `<div class="subs one">${answerHtml(card.text, esc, 'mine')}</div>` : ''}`;
  }
  return `<div class="status">Play your best match<small>${nameOf(state.judgeId)} is judging</small></div>
    <div class="hand">${hand.map((c) => `<button class="ans ${String(c.id) === sel ? 'sel' : ''}" data-card="${esc(c.id)}">${esc(c.text)}</button>`).join('')}</div>
    <div class="confirm"><button ${sel == null ? 'disabled' : ''} data-submit>${sel == null ? 'Tap a card' : 'Play this card'}</button></div>`;
}

function judgeView(iAmJudge) {
  const subs = state.submissions ?? [];
  if (!iAmJudge) {
    return `<div class="status">${nameOf(state.judgeId)} is choosing…</div>
      <div class="subs">${subs.map((s) => answerHtml(s.text, esc)).join('')}</div>`;
  }
  return `<div class="status">Pick the best match</div>
    <div class="subs">${subs.map((s) => `<button class="ans ${String(s.id) === sel ? 'sel' : ''}" data-sub="${esc(s.id)}">${esc(s.text)}</button>`).join('')}</div>
    <div class="confirm"><button ${sel == null ? 'disabled' : ''} data-pick>${sel == null ? 'Tap an answer' : 'This one fits the bill'}</button></div>`;
}

function overView() {
  const r = state.result;
  const over = state.phase === 'gameOver';
  let head = '';
  if (over) {
    const names = state.winners.map(nameOf).join(' & ');
    head = `<div class="winner-banner">🏆 ${names} win${state.winners.length > 1 ? '' : 's'}!</div>`;
  } else if (r) head = `<div class="status">${nameOf(r.winnerId)} wins the round</div>`;
  const plays = r ? `<div class="result">${r.plays.map((p) => `<div class="play ${p.submissionId === r.submissionId ? 'winner' : ''}">
      ${answerHtml(p.text, esc, p.submissionId === r.submissionId ? 'win' : '')}
      <span class="who">${nameOf(p.playerId)}${p.submissionId === r.submissionId ? ' · winner' : ''}</span></div>`).join('')}</div>` : '';
  const btn = over
    ? '<button class="big" data-emit="newGame">New game</button>'
    : '<button class="big" data-emit="nextRound">Next round</button>';
  return `${over ? promptHtml(state.prompt, esc) : ''}${head}${plays}${btn}`;
}

document.addEventListener('click', (e) => {
  const card = e.target.closest('[data-card]');
  const sub = e.target.closest('[data-sub]');
  if (card) { sel = sel === card.dataset.card ? null : card.dataset.card; render(); }
  else if (sub) { sel = sel === sub.dataset.sub ? null : sub.dataset.sub; render(); }
  else if (e.target.closest('[data-submit]') && sel != null) {
    const c = (state.you?.hand ?? []).find((x) => String(x.id) === sel);
    if (c) socket.emit('submit', { cardId: c.id });
    sel = null;
  } else if (e.target.closest('[data-pick]') && sel != null) {
    const s = (state.submissions ?? []).find((x) => String(x.id) === sel);
    if (s) socket.emit('pick', { submissionId: s.id });
    sel = null;
  }
});
