import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameError, ASSETS, buildDeck, makeCard, TARGET_SCORE } from '../engine.js';
import cya from '../index.js';
import { games } from '../../../server/games.js';

let nextId = 1000;
const cards = (...keys) => keys.map((k) => makeCard(k, nextId++));

// Stack the deck so seats (in deal order, left of the dealer first) receive
// `hands`, then the first discard, then `rest` to draw from.
function dealt(hands, discard, rest = []) {
  const order = [];
  for (let i = 0; i < 5; i++) for (const h of hands) order.push(h[i]);
  return cards(...order, ...(discard ? [discard] : []), ...rest);
}

// rng () => 0 makes A the first dealer, so with A, B, C the deal goes B, C, A
// and B acts first.
function setup({ names = ['A', 'B', 'C'], deck, mode } = {}) {
  const g = new Game({ rng: () => 0, deck });
  for (const n of names) g.addPlayer(n, n);
  if (mode) g.setMode(mode);
  g.start();
  return g;
}

// Replace the dealt table: hands and stacks per player, and the draw pile.
function table(g, seats, deck = []) {
  for (const [id, { hand = [], stack = [] }] of Object.entries(seats)) {
    const p = g.player(id);
    p.hand = cards(...hand);
    p.stack = stack.map((keys) => {
      const cs = cards(...keys);
      return { asset: cs.find((c) => c.kind === 'asset').asset, cards: cs };
    });
  }
  g.deck = cards(...deck);
}

const keys = (list) => list.map((c) => c.asset);
const idOf = (g, pid, key) => g.player(pid).hand.find((c) => c.asset === key).id;
const top = (g, pid) => g.player(pid).stack.at(-1);

const FILLER = ['piggy', 'coins', 'cash', 'bank', 'stocks'];

// ---- deck ---------------------------------------------------------------

test('deck has 104 cards with the table counts and values', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 104);
  assert.equal(new Set(deck.map((c) => c.id)).size, 104);
  for (const a of ASSETS) {
    const of = deck.filter((c) => c.asset === a.key);
    assert.equal(of.length, a.count, a.key);
    assert.ok(of.every((c) => c.value === a.value && c.name === a.name));
    assert.ok(of.every((c) => c.kind === (a.wild ? 'wild' : 'asset')));
  }
  assert.equal(deck.filter((c) => c.kind === 'wild').length, 12);
  assert.equal(deck.find((c) => c.asset === 'gold').value, 50000);
  assert.equal(deck.find((c) => c.asset === 'home').value, 20000);
});

// ---- setup --------------------------------------------------------------

test('deals five each left of the dealer, flips a discard, and the next player starts', () => {
  const g = setup({ names: ['A', 'B'], deck: dealt([['home', 'home', 'home', 'home', 'home'], ['gold', 'gold', 'gold', 'gold', 'boat']], 'jewels', ['auto']) });
  assert.deepEqual(keys(g.player('B').hand), ['home', 'home', 'home', 'home', 'home']);
  assert.deepEqual(keys(g.player('A').hand), ['gold', 'gold', 'gold', 'gold', 'boat']);
  assert.equal(g.discard.at(-1).asset, 'jewels');
  assert.equal(g.deck.length, 1);
  assert.equal(g.turnId, 'B');
  assert.equal(g.view(null).dealerId, 'A');
});

test('players: max six, and a blank name is refused', () => {
  const g = new Game({ rng: () => 0 });
  for (const n of ['A', 'B', 'C', 'D', 'E', 'F']) g.addPlayer(n, n);
  assert.throws(() => g.addPlayer('G', 'G'), GameError);
  assert.throws(() => g.addPlayer('H', ' '), GameError);
  g.start();
  assert.throws(() => g.addPlayer('G', 'G'), GameError); // seated plus waiting is capped too
});

test('removing a player between rounds keeps the dealer in place', () => {
  const g = setup({ names: ['A', 'B', 'C'] });
  g.endRound();
  assert.equal(g.phase, 'roundOver');
  g.removePlayer('A'); // the dealer, seat 0
  g.nextRound(); // dealer moves on to the player after A
  assert.equal(g.view(null).dealerId, 'B');
  assert.equal(g.turnId, 'C');
});

