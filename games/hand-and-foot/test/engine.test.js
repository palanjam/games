import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, GameError, ROUNDS, OPENING_MINIMUMS, MAX_PLAYERS, buildDeck, deckCount, cardName, cardValue, bookType,
} from '../engine.js';
import handAndFoot, { autoDiscard } from '../index.js';
import { games } from '../../../server/games.js';

// Cards by name: '7♥', '10♠', 'A♦', '2♣', or 'JK' for a Joker.
const SYMBOLS = { '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs', '♠': 'spades' };
const RANKS = { J: 11, Q: 12, K: 13, A: 14 };
let nextId = 1000;
function card(name) {
  if (name === 'JK') return { id: nextId++, rank: null, suit: null, joker: true };
  const r = name.slice(0, -1);
  return { id: nextId++, rank: RANKS[r] ?? Number(r), suit: SYMBOLS[name.at(-1)], joker: false };
}
const cards = (names) => (names ? names.trim().split(/\s+/).map(card) : []);
const names = (list) => list.map(cardName).join(' ');
const ids = (list) => list.map((c) => c.id);

// rng () => 0 makes the first player the first dealer, so with A, B the deal
// goes B, A and B plays first.
function setup({ players = ['A', 'B'], deck } = {}) {
  const g = new Game({ rng: () => 0, deck });
  for (const n of players) g.addPlayer(n, n);
  g.start();
  return g;
}

// Replace the dealt cards with known ones. `players` maps id to
// { hand, foot, piles: { rank: 'cards' }, opened, inFoot }; `discard` is
// bottom to top. Unmentioned players keep what they were dealt.
function arrange(g, { players = {}, stock, discard } = {}) {
  for (const [id, s] of Object.entries(players)) {
    const p = g.player(id);
    if (s.hand !== undefined) p.hand = cards(s.hand);
    if (s.foot !== undefined) p.foot = cards(s.foot);
    if (s.inFoot) {
      p.inFoot = true;
      p.foot = [];
    }
    if (s.piles) {
      p.piles = Object.entries(s.piles).map(([rank, list]) => ({ rank: Number(rank), cards: cards(list) }));
      p.opened = true;
    }
    if (s.opened !== undefined) p.opened = s.opened;
  }
  if (stock !== undefined) g.stock = cards(stock);
  if (discard !== undefined) g.discard = cards(discard);
}

// The id of the first card matching `name` among the player's playing cards.
function idOf(g, pid, name) {
  const c = card(name);
  const found = g.player(pid).hand.find((h) => h.joker === c.joker && h.suit === c.suit && h.rank === c.rank);
  assert.ok(found, `${pid} holds no ${name}`);
  return found.id;
}
const idsOf = (g, pid, list) => {
  const taken = new Set();
  return list.split(' ').map((name) => {
    const c = card(name);
    const found = g.player(pid).hand.find((h) => !taken.has(h) && h.joker === c.joker && h.suit === c.suit && h.rank === c.rank);
    assert.ok(found, `${pid} holds no (more) ${name}`);
    taken.add(found);
    return found.id;
  });
};
const entry = (g, pid, rank, list) => ({ rank, cardIds: idsOf(g, pid, list) });
const pile = (g, pid, rank) => g.player(pid).piles.find((p) => p.rank === rank);

// Every card object anywhere in a view.
function cardsIn(value, out = []) {
  if (Array.isArray(value)) for (const v of value) cardsIn(v, out);
  else if (value && typeof value === 'object') {
    if ('joker' in value && 'id' in value) out.push(value);
    else for (const v of Object.values(value)) cardsIn(v, out);
  }
  return out;
}

const snapshot = (g) => JSON.stringify({ players: g.players, stock: g.stock, discard: g.discard, stage: g.stage });

// ---- deck, values, deal ------------------------------------------------

test('deck: one 54-card deck per player plus one, at least 4, unique ids', () => {
  assert.deepEqual([2, 3, 4, 5, 6].map(deckCount), [4, 4, 5, 6, 7]);
  const deck = buildDeck(4);
  assert.equal(deck.length, 216);
  assert.equal(new Set(ids(deck)).size, 216);
  assert.equal(deck.filter((c) => c.joker).length, 8);
  assert.ok(deck.filter((c) => c.joker).every((c) => c.rank === null && c.suit === null));
  assert.equal(deck.filter((c) => c.rank === 14 && c.suit === 'spades').length, 4);
  for (const [players, decks] of [[['A', 'B'], 4], [['A', 'B', 'C', 'D', 'E'], 6]]) {
    const g = setup({ players });
    const all = [...g.stock, ...g.discard, ...g.players.flatMap((p) => [...p.hand, ...p.foot])];
    assert.equal(all.length, decks * 54);
  }
});

test('card values: Joker 50, 2 and A 20, 8–K 10, 4–7 5, black 3 5, red 3 300', () => {
  const values = (list) => cards(list).map(cardValue);
  assert.deepEqual(values('JK 2♣ A♥ K♠ Q♦ J♣ 10♥ 9♠ 8♦'), [50, 20, 20, 10, 10, 10, 10, 10, 10]);
  assert.deepEqual(values('7♥ 6♠ 5♦ 4♣'), [5, 5, 5, 5]);
  assert.deepEqual(values('3♣ 3♠ 3♥ 3♦'), [5, 5, 300, 300]);
});

