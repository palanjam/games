// Shared helpers for the phone and board pages.

import { esc } from '/lib/room.js';

export { socket, esc } from '/lib/room.js';

export const byId = (state, id) => state.players.find((p) => p.id === id);

const ICONS = {
  baseball: '⚾', coins: '🪙', piggy: '🐷', cash: '💵', bank: '🏦', stocks: '📈',
  boat: '🚤', jewels: '💎', auto: '🚗', home: '🏠', silver: '🥈', gold: '🥇',
};

// Totals as full dollars, card faces as $15K.
export const dollars = (v) => `$${v.toLocaleString('en-US')}`;
export const short = (v) => `$${v / 1000}K`;

export function cardHtml(card) {
  return `<span class="card a-${esc(card.asset)} ${card.kind}">
    <span class="ic">${ICONS[card.asset] ?? '?'}</span>
    <span class="nm">${esc(card.name)}</span>
    <span class="val">${short(card.value)}</span>
  </span>`;
}

export function setHtml(set, extra = '') {
  return `<span class="set${extra ? ' ' + extra : ''}" style="--n:${set.cards.length}">
    <span class="cards">${set.cards.map(cardHtml).join('')}</span>
    <span class="sval">${short(set.value)}</span>
  </span>`;
}

export function stackHtml(stack) {
  if (!stack.length) return '<span class="nostack muted">No sets yet</span>';
  const last = stack.length - 1;
  return `<div class="stack">${stack.map((s, i) => setHtml(s, i === last ? 'top' : '')).join('')}</div>`;
}

export const backHtml = () => '<span class="card back">$</span>';

// What the contested/top set is called: its asset card (the top card of a set).
export const setName = (set) => set.cards.at(-1)?.name ?? set.asset;

export const modeText = (state) =>
  state.mode === 'quick' ? 'Quick game: one round' : `Classic: first to ${dollars(state.targetScore)}`;

export function badges(state, p) {
  const out = [];
  if (state.dealerId === p.id) out.push('<span class="badge dealer">Dealer</span>');
  if (!p.connected) out.push('<span class="badge offline">Offline</span>');
  return out.join(' ');
}