test('mode can be set in the lobby only', () => {
  const g = new Game();
  assert.equal(g.mode, 'classic');
  g.setMode('quick');
  assert.equal(g.mode, 'quick');
  assert.throws(() => g.setMode('speedy'), GameError);
  g.addPlayer('A', 'A');
  g.addPlayer('B', 'B');
  g.start();
  assert.throws(() => g.setMode('classic'), GameError);
  g.reset();
  assert.equal(g.mode, 'quick');
});

// ---- pairing and discarding -------------------------------------------

test('pair: two matching assets or one asset with one wild', () => {
  const g = setup();
  table(g, { B: { hand: ['home', 'home', 'gold', 'boat', 'silver'] }, C: { hand: FILLER }, A: { hand: FILLER } }, ['auto', 'auto', 'auto', 'auto']);
  const [h1, h2] = g.player('B').hand.filter((c) => c.asset === 'home').map((c) => c.id);
  g.pair('B', [h1, h2]);
  assert.equal(g.player('B').stack.length, 1);
  assert.equal(top(g, 'B').asset, 'home');
  assert.equal(g.player('B').hand.length, 5); // drew back up
  assert.equal(g.turnId, 'C');
  g.discardCard('C', idOf(g, 'C', 'piggy'));
  g.discardCard('A', idOf(g, 'A', 'piggy'));
  // Wild + asset: the wild sits below the asset.
  g.pair('B', [idOf(g, 'B', 'boat'), idOf(g, 'B', 'gold')]);
  assert.equal(top(g, 'B').asset, 'boat');
  assert.deepEqual(keys(top(g, 'B').cards), ['gold', 'boat']);
});

test('pair rejects two wilds, mismatches, repeats, and out-of-turn plays', () => {
  const g = setup();
  table(g, { B: { hand: ['gold', 'silver', 'home', 'boat', 'boat'] }, C: { hand: FILLER }, A: { hand: FILLER } });
  const id = (k) => idOf(g, 'B', k);
  assert.throws(() => g.pair('B', [id('gold'), id('silver')]), /Two wilds/);
  assert.throws(() => g.pair('B', [id('home'), id('boat')]), GameError);
  assert.throws(() => g.pair('B', [id('home'), id('home')]), GameError);
  assert.throws(() => g.pair('B', [id('home')]), GameError);
  assert.throws(() => g.pair('B', [id('home'), 9999]), GameError);
  assert.throws(() => g.pair('C', [idOf(g, 'C', 'piggy'), idOf(g, 'C', 'coins')]), /not your turn/);
  assert.equal(g.player('B').hand.length, 5);
});

test('pairDiscard works with the wild in hand or on the discard pile', () => {
  const g = setup();
  table(g, { B: { hand: ['gold', ...FILLER.slice(1)] }, C: { hand: ['jewels', ...FILLER.slice(1)] }, A: { hand: ['silver', 'auto', ...FILLER.slice(2)] } });
  g.discard = cards('silver', 'jewels', 'home');
  // Wild in hand, asset on the pile.
  g.pairDiscard('B', idOf(g, 'B', 'gold'));
  assert.deepEqual(keys(top(g, 'B').cards), ['gold', 'home']);
  assert.equal(g.discard.at(-1).asset, 'jewels');
  // Matching asset.
  g.pairDiscard('C', idOf(g, 'C', 'jewels'));
  assert.equal(top(g, 'C').asset, 'jewels');
  // Wild on the pile, asset in hand; two wilds are refused.
  assert.equal(g.discard.at(-1).asset, 'silver');
  assert.throws(() => g.pairDiscard('A', idOf(g, 'A', 'silver')), /Two wilds/);
  g.pairDiscard('A', idOf(g, 'A', 'auto'));
  assert.deepEqual(keys(top(g, 'A').cards), ['silver', 'auto']);
  assert.equal(g.discard.length, 0);
  assert.throws(() => g.pairDiscard('B', idOf(g, 'B', 'coins')), /empty/);
});

test('pairDiscard rejects a card that does not match', () => {
  const g = setup();
  table(g, { B: { hand: FILLER }, C: { hand: FILLER }, A: { hand: FILLER } });
  g.discard = cards('home');
  assert.throws(() => g.pairDiscard('B', idOf(g, 'B', 'cash')), GameError);
});

