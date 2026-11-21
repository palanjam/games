import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, buildDeck, scoreHand, GameError } from '../src/game.js';

// Build a stacked deck from tokens: 5, '+4', 'x2', 'F' (Freeze), 'T' (Flip Three), 'S' (Second Chance).
function stack(...tokens) {
  return tokens.map((t, id) => {
    if (typeof t === 'number') return { id, type: 'number', value: t };
    if (t[0] === '+') return { id, type: 'modifier', value: Number(t.slice(1)) };
    if (t[0] === 'x') return { id, type: 'multiplier', value: 2 };
    return { id, type: 'action', value: { F: 'freeze', T: 'flipThree', S: 'secondChance' }[t] };
  });
}

// rng () => 0 makes A the first dealer, so the deal goes B, C, A and B acts first.
function setup(deck, names = ['A', 'B', 'C'], opts = {}) {
  const g = new Game({ rng: () => 0, deck: stack(...deck), ...opts });
  for (const n of names) g.addPlayer(n, n);
  g.start();
  return g;
}

const nums = (g, id) => g.player(id).numbers.map((c) => c.value);

test('deck has the standard 94-card composition', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 94);
  const numbers = deck.filter((c) => c.type === 'number');
  assert.equal(numbers.length, 79);
  for (let n = 1; n <= 12; n++) assert.equal(numbers.filter((c) => c.value === n).length, n);
  assert.equal(deck.filter((c) => c.type === 'action').length, 9);
  assert.equal(new Set(deck.map((c) => c.id)).size, 94);
});

test('scoring doubles numbers only, then adds modifiers and the Flip 7 bonus', () => {
  const card = (type, value) => ({ type, value });
  const hand = (numbers, modifiers = [], status = 'stayed') => ({
    status,
    numbers: numbers.map((v) => card('number', v)),
    modifiers,
  });
  assert.equal(scoreHand(hand([3, 5], [card('multiplier', 2), card('modifier', 4)])), 20);
  assert.equal(scoreHand(hand([0, 1, 2, 3, 4, 5, 6])), 21 + 15);
  assert.equal(scoreHand(hand([3, 5], [], 'busted')), 0);
});

test('deals left of the dealer and starts with the next player', () => {
  const g = setup([1, 2, 3, 4]);
  assert.deepEqual([nums(g, 'B'), nums(g, 'C'), nums(g, 'A')], [[1], [2], [3]]);
  assert.equal(g.turnId, 'B');
  assert.throws(() => g.hit('A'), GameError);
});

test('drawing a duplicate busts and passes the turn', () => {
  const g = setup([5, 2, 3, 5]);
  g.hit('B');
  assert.equal(g.player('B').status, 'busted');
  assert.equal(g.player('B').bustCard.value, 5);
  assert.equal(g.turnId, 'C');
});

test('Second Chance cancels a duplicate', () => {
  const g = setup([5, 2, 3, 'S', 5]);
  g.hit('B'); // Second Chance
  g.stay('C');
  g.stay('A');
  g.hit('B'); // duplicate 5
  assert.equal(g.player('B').status, 'active');
  assert.equal(g.player('B').secondChance, null);
  assert.deepEqual(nums(g, 'B'), [5]);
});

test('Freeze asks the drawer for a target and banks their points', () => {
  const g = setup([5, 2, 3, 'F']);
  g.hit('B');
  assert.equal(g.pending.kind, 'target');
  assert.equal(g.pending.chooserId, 'B');
  assert.throws(() => g.hit('C'), GameError);
  g.choose('B', 'C');
  assert.equal(g.player('C').status, 'frozen');
  assert.equal(g.turnId, 'A'); // C is skipped
});

test('Flip Three defers drawn actions until all three cards are flipped', () => {
  const g = setup([5, 2, 3, 'T', 7, 'F', 8, 9]);
  g.hit('B');
  g.choose('B', 'C');
  // C flipped 7, Freeze (held), 8 — then resolves the held Freeze.
  assert.deepEqual(nums(g, 'C'), [2, 7, 8]);
  assert.equal(g.pending.chooserId, 'C');
  g.choose('C', 'A');
  assert.equal(g.player('A').status, 'frozen');
  assert.equal(g.turnId, 'C');
});

test('busting during Flip Three discards held actions', () => {
  const g = setup([5, 2, 3, 'T', 'F', 2, 9]);
  g.hit('B');
  g.choose('B', 'C');
  assert.equal(g.player('C').status, 'busted');
  assert.equal(g.pending, null);
  assert.equal(g.turnId, 'A');
  assert.equal(g.deck[0].value, 9); // third card never flipped
});

test('an action dealt during the initial deal resolves before dealing continues', () => {
  const g = setup(['F', 2, 3, 4]);
  assert.equal(g.pending.chooserId, 'B');
  g.choose('B', 'C');
  assert.equal(g.player('C').status, 'frozen');
  assert.deepEqual(nums(g, 'C'), []); // frozen players are skipped in the deal
  assert.deepEqual(nums(g, 'A'), [2]);
  assert.equal(g.turnId, 'B');
});

test('an extra Second Chance goes to another player without one', () => {
  // Deal: B gets S, C gets 2, A gets S. B draws a second S: only C is eligible.
  const g = setup(['S', 2, 'S', 'S', 'S', 9]);
  g.hit('B');
  assert.ok(g.player('C').secondChance);
  // Now everyone holds one, so C's extra Second Chance is discarded.
  g.hit('C');
  assert.equal(g.discard.length, 1);
  assert.equal(g.pending, null);
});

test('Flip 7 ends the round immediately with a bonus', () => {
  const g = setup([1, 12, 2, 3, 4, 5, 6, 7], ['A', 'B']);
  for (let i = 0; i < 6; i++) {
    g.hit('B');
    if (g.phase !== 'playing') break;
    if (g.turnId === 'A') g.stay('A');
  }
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.player('B').status, 'flip7');
  assert.equal(g.player('B').roundScore, 1 + 2 + 3 + 4 + 5 + 6 + 7 + 15);
  assert.equal(g.player('A').roundScore, 12);
});

test('the game ends when someone reaches the target score', () => {
  const g = setup([10, 1, 4], ['A', 'B'], { targetScore: 10 });
  g.stay('B');
  g.stay('A');
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winners, ['B']);
  assert.throws(() => g.nextRound(), GameError);
});

test('dealer rotates and cards are recycled between rounds', () => {
  const g = setup([1, 2, 3], ['A', 'B']);
  g.stay('B');
  g.stay('A');
  assert.equal(g.phase, 'roundOver');
  g.nextRound(); // deck had 1 card left; the discard pile is reshuffled in when needed
  assert.equal(g.toJSON().dealerId, 'B');
  assert.equal(g.turnId, 'A');
  assert.equal(g.players.reduce((n, p) => n + p.numbers.length, 0), 2);
});
