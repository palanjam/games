import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, buildDeck, scoreHand, GameError } from '../engine.js';

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

// ---- boot and late join ---------------------------------------------------

// Play the round out: everyone left stays (or picks the first option).
function finishRound(g) {
  for (let i = 0; i < 50 && g.phase === 'playing'; i++) {
    if (g.pending) g.choose(g.pending.chooserId, g.pending.options[0]);
    else g.stay(g.turnId);
  }
  assert.notEqual(g.phase, 'playing', 'round should finish');
}

test('joining mid-round puts the player on the waiting list and counts toward capacity', () => {
  const g = setup([5, 2, 3, 9]);
  const w = g.addPlayer('D', 'Dee');
  assert.equal(w.name, 'Dee');
  assert.ok(g.isWaiting('D'));
  assert.equal(g.players.length, 3);
  assert.deepEqual(g.toJSON().waiting, [{ id: 'D', name: 'Dee' }]);
  assert.equal(g.log.at(-1).text, 'Dee will join next round.');
  assert.throws(() => g.addPlayer('E', ' '), GameError);
  for (let i = 0; i < 8; i++) g.addPlayer(`W${i}`, `W${i}`);
  assert.throws(() => g.addPlayer('X', 'X'), /full/);
});

test('waiting players are seated next round with last place score', () => {
  const g = setup([10, 5, 1, 3, 9, 9, 9, 9, 9, 9], ['A', 'B', 'C']);
  g.stay('B');
  g.stay('C');
  g.stay('A');
  assert.equal(g.phase, 'roundOver');
  const lowest = Math.min(...g.players.map((p) => p.score));
  g.addPlayer('D', 'Dee');
  g.nextRound();
  assert.deepEqual(g.waiting, []);
  assert.equal(g.players.at(-1).id, 'D');
  assert.equal(g.player('D').score, lowest);
  assert.ok(g.log.some((l) => l.text === `Dee joins with ${lowest} points.`));
});

test('nextRound counts waiting players toward the minimum', () => {
  const g = setup([1, 2, 3], ['A', 'B']);
  g.removePlayer('B'); // abandoned
  assert.equal(g.phase, 'roundOver');
  assert.throws(() => g.nextRound(), GameError);
  g.addPlayer('C', 'Cee');
  g.nextRound();
  assert.equal(g.phase, 'playing');
  assert.equal(g.player('C').score, 0);
});

test('reset seats waiting players at zero', () => {
  const g = setup([1, 2, 3], ['A', 'B']);
  g.addPlayer('D', 'Dee');
  g.reset();
  assert.equal(g.phase, 'lobby');
  assert.deepEqual(g.waiting, []);
  assert.equal(g.player('D').score, 0);
});

test('removing a waiting player changes nothing else', () => {
  const g = setup([5, 2, 3, 9]);
  g.addPlayer('D', 'Dee');
  g.removePlayer('D');
  assert.deepEqual(g.waiting, []);
  assert.equal(g.players.length, 3);
  assert.equal(g.phase, 'playing');
  assert.equal(g.turnId, 'B');
});

test('removed turn holder: next seated player takes over', () => {
  const g = setup([5, 2, 3, 9, 9, 9]);
  g.removePlayer('B');
  assert.equal(g.turnId, 'C');
  assert.deepEqual(g.players.map((p) => p.id), ['A', 'C']);
  assert.equal(g.log.at(-1).text, 'B was removed from the game.');
  finishRound(g);
  assert.equal(g.phase, 'roundOver');
});

test('removing a player who is not on turn keeps the turn', () => {
  const g = setup([5, 2, 3, 9, 9, 9]);
  g.removePlayer('C');
  assert.equal(g.turnId, 'B');
  finishRound(g);
  assert.equal(g.players.length, 2);
});

test('a removed dealer: the next dealer is the player who would have dealt after them', () => {
  const g = setup([5, 2, 3, 9, 9, 9, 9, 9], ['A', 'B', 'C']); // A deals
  assert.equal(g.toJSON().dealerId, 'A');
  g.removePlayer('A');
  assert.equal(g.toJSON().dealerId, null);
  finishRound(g);
  g.nextRound();
  assert.equal(g.toJSON().dealerId, 'B');
});