test('discard puts the card on the pile and passes the turn', () => {
  const g = setup();
  table(g, { B: { hand: FILLER }, C: { hand: FILLER }, A: { hand: FILLER } }, ['home']);
  const card = g.player('B').hand[0];
  g.discardCard('B', String(card.id)); // ids may arrive as strings
  assert.equal(g.discard.at(-1), card);
  assert.equal(g.player('B').hand.length, 5);
  assert.equal(g.turnId, 'C');
});

test('a new set never merges with an existing set of the same asset', () => {
  const g = setup({ names: ['A', 'B'] });
  table(g, { B: { hand: ['home', 'home', 'home', 'home', 'cash'] }, A: { hand: FILLER } });
  const homes = () => g.player('B').hand.filter((c) => c.asset === 'home').map((c) => c.id);
  g.pair('B', homes().slice(0, 2));
  g.discardCard('A', idOf(g, 'A', 'piggy'));
  g.pair('B', homes().slice(0, 2));
  assert.equal(g.player('B').stack.length, 2);
  assert.ok(g.player('B').stack.every((s) => s.cards.length === 2));
});

// ---- challenges -------------------------------------------------------

test('challenge eligibility: own set, target with two sets, not self, matching card', () => {
  const g = setup();
  table(g, {
    B: { hand: ['home', 'boat', 'gold', 'cash', 'cash'] },
    C: { hand: ['home', ...FILLER.slice(1)], stack: [['auto', 'auto'], ['home', 'home']] },
    A: { hand: FILLER, stack: [['jewels', 'jewels']] },
  });
  const id = (k) => idOf(g, 'B', k);
  assert.throws(() => g.challenge('B', 'C', id('home')), /set of your own/);
  g.player('B').stack = [{ asset: 'stocks', cards: cards('stocks', 'stocks') }];
  assert.throws(() => g.challenge('B', 'A', id('gold')), /only set is safe/);
  assert.throws(() => g.challenge('B', 'B', id('gold')), /yourself/);
  assert.throws(() => g.challenge('B', 'Z', id('gold')), GameError);
  assert.throws(() => g.challenge('B', 'C', id('boat')), GameError);
  assert.throws(() => g.challenge('C', 'B', idOf(g, 'C', 'cash')), /not your turn/);
  g.challenge('B', 'C', id('gold')); // a wild always matches
  assert.equal(g.battle.toMoveId, 'C');
  assert.equal(g.battle.asset, 'home');
});

test('rulebook example: challenger wins the set plus every battle card', () => {
  const g = setup();
  table(g, {
    B: { hand: ['home', 'home', 'cash', 'bank', 'stocks'], stack: [['boat', 'boat']] },
    C: { hand: ['gold', 'cash', 'bank', 'stocks', 'auto'], stack: [['auto', 'auto'], ['home', 'silver']] },
    A: { hand: FILLER },
  }, ['jewels', 'jewels', 'jewels', 'piggy', 'piggy']);
  g.challenge('B', 'C', idOf(g, 'B', 'home'));
  assert.throws(() => g.discardCard('B', idOf(g, 'B', 'cash')), /battle/);
  assert.throws(() => g.respond('B', idOf(g, 'B', 'home')), /not your move/);
  g.respond('C', idOf(g, 'C', 'gold'));
  assert.equal(g.battle.toMoveId, 'B');
  assert.equal(g.deck.length, 5); // no drawing during a battle
  g.respond('B', idOf(g, 'B', 'home')); // C holds no home or wild: B wins
  assert.equal(g.battle, null);
  const won = top(g, 'B');
  assert.equal(g.player('B').stack.length, 2);
  assert.equal(won.asset, 'home');
  assert.equal(won.cards.length, 5);
  assert.deepEqual(keys(won.cards), ['silver', 'gold', 'home', 'home', 'home']);
  assert.equal(g.player('C').stack.length, 1);
  // B (turn player) draws first, then C, who played a card.
  assert.deepEqual(keys(g.player('B').hand).slice(-2), ['jewels', 'jewels']);
  assert.deepEqual(keys(g.player('C').hand).at(-1), 'jewels');
  assert.equal(g.player('C').hand.length, 5);
  assert.deepEqual(keys(g.deck), ['piggy', 'piggy']);
  assert.equal(g.turnId, 'C');
});

