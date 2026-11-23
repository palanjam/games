// Shared helpers for the phone and board pages.

import { esc } from '/lib/room.js';

export { socket, esc } from '/lib/room.js';

export const byId = (state, id) => state.players.find((p) => p.id === id);

const SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const RANKS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export const rankText = (rank) => RANKS[rank] ?? String(rank);
export const isRed = (c) => c.suit === 'hearts' || c.suit === 'diamonds';
export const isWild = (c) => Boolean(c.joker) || c.rank === 2;
export const isThree = (c) => !c.joker && c.rank === 3;
export const isRedThree = (c) => isThree(c) && isRed(c);

export const cardText = (c) => (c.joker ? 'Joker' : `${rankText(c.rank)}${SYMBOLS[c.suit] ?? ''}`);

// Face value, as the rules define it (melds, opening totals, penalties).
export function cardValue(c) {
  if (c.joker) return 50;
  if (c.rank === 2 || c.rank === 14) return 20;
  if (c.rank === 3) return isRed(c) ? 300 : 5;
  return c.rank >= 8 ? 10 : 5;
}

export function cardHtml(card) {
  const cls = ['card', card.joker ? 'joker' : `s-${esc(card.suit)}`];
  let ribbon = '';
  if (isWild(card)) { cls.push('wild'); ribbon = 'WILD'; }
  else if (isThree(card)) {
    const red = isRed(card);
    cls.push(red ? 'red3' : 'black3');
    ribbon = red ? '−300' : '−5';
  }
  const face = card.joker
    ? '<span class="rk">JOKER</span><span class="su">★</span>'
    : `<span class="rk">${rankText(card.rank)}</span><span class="su">${SYMBOLS[card.suit] ?? '?'}</span>`;
  return `<span class="${cls.join(' ')}">${face}${ribbon ? `<span class="wl">${ribbon}</span>` : ''}</span>`;
}

export const backHtml = () => '<span class="card back">♦</span>';

export const bookLabel = (b) => (b === 'clean' ? 'Clean book' : b === 'dirty' ? 'Dirty book' : '');

// One pile: its cards overlapped in a row, and a caption with rank and book state.
export function pileHtml(pile) {
  const n = pile.cards.length;
  const wilds = pile.cards.filter(isWild).length;
  const cap = pile.book ? bookLabel(pile.book) : `${n}/7`;
  return `<span class="mpile ${pile.book ?? ''}">
    <span class="pcards">${pile.cards.map(cardHtml).join('')}</span>
    <span class="pcap"><b>${rankText(pile.rank)}</b> ×${n}${wilds ? ` <small>(${wilds}w)</small>` : ''} <em>${cap}</em></span>
  </span>`;
}

// Small text chips for a pile (other players on the phone).
export function pileChip(pile) {
  return `<span class="chip ${pile.book ?? ''}" title="${esc(bookLabel(pile.book) || 'Not a book yet')}">${rankText(pile.rank)} ×${pile.cards.length}</span>`;
}

// "Clean 1/2 · Dirty 0/1": what is still needed before going out.
export function bookProgress(p) {
  const c = Math.min(p.cleanBooks, 2);
  const d = Math.min(p.dirtyBooks, 1);
  return `<span class="bk ${c >= 2 ? 'ok' : ''}">Clean ${c}/2</span><span class="bk ${d >= 1 ? 'ok' : ''}">Dirty ${d}/1</span>`;
}

export function badges(state, p) {
  const out = [];
  if (state.dealerId === p.id) out.push('<span class="badge dealer">Dealer</span>');
  if (state.outId === p.id) out.push('<span class="badge out">Out</span>');
  if (!p.connected) out.push('<span class="badge offline">Offline</span>');
  return out.join(' ');
}

export const where = (p) => (p.inFoot ? `In foot · ${p.cardCount} card${p.cardCount === 1 ? '' : 's'}`
  : `Hand ${p.cardCount} · foot ${p.footCount}`);

// Rounds down, players across; the highest total is highlighted.
export function scoreGridHtml(state) {
  const ps = state.players;
  const played = Math.max(0, ...ps.map((p) => p.roundScores.length));
  const high = played ? Math.max(...ps.map((p) => p.score)) : null;
  const head = ps.map((p) => `<th title="${esc(p.name)}"><span>${esc(p.name)}</span></th>`).join('');
  const rows = Array.from({ length: state.rounds }, (_, i) => `<tr class="${i === state.round - 1 && state.phase === 'playing' ? 'now' : ''}">
    <th title="Round ${i + 1}">${i + 1}</th>${ps.map((p) => `<td>${p.roundScores[i] === null ? '–' : p.roundScores[i]?.total ?? ''}</td>`).join('')}</tr>`).join('');
  const total = ps.map((p) => `<td class="${p.score === high ? 'low' : ''}">${p.score}</td>`).join('');
  return `<table class="grid-scores">
    <thead><tr><th></th>${head}</tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><th>Σ</th>${total}</tr></tfoot>
  </table>`;
}

// This round's breakdown per player (round over / game over).
export function roundTableHtml(state) {
  const i = state.round - 1;
  const rows = state.players.map((p) => {
    const r = p.roundScores[i];
    if (!r) return '';
    return `<tr class="${state.winners.includes(p.id) ? 'win' : ''}">
      <th>${state.winners.includes(p.id) ? '🏆 ' : ''}${esc(p.name)}${r.wentOut ? ' <span class="badge out">Out</span>' : ''}</th>
      <td>${r.melded}</td><td>${r.bonus + (r.wentOut || 0)}</td><td class="neg">${r.penalty ? `−${Math.abs(r.penalty)}` : 0}</td><td><b>${r.total}</b></td><td class="tot">${p.score}</td></tr>`;
  }).join('');
  return `<table class="round-table">
    <thead><tr><th></th><td>Melded</td><td>Bonus</td><td>Held</td><td>Round</td><td>Total</td></tr></thead>
    <tbody>${rows}</tbody></table>`;
}