test('removed chooser: the pending action is discarded and play moves on', () => {
  const g = setup([5, 2, 3, 'F', 9, 9, 9]);
  g.hit('B');
  assert.equal(g.pending.chooserId, 'B');
  g.removePlayer('B');
  assert.equal(g.pending, null);
  assert.equal(g.discard.length, 1);
  assert.equal(g.turnId, 'C');
  finishRound(g);
});

test('removed possible target is dropped from the pending options', () => {
  const g = setup([5, 2, 3, 'F', 9, 9, 9]);
  g.hit('B');
  g.removePlayer('C');
  assert.deepEqual(g.pending.options.sort(), ['A', 'B']);
  g.choose('B', 'A');
  assert.equal(g.turnId, 'B');
  finishRound(g);
});

test('Flip Three on a removed player ends and play continues', () => {
  const g = setup([5, 2, 3, 'T', 7, 'F', 8, 9, 9, 9]);
  g.hit('B');
  g.choose('B', 'C');
  assert.equal(g.pending.chooserId, 'C'); // C holds a Freeze from the sequence
  g.removePlayer('C');
  assert.equal(g.pending, null);
  assert.equal(g.turnId, 'A');
  finishRound(g);
});

test('removing the turn holder while someone else owes a choice resumes at the right seat', () => {
  const g = setup([5, 2, 3, 'T', 7, 'F', 8, 9, 9, 9]);
  g.hit('B');
  g.choose('B', 'C');
  g.removePlayer('B'); // B's turn is over once C resolves
  assert.equal(g.turnId, null);
  g.choose('C', 'A');
  assert.equal(g.turnId, 'C');
  finishRound(g);
});

test('removing down to one player abandons the round', () => {
  const g = setup([5, 2, 3, 9], ['A', 'B']);
  g.stay('B');
  g.removePlayer('A');
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.player('B').score, 0);
  assert.equal(g.log.at(-1).text, 'Round 1 was abandoned: not enough players.');
});

test('removing a player never leaks their cards', () => {
  const g = setup([5, 2, 3, 9, 9]);
  g.hit('B');
  g.removePlayer('B');
  const json = JSON.stringify(g.toJSON());
  assert.ok(!g.toJSON().players.some((p) => p.id === 'B'));
  assert.ok(!g.log.some((l) => /\b9\b/.test(l.text) && l.text.includes('removed')));
  assert.equal(g.log.at(-1).text, 'B was removed from the game.');
  assert.ok(json.includes('waiting'));
});

test('removing in roundOver and gameOver still works', () => {
  const g = setup([10, 1, 4], ['A', 'B', 'C'], { targetScore: 10 });
  g.stay('B');
  g.stay('C');
  g.stay('A');
  assert.equal(g.phase, 'gameOver');
  const winner = g.winners[0];
  g.removePlayer(winner);
  assert.deepEqual(g.winners, []);
});

// Every card is somewhere: deck, discard, set aside, on the table or in a pending choice.
function cardCount(g) {
  let n = g.deck.length + g.discard.length + g.outOfPlay.length + (g.pending ? 1 : 0);
  for (const p of g.players) n += p.numbers.length + p.modifiers.length + (p.secondChance ? 1 : 0) + (p.bustCard ? 1 : 0);
  return n;
}

test("a removed player's cards stay out of play this round, then rejoin the discard pile", () => {
  const g = setup([5, 2, 3, 'x2', '+4', 9, 9, 9, 9, 9]);
  g.hit('B'); // B: 5, x2
  const total = cardCount(g);
  g.removePlayer('B');
  assert.equal(cardCount(g), total);
  assert.equal(g.discard.length, 0, 'not reshuffled into this round');
  while (g.phase === 'playing') g.stay(g.turnId);
  g.nextRound();
  assert.equal(cardCount(g), total);
  assert.equal(g.outOfPlay.length, 0);
});

test('an abandoned round discards a pending action card instead of losing it', () => {
  const g = setup([5, 2, 'F', 9, 9], ['A', 'B']); // deal: B 5, A 2, then B hits a Freeze
  g.hit('B');
  assert.equal(g.pending?.chooserId, 'B');
  const total = cardCount(g);
  g.removePlayer('A');
  assert.equal(g.phase, 'roundOver');
  assert.equal(cardCount(g), total);
  assert.ok(g.discard.some((c) => c.value === 'freeze'));
});