test('defender who outlasts the challenger keeps the set and adds the battle cards', () => {
  const g = setup();
  table(g, {
    B: { hand: ['gold', 'cash', 'bank', 'stocks', 'piggy'], stack: [['boat', 'boat']] },
    C: { hand: ['home', 'cash', 'bank', 'stocks', 'auto'], stack: [['auto', 'auto'], ['home', 'home']] },
    A: { hand: FILLER },
  }, ['jewels']);
  g.challenge('B', 'C', idOf(g, 'B', 'gold'));
  g.respond('C', idOf(g, 'C', 'home')); // B has nothing left: C wins
  assert.equal(g.battle, null);
  assert.equal(g.player('C').stack.length, 2);
  assert.deepEqual(keys(top(g, 'C').cards), ['gold', 'home', 'home', 'home']);
  assert.equal(g.player('B').stack.length, 1);
  assert.equal(g.player('B').hand.length, 5); // drew the last card
  assert.equal(g.player('C').hand.length, 4); // deck ran out before C
  assert.equal(g.turnId, 'C');
});

test('giving up hands the win to the other side', () => {
  const g = setup();
  table(g, {
    B: { hand: ['home', 'home', 'bank', 'stocks', 'piggy'], stack: [['boat', 'boat']] },
    C: { hand: ['silver', 'home', 'bank', 'stocks', 'auto'], stack: [['auto', 'auto'], ['home', 'home']] },
    A: { hand: FILLER },
  });
  g.challenge('B', 'C', idOf(g, 'B', 'home'));
  assert.throws(() => g.respond('C', idOf(g, 'C', 'bank')), GameError);
  assert.throws(() => g.fold('B'), /not your move/);
  g.fold('C');
  assert.equal(g.player('C').stack.length, 1);
  assert.deepEqual(keys(top(g, 'B').cards), ['home', 'home', 'home']);
  assert.throws(() => g.fold('C'), /no battle/);
});

test('a defender with no eligible card loses at once and does not draw', () => {
  const g = setup();
  table(g, {
    B: { hand: ['home', 'cash', 'bank', 'stocks', 'piggy'], stack: [['boat', 'boat']] },
    C: { hand: ['cash', 'bank', 'stocks', 'auto'], stack: [['auto', 'auto'], ['home', 'home']] },
    A: { hand: FILLER },
  }, ['jewels', 'jewels']);
  g.challenge('B', 'C', idOf(g, 'B', 'home'));
  assert.equal(g.battle, null);
  assert.deepEqual(keys(top(g, 'B').cards), ['home', 'home', 'home']);
  assert.equal(g.player('C').hand.length, 4);
  assert.deepEqual(keys(g.deck), ['jewels']);
});

test('the bottom set can never be stolen', () => {
  const g = setup();
  table(g, {
    B: { hand: ['home', 'gold', 'bank', 'stocks', 'piggy'], stack: [['boat', 'boat']] },
    C: { hand: FILLER, stack: [['home', 'home']] },
    A: { hand: FILLER },
  });
  assert.throws(() => g.challenge('B', 'C', idOf(g, 'B', 'home')), /safe/);
  assert.equal(g.player('C').stack.length, 1);
});

// ---- turn order and round end ------------------------------------------

test('players with empty hands are skipped once the deck is gone', () => {
  const g = setup();
  table(g, { B: { hand: ['cash', 'cash'] }, C: { hand: [] }, A: { hand: ['bank'] } });
  g.discardCard('B', g.player('B').hand[0].id);
  assert.equal(g.turnId, 'A');
  g.discardCard('A', g.player('A').hand[0].id);
  assert.equal(g.turnId, 'B');
});