test('deal: 11-card hands then 11-card feet left of the dealer, one card turned up', () => {
  const hB = 'A♥ A♦ A♣ K♥ K♦ K♣ Q♥ Q♦ Q♣ J♥ J♦';
  const hA = '4♥ 4♦ 4♣ 5♥ 5♦ 5♣ 6♥ 6♦ 6♣ 7♥ 7♦';
  const fB = '8♥ 8♦ 8♣ 9♥ 9♦ 9♣ 10♥ 10♦ 10♣ JK JK';
  const fA = '2♥ 2♦ 2♣ 3♥ 3♦ 3♣ 3♠ 8♠ 9♠ 10♠ J♠';
  const deal = (x, y) => x.split(' ').flatMap((c, i) => [c, y.split(' ')[i]]).join(' ');
  const deck = cards(`${deal(hB, hA)} ${deal(fB, fA)} Q♠ K♠ A♠ 4♠`);
  const g = setup({ deck });
  assert.equal(names(g.player('B').hand), names(cards(hB)));
  assert.equal(names(g.player('A').hand), names(cards(hA)));
  assert.equal(names(g.player('B').foot), names(cards(fB)));
  assert.equal(names(g.player('A').foot), names(cards(fA)));
  const v = g.view(null);
  assert.equal(v.phase, 'playing');
  assert.equal(v.round, 1);
  assert.equal(v.rounds, ROUNDS);
  assert.equal(v.openingMin, 50);
  assert.equal(v.dealerId, 'A');
  assert.equal(v.turnId, 'B');
  assert.equal(v.stage, 'draw');
  assert.equal(cardName(v.discardTop), 'Q♠');
  assert.equal(v.discardBlocked, true); // only 1 card: the pile needs 5 to be taken
  assert.equal(v.stockCount, 3);
  assert.equal(v.discardCount, 1);
});

test('players: 2 to 6, lobby only, removal only between rounds', () => {
  const g = new Game({ rng: () => 0 });
  g.addPlayer('A', 'A');
  assert.throws(() => g.start(), GameError);
  for (const n of 'BCDEF') g.addPlayer(n, n);
  assert.equal(g.players.length, MAX_PLAYERS);
  assert.throws(() => g.addPlayer('G', 'G'), GameError);
  assert.throws(() => new Game().addPlayer('X', '  '), GameError);
  g.start();
  assert.throws(() => g.addPlayer('H', 'H'), GameError);
  assert.throws(() => g.removePlayer('B'), GameError);
  g.phase = 'roundOver';
  g.removePlayer('A'); // the dealer
  g.nextRound();
  assert.equal(g.view(null).dealerId, 'B');
  assert.equal(g.turnId, 'C');
});

// ---- drawing ------------------------------------------------------------

test('drawing from the stock takes 3, or what is left', () => {
  const g = setup();
  arrange(g, { stock: '4♠ 5♠ 6♠ 7♠ 8♠', discard: '9♣' });
  const before = g.player('B').hand.length;
  g.draw('B');
  assert.equal(g.player('B').hand.length, before + 3);
  assert.equal(g.stage, 'play');
  assert.equal(g.stock.length, 2);
  g.discardCard('B', idOf(g, 'B', '4♠'));
  g.draw('A');
  assert.equal(g.stock.length, 0);
  assert.equal(g.player('A').hand.length, 11 + 2);
});

test('turns are draw, play, discard; out-of-turn and out-of-stage moves are refused', () => {
  const g = setup();
  assert.throws(() => g.draw('A'), /not your turn/);
  assert.throws(() => g.discardCard('B', g.player('B').hand[0].id), /Draw first/);
  assert.throws(() => g.meld('B', []), /Draw first/);
  g.draw('B');
  assert.throws(() => g.draw('B'), /already drawn/);
  assert.throws(() => g.pickup('B', []), /already drawn/);
  assert.throws(() => g.discardCard('B', 99999), /isn't in your hand/);
  g.discardCard('B', String(g.player('B').hand[0].id)); // ids may arrive as strings
  assert.equal(g.turnId, 'A');
  assert.equal(g.stage, 'draw');
});

test('choosing an empty stock ends the round with no going-out bonus', () => {
  const g = setup();
  arrange(g, {
    stock: '',
    discard: '3♣',
    players: {
      B: { hand: '9♥ 3♥', foot: '4♣', piles: { 13: 'K♥ K♦ K♣' } },
      A: { hand: '5♠', foot: '3♠ JK' },
    },
  });
  g.draw('B');
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.outId, null);
  const [b] = g.player('B').roundScores;
  assert.deepEqual(b, { melded: 30, bonus: 0, wentOut: 0, penalty: 10 + 300 + 5, total: 30 - 315 });
  const [a] = g.player('A').roundScores;
  assert.deepEqual(a, { melded: 0, bonus: 0, wentOut: 0, penalty: 5 + 5 + 50, total: -60 });
});

// ---- the discard pile ---------------------------------------------------

test('the discard pile is blocked by a 3 (red or black), a wild, or being empty', () => {
  for (const top of ['3♠', '3♣', '3♥', '3♦', '2♣', '2♥', 'JK', null]) {
    const g = setup();
    arrange(g, { discard: top ? `4♣ 5♣ 6♣ K♠ ${top}` : '', players: { B: { hand: 'K♥ K♦ 4♠ 4♣ 4♦' } } });
    assert.equal(g.view('B').discardBlocked, true, `${top}`);
    assert.throws(() => g.pickup('B', [{ rank: 13, cardIds: idsOf(g, 'B', 'K♥ K♦') }]), GameError, `${top}`);
    assert.equal(g.stage, 'draw');
  }
});

