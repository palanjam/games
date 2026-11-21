import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUITS, isWild, cardPoints, arrange, bestDiscard } from '../public/melds.js';

// Cards by name: '7♥', '10★', 'K♠', or 'JK' for a Joker.
const SYMBOLS = { '★': 'stars', '♥': 'hearts', '♣': 'clubs', '♠': 'spades', '♦': 'diamonds' };
const RANKS = { J: 11, Q: 12, K: 13 };
let nextId = 1;
function card(name) {
  if (name === 'JK') return { id: nextId++, suit: null, rank: null, joker: true };
  const suit = SYMBOLS[name.at(-1)];
  const r = name.slice(0, -1);
  return { id: nextId++, suit, rank: RANKS[r] ?? Number(r), joker: false };
}
const hand = (names) => names.split(' ').map(card);
const sum = (cards, wr) => cards.reduce((s, c) => s + cardPoints(c, wr), 0);

// Independent meld check: a book (naturals share a rank), a run (naturals
// share a suit, distinct ranks, fit in a window of the meld's length within
// 3..K), or all wilds.
function isMeld(cards, wr) {
  if (cards.length < 3) return false;
  const nat = cards.filter((c) => !isWild(c, wr));
  if (!nat.length || nat.every((c) => c.rank === nat[0].rank)) return true;
  if (!nat.every((c) => c.suit === nat[0].suit)) return false;
  const ranks = nat.map((c) => c.rank);
  if (new Set(ranks).size !== ranks.length) return false;
  return Math.max(...ranks) - Math.min(...ranks) < cards.length && cards.length <= 11;
}

// Runs come back in rank order with wilds in their gaps: some window lo..
// matches every natural's position.
function runInOrder(meld, wr) {
  const nat = meld.map((c, k) => [c, k]).filter(([c]) => !isWild(c, wr));
  if (!nat.length || nat.every(([c]) => c.rank === nat[0][0].rank)) return true; // a book
  const lo = nat[0][0].rank - nat[0][1];
  return lo >= 3 && lo + meld.length - 1 <= 13 && nat.every(([c, k]) => c.rank === lo + k);
}

// Naive minimum: the first card is deadwood or melds with some subset of the rest.
function brute(cards, wr) {
  if (!cards.length) return 0;
  const [first, ...rest] = cards;
  let best = cardPoints(first, wr) + brute(rest, wr);
  for (let sub = 1; sub < 1 << rest.length; sub++) {
    const pick = rest.filter((_, b) => sub & (1 << b));
    if (pick.length < 2 || !isMeld([first, ...pick], wr)) continue;
    best = Math.min(best, brute(rest.filter((_, b) => !(sub & (1 << b))), wr));
  }
  return best;
}

// Checks the arrangement is a real partition of the hand into valid melds.
function check(cards, wr) {
  const result = arrange(cards, wr);
  const used = [...result.melds.flat(), ...result.deadwood].map((c) => c.id).sort((a, b) => a - b);
  assert.deepEqual(used, cards.map((c) => c.id).sort((a, b) => a - b), 'every card used exactly once');
  for (const m of result.melds) {
    assert.ok(isMeld(m, wr), `not a meld: ${JSON.stringify(m)}`);
    assert.ok(runInOrder(m, wr), `run out of order: ${JSON.stringify(m)}`);
  }
  assert.equal(result.points, sum(result.deadwood, wr));
  return result;
}