test('the round ends when the deck and every hand are empty, scoring each stack', () => {
  const g = setup();
  table(g, {
    B: { hand: ['cash'], stack: [['home', 'home'], ['gold', 'boat']] },
    C: { hand: ['cash'], stack: [['piggy', 'piggy']] },
    A: { hand: ['cash'] },
  });
  g.discardCard('B', g.player('B').hand[0].id);
  g.discardCard('C', g.player('C').hand[0].id);
  assert.equal(g.phase, 'playing');
  g.discardCard('A', g.player('A').hand[0].id);
  assert.equal(g.phase, 'roundOver'); // classic, nobody near $1M
  assert.equal(g.player('B').roundScore, 40000 + 65000);
  assert.equal(g.player('C').roundScore, 10000);
  assert.equal(g.player('A').roundScore, 0);
  assert.equal(g.player('B').score, 105000);
  assert.equal(g.turnId, null);
  assert.throws(() => g.discardCard('B', 1), GameError);
});

test('next round rotates the dealer and deals from a fresh full deck', () => {
  const g = setup();
  table(g, { B: { hand: ['cash'], stack: [['home', 'home']] }, C: { hand: [] }, A: { hand: [] } });
  g.discardCard('B', g.player('B').hand[0].id);
  assert.equal(g.phase, 'roundOver');
  assert.throws(() => g.discardCard('B', 1), GameError);
  g.nextRound();
  assert.equal(g.round, 2);
  assert.equal(g.view(null).dealerId, 'B');
  assert.equal(g.turnId, 'C');
  assert.equal(g.deck.length, 104 - 15 - 1);
  assert.ok(g.players.every((p) => p.hand.length === 5 && !p.stack.length));
  assert.equal(g.player('B').score, 40000);
  assert.throws(() => g.nextRound(), GameError);
});

test('classic ends once someone reaches $1,000,000; ties share the win', () => {
  const g = setup({ names: ['A', 'B'] });
  g.player('A').score = TARGET_SCORE - 20000;
  g.player('B').score = TARGET_SCORE - 50000;
  table(g, { B: { hand: [], stack: [['gold', 'home']] }, A: { hand: [], stack: [['home', 'home']] } });
  g.endRound();
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winners.sort(), ['A', 'B']);
  assert.throws(() => g.nextRound(), GameError);
});

test('classic: the highest total wins when the target is reached', () => {
  const g = setup({ names: ['A', 'B'] });
  g.player('A').score = TARGET_SCORE - 10000;
  table(g, { B: { hand: [], stack: [['gold', 'home']] }, A: { hand: [], stack: [['home', 'home']] } });
  g.endRound();
  assert.deepEqual(g.winners, ['A']);
});

test('a winner who leaves after the game is dropped from winners', () => {
  const g = setup({ names: ['A', 'B', 'C'], mode: 'quick' });
  table(g, { B: { hand: ['cash'], stack: [['gold', 'home']] }, A: { hand: [], stack: [['home', 'home']] }, C: { hand: [], stack: [] } });
  g.discardCard('B', g.player('B').hand[0].id);
  assert.deepEqual(g.winners, ['B']);
  g.removePlayer('B');
  assert.deepEqual(g.winners, []);
  assert.deepEqual(g.view('A').winners, []);
});

test('quick mode ends after one round with the highest score winning', () => {
  const g = setup({ names: ['A', 'B'], mode: 'quick' });
  table(g, { B: { hand: ['cash'], stack: [['gold', 'home']] }, A: { hand: [], stack: [['home', 'home']] } });
  g.discardCard('B', g.player('B').hand[0].id);
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winners, ['B']);
  g.reset();
  assert.equal(g.phase, 'lobby');
  assert.ok(g.players.every((p) => p.score === 0));
});

// ---- views and descriptor ----------------------------------------------

test('view shows only your own hand and never the deck order', () => {
  const g = setup();
  const v = g.view('B');
  assert.equal(v.you.id, 'B');
  assert.deepEqual(v.you.hand, g.player('B').hand);
  assert.equal(v.handSize, 5);
  assert.equal(v.targetScore, TARGET_SCORE);
  assert.equal(v.deckCount, 104 - 15 - 1);
  assert.equal(v.discardTop, g.discard.at(-1));
  for (const p of v.players) {
    assert.equal(p.handCount, 5);
    assert.ok(!('hand' in p));
  }
  assert.ok(!('deck' in v));
  const pub = g.view(null);
  assert.equal(pub.you, null);
  // Collect every card-shaped object in the public view.
  const seen = new Set();
  const walk = (x) => {
    if (!x || typeof x !== 'object') return;
    if ('kind' in x && 'asset' in x) seen.add(x.id);
    Object.values(x).forEach(walk);
  };
  walk(pub);
  assert.deepEqual([...seen], [g.discard.at(-1).id]);
});

