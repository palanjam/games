// Shared helpers for the phone and board pages.
export { socket, esc } from '/lib/room.js';

export const byId = (state, id) => state.players.find((p) => p.id === id);

export const logoHtml = (cls = '') => `<div class="logo ${cls}">FITS <span>the</span> BILL</div>`;

// A prompt: the describing word, on a ticket-shaped card.
export const promptHtml = (prompt, esc) =>
  `<div class="prompt"><small>Which one is the most…</small><b>${prompt ? esc(prompt.text) : '…'}</b></div>`;

// An answer card. `attrs` adds classes / data attributes.
export const answerHtml = (text, esc, cls = '', attrs = '') =>
  `<span class="ans ${cls}" ${attrs}><span>${esc(text)}</span></span>`;

// Score list; each player's won prompts underneath.
export function scoresHtml(state, esc, { compact = false } = {}) {
  const rows = [...state.players].sort((a, b) => b.score - a.score);
  return `<ul class="scores">${rows.map((p) => `<li class="${state.judgeId === p.id && state.phase !== 'lobby' ? 'judge' : ''}">
    <div class="row"><span class="nm">${esc(p.name)}${state.judgeId === p.id && state.phase !== 'lobby' ? ' <span class="badge">Judge</span>' : ''}${p.connected ? '' : ' <span class="badge offline">Offline</span>'}</span>
      <b class="pts">${p.score}</b></div>
    ${p.won?.length && !compact ? `<div class="won">${p.won.map((w) => `<span>${esc(w)}</span>`).join('')}</div>` : ''}
  </li>`).join('')}</ul>`;
}

// Players the table is still waiting for in the submit stage.
export const waitingFor = (state) =>
  state.players.filter((p) => p.id !== state.judgeId && !state.submitted.includes(p.id));