function makeRng(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

function fullDeck() {
  const cards = [];
  for (let d = 0; d < 2; d++) {
    for (const suit of SUITS) for (let rank = 3; rank <= 13; rank++) cards.push({ id: cards.length, suit, rank, joker: false });
    for (let j = 0; j < 3; j++) cards.push({ id: cards.length, suit: null, rank: null, joker: true });
  }
  return cards;
}

function sample(pool, n, rng) {
  const a = [...pool];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

test('isWild and cardPoints follow the round', () => {
  const [seven, joker, king] = hand('7♥ JK K♠');
  assert.equal(isWild(seven, 7), true);
  assert.equal(isWild(seven, 8), false);
  assert.equal(isWild(joker, 3), true);
  assert.equal(cardPoints(seven, 3), 7);
  assert.equal(cardPoints(seven, 7), 20);
  assert.equal(cardPoints(king, 3), 13);
  assert.equal(cardPoints(king, 13), 20);
  assert.equal(cardPoints(joker, 13), 50);
});

test('arrange matches a brute force on random small hands', () => {
  const rng = makeRng(42);
  const deck = fullDeck();
  // A narrow pool makes melds (and conflicts between them) common.
  const pools = [
    deck.filter((c) => c.joker || ((c.suit === 'hearts' || c.suit === 'stars') && c.rank <= 9)),
    deck.filter((c) => c.joker || c.rank <= 6),
    deck,
  ];
  for (let t = 0; t < 400; t++) {
    const pool = pools[t % pools.length];
    const cards = sample(pool, 3 + Math.floor(rng() * 7), rng);
    const wr = 3 + Math.floor(rng() * 11);
    const result = check(cards, wr);
    assert.equal(result.points, brute(cards, wr), `hand ${JSON.stringify(cards)} wild ${wr}`);
  }
});

test('books may repeat suits', () => {
  const r = check(hand('8♥ 8♥ 8♠ 4★'), 3);
  assert.equal(r.points, 4);
  assert.equal(r.melds.length, 1);
  assert.equal(r.melds[0].length, 3);
});

test('runs fill gaps with wilds, in rank order', () => {
  const r = check(hand('5♣ JK 7♣ 9♣ 4♠'), 4); // 4♠ is wild
  assert.equal(r.points, 0);
  assert.equal(r.melds.length, 1);
  assert.deepEqual(r.melds[0].map((c) => c.rank), [5, null, 7, 4, 9]);
});

test('wilds extend runs at either end but never past 3..K', () => {
  const low = check(hand('3♦ 4♦ JK'), 13);
  assert.equal(low.points, 0);
  assert.deepEqual(low.melds[0].map((c) => c.rank ?? 'W'), [3, 4, 'W']);
  const high = check(hand('Q♦ K♦ JK'), 5);
  assert.equal(high.points, 0);
  assert.deepEqual(high.melds[0].map((c) => c.rank ?? 'W'), ['W', 12, 13]);
  // A full 3..K run cannot take a twelfth card, so it splits up to make room
  // for the Jokers (rank 14 here just means no natural rank is wild).
  const full = check(hand('3♥ 4♥ 5♥ 6♥ 7♥ 8♥ 9♥ 10♥ J♥ Q♥ K♥ JK JK'), 14);
  assert.equal(full.points, 0);
  assert.ok(full.melds.length >= 2);
  assert.ok(full.melds.every((m) => m.length <= 11));
});

test('wilds alone make a meld; spare wilds score at their own value', () => {
  assert.equal(check(hand('JK JK 6♦'), 6).points, 0);
  assert.equal(check(hand('JK 9♠ 9♦'), 3).points, 0);
  assert.equal(check(hand('JK JK JK'), 5).melds.length, 1);
  assert.equal(check(hand('JK 5♠'), 5).points, 70);
  assert.equal(check(hand('JK 8♥ 3♠'), 5).points, 61);
  // Two wilds and a natural always make a book, so the rest is what scores.
  assert.equal(check(hand('JK 6♠ 4★ 9♥'), 6).points, 4);
});

test('the same natural card is never used twice', () => {
  // 7♥ could finish the run or the book, not both: the book (leaving 5 + 6) wins.
  const cards = hand('5♥ 6♥ 7♥ 7♠ 7♦');
  const r = check(cards, 13);
  assert.equal(r.points, 11);
  assert.equal(r.points, brute(cards, 13));
});

test('a hand with no melds is all deadwood', () => {
  const r = check(hand('3♥ 5♠ 8♦ J★ K♣'), 4);
  assert.equal(r.melds.length, 0);
  assert.equal(r.points, 3 + 5 + 8 + 11 + 13);
  assert.deepEqual(arrange([], 5), { melds: [], deadwood: [], points: 0 });
});

test('14-card hands with many wilds arrange in under 50ms', () => {
  const rng = makeRng(7);
  const deck = fullDeck();
  const pool = deck.filter((c) => c.joker || c.suit === 'hearts');
  let worst = 0;
  arrange(sample(pool, 14, rng), 13); // warm up the JIT
  for (let t = 0; t < 60; t++) {
    const cards = [...sample(pool.filter((c) => !c.joker && c.rank !== 13), 10, rng), ...sample(pool.filter((c) => c.joker || c.rank === 13), 4, rng)];
    const start = performance.now();
    check(cards, 13);
    worst = Math.max(worst, performance.now() - start);
  }
  assert.ok(worst < 50, `worst ${worst.toFixed(1)}ms`);
});

test('bestDiscard leaves the fewest points, discarding the highest card on ties', () => {
  const cards = hand('5♥ 6♥ 7♥ K♠ 9♦');
  assert.deepEqual(bestDiscard(cards, 3), { cardId: cards[3].id, points: 9 });
  // Any card can go and the rest still melds (3♠ is wild): drop the 3♠ (20).
  const tie = hand('5♥ 6♥ 7♥ 3♠');
  assert.deepEqual(bestDiscard(tie, 3), { cardId: tie[3].id, points: 0 });
  const out = hand('JK 4★ 4♥ Q♣');
  assert.deepEqual(bestDiscard(out, 3), { cardId: out[3].id, points: 0 });
});