test('view describes a battle in progress', () => {
  const g = setup();
  table(g, {
    B: { hand: ['home', 'home', 'cash', 'bank', 'stocks'], stack: [['boat', 'boat']] },
    C: { hand: ['gold', 'home'], stack: [['auto', 'auto'], ['home', 'home']] },
    A: { hand: FILLER },
  });
  g.challenge('B', 'C', idOf(g, 'B', 'home'));
  const { battle } = g.view(null);
  assert.equal(battle.challengerId, 'B');
  assert.equal(battle.defenderId, 'C');
  assert.equal(battle.toMoveId, 'C');
  assert.equal(battle.asset, 'home');
  assert.equal(battle.set.value, 40000);
  assert.deepEqual(battle.plays.map((x) => [x.playerId, x.card.asset]), [['B', 'home']]);
  assert.equal(g.view(null).players.find((p) => p.id === 'C').stackValue, 70000);
});

test('the log keeps the last 50 entries', () => {
  const g = new Game();
  for (let i = 0; i < 60; i++) g.addLog(`entry ${i}`);
  assert.equal(g.log.length, 50);
  assert.equal(g.log[0].text, 'entry 10');
});

test('autoplay discards the lowest card for an offline player, or folds a battle', () => {
  const g = setup();
  table(g, {
    B: { hand: ['home', 'piggy', 'gold', 'cash', 'home'], stack: [['boat', 'boat']] },
    C: { hand: ['silver', 'home', 'cash'], stack: [['auto', 'auto'], ['home', 'home']] },
    A: { hand: FILLER },
  });
  for (const p of g.players) p.connected = true;
  assert.throws(() => cya.actions.autoplay(g), GameError);
  g.player('B').connected = false;
  cya.actions.autoplay(g);
  assert.equal(g.discard.at(-1).asset, 'piggy');
  assert.equal(g.turnId, 'C');
  g.discardCard('C', idOf(g, 'C', 'cash'));
  g.discardCard('A', idOf(g, 'A', 'piggy'));
  g.player('B').connected = true;
  g.challenge('B', 'C', idOf(g, 'B', 'home'));
  g.player('C').connected = false;
  cya.actions.autoplay(g); // C folds
  assert.equal(g.battle, null);
  assert.equal(g.player('C').stack.length, 1);
});

test('descriptor is registered after Flip 7 with every action', () => {
  assert.deepEqual([...games.keys()].slice(0, 2), ['flip7', 'cover-your-assets']);
  assert.equal(cya.minPlayers, 2);
  assert.equal(cya.maxPlayers, 6);
  for (const a of ['setMode', 'pair', 'pairDiscard', 'discard', 'challenge', 'respond', 'fold', 'nextRound', 'autoplay']) {
    assert.equal(typeof cya.actions[a], 'function', a);
  }
  const g = cya.create();
  cya.actions.setMode(g, { mode: 'quick' });
  assert.equal(g.mode, 'quick');
});

// ---- managing players mid-game -------------------------------------------

// Play the round out with whoever is left: always discard the lowest card, or
// give up a battle. Throws if the game ever stalls.
function finishRound(g) {
  for (let i = 0; i < 500 && g.phase === 'playing'; i++) {
    const actor = g.battle?.toMoveId ?? g.turnId;
    assert.ok(g.player(actor), 'the actor is seated');
    if (g.battle) g.fold(actor);
    else {
      const hand = g.player(actor).hand;
      assert.ok(hand.length, 'the actor holds cards');
      g.discardCard(actor, hand.reduce((l, c) => (c.value < l.value ? c : l)).id);
    }
  }
  assert.notEqual(g.phase, 'playing');
}

