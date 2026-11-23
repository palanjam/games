// Shared helpers for the phone and board pages.

import { esc } from '/lib/room.js';

export { socket, esc } from '/lib/room.js';

export const byId = (state, id) => state.players.find((p) => p.id === id);

const SYMBOLS = { stars: '★', hearts: '♥', clubs: '♣', spades: '♠', diamonds: '♦' };
const RANKS = { 11: 'J', 12: 'Q', 13: 'K' };

export const rankText = (rank) => RANKS[rank] ?? String(rank);

// "Wild: 7s". Jokers are always wild too, which the card faces show.
export const wildText = (wildRank) => `${rankText(wildRank)}s`;

export const cardText = (card) => (card.joker ? 'Joker' : `${rankText(card.rank)}${SYMBOLS[card.suit]}`);

const isWild = (card, wildRank) => card.joker || card.rank === wildRank;

// Whether a card is wild comes from the round's wild rank, so every renderer
// passes it in. Wilds get a gold WILD ribbon as well as their own colours.
export function cardHtml(card, wildRank) {
  const wild = isWild(card, wildRank);
  const cls = ['card', card.joker ? 'joker' : `s-${esc(card.suit)}`];
  if (wild) cls.push('wild');
  const face = card.joker
    ? '<span class="rk">JOKER</span><span class="su">♛</span>'
    : `<span class="rk">${rankText(card.rank)}</span><span class="su">${SYMBOLS[card.suit] ?? '?'}</span>`;
  return `<span class="${cls.join(' ')}">${face}${wild ? '<span class="wl">WILD</span>' : ''}</span>`;
}

export const backHtml = () => '<span class="card back">♛</span>';

// A meld is a tight group of cards. `wrap` lets a caller put each card in its
// own element (the phone hand makes them tappable).
export function meldHtml(cards, wildRank, wrap = (c, html) => html) {
  return `<span class="meld">${cards.map((c) => wrap(c, cardHtml(c, wildRank))).join('')}</span>`;
}

export function deadwoodHtml(cards, wildRank, points, wrap = (c, html) => html) {
  if (!cards.length) return '';
  return `<span class="meld dead">${cards.map((c) => wrap(c, cardHtml(c, wildRank))).join('')}<span class="pts">${points} pt${points === 1 ? '' : 's'}</span></span>`;
}

// A laid-down hand: melds, then the cards that didn't fit and what they cost.
export function laidHtml(laid, wildRank) {
  return `<span class="laid">${laid.melds.map((m) => meldHtml(m, wildRank)).join('')}${deadwoodHtml(laid.deadwood, wildRank, laid.points)}</span>`;
}

export function badges(state, p) {
  const out = [];
  if (state.dealerId === p.id) out.push('<span class="badge dealer">Dealer</span>');
  if (state.outId === p.id) out.push('<span class="badge out">Out</span>');
  if (!p.connected) out.push('<span class="badge offline">Offline</span>');
  return out.join(' ');
}

// Rounds x players. The lowest total is highlighted once a round is finished.
export function scoreGridHtml(state) {
  const ps = state.players;
  const played = Math.max(0, ...ps.map((p) => p.roundScores.length));
  const low = played ? Math.min(...ps.map((p) => p.score)) : null;
  const head = ps.map((p) => `<th title="${esc(p.name)}"><span>${esc(p.name)}</span></th>`).join('');
  const rows = Array.from({ length: state.rounds }, (_, i) => `<tr class="${i === state.round - 1 && state.phase === 'playing' ? 'now' : ''}">
    <th title="Round ${i + 1}">${rankText(i + 3)}</th>${ps.map((p) => `<td>${p.roundScores[i] === null ? '–' : p.roundScores[i] ?? ''}</td>`).join('')}</tr>`).join('');
  const total = ps.map((p) => `<td class="${p.score === low ? 'low' : ''}">${p.score}</td>`).join('');
  return `<table class="grid-scores">
    <thead><tr><th></th>${head}</tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><th>Σ</th>${total}</tr></tfoot>
  </table>`;
}
