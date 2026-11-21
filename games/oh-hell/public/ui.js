// Shared helpers for the phone and board pages.

import { esc } from '/lib/room.js';

export { socket, esc } from '/lib/room.js';

export const byId = (state, id) => state.players.find((p) => p.id === id);

export const SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const RANKS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const SUIT_ORDER = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };

export const rankText = (rank) => RANKS[rank] ?? String(rank);
export const cardText = (card) => `${rankText(card.rank)}${SYMBOLS[card.suit]}`;

export const sortHand = (hand) => [...hand].sort((a, b) => SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || a.rank - b.rank);

export function cardHtml(card, extra = '') {
  return `<span class="card s-${esc(card.suit)} ${extra}"><span class="rk">${rankText(card.rank)}</span><span class="su">${SYMBOLS[card.suit] ?? '?'}</span></span>`;
}

export const patternLabel = {
  'down-up': ['Down and up', 'big hands to 1, then back up'],
  down: ['Down', 'big hands to 1'],
  up: ['Up', '1 card up to the biggest'],
};

export function badges(state, p) {
  const out = [];
  if (state.dealerId === p.id) out.push('<span class="badge dealer">Dealer</span>');
  if (!p.connected) out.push('<span class="badge offline">Offline</span>');
  return out.join(' ');
}

// The trump card plus suit, shown prominently on both pages.
export function trumpHtml(state) {
  if (!state.trumpCard) return '<span class="trump none">No trump</span>';
  return `<span class="trump s-${esc(state.trumpSuit)}"><small>Trump</small><span class="tsym">${SYMBOLS[state.trumpSuit] ?? ''}</span></span>`;
}

// "2 / 1": bid and tricks so far, with a made/over/under hint once the round is scored.
export function bidText(p) {
  return `${p.bid ?? '–'} bid · ${p.tricks ?? 0} won`;
}

// A trick as a row of cards, each labelled with who played it.
export function playsHtml(state, plays, winnerId = null) {
  return `<div class="plays">${plays.map((pl) => `<div class="play ${pl.playerId === winnerId ? 'won' : ''}">
    ${cardHtml(pl.card)}<small>${esc(byId(state, pl.playerId)?.name ?? '?')}${pl.playerId === winnerId ? ' ★' : ''}</small></div>`).join('')}</div>`;
}

// Rounds x players: points per round, running total at the foot.
export function scoreGridHtml(state) {
  const ps = state.players;
  const played = Math.max(0, ...ps.map((p) => p.roundScores.length));
  const top = played ? Math.max(...ps.map((p) => p.score)) : null;
  const head = ps.map((p) => `<th title="${esc(p.name)}"><span>${esc(p.name)}</span></th>`).join('');
  const rows = Array.from({ length: Math.max(played, state.round || 0) }, (_, i) => {
    const now = i === state.round - 1 && state.phase === 'playing';
    return `<tr class="${now ? 'now' : ''}"><th title="Round ${i + 1}">${i + 1}</th>${ps.map((p) => {
      const r = p.roundScores[i];
      return `<td class="${r && r.tricks === r.bid ? 'made' : ''}">${r ? r.points : ''}</td>`;
    }).join('')}</tr>`;
  }).join('');
  const total = ps.map((p) => `<td class="${p.score === top ? 'top' : ''}">${p.score}</td>`).join('');
  return `<table class="grid-scores">
    <thead><tr><th></th>${head}</tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><th>Σ</th>${total}</tr></tfoot>
  </table>`;
}

// This round's bids, tricks and points per player (round over).
export function roundResultsHtml(state, me = null) {
  return `<table class="rtable"><thead><tr><th></th><th>Bid</th><th>Won</th><th>Pts</th></tr></thead><tbody>${state.players.map((p) => {
    const r = p.roundScores.at(-1);
    const made = r && r.tricks === r.bid;
    return `<tr class="${p.id === me ? 'me' : ''}"><th>${esc(p.name)}</th><td>${r ? r.bid : '–'}</td><td>${r ? r.tricks : '–'}</td>
      <td class="${made ? 'made' : 'miss'}">${r ? `+${r.points}` : ''}${made ? ' ✓' : ''}</td></tr>`;
  }).join('')}</tbody></table>`;
}