test('taking the discard pile takes the top 5; the top card is melded, the rest join your cards', () => {
  const g = setup();
  arrange(g, {
    discard: '4♣ 5♣ 6♣ 7♣ 8♣ 9♣ K♠',
    players: { B: { hand: 'K♥ K♦ A♥ A♦ A♣ 4♠', opened: false } },
  });
  const top = g.discard.at(-1);
  g.pickup('B', [
    { rank: 13, cardIds: [...idsOf(g, 'B', 'K♥ K♦'), top.id] },
    entry(g, 'B', 14, 'A♥ A♦ A♣'),
  ]);
  assert.equal(g.stage, 'play');
  assert.equal(names(g.discard), '4♣ 5♣');
  assert.equal(names(pile(g, 'B', 13).cards), 'K♥ K♦ K♠');
  assert.equal(names(g.player('B').hand), '4♠ 6♣ 7♣ 8♣ 9♣');
  assert.equal(g.player('B').opened, true);
  assert.equal(g.view(null).discardTop.rank, 5);
});

test('the discard pile keeps discard order: a pickup takes the last 5 discards, the rest stay in order', () => {
  const g = setup();
  arrange(g, {
    stock: '4♥ 4♦ 4♣ 4♠ 6♥ 6♦ 6♣ 6♠ 7♥ 7♦ 7♣ 7♠ 9♥ 9♦ 9♣ 9♠ 10♥ 10♦',
    discard: '8♣',
    players: { A: { hand: 'J♥ J♦ J♣ J♠ Q♥ Q♦', opened: true }, B: { hand: 'J♥ J♦ J♣ J♠ Q♥ Q♦', opened: true } },
  });
  // Six turns, each discarding a known card on top of the last.
  const order = ['J♥', 'Q♥', 'J♦', 'Q♦', 'J♣', 'K♠'];
  for (const name of order) {
    const pid = g.turnId;
    g.draw(pid);
    if (name === 'K♠') g.player(pid).hand.push(card('K♠'));
    g.discardCard(pid, idOf(g, pid, name));
  }
  assert.equal(names(g.discard), `8♣ ${order.join(' ')}`);
  // The log says who discarded, never which card.
  const logged = g.log.map((l) => l.text).join('\n');
  assert.ok(logged.includes(' discarded.'));
  for (const name of order) assert.ok(!logged.includes(name), `log names ${name}`);

  const pid = g.turnId;
  arrange(g, { players: { [pid]: { hand: 'K♥ K♦ 4♠' } } });
  g.pickup(pid, [{ rank: 13, cardIds: [...idsOf(g, pid, 'K♥ K♦'), g.discard.at(-1).id] }]);
  assert.equal(names(g.discard), '8♣ J♥');
  assert.equal(names(g.player(pid).hand), '4♠ Q♥ J♦ Q♦ J♣');
});

test('the discard pile can only be taken with at least 5 cards in it', () => {
  const g = setup();
  arrange(g, { discard: '6♣ 7♣ 9♣ K♠', players: { B: { hand: 'K♥ 4♠', piles: { 13: 'K♦ K♣ K♥' } } } });
  assert.equal(g.view('B').discardBlocked, true);
  const before = snapshot(g);
  assert.throws(() => g.pickup('B', [{ rank: 13, cardIds: [g.discard.at(-1).id] }]), /at least 5 cards/);
  assert.equal(snapshot(g), before);

  g.discard.unshift(card('5♣'));
  assert.equal(g.view('B').discardBlocked, false);
  g.pickup('B', [{ rank: 13, cardIds: [g.discard.at(-1).id] }]);
  assert.equal(g.discard.length, 0);
  assert.equal(names(pile(g, 'B', 13).cards), 'K♦ K♣ K♥ K♠');
  assert.equal(names(g.player('B').hand), 'K♥ 4♠ 5♣ 6♣ 7♣ 9♣');
});

