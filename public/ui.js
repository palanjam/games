// Shared helpers for the phone and board pages.

export const socket = window.io();

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export const byId = (state, id) => state.players.find((p) => p.id === id);

const ACTIONS = {
  freeze: { icon: '❄', text: 'Freeze' },
  flipThree: { icon: '3', text: 'Flip Three' },
  secondChance: { icon: '♥', text: 'Second Chance' },
};

// Cards animate in the first time a client sees them. A card's start time is
// remembered so re-renders mid-animation continue it instead of restarting.
// Several cards arriving in one update (e.g. a Flip Three) are staggered.
const seen = new Map();
let primed = false;
let batch = 0;
let round = 0;

export function beginCards(state) {
  batch = 0;
  round = state.round;
}

export function endCards() {
  primed = true;
}

function anim(card) {
  const key = `${round}:${card.id}`;
  const now = performance.now();
  if (!seen.has(key)) seen.set(key, primed ? { at: now, delay: batch++ * 450 } : { at: -Infinity, delay: 0 });
  const { at, delay } = seen.get(key);
  const elapsed = now - at;
  return elapsed < delay + 700 ? { cls: ' new', style: ` style="--d:${Math.round(delay - elapsed)}ms"` } : { cls: '', style: '' };
}

export function cardHtml(card, extra = '') {
  const a = anim(card);
  const cls = `card${a.cls}${extra ? ' ' + extra : ''}`;
  switch (card.type) {
    case 'number':
      return `<div class="${cls} num n${card.value}"${a.style}><span class="c">${card.value}</span><b>${card.value}</b><span class="c br">${card.value}</span></div>`;
    case 'modifier':
      return `<div class="${cls} mod"${a.style}><b>+${card.value}</b></div>`;
    case 'multiplier':
      return `<div class="${cls} mult"${a.style}><b>×2</b></div>`;
    default: {
      const { icon, text } = ACTIONS[card.value];
      return `<div class="${cls} act ${card.value}"${a.style}><b>${icon}</b><small>${text}</small></div>`;
    }
  }
}

// All the cards in front of a player: numbers, then modifiers, then extras.
export function handHtml(p) {
  const cards = [
    ...p.numbers.map((c) => cardHtml(c)),
    ...(p.bustCard ? [cardHtml(p.bustCard, 'bust')] : []),
    ...p.modifiers.map((c) => cardHtml(c)),
    ...(p.secondChance ? [cardHtml(p.secondChance)] : []),
  ];
  return cards.length ? cards.join('') : '<div class="card empty"></div>';
}

export const STATUS = {
  waiting: '',
  active: '',
  stayed: 'Stayed',
  frozen: 'Frozen',
  busted: 'Bust!',
  flip7: 'Flip 7!',
};

export function pendingText(state) {
  const pend = state.pending;
  if (!pend) return '';
  const who = byId(state, pend.chooserId)?.name ?? '?';
  return pend.kind === 'secondChance'
    ? `${who} is giving away a Second Chance…`
    : `${who} drew ${pend.label} and is choosing a target…`;
}

let toastTimer;
export function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

socket.on('problem', toast);

// Delegated click handling: <button data-emit="event" data-arg='{"k":"v"}'>
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-emit]');
  if (!btn) return;
  const arg = btn.dataset.arg ? JSON.parse(btn.dataset.arg) : {};
  if (btn.dataset.confirm && !confirm(btn.dataset.confirm)) return;
  socket.emit(btn.dataset.emit, arg);
});