test('joining mid-round goes to waiting, shows in the view and counts toward capacity', () => {
  const g = setup({ names: ['A', 'B', 'C', 'D', 'E'] });
  g.addPlayer('W', 'Wendy');
  assert.equal(g.isWaiting('W'), true);
  assert.equal(g.player('W'), undefined);
  assert.deepEqual(g.waiting, [{ id: 'W', name: 'Wendy' }]);
  assert.deepEqual(g.view(null).waiting, [{ id: 'W', name: 'Wendy' }]);
  assert.deepEqual(g.view('A').waiting, [{ id: 'W', name: 'Wendy' }]);
  assert.equal(g.log.at(-1).text, 'Wendy will join next round.');
  assert.throws(() => g.addPlayer('X', 'Xed'), GameError); // 5 + 1 = 6
  assert.throws(() => g.addPlayer('Y', ' '), GameError);
});

test('the next round seats waiting players at last place with their hands dealt', () => {
  const g = setup({ names: ['A', 'B', 'C'] });
  g.player('A').score = 30000;
  g.player('B').score = 10000;
  g.player('C').score = 20000;
  g.endRound(); // adds this round's (empty) stacks: scores unchanged
  g.addPlayer('W', 'Wendy');
  g.addPlayer('V', 'Val');
  g.nextRound();
  assert.deepEqual(g.players.map((p) => p.id), ['A', 'B', 'C', 'W', 'V']);
  assert.equal(g.player('W').score, 10000);
  assert.equal(g.player('V').score, 10000);
  assert.equal(g.player('W').hand.length, 5);
  assert.deepEqual(g.waiting, []);
  assert.ok(g.log.some((l) => l.text === 'Wendy joins with $10,000.'));
});

test('a waiting player lets a one-player table start the next round, and nextRound counts them', () => {
  const g = setup({ names: ['A', 'B'] });
  g.removePlayer('B'); // abandons
  assert.equal(g.phase, 'roundOver');
  assert.throws(() => g.nextRound(), GameError);
  g.addPlayer('W', 'Wendy');
  g.nextRound();
  assert.equal(g.players.length, 2);
  assert.equal(g.phase, 'playing');
});

test('reset seats waiting players at zero', () => {
  const g = setup({ names: ['A', 'B'] });
  g.player('A').score = 5000;
  g.addPlayer('W', 'Wendy');
  g.reset();
  assert.equal(g.phase, 'lobby');
  assert.deepEqual(g.players.map((p) => [p.id, p.score]), [['A', 0], ['B', 0], ['W', 0]]);
  assert.deepEqual(g.waiting, []);
});

test('removing a waiting player changes nothing else', () => {
  const g = setup({ names: ['A', 'B'] });
  const turn = g.turnId;
  g.addPlayer('W', 'Wendy');
  g.removePlayer('W');
  assert.deepEqual(g.waiting, []);
  assert.equal(g.isWaiting('W'), false);
  assert.equal(g.players.length, 2);
  assert.equal(g.turnId, turn);
  assert.equal(g.phase, 'playing');
});

test('removing the player whose turn it is passes the turn on, and the round finishes', () => {
  const g = setup();
  assert.equal(g.turnId, 'B');
  g.removePlayer('B');
  assert.equal(g.turnId, 'C');
  assert.equal(g.log.at(-1).text, 'B was removed from the game.');
  finishRound(g);
  assert.ok(g.players.every((p) => p.id !== 'B'));
});

test('removing a player who is not on turn leaves the turn alone', () => {
  const g = setup();
  g.removePlayer('C');
  assert.equal(g.turnId, 'B');
  g.discardCard('B', g.player('B').hand[0].id);
  assert.equal(g.turnId, 'A');
  finishRound(g);
});

test('removing the dealer: next round is dealt by the player after them', () => {
  const g = setup(); // A deals
  g.removePlayer('A');
  finishRound(g);
  assert.equal(g.phase, 'roundOver');
  g.nextRound();
  assert.equal(g.view(null).dealerId, 'B');
});

test('removing a non-dealer before the dealer keeps the dealer the same player', () => {
  const g = setup({ names: ['A', 'B', 'C'] });
  g.dealerIndex = 2; // C deals
  g.removePlayer('A');
  assert.equal(g.view(null).dealerId, 'C');
});

