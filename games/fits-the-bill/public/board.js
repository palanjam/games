import { socket, esc, byId, logoHtml, promptHtml, answerHtml, scoresHtml, waitingFor } from '/g/fits-the-bill/ui.js';
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
const name = (id) => esc(byId(state, id)?.name ?? '?');

function lobbyView() {
  return `<div class="lobby">${logoHtml('huge')}
    <div class="join"><div class="qr">${info.qrSvg}</div>
      <div><p class="muted">Scan with your phone, or open</p><p class="url">${esc(info.joinUrl)}</p>
        <p class="muted">Room code <b class="code">${esc(info.code)}</b></p></div></div>
    <ul class="chips">${state.players.map((p) => `<li>${esc(p.name)}${p.connected ? '' : ' <span class="badge offline">Offline</span>'}
      <button class="x" title="Remove" data-emit="kick" data-arg="${esc(JSON.stringify({ playerId: p.id }))}">×</button></li>`).join('')
      || '<li class="muted">Waiting for players…</li>'}</ul>
    <p class="tgt">First to <b>${state.target}</b> points wins (change it on a phone)</p>
    <button class="big" data-emit="start" ${state.players.length < 3 ? 'disabled' : ''}>Start game</button></div>`;
}

function tableView() {
  return `<div class="table">
    <header class="bar">${logoHtml()}<div class="banner">${banner()}</div></header>
    <section class="main">${mainView()}</section>
    <aside class="side">
      <div class="mini-join">${esc(info.joinUrl)}</div>
      <h3>Scores · first to ${state.target}</h3>${scoresHtml(state, esc)}
      ${manageHtml()}
      <button class="ghost" data-emit="newGame" data-confirm="Abandon this game and return to the lobby?">Back to lobby</button>
    </aside></div>`;
}

function banner() {
  const j = byId(state, state.judgeId);
  if (state.phase === 'gameOver') {
    if (!state.winners.length) return '<span>Game over</span><button data-emit="newGame">New game</button>';
    const names = state.winners.map(name).join(' & ');
    return `<span class="win">🏆 ${names} win${state.winners.length > 1 ? '' : 's'}!</span><button data-emit="newGame">New game</button>`;
  }
  if (state.phase === 'roundOver') {
    // No result when the round was cancelled; the round winner may have been removed since.
    const w = byId(state, state.result?.winnerId);
    const text = w ? `<b>${esc(w.name)}</b> takes the round` : state.result ? `Round ${state.round} over` : `Round ${state.round} was cancelled`;
    return `<span>${text}</span><button data-emit="nextRound">Next round ▶</button>`;
  }
  const off = [];
  if (state.stage === 'submit') off.push(...waitingFor(state).filter((p) => !p.connected));
  else if (j && !j.connected) off.push(j);
  const text = state.stage === 'submit'
    ? `Round ${state.round}: play your best match`
    : `Round ${state.round}: <b>${name(state.judgeId)}</b> is choosing`;
  const help = off.length ? ` <button class="ghost" data-emit="autoplay">${off.map((p) => esc(p.name)).join(', ')} offline: play for them</button>` : '';
  return `<span>${text}</span>${help}`;
}

function mainView() {
  if (state.phase === 'gameOver') {
    return `${state.result ? resultView() : ''}`;
  }
  const prompt = promptHtml(state.prompt, esc);
  if (state.phase === 'roundOver') return `${prompt}${resultView()}`;
  if (state.stage === 'submit') {
    return `${prompt}<div class="who-played">${state.players.map((p) =>
      `<span class="${p.id === state.judgeId ? 'judge' : state.submitted.includes(p.id) ? 'done' : ''}">${esc(p.name)}${p.id === state.judgeId ? ' · judge' : state.submitted.includes(p.id) ? ' ✓' : ''}</span>`).join('')}</div>`;
  }
  return `${prompt}<div class="cards">${(state.submissions ?? []).map((s) => answerHtml(s.text, esc)).join('')}</div>`;
}

function resultView() {
  const r = state.result;
  if (!r) return '';
  return `<div class="cards">${r.plays.map((p) => {
    const w = p.submissionId === r.submissionId;
    return answerHtml(p.text, esc, w ? 'win' : '', '').replace('</span></span>', `</span><small>${name(p.playerId)}${w ? ' · winner' : ''}</small></span>`);
  }).join('')}</div>`;
}

// Boot controls while a game is running: a remove button per seated player,
// and the late joiners waiting for the next round.
function removeBtn(p, text) {
  return `<button class="x" title="Remove" data-emit="kick" data-arg="${esc(JSON.stringify({ playerId: p.id }))}" data-confirm="${esc(text)}">×</button>`;
}
function manageHtml() {
  const waiting = state.waiting ?? [];
  return `<ul class="chips manage">${state.players.map((p) =>
    `<li>${esc(p.name)} ${removeBtn(p, `Remove ${p.name} from the game?`)}</li>`).join('')}</ul>
    ${waiting.length ? `<p class="muted">Joining next round: ${waiting.map((w) =>
      `${esc(w.name)} ${removeBtn(w, `Remove ${w.name}?`)}`).join(', ')}</p>` : ''}`;
}