test('a pickup batch without the top card, or with the cards under it, is refused and changes nothing', () => {
  const g = setup();
  arrange(g, {
    discard: '5♣ 6♣ 9♣ Q♠ K♠',
    players: { B: { hand: 'K♥ K♦ Q♥ Q♦ A♥ A♦ A♣ 4♠', piles: { 5: '5♥ 5♦ 5♣' } } },
  });
  const before = snapshot(g);
  assert.throws(() => g.pickup('B', [entry(g, 'B', 14, 'A♥ A♦ A♣')]), /must meld the K♠/);
  assert.throws(() => g.pickup('B', [{ rank: 12, cardIds: [...idsOf(g, 'B', 'Q♥ Q♦'), g.discard[3].id] }]), /isn't in your hand/);
  assert.throws(() => g.pickup('B', []), GameError);
  assert.throws(() => g.pickup('B', undefined), GameError);
  assert.equal(snapshot(g), before);
});

test('the top card may go onto your existing pile of its rank', () => {
  const g = setup();
  arrange(g, { discard: '5♣ 6♣ 7♣ 4♣ 9♣', players: { B: { hand: 'K♥ 4♠ 5♠', piles: { 9: '9♥ 9♦ 9♠' } } } });
  g.pickup('B', [{ rank: 9, cardIds: [g.discard.at(-1).id] }]);
  assert.equal(pile(g, 'B', 9).cards.length, 4);
  assert.equal(names(g.player('B').hand), 'K♥ 4♠ 5♠ 5♣ 6♣ 7♣ 4♣');
});

// ---- opening ------------------------------------------------------------

test('opening minimum per round: 50 / 90 / 120 / 150, counting every card in the batch', () => {
  for (let round = 1; round <= ROUNDS; round++) {
    const g = setup();
    g.phase = 'roundOver';
    g.round = round - 1;
    g.nextRound();
    assert.equal(g.openingMin, OPENING_MINIMUMS[round - 1]);
    assert.equal(g.view(null).openingMin, [50, 90, 120, 150][round - 1]);
    const id = g.turnId;
    // Kings 30, Aces 60, Jokers in a pile of 8s: 10*3 + 50 = 80, total 170.
    arrange(g, { stock: '4♠ 5♠ 6♠ 7♠', players: { [id]: { hand: 'K♥ K♦ K♣ A♥ A♦ A♣ 8♥ 8♦ 8♣ JK 4♣', opened: false } } });
    g.draw(id);
    const tries = [
      [[entry(g, id, 13, 'K♥ K♦ K♣')], 30],
      [[entry(g, id, 13, 'K♥ K♦ K♣'), entry(g, id, 14, 'A♥ A♦ A♣')], 90],
      [[entry(g, id, 14, 'A♥ A♦ A♣'), entry(g, id, 8, '8♥ 8♦ 8♣')], 90],
      [[entry(g, id, 13, 'K♥ K♦ K♣'), entry(g, id, 14, 'A♥ A♦ A♣'), entry(g, id, 8, '8♥ 8♦ 8♣')], 120],
      [[entry(g, id, 13, 'K♥ K♦ K♣'), entry(g, id, 14, 'A♥ A♦ A♣'), entry(g, id, 8, '8♥ 8♦ 8♣ JK')], 170],
    ];
    const min = OPENING_MINIMUMS[round - 1];
    let opened = false;
    for (const [batch, total] of tries) {
      if (opened) break;
      if (total < min) {
        assert.throws(() => g.meld(id, batch), new RegExp(`at least ${min} \\(that's ${total}\\)`));
        assert.equal(g.player(id).piles.length, 0);
      } else {
        g.meld(id, batch);
        opened = true;
      }
    }
    assert.ok(opened);
    assert.equal(g.player(id).opened, true);
  }
});

test('once opened, small melds are fine; the pickup top card counts toward opening', () => {
  const g = setup();
  arrange(g, { discard: '5♣ 6♣ 7♣ 4♣ A♠', players: { B: { hand: 'A♥ A♦ K♥ K♦ K♣ 4♠ 5♠', opened: false } } });
  // A♠ + A♥ + A♦ = 60 >= 50
  g.pickup('B', [{ rank: 14, cardIds: [...idsOf(g, 'B', 'A♥ A♦'), g.discard.at(-1).id] }]);
  assert.equal(g.player('B').opened, true);
  g.meld('B', [entry(g, 'B', 13, 'K♥ K♦ K♣')]);
  assert.equal(pile(g, 'B', 13).cards.length, 3);

  const h = setup();
  arrange(h, { discard: '5♣ 6♣ 7♣ 4♣ K♠', players: { B: { hand: 'K♥ K♦ 4♠ 5♠', opened: false } } });
  assert.throws(() => h.pickup('B', [{ rank: 13, cardIds: [...idsOf(h, 'B', 'K♥ K♦'), h.discard.at(-1).id] }]), /at least 50 \(that's 30\)/);
  assert.equal(h.discard.length, 5);
});

// ---- piles --------------------------------------------------------------

test('new piles need 3 cards with 2 naturals; 3s and wrong ranks never meld', () => {
  const g = setup();
  arrange(g, { players: { B: { hand: 'K♥ K♦ K♣ Q♥ JK 2♣ 3♠ 3♥ 3♦ 4♠ 4♣', piles: { 9: '9♥ 9♦ 9♣' } } } });
  g.draw('B');
  assert.throws(() => g.meld('B', [entry(g, 'B', 13, 'K♥ K♦')]), /at least 3 cards/);
  assert.throws(() => g.meld('B', [entry(g, 'B', 13, 'K♥ JK 2♣')]), /at least 2 natural/);
  assert.throws(() => g.meld('B', [entry(g, 'B', 13, 'K♥ K♦ Q♥')]), /doesn't belong/);
  assert.throws(() => g.meld('B', [{ rank: 3, cardIds: idsOf(g, 'B', '3♠ 3♥ 3♦') }]), /3s can never/);
  assert.throws(() => g.meld('B', [entry(g, 'B', 4, '4♠ 4♣ 3♠')]), /3s can never/);
  assert.throws(() => g.meld('B', [{ rank: 2, cardIds: idsOf(g, 'B', 'JK 2♣') }]), /4s through Aces/);
  assert.throws(() => g.meld('B', [{ rank: 'x', cardIds: idsOf(g, 'B', 'K♥ K♦ K♣') }]), /4s through Aces/);
  assert.throws(() => g.meld('B', [{ rank: 13, cardIds: [] }]), /Choose some cards/);
  const k = idOf(g, 'B', 'K♥');
  assert.throws(() => g.meld('B', [{ rank: 13, cardIds: [k, k, idOf(g, 'B', 'K♦')] }]), /same card twice/);
  g.meld('B', [{ rank: '13', cardIds: idsOf(g, 'B', 'K♥ K♦ JK') }]); // rank may arrive as a string
  assert.equal(names(pile(g, 'B', 13).cards), 'K♥ K♦ Joker');
});

test('one pile per rank: melding a rank you already have adds to that pile', () => {
  const g = setup();
  arrange(g, { players: { B: { hand: 'K♥ K♦ K♣ K♠ K♥ 2♣ 9♠ 4♠ 4♣', piles: { 9: '9♥ 9♦ 9♣' } } } });
  g.draw('B');
  g.meld('B', [entry(g, 'B', 13, 'K♥ K♦ K♣'), entry(g, 'B', 13, 'K♠')]);
  g.meld('B', [entry(g, 'B', 9, '9♠')]);
  g.meld('B', [entry(g, 'B', 13, '2♣')]); // a wild alone onto a pile
  g.meld('B', [entry(g, 'B', 13, 'K♥')]);
  assert.deepEqual(g.player('B').piles.map((p) => [p.rank, p.cards.length]), [[9, 4], [13, 6]]);
  assert.deepEqual(g.view('A').players.find((p) => p.id === 'B').piles.map((p) => p.rank), [9, 13]);
});

test('naturals must outnumber wilds, and a clean book takes no wilds', () => {
  const g = setup();
  arrange(g, {
    players: {
      B: {
        hand: 'JK 2♣ 2♦ 2♥ 10♥ 10♦ Q♥ 5♣ 5♦',
        piles: { 9: '9♥ 9♦ 9♣ 9♠ 9♥ 9♦ 9♣', 13: 'K♥ K♦ JK', 8: '8♥ 8♦ 8♣ 8♠' },
      },
    },
  });
  g.draw('B');
  assert.throws(() => g.meld('B', [entry(g, 'B', 9, 'JK')]), /clean book/);
  assert.throws(() => g.meld('B', [entry(g, 'B', 13, '2♣')]), /more natural cards than wild/);
  assert.throws(() => g.meld('B', [entry(g, 'B', 10, '10♥ 10♦ 2♣ 2♦')]), /more natural cards than wild/);
  assert.throws(() => g.meld('B', [entry(g, 'B', 12, 'JK 2♣ 2♦')]), /at least 2 natural/);
  assert.throws(() => g.meld('B', [entry(g, 'B', 8, '2♣ 2♦ 2♥ JK')]), /more natural cards than wild/);
  g.meld('B', [entry(g, 'B', 8, '2♣ 2♦ 2♥')]); // 4 naturals, 3 wilds: a dirty book
  assert.equal(bookType(pile(g, 'B', 8).cards), 'dirty');
  g.meld('B', [entry(g, 'B', 10, '10♥ 10♦ JK')]);
  assert.equal(pile(g, 'B', 10).cards.length, 3);
});

test('a batch is all or nothing: one bad entry leaves everything as it was', () => {
  const g = setup();
  arrange(g, { players: { B: { hand: 'K♥ K♦ K♣ Q♥ Q♦ 4♠', piles: { 9: '9♥ 9♦ 9♣' } } } });
  g.draw('B');
  const before = snapshot(g);
  assert.throws(() => g.meld('B', [entry(g, 'B', 13, 'K♥ K♦ K♣'), entry(g, 'B', 12, 'Q♥ Q♦')]), /at least 3 cards/);
  assert.equal(snapshot(g), before);
});

test('piles past 7 cards stay one book: 14 cards earn one bonus', () => {
  const g = setup();
  arrange(g, {
    stock: '',
    players: {
      B: { hand: '', inFoot: true, piles: { 9: '9♥ 9♦ 9♣ 9♠ 9♥ 9♦ 9♣ 9♠ 9♥ 9♦ 9♣ 9♠ 9♥ 9♦', 13: 'K♥ K♦ K♣ K♠ K♥ K♦ 2♣ 2♦', 5: '5♥ 5♦ 5♣ 5♠ 5♥ 5♦' } },
      A: { hand: '', foot: '' },
    },
  });
  const b = g.view(null).players.find((p) => p.id === 'B');
  assert.deepEqual(b.piles.map((p) => p.book), [null, 'clean', 'dirty']);
  assert.equal(b.cleanBooks, 1);
  assert.equal(b.dirtyBooks, 1);
  assert.equal(b.canGoOut, false);
  g.draw('B'); // empty stock: round over
  const [s] = g.player('B').roundScores;
  assert.equal(s.bonus, 500 + 300);
  assert.equal(s.melded, 30 + 140 + 60 + 40);
});

// ---- hand to foot -------------------------------------------------------

test('melding your whole hand picks up your foot at once and you play on from it', () => {
  const g = setup();
  arrange(g, {
    stock: 'K♣ A♣ A♠ 4♠',
    players: { B: { hand: 'K♥ K♦ A♥ A♦', foot: 'Q♥ Q♦ Q♣ 7♠ 7♣', opened: false } },
  });
  g.draw('B');
  g.meld('B', [entry(g, 'B', 13, 'K♥ K♦ K♣'), entry(g, 'B', 14, 'A♥ A♦ A♣ A♠')]);
  const p = g.player('B');
  assert.equal(p.inFoot, true);
  assert.equal(p.foot.length, 0);
  assert.equal(names(p.hand), 'Q♥ Q♦ Q♣ 7♠ 7♣');
  assert.equal(g.turnId, 'B');
  assert.equal(g.stage, 'play');
  g.meld('B', [entry(g, 'B', 12, 'Q♥ Q♦ Q♣')]);
  g.discardCard('B', idOf(g, 'B', '7♠'));
  assert.equal(g.turnId, 'A');
  const v = g.view('B');
  assert.equal(v.you.inFoot, true);
  assert.equal(v.you.footCount, 0);
  assert.equal(names(v.you.cards), '7♣');
});

test('discarding your last hand card picks up your foot; you play it next turn', () => {
  const g = setup();
  arrange(g, {
    stock: '4♠ 4♣ 4♦ 5♠ 5♣ 5♦ 6♠ 6♣ 6♦',
    players: { B: { hand: 'K♥', foot: 'Q♥ Q♦ Q♣ 7♠', piles: { 13: 'K♣ K♠ K♦' } } },
  });
  g.draw('B');
  g.meld('B', [entry(g, 'B', 4, '4♠ 4♣ 4♦')]);
  g.discardCard('B', idOf(g, 'B', 'K♥'));
  const p = g.player('B');
  assert.equal(p.inFoot, true);
  assert.equal(names(p.hand), 'Q♥ Q♦ Q♣ 7♠');
  assert.equal(g.turnId, 'A');
  const seen = g.view('A').players.find((q) => q.id === 'B');
  assert.equal(seen.inFoot, true);
  assert.equal(seen.cardCount, 4);
  assert.equal(seen.footCount, 0);
  g.draw('A');
  g.discardCard('A', g.player('A').hand[0].id);
  g.draw('B');
  assert.equal(names(p.hand), 'Q♥ Q♦ Q♣ 7♠ 6♠ 6♣ 6♦');
});

test('a pickup that melds the whole hand keeps the 4 taken cards; melding those picks up the foot', () => {
  const g = setup();
  arrange(g, { discard: '5♣ 5♦ 5♠ 5♥ A♠', players: { B: { hand: 'A♥ A♦', foot: '7♠ 7♣ 7♦', opened: false } } });
  g.pickup('B', [{ rank: 14, cardIds: [...idsOf(g, 'B', 'A♥ A♦'), g.discard.at(-1).id] }]);
  assert.equal(g.player('B').inFoot, false);
  assert.equal(names(g.player('B').hand), '5♣ 5♦ 5♠ 5♥');
  g.meld('B', [entry(g, 'B', 5, '5♣ 5♦ 5♠ 5♥')]);
  assert.equal(g.player('B').inFoot, true);
  assert.equal(names(g.player('B').hand), '7♠ 7♣ 7♦');
  assert.equal(g.stage, 'play');
});

// ---- in the foot: limits and going out ------------------------------------

const TWO_CLEAN_ONE_DIRTY = {
  9: '9♥ 9♦ 9♣ 9♠ 9♥ 9♦ 9♣',
  10: '10♥ 10♦ 10♣ 10♠ 10♥ 10♦ 10♣',
  13: 'K♥ K♦ K♣ K♠ K♥ K♦ JK',
};

test('in the foot, a meld must keep a card, and two until you have the books', () => {
  const g = setup();
  arrange(g, {
    stock: 'Q♥ Q♦ Q♣',
    players: { B: { hand: '5♠', inFoot: true, piles: { 9: '9♥ 9♦ 9♣ 9♠ 9♥ 9♦', 10: TWO_CLEAN_ONE_DIRTY[10], 13: TWO_CLEAN_ONE_DIRTY[13] } } },
  });
  g.draw('B'); // 5♠ Q♥ Q♦ Q♣
  assert.throws(() => g.meld('B', [entry(g, 'B', 12, 'Q♥ Q♦ Q♣')]), /Keep two cards/);
  assert.equal(g.player('B').hand.length, 4);
});

test('in the foot, a meld that completes the books may leave one card, never none', () => {
  const g = setup();
  arrange(g, {
    stock: '9♠ 9♥ 5♣',
    players: { B: { hand: '5♠', inFoot: true, piles: { 9: '9♥ 9♦ 9♣ 9♠ 9♥ 9♦', 10: TWO_CLEAN_ONE_DIRTY[10], 13: TWO_CLEAN_ONE_DIRTY[13] } } },
  });
  g.draw('B'); // 5♠ 9♠ 9♥ 5♣
  assert.throws(() => g.meld('B', [entry(g, 'B', 9, '9♠ 9♥'), entry(g, 'B', 5, '5♠ 5♣')]), /at least 3 cards/);
  g.meld('B', [entry(g, 'B', 9, '9♠ 9♥')]); // the 9s become a clean book (8 cards)
  assert.equal(g.view(null).players.find((p) => p.id === 'B').canGoOut, true);

  const h = setup();
  arrange(h, {
    stock: '4♠ 4♣ 4♦',
    players: { B: { hand: '', inFoot: true, piles: TWO_CLEAN_ONE_DIRTY } },
  });
  h.draw('B');
  assert.throws(() => h.meld('B', [entry(h, 'B', 4, '4♠ 4♣ 4♦')]), /Keep a card to discard/);
});

test("in the foot you can't discard your last card without 2 clean books and 1 dirty", () => {
  const g = setup();
  arrange(g, {
    stock: '9♠ 9♥ 5♣ 6♣ 7♣ 8♣',
    players: {
      B: { hand: '', inFoot: true, piles: { 9: '9♥ 9♦ 9♣ 9♠ 9♥ 9♦ 9♣', 13: TWO_CLEAN_ONE_DIRTY[13], 10: '10♥ 10♦ 10♣' } },
    },
  });
  g.draw('B'); // 9♠ 9♥ 5♣
  // Melding the 9s would leave one card without the books: refused.
  assert.throws(() => g.meld('B', [entry(g, 'B', 9, '9♠ 9♥')]), /Keep two cards/);
  // A discard that leaves cards is fine; the very last card is not.
  g.discardCard('B', idOf(g, 'B', '9♠'));
  assert.equal(g.turnId, 'A');
  g.turnId = 'B';
  g.stage = 'play';
  arrange(g, { players: { B: { hand: '5♣' } } });
  assert.throws(() => g.discardCard('B', idOf(g, 'B', '5♣')), /2 clean books and 1 dirty/);
  assert.equal(g.turnId, 'B');
  assert.equal(g.phase, 'playing');
  assert.equal(g.player('B').hand.length, 1);
});

test('going out: discard the last foot card with the books; +100 and the round ends', () => {
  const g = setup();
  arrange(g, {
    stock: '10♠ 5♣ 8♣ 4♥',
    players: {
      B: { hand: '5♠ 5♥', inFoot: true, piles: { 9: TWO_CLEAN_ONE_DIRTY[9], 13: TWO_CLEAN_ONE_DIRTY[13], 10: '10♥ 10♦ 10♣ 10♥ 10♦ 10♣' } },
      A: { hand: '3♥ 3♣ K♠', foot: 'JK 4♠', piles: { 6: '6♥ 6♦ 6♣' } },
    },
  });
  g.draw('B'); // 5♠ 5♥ 10♠ 5♣ 8♣
  g.meld('B', [entry(g, 'B', 10, '10♠'), entry(g, 'B', 5, '5♠ 5♥ 5♣')]); // books made: one card may stay
  assert.equal(names(g.player('B').hand), '8♣');
  g.discardCard('B', idOf(g, 'B', '8♣'));
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.outId, 'B');
  assert.equal(g.turnId, null);
  const [b] = g.player('B').roundScores;
  assert.deepEqual(b, { melded: 70 + 110 + 70 + 15, bonus: 1300, wentOut: 100, penalty: 0, total: 265 + 1300 + 100 });
  // A's unpicked foot counts against them, red 3 300, black 3 5.
  const [a] = g.player('A').roundScores;
  assert.deepEqual(a, { melded: 15, bonus: 0, wentOut: 0, penalty: 300 + 5 + 10 + 50 + 5, total: 15 - 370 });
  assert.equal(g.player('A').score, -355);
  assert.equal(g.view(null).players.find((p) => p.id === 'B').score, 1665);
});

// ---- rounds and the game ------------------------------------------------

test('four rounds, the dealer rotates; highest total wins and ties share', () => {
  const g = setup({ players: ['A', 'B', 'C'] });
  const dealers = [];
  for (let round = 1; round <= ROUNDS; round++) {
    assert.equal(g.round, round);
    dealers.push(g.view(null).dealerId);
    // Empty the stock so the next draw ends the round; set the penalties.
    arrange(g, {
      stock: '',
      players: { A: { hand: '4♠', foot: '' }, B: { hand: '4♣', foot: '' }, C: { hand: round === 4 ? '5♠ 5♣' : '4♦', foot: '' } },
    });
    g.draw(g.turnId);
    if (round < ROUNDS) {
      assert.equal(g.phase, 'roundOver');
      assert.throws(() => g.draw(g.players[0].id), /No round/);
      g.nextRound();
    }
  }
  assert.deepEqual(dealers, ['A', 'B', 'C', 'A']);
  assert.equal(g.phase, 'gameOver');
  assert.throws(() => g.nextRound(), /not over/);
  assert.deepEqual(g.players.map((p) => p.score), [-20, -20, -25]);
  assert.deepEqual(g.winners, ['A', 'B']);
  assert.deepEqual(g.view(null).winners, ['A', 'B']);
  g.reset();
  assert.equal(g.phase, 'lobby');
  assert.ok(g.players.every((p) => p.score === 0 && p.roundScores.length === 0));
});

// ---- autoplay -----------------------------------------------------------

test('autoplay only acts for an offline turn player: draws 3, discards a red 3 first', () => {
  const g = setup();
  arrange(g, { stock: 'K♠ 4♠ 6♠ 7♠', players: { B: { hand: 'A♥ 3♦ JK 5♣' } } });
  assert.throws(() => handAndFoot.actions.autoplay(g), /connected/);
  g.player('B').connected = false;
  handAndFoot.actions.autoplay(g);
  assert.equal(cardName(g.discard.at(-1)), '3♦');
  assert.equal(g.player('B').hand.length, 6);
  assert.equal(g.player('B').piles.length, 0);
  assert.equal(g.turnId, 'A');
});

test('autoplay discards the highest-value natural card, or the cheapest wild if only wilds are left', () => {
  const g = setup();
  arrange(g, { players: { B: { hand: '4♣ JK 2♥ 10♠ A♦ 3♣ K♥' } } });
  assert.equal(cardName(autoDiscard(g, g.player('B'))), 'A♦');
  arrange(g, { players: { B: { hand: 'JK 2♥ JK' } } });
  assert.equal(cardName(autoDiscard(g, g.player('B'))), '2♥');
  arrange(g, { players: { B: { hand: '7♠', inFoot: true, piles: { 4: '4♥ 4♦ 4♣' } } } });
  assert.equal(autoDiscard(g, g.player('B')), null);
  arrange(g, { players: { B: { hand: '7♠', inFoot: true, piles: TWO_CLEAN_ONE_DIRTY } } });
  assert.equal(cardName(autoDiscard(g, g.player('B'))), '7♠');
});

test('autoplay after the player already drew just discards', () => {
  const g = setup();
  arrange(g, { stock: '4♠ 5♠ 6♠ 7♠', players: { B: { hand: 'K♥ 9♦' } } });
  g.draw('B');
  g.player('B').connected = false;
  handAndFoot.actions.autoplay(g);
  assert.equal(cardName(g.discard.at(-1)), 'K♥');
  assert.equal(g.stock.length, 1);
  assert.equal(g.turnId, 'A');
});

test('autoplay with an empty stock ends the round', () => {
  const g = setup();
  arrange(g, { stock: '' });
  g.player('B').connected = false;
  handAndFoot.actions.autoplay(g);
  assert.equal(g.phase, 'roundOver');
  assert.throws(() => handAndFoot.actions.autoplay(g), /No round/);
});

test('a whole game plays out to round 4 with autoplay, every card accounted for', () => {
  const g = setup({ players: ['A', 'B', 'C', 'D'] });
  for (const p of g.players) p.connected = false;
  let turns = 0;
  while (g.phase !== 'gameOver') {
    if (g.phase === 'roundOver') {
      g.nextRound();
      continue;
    }
    handAndFoot.actions.autoplay(g);
    if (g.phase === 'playing') {
      const all = g.stock.length + g.discard.length + g.players.reduce((t, p) => t + p.hand.length + p.foot.length, 0);
      assert.equal(all, 5 * 54);
    }
    assert.ok(++turns < 1000);
  }
  assert.equal(g.round, ROUNDS);
  assert.ok(g.players.every((p) => p.roundScores.length === ROUNDS));
  assert.ok(g.winners.length >= 1);
});

// ---- views --------------------------------------------------------------

test('views hide other hands, every foot, the stock order and the discards under the top', () => {
  const g = setup({ players: ['A', 'B', 'C'] });
  arrange(g, { discard: '4♣ 5♣ 6♣' });
  const hidden = (viewer) => {
    const own = viewer ? new Set(ids(g.player(viewer).hand)) : new Set();
    const ownCards = g.players.flatMap((p) => (p.id === viewer ? [] : p.hand));
    return [...ownCards, ...g.players.flatMap((p) => p.foot), ...g.stock, ...g.discard.slice(0, -1)].filter((c) => !own.has(c.id));
  };
  for (const viewer of [null, 'A', 'B', 'C']) {
    const v = g.view(viewer);
    const seen = new Set(ids(cardsIn(v)));
    for (const c of hidden(viewer)) assert.ok(!seen.has(c.id), `${viewer} sees ${cardName(c)}`);
    for (const p of v.players) {
      assert.equal(p.cardCount, 11);
      assert.equal(p.footCount, 11);
      assert.equal(p.inFoot, false);
      assert.ok(!('hand' in p) && !('foot' in p) && !('cards' in p));
    }
    assert.equal(v.stockCount, g.stock.length);
    assert.equal(v.discardCount, 3);
    assert.equal(cardName(v.discardTop), '6♣');
    assert.ok(!('stock' in v) && !('discard' in v));
  }
  const v = g.view('B');
  assert.deepEqual(ids(v.you.cards), ids(g.player('B').hand));
  assert.deepEqual(v.you, { id: 'B', cards: v.you.cards, inFoot: false, footCount: 11, opened: false });
  assert.equal(g.view(null).you, null);
  // Views are copies: changing one doesn't touch the game.
  v.you.cards.pop();
  assert.equal(g.player('B').hand.length, 11);
});

test('the view shows piles, books and progress to going out', () => {
  const g = setup();
  arrange(g, { players: { A: { piles: { 9: TWO_CLEAN_ONE_DIRTY[9], 13: TWO_CLEAN_ONE_DIRTY[13], 5: '5♥ 5♦ 5♣' } } } });
  const a = g.view('B').players.find((p) => p.id === 'A');
  assert.deepEqual(a.piles.map((p) => [p.rank, p.cards.length, p.book]), [[5, 3, null], [9, 7, 'clean'], [13, 7, 'dirty']]);
  assert.equal(a.cleanBooks, 1);
  assert.equal(a.dirtyBooks, 1);
  assert.equal(a.canGoOut, false);
  assert.equal(a.opened, true);
  assert.deepEqual(a.roundScores, []);
  assert.equal(a.connected, true);
});

test('the lobby view has no round details', () => {
  const g = new Game();
  g.addPlayer('A', 'Ann');
  const v = g.view('A');
  assert.equal(v.phase, 'lobby');
  assert.equal(v.round, 0);
  assert.equal(v.openingMin, null);
  assert.equal(v.turnId, null);
  assert.equal(v.stage, null);
  assert.equal(v.discardTop, null);
  assert.equal(v.stockCount, 0);
  assert.deepEqual(v.you, { id: 'A', cards: [], inFoot: false, footCount: 0, opened: false });
});

test('the log keeps the last 50 entries', () => {
  const g = new Game();
  for (let i = 0; i < 6; i++) g.addPlayer(`p${i}`, `P${i}`);
  for (let i = 0; i < 60; i++) g.addLog(`entry ${i}`);
  const { log } = g.view(null);
  assert.equal(log.length, 50);
  assert.equal(log.at(-1).text, 'entry 59');
  assert.ok(log.every((e, i) => i === 0 || e.id === log[i - 1].id + 1));
});

test('Hand and Foot is registered with its actions', () => {
  assert.equal(games.get('hand-and-foot'), handAndFoot);
  assert.equal(handAndFoot.minPlayers, 2);
  assert.equal(handAndFoot.maxPlayers, 6);
  assert.deepEqual(Object.keys(handAndFoot.actions).sort(), ['autoplay', 'discard', 'draw', 'meld', 'nextRound', 'pickup']);
  const g = handAndFoot.create();
  g.addPlayer('A', 'A');
  g.addPlayer('B', 'B');
  g.start();
  const turn = g.turnId;
  const me = () => turn;
  handAndFoot.actions.draw(g, {}, me);
  assert.equal(g.stage, 'play');
  assert.throws(() => handAndFoot.actions.meld(g, {}, me), /Choose some cards/);
  handAndFoot.actions.discard(g, { cardId: g.player(turn).hand[0].id }, me);
  assert.notEqual(g.turnId, turn);
});