test('removing the attacker cancels the battle and passes the turn from their seat', () => {
  const g = setup();
  table(g, {
    B: { hand: ['home', 'home', 'cash'], stack: [['boat', 'boat']] },
    C: { hand: ['silver', 'home', 'cash', 'home'], stack: [['auto', 'auto'], ['home', 'home']] },
    A: { hand: FILLER },
  }, [...FILLER, ...FILLER]);
  g.discard = [];
  g.challenge('B', 'C', idOf(g, 'B', 'home'));
  g.respond('C', idOf(g, 'C', 'home'));
  g.removePlayer('B');
  assert.equal(g.battle, null);
  assert.equal(g.player('C').stack.length, 2); // C keeps the set, battle cards are not added
  assert.equal(top(g, 'C').cards.length, 2);
  assert.equal(g.discard.length, 1); // C's played card went to the discard
  assert.equal(g.discard[0].asset, 'home');
  assert.equal(g.player('C').hand.length, 5); // defender who played draws back up
  assert.equal(g.turnId, 'C'); // next seat after B
  finishRound(g);
});

test('removing the defender cancels the battle; the attacker keeps their cards out of the set', () => {
  const g = setup();
  table(g, {
    B: { hand: ['home', 'cash', 'bank'], stack: [['boat', 'boat']] },
    C: { hand: ['silver', 'cash'], stack: [['auto', 'auto'], ['home', 'home']] },
    A: { hand: FILLER },
  }, [...FILLER, ...FILLER, ...FILLER]);
  g.discard = [];
  g.challenge('B', 'C', idOf(g, 'B', 'home'));
  g.removePlayer('C');
  assert.equal(g.battle, null);
  assert.equal(g.discard.length, 1);
  assert.equal(g.player('B').stack.length, 1);
  assert.equal(g.player('B').hand.length, 5); // attacker's turn ends and they draw
  assert.equal(g.turnId, 'A');
  finishRound(g);
});

test('removing a bystander during a battle leaves it running', () => {
  const g = setup();
  table(g, {
    B: { hand: ['home', 'cash'], stack: [['boat', 'boat']] },
    C: { hand: ['home', 'cash'], stack: [['auto', 'auto'], ['home', 'home']] },
    A: { hand: FILLER },
  }, FILLER);
  g.challenge('B', 'C', idOf(g, 'B', 'home'));
  g.removePlayer('A');
  assert.equal(g.battle.toMoveId, 'C');
  g.fold('C');
  assert.equal(g.battle, null);
  finishRound(g);
});

test('removing down to one player abandons the round without scoring', () => {
  const g = setup({ names: ['A', 'B'] });
  table(g, { B: { hand: ['cash'], stack: [['gold', 'home']] }, A: { hand: ['cash'], stack: [['home', 'home']] } });
  g.removePlayer('A');
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.player('B').score, 0);
  assert.equal(g.player('B').roundScore, 0);
  assert.ok(g.log.some((l) => l.text === 'Round 1 was abandoned: not enough players.'));
  assert.equal(g.turnId, null);
});

test('abandoning a quick game ends it', () => {
  const g = setup({ names: ['A', 'B'], mode: 'quick' });
  g.removePlayer('B');
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winners, ['A']);
});

test('removing a player mid-round never leaks their hand or the deck in views or the log', () => {
  const g = setup();
  const secret = g.player('B').hand.map((c) => c.id);
  g.removePlayer('B');
  const text = JSON.stringify([g.view('A'), g.view('C'), g.view(null)]);
  for (const id of secret) assert.ok(!text.includes(`"id":${id},"kind"`), `card ${id}`);
  assert.ok(g.log.every((l) => !/\bplays|discard/.test(l.text)));
});

test('a removal in the final empty-hands state ends the round with the right scores', () => {
  const g = setup();
  table(g, {
    B: { hand: ['cash'], stack: [['gold', 'home']] },
    C: { hand: [], stack: [['home', 'home']] },
    A: { hand: [], stack: [['home', 'home']] },
  });
  g.removePlayer('B'); // turn player leaves, nobody else holds cards and the deck is empty
  assert.notEqual(g.phase, 'playing');
  assert.equal(g.player('A').score, 40000);
});

test('removing the dealer mid-round shows nobody as dealer until the next deal', () => {
  const g = setup({ names: ['A', 'B', 'C'] });
  g.dealerIndex = 1; // B deals
  g.removePlayer('B');
  assert.equal(g.view(null).dealerId, null, 'the badge does not jump to A');
  finishRound(g);
  g.nextRound();
  assert.equal(g.view(null).dealerId, 'C');
});
