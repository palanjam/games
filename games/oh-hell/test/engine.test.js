import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameError, maxHand, handSizes, buildDeck, cardName } from '../engine.js';
import ohHell, { autoCard } from '../index.js';

// Cards by name: '7♥', '10♠', 'A♦'.
const SYMBOLS = { '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs', '♠': 'spades' };
const RANKS = { J: 11, Q: 12, K: 13, A: 14 };
let nextId = 1000;
function card(name) {
  const r = name.slice(0, -1);
  return { id: nextId++, rank: RANKS[r] ?? Number(r), suit: SYMBOLS[name.at(-1)] };
}
const cards = (list) => (list ? list.trim().split(/\s+/).map(card) : []);

// rng () => 0 makes the first player the first dealer, so with A, B, C the
// deal goes B, C, A: B bids and leads first, A (the dealer) bids last.
function setup({ players = ['A', 'B', 'C'], deck, pattern } = {}) {
  const g = new Game({ rng: () => 0, deck });
  for (const n of players) g.addPlayer(n, n);
  if (pattern) g.setPattern(pattern);
  g.start();
  return g;
}

// Replace the dealt hands (and optionally trump) with known cards.
function arrange(g, hands, trump) {
  for (const [id, list] of Object.entries(hands)) g.player(id).hand = cards(list);
  if (trump) g.trumpCard = card(trump);
}
const idOf = (g, pid, name) => {
  const c = card(name);
  const f = g.player(pid).hand.find((h) => h.suit === c.suit && h.rank === c.rank);
  assert.ok(f, `${pid} holds no ${name}`);
  return f.id;
};
const play = (g, pid, name) => g.play(pid, idOf(g, pid, name));
const bidAll = (g, bids) => {
  for (const [id, b] of Object.entries(bids)) g.bid(id, b);
};

function cardsIn(value, out = []) {
  if (Array.isArray(value)) for (const v of value) cardsIn(v, out);
  else if (value && typeof value === 'object') {
    if ('suit' in value && 'rank' in value && 'id' in value) out.push(value);
    else for (const v of Object.values(value)) cardsIn(v, out);
  }
  return out;
}

// ---- patterns ----------------------------------------------------------

test('maxHand: 10 up to 5 players, then as many as leave a trump card', () => {
  assert.deepEqual([3, 4, 5, 6, 7].map(maxHand), [10, 10, 10, 8, 7]);
});

test('hand sizes for every pattern', () => {
  assert.deepEqual(handSizes(3, 'down-up'), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(handSizes(5).length, 19);
  assert.deepEqual(handSizes(6, 'down'), [8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(handSizes(7, 'up'), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(handSizes(7, 'down-up'), [7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(buildDeck().length, 52);
});

test('setPattern: lobby only, known patterns only, default down-up', () => {
  const g = new Game();
  assert.equal(g.view(null).pattern, 'down-up');
  assert.deepEqual(g.view(null).patterns, ['down-up', 'down', 'up']);
  g.setPattern('up');
  assert.equal(g.view(null).pattern, 'up');
  assert.throws(() => g.setPattern('sideways'), GameError);
  for (const n of 'ABC') g.addPlayer(n, n);
  g.start();
  assert.throws(() => g.setPattern('down'), GameError);
  assert.equal(g.handSize, 1);
  assert.equal(g.view(null).rounds, 10);
});

test('player limits: 3 to 7', () => {
  const g = new Game();
  g.addPlayer('A', 'A');
  g.addPlayer('B', 'B');
  assert.throws(() => g.start(), GameError);
  for (const n of 'CDEFG') g.addPlayer(n, n);
  assert.throws(() => g.addPlayer('H', 'H'), GameError);
  g.start();
  assert.equal(g.handSize, 7);
});

// ---- deal --------------------------------------------------------------

test('deal: one card at a time left of the dealer, next card is trump', () => {
  const deck = buildDeck();
  const g = setup({ deck, pattern: 'up' }); // 1 card each
  assert.equal(g.handSize, 1);
  // Dealer A; B, C, A get cards 0, 1, 2; card 3 is trump.
  assert.equal(g.player('B').hand[0].id, deck[0].id);
  assert.equal(g.player('C').hand[0].id, deck[1].id);
  assert.equal(g.player('A').hand[0].id, deck[2].id);
  assert.equal(g.trumpCard.id, deck[3].id);
  assert.equal(g.trumpSuit, deck[3].suit);
  assert.equal(g.deck.length, 48);
  assert.equal(g.turnId, 'B');
  assert.equal(g.stage, 'bid');
});

test('deal: with a full-size hand every card is distinct and one is left for trump', () => {
  const g = setup({ players: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] });
  assert.equal(g.handSize, 7);
  const all = [...g.players.flatMap((p) => p.hand), g.trumpCard, ...g.deck];
  assert.equal(new Set(all.map((c) => c.id)).size, 52);
  assert.ok(g.players.every((p) => p.hand.length === 7));
});

test('dealer rotates left each round; first dealer comes from the rng', () => {
  const g = setup({ pattern: 'up' });
  assert.equal(g.dealer.id, 'A');
  bidAll(g, { B: 0, C: 0, A: 0 });
  // finish round 1 (1 card each): play it out via autoplay-like lowest cards
  while (g.phase === 'playing') g.play(g.turnId, g.playableCards(g.player(g.turnId))[0].id);
  assert.equal(g.phase, 'roundOver');
  g.nextRound();
  assert.equal(g.dealer.id, 'B');
  assert.equal(g.turnId, 'C');
  assert.equal(g.handSize, 2);
  assert.equal(g.round, 2);
  assert.throws(() => g.nextRound(), GameError);
  const g2 = new Game({ rng: () => 0.99 });
  for (const n of 'ABC') g2.addPlayer(n, n);
  g2.start();
  assert.equal(g2.dealer.id, 'C');
});

// ---- bidding -----------------------------------------------------------

test('bidding: starts left of the dealer, in order, dealer last, public', () => {
  const g = setup({ pattern: 'down' }); // 10 cards
  assert.equal(g.turnId, 'B');
  assert.throws(() => g.bid('C', 1), /turn/);
  g.bid('B', 3);
  assert.equal(g.turnId, 'C');
  assert.equal(g.view('A').players.find((p) => p.id === 'B').bid, 3);
  assert.equal(g.view(null).bidTotal, 3);
  assert.equal(g.view(null).players.find((p) => p.id === 'A').bid, null);
  g.bid('C', 2);
  assert.equal(g.turnId, 'A');
  g.bid('A', 0);
  assert.equal(g.stage, 'play');
  assert.equal(g.turnId, 'B');
  assert.throws(() => g.bid('B', 1), GameError);
});

test('bidding: whole numbers from 0 to the hand size', () => {
  const g = setup({ pattern: 'down' });
  for (const bad of [-1, 11, 1.5, '2', null, NaN]) assert.throws(() => g.bid('B', bad), GameError);
  g.bid('B', 10);
  g.bid('C', 0);
});

test('the hook: the dealer may not make the bids equal the hand size', () => {
  const g = setup({ pattern: 'down' }); // 10 tricks
  g.bid('B', 4);
  assert.equal(g.view('B').forbiddenBid, null);
  g.bid('C', 3);
  assert.equal(g.view('A').forbiddenBid, 3);
  assert.throws(() => g.bid('A', 3), /dealer cannot bid 3/);
  g.bid('A', 4);
  assert.equal(g.stage, 'play');
  assert.equal(g.view(null).forbiddenBid, null);
});

test('the hook: no forbidden number when the others already bid over the hand size', () => {
  const g = setup({ pattern: 'down' });
  g.bid('B', 9);
  g.bid('C', 8);
  assert.equal(g.forbiddenBid, null);
  g.bid('A', 0);
  assert.equal(g.stage, 'play');
});

test('the hook: forbidden 0 when others total the hand size', () => {
  const g = setup({ pattern: 'down' });
  g.bid('B', 5);
  g.bid('C', 5);
  assert.equal(g.forbiddenBid, 0);
  assert.throws(() => g.bid('A', 0), GameError);
  g.bid('A', 1);
});

test('bidding rejects play and play rejects bidding', () => {
  const g = setup({ pattern: 'up' });
  assert.throws(() => g.play('B', g.player('B').hand[0].id), GameError);
  bidAll(g, { B: 0, C: 0, A: 0 });
  assert.throws(() => g.bid('B', 0), GameError);
});

// ---- play --------------------------------------------------------------

function round2(hands, trump, bids = { B: 0, C: 0, A: 0 }) {
  const g = setup({ pattern: 'down' });
  g.sizes = [2];
  arrange(g, hands, trump);
  bidAll(g, bids);
  return g;
}

test('must follow suit when able', () => {
  const g = round2({ B: '9♣ 3♥', C: '5♣ 6♠', A: '2♣ 4♦' }, '8♦');
  assert.equal(g.view('B').you.playable.length, 2);
  assert.deepEqual(g.view('C').you.playable, []);
  play(g, 'B', '9♣');
  assert.equal(g.ledSuit, 'clubs');
  assert.deepEqual(g.view('C').you.playable, [idOf(g, 'C', '5♣')]);
  assert.throws(() => play(g, 'C', '6♠'), /follow suit/);
  play(g, 'C', '5♣');
  assert.throws(() => play(g, 'A', '4♦'), GameError);
  play(g, 'A', '2♣');
});

test('a void player may play anything, and cannot play a card they do not hold', () => {
  const g = round2({ B: '9♣ 3♥', C: '5♦ 6♠', A: '2♣ 4♦' }, '8♦');
  play(g, 'B', '9♣');
  assert.equal(g.view('C').you.playable.length, 2);
  assert.throws(() => g.play('C', 999999), /hold/);
  assert.throws(() => g.play('A', g.player('A').hand[0].id), /turn/);
  play(g, 'C', '6♠');
});

test('highest card of the led suit wins when no trump is played', () => {
  const g = round2({ B: '9♣ 3♥', C: 'K♣ 6♠', A: 'A♠ 4♦' }, '8♥');
  play(g, 'B', '9♣');
  play(g, 'C', 'K♣');
  play(g, 'A', 'A♠'); // off-suit ace never wins
  assert.equal(g.lastTrick.winnerId, 'C');
  assert.equal(g.player('C').tricks, 1);
  assert.equal(g.turnId, 'C');
});

test('trump beats the led suit; highest trump wins', () => {
  const g = round2({ B: '9♣ 3♥', C: '2♦ 6♠', A: '5♦ 4♠' }, '8♦');
  play(g, 'B', '9♣');
  play(g, 'C', '2♦');
  play(g, 'A', '5♦');
  assert.equal(g.lastTrick.winnerId, 'A');
  assert.equal(g.turnId, 'A');
});

test('the trick winner leads next, and the led suit resets', () => {
  const g = round2({ B: '9♣ 3♥', C: 'K♣ 6♠', A: '2♣ 4♦' }, '8♦');
  play(g, 'B', '9♣');
  play(g, 'C', 'K♣');
  play(g, 'A', '2♣');
  assert.equal(g.turnId, 'C');
  assert.equal(g.ledSuit, null);
  assert.deepEqual(g.view('C').trick, []);
  assert.equal(g.view('C').you.playable.length, 1);
  play(g, 'C', '6♠');
  assert.equal(g.ledSuit, 'spades');
});

test('lastTrick stays visible with plays and winner, including after the round ends', () => {
  const g = round2({ B: '9♣ 3♥', C: 'K♣ 6♠', A: '2♣ 4♦' }, '8♦');
  play(g, 'B', '9♣');
  play(g, 'C', 'K♣');
  play(g, 'A', '2♣');
  const lt = g.view(null).lastTrick;
  assert.deepEqual(lt.plays.map((x) => x.playerId), ['B', 'C', 'A']);
  assert.equal(lt.winnerId, 'C');
  play(g, 'C', '6♠');
  play(g, 'A', '4♦'); // led spades, A is void: 4♦ is trump and wins
  play(g, 'B', '3♥');
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.view(null).lastTrick.plays.map((x) => x.playerId), ['C', 'A', 'B']);
  assert.equal(g.view(null).lastTrick.winnerId, 'A');
  assert.equal(g.view(null).turnId, null);
  assert.equal(g.view(null).stage, null);
});

// ---- scoring -----------------------------------------------------------

test('scoring: made bids (including 0), overs and unders', () => {
  const g = round2({ B: 'A♣ 3♥', C: '5♣ 6♠', A: '2♣ 4♠' }, '8♦', { B: 1, C: 0, A: 0 });
  // Trick 1: B A♣ wins. Trick 2: B leads 3♥; C void -> 6♠; A void -> 4♠; none trump, led hearts: B wins.
  play(g, 'B', 'A♣');
  play(g, 'C', '5♣');
  play(g, 'A', '2♣');
  play(g, 'B', '3♥');
  play(g, 'C', '6♠');
  play(g, 'A', '4♠');
  assert.equal(g.phase, 'gameOver');
  const score = (id) => g.player(id).roundScores[0];
  assert.deepEqual(score('B'), { bid: 1, tricks: 2, points: 2 }); // over: no bonus
  assert.deepEqual(score('C'), { bid: 0, tricks: 0, points: 10 }); // made 0
  assert.deepEqual(score('A'), { bid: 0, tricks: 0, points: 10 });
  assert.equal(g.player('B').score, 2);
});

test('scoring: made non-zero bid and a missed zero bid', () => {
  const g = round2({ B: 'A♣ 3♥', C: '5♣ 6♠', A: '2♣ 4♠' }, '8♦', { B: 2, C: 0, A: 1 });
  // sum 3 != 2, dealer fine. B wins both tricks; A bid 1 (miss, 0 tricks); C bid 0 (made).
  play(g, 'B', 'A♣');
  play(g, 'C', '5♣');
  play(g, 'A', '2♣');
  play(g, 'B', '3♥');
  play(g, 'C', '6♠');
  play(g, 'A', '4♠');
  assert.deepEqual(g.player('B').roundScores[0], { bid: 2, tricks: 2, points: 12 });
  assert.deepEqual(g.player('A').roundScores[0], { bid: 1, tricks: 0, points: 0 });
  assert.deepEqual(g.player('C').roundScores[0], { bid: 0, tricks: 0, points: 10 });
});

test('a missed bid under scores its tricks', () => {
  const g = round2({ B: 'A♣ 3♥', C: '5♣ 6♠', A: '2♣ 4♠' }, '8♦', { B: 0, C: 0, A: 1 });
  play(g, 'B', 'A♣');
  play(g, 'C', '5♣');
  play(g, 'A', '2♣');
  play(g, 'B', '3♥');
  play(g, 'C', '6♠');
  play(g, 'A', '4♠');
  assert.deepEqual(g.player('B').roundScores[0], { bid: 0, tricks: 2, points: 2 });
});

// ---- game end ----------------------------------------------------------

function finishRound(g) {
  while (g.phase === 'playing') {
    const p = g.player(g.turnId);
    if (g.stage === 'bid') g.bid(p.id, g.forbiddenBid === 0 ? 1 : 0);
    else g.play(p.id, autoCard(g, p).id);
  }
}

test('a full game runs through every round and ends in gameOver', () => {
  const g = setup({ pattern: 'up' });
  for (let r = 1; r <= 10; r++) {
    assert.equal(g.round, r);
    assert.equal(g.handSize, r);
    finishRound(g);
    assert.equal(g.phase, r < 10 ? 'roundOver' : 'gameOver');
    assert.ok(g.players.every((p) => p.roundScores.length === r));
    if (r < 10) g.nextRound();
  }
  assert.ok(g.winners.length >= 1);
  const best = Math.max(...g.players.map((p) => p.score));
  assert.ok(g.winners.every((id) => g.player(id).score === best));
  assert.throws(() => g.nextRound(), GameError);
  assert.match(g.log.at(-1).text, /win/);
});

test('ties share the win', () => {
  const h = round2({ B: 'A♣ 3♥', C: '5♣ 6♠', A: '2♣ 4♠' }, '8♦', { B: 0, C: 0, A: 0 });
  // B takes both: 2 points; C and A tie on 10.
  play(h, 'B', 'A♣');
  play(h, 'C', '5♣');
  play(h, 'A', '2♣');
  play(h, 'B', '3♥');
  play(h, 'C', '6♠');
  play(h, 'A', '4♠');
  assert.deepEqual(h.winners.sort(), ['A', 'C']);
  assert.match(h.log.at(-1).text, /A & C win with 10/);
});

test('removePlayer: reset returns to the lobby with zeroed scores', () => {
  const g = setup({ pattern: 'up' });
  finishRound(g);
  g.reset();
  assert.equal(g.phase, 'lobby');
  assert.ok(g.players.every((p) => p.score === 0 && p.hand.length === 0));
  g.removePlayer('C');
  assert.equal(g.players.length, 2);
});

// ---- autoplay ----------------------------------------------------------

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

test('autoplay is always legal across whole games with every pattern and player count', () => {
  for (const pattern of ['down-up', 'down', 'up']) {
    for (const n of [3, 4, 5, 6, 7]) {
      const g = new Game({ rng: seeded(n * 7 + pattern.length) });
      for (let i = 0; i < n; i++) {
        g.addPlayer(`p${i}`, `P${i}`);
        g.player(`p${i}`).connected = false;
      }
      g.setPattern(pattern);
      g.start();
      const act = ohHell.actions.autoplay;
      let steps = 0;
      while (g.phase !== 'gameOver') {
        if (g.phase === 'roundOver') g.nextRound();
        else act(g); // throws if illegal
        assert.ok(++steps < 5000);
      }
      assert.equal(g.round, g.sizes.length);
      assert.equal(g.rounds, handSizes(n, pattern).length);
    }
  }
});

test('autoplay: smallest legal bid (1 when 0 is forbidden) and lowest legal card; only for a disconnected turn player', () => {
  const g = setup({ pattern: 'down' });
  const act = ohHell.actions.autoplay;
  assert.throws(() => act(g), /connected/);
  g.player('B').connected = false;
  act(g);
  assert.equal(g.player('B').bid, 0);
  g.bid('C', 10);
  g.player('A').connected = false;
  assert.equal(g.forbiddenBid, 0);
  act(g);
  assert.equal(g.player('A').bid, 1);
  assert.equal(g.stage, 'play');
  // lowest legal card for B
  arrange(g, { B: '9♣ 3♥ 2♠' });
  g.player('B').connected = false;
  act(g);
  assert.equal(g.lastTrick, null);
  assert.equal(cardName(g.trick[0].card), '2♠');
  // C must follow spades if able
  arrange(g, { C: '7♠ 5♠ 2♣' });
  g.player('C').connected = true;
  const c = g.player('C');
  assert.equal(autoCard(g, c).rank, 5);
});

// ---- views -------------------------------------------------------------

test('views hide other hands and the undealt deck; the trump card is public', () => {
  const g = setup({ pattern: 'down' });
  const mine = new Set(g.player('B').hand.map((c) => c.id));
  const view = g.view('B');
  assert.equal(view.you.hand.length, 10);
  assert.ok(view.you.hand.every((c) => mine.has(c.id)));
  const seen = new Set(cardsIn(view).map((c) => c.id));
  for (const id of seen) assert.ok(mine.has(id) || id === g.trumpCard.id, `leaked card ${id}`);
  assert.deepEqual(view.trumpCard, g.trumpCard);
  assert.ok(view.players.every((p) => p.cardCount === 10));
  assert.equal(JSON.stringify(view).includes('"deck"'), false);

  const board = g.view(null);
  assert.equal(board.you, null);
  assert.deepEqual([...new Set(cardsIn(board).map((c) => c.id))], [g.trumpCard.id]);
  assert.deepEqual(g.view('A').you.playable, []);
});

test('views: hand sorted by suit then rank; playable only on your play turn; log has no hidden cards', () => {
  const g = setup({ pattern: 'down' });
  g.sizes = [3];
  arrange(g, { B: 'K♠ 3♥ 9♥', C: '2♣ 3♣ 4♣', A: '5♣ 6♣ 7♣' }, '8♦');
  assert.deepEqual(g.view('B').you.hand.map(cardName), ['3♥', '9♥', 'K♠']);
  assert.deepEqual(g.view('B').you.playable, []); // bidding
  bidAll(g, { B: 0, C: 0, A: 0 });
  assert.equal(g.view('B').you.playable.length, 3);
  assert.deepEqual(g.view('C').you.playable, []);
  const text = g.log.map((l) => l.text).join('\n');
  assert.equal(text.includes('K♠'), false);
  assert.match(text, /Trump is /);
});

test('descriptor: registered shape and actions drive a game', () => {
  assert.equal(ohHell.id, 'oh-hell');
  assert.equal(ohHell.minPlayers, 3);
  assert.equal(ohHell.maxPlayers, 7);
  assert.deepEqual(Object.keys(ohHell.actions).sort(), ['autoplay', 'bid', 'nextRound', 'play', 'setPattern']);
  const g = ohHell.create();
  for (const n of 'ABC') g.addPlayer(n, n);
  ohHell.actions.setPattern(g, { pattern: 'up' });
  g.start();
  const me = (id) => () => id;
  // The first dealer is random, so bid and lead in whatever order the game says.
  for (let i = 0; i < 3; i++) ohHell.actions.bid(g, { bid: g.forbiddenBid === 0 ? 1 : 0 }, me(g.turnId));
  const leader = g.turnId;
  const cardId = g.player(leader).hand[0].id;
  ohHell.actions.play(g, { cardId }, me(leader));
  assert.equal(g.trick.length, 1);
});

// ---- manage players: late joiners and boots -----------------------------

// Play (or bid) for whoever's turn it is until the round ends.
function finishWithAuto(g) {
  let steps = 0;
  while (g.phase === 'playing') {
    const p = g.player(g.turnId);
    if (g.stage === 'bid') g.bid(p.id, g.forbiddenBid === 0 ? 1 : 0);
    else g.play(p.id, autoCard(g, p).id);
    assert.ok(++steps < 500, 'stuck');
  }
}

const noHiddenLeak = (g, viewer, hand) => {
  const ids = new Set(hand.map((c) => c.id));
  assert.ok(!cardsIn(g.view(viewer)).some((c) => ids.has(c.id)), 'removed hand leaked into a view');
  assert.ok(!g.log.some((l) => hand.some((c) => l.text.includes(cardName(c)) && !/plays|Trump/.test(l.text))), 'leaked in log');
};

test('late join: goes to waiting mid-round, shows in the view, counts toward capacity', () => {
  const g = setup({ players: ['A', 'B', 'C', 'D', 'E', 'F'], pattern: 'up' });
  g.addPlayer('G', 'Gus');
  assert.equal(g.players.length, 6);
  assert.deepEqual(g.view(null).waiting, [{ id: 'G', name: 'Gus' }]);
  assert.ok(g.isWaiting('G'));
  assert.ok(!g.isWaiting('A'));
  assert.equal(g.log.at(-1).text, 'Gus will join next round.');
  assert.throws(() => g.addPlayer('H', 'Hal'), /full/);
  assert.throws(() => g.addPlayer('I', '  '), GameError);
  assert.deepEqual(g.view('G').waiting.map((w) => w.id), ['G']);
});

test('late join: seated at the next round level with last place, null-padded roundScores', () => {
  const g = setup({ pattern: 'up' });
  finishWithAuto(g);
  assert.equal(g.phase, 'roundOver');
  g.player('A').score = 15;
  g.player('B').score = 12;
  g.player('C').score = 20;
  g.addPlayer('D', 'Dee');
  assert.equal(g.phase, 'roundOver');
  g.nextRound();
  assert.deepEqual(g.players.map((p) => p.id), ['A', 'B', 'C', 'D']);
  const d = g.player('D');
  assert.equal(d.score, 12);
  assert.deepEqual(d.roundScores, [null]);
  assert.equal(d.hand.length, 2);
  assert.deepEqual(g.waiting, []);
  assert.ok(g.log.some((l) => l.text === 'Dee joins with 12 points.'));
  assert.equal(g.view(null).players[3].roundScores[0], null);
  finishWithAuto(g);
  assert.equal(g.player('D').roundScores.length, 2);
});

test('late join: nextRound counts waiting players, and the hand size is capped for a bigger table', () => {
  const g = setup({ players: ['A', 'B', 'C'], pattern: 'down' });
  assert.equal(g.handSize, 10);
  finishWithAuto(g);
  for (const [id, n] of [['D', 'D'], ['E', 'E'], ['F', 'F'], ['G', 'G']]) g.addPlayer(id, n);
  g.nextRound();
  assert.equal(g.players.length, 7);
  assert.equal(g.handSize, 7); // schedule said 9; floor(51 / 7) caps it
  assert.ok(g.players.every((p) => p.hand.length === 7));
  assert.ok(g.trumpCard);
  finishWithAuto(g);
  assert.equal(g.phase, 'roundOver');
});

test('late join: a table of two plus a waiting player can still start the next round', () => {
  const g = setup({ pattern: 'up' });
  g.removePlayer('C'); // 2 left: the round carries on
  assert.equal(g.phase, 'playing');
  finishWithAuto(g);
  assert.equal(g.phase, 'roundOver');
  assert.throws(() => g.nextRound(), /at least 3/);
  g.addPlayer('D', 'Dee');
  g.nextRound();
  assert.equal(g.players.length, 3);
});

test('late join: reset seats waiting players at zero', () => {
  const g = setup({ pattern: 'up' });
  g.addPlayer('D', 'Dee');
  g.reset();
  assert.equal(g.phase, 'lobby');
  assert.deepEqual(g.waiting, []);
  assert.deepEqual(g.players.map((p) => p.id), ['A', 'B', 'C', 'D']);
  assert.ok(g.players.every((p) => p.score === 0 && p.roundScores.length === 0));
});

test('remove a waiting player: nothing else changes', () => {
  const g = setup({ pattern: 'down' });
  g.addPlayer('D', 'Dee');
  const turn = g.turnId;
  g.removePlayer('D');
  assert.deepEqual(g.waiting, []);
  assert.equal(g.players.length, 3);
  assert.equal(g.turnId, turn);
  assert.equal(g.phase, 'playing');
});

test('remove during bidding: their turn passes on, their bid is dropped, hand stays hidden', () => {
  const g = setup({ pattern: 'down' }); // B bids first, then C, A (dealer) last
  const hand = [...g.player('B').hand];
  g.removePlayer('B');
  assert.deepEqual(g.players.map((p) => p.id), ['A', 'C']);
  assert.equal(g.turnId, 'C');
  assert.equal(g.dealer.id, 'A');
  noHiddenLeak(g, null, hand);
  noHiddenLeak(g, 'A', hand);
  g.bid('C', 3);
  g.bid('A', 4);
  assert.equal(g.stage, 'play');
  assert.equal(g.turnId, 'C');
  finishWithAuto(g);
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.player('C').roundScores.length, 1);
});

test('remove during bidding: not their turn; a bid they made leaves the total', () => {
  const g = setup({ players: ['A', 'B', 'C', 'D'], pattern: 'down' }); // dealer A; order B C D A
  g.bid('B', 4);
  g.bid('C', 3);
  assert.equal(g.bidTotal, 7);
  g.removePlayer('B');
  assert.equal(g.bidTotal, 3);
  assert.equal(g.turnId, 'D');
  g.bid('D', 1);
  assert.equal(g.forbiddenBid, 6);
  g.bid('A', 0);
  assert.equal(g.stage, 'play');
  finishWithAuto(g);
  assert.equal(g.phase, 'roundOver');
});

test('remove the dealer during bidding: the previous seat bids last and the hook applies to them', () => {
  const g = setup({ players: ['A', 'B', 'C', 'D'], pattern: 'down' }); // dealer A; order B C D A
  g.bid('B', 2);
  g.removePlayer('A');
  assert.deepEqual(g.players.map((p) => p.id), ['B', 'C', 'D']);
  assert.equal(g.dealer.id, 'D');
  assert.equal(g.turnId, 'C');
  g.bid('C', 2);
  assert.equal(g.turnId, 'D');
  assert.equal(g.forbiddenBid, 6);
  assert.throws(() => g.bid('D', 6), GameError);
  g.bid('D', 0);
  assert.equal(g.stage, 'play');
  assert.equal(g.turnId, 'B'); // leads: the seat after the dealer
  finishWithAuto(g);
  // next round's dealer is the player who would have dealt after A
  g.nextRound();
  assert.equal(g.dealer.id, 'B');
});

test('remove the dealer after the others bid and when it is the dealer\'s own bid: play starts, no hook re-check', () => {
  const g = setup({ pattern: 'down' }); // order B C A
  g.bid('B', 5);
  g.bid('C', 5);
  assert.equal(g.turnId, 'A');
  g.removePlayer('A');
  assert.equal(g.stage, 'play');
  assert.equal(g.dealer.id, 'C');
  assert.equal(g.turnId, 'B');
  finishWithAuto(g);
  assert.equal(g.phase, 'roundOver');
});

test('remove the previous seat while the dealer has already bid: no hook re-check', () => {
  const g = setup({ players: ['A', 'B', 'C', 'D'], pattern: 'down' }); // dealer A; order B C D A
  g.bid('B', 1);
  g.bid('C', 1);
  g.bid('D', 1);
  g.removePlayer('A'); // dealer gone, all remaining have bid
  assert.equal(g.stage, 'play');
  assert.equal(g.forbiddenBid, null);
  finishWithAuto(g);
  assert.equal(g.phase, 'roundOver');
});

function playing(g, bids = { B: 0, C: 0, A: 0 }) {
  bidAll(g, bids);
}

test('remove during play: on their turn, the lead passes to the next seat', () => {
  const g = round2({ B: 'A♣ 3♥', C: '5♣ 6♠', A: '2♣ 4♠' }, '8♦', { B: 1, C: 0, A: 0 });
  assert.equal(g.turnId, 'B');
  const hand = [...g.player('B').hand];
  g.removePlayer('B');
  assert.equal(g.turnId, 'C');
  assert.equal(g.stage, 'play');
  noHiddenLeak(g, null, hand);
  noHiddenLeak(g, 'C', hand);
  play(g, 'C', '5♣');
  play(g, 'A', '2♣');
  assert.equal(g.lastTrick.winnerId, 'C');
  play(g, 'C', '6♠');
  play(g, 'A', '4♠');
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.player('C').roundScores[0].tricks, 2);
});

test('remove during play: their card leaves the trick and the trick completes without them', () => {
  const g = round2({ B: 'A♣ 3♥', C: '5♣ 6♠', A: '2♣ 4♠' }, '8♦', { B: 1, C: 0, A: 0 });
  play(g, 'B', 'A♣');
  assert.equal(g.trick.length, 1);
  g.removePlayer('B');
  assert.equal(g.trick.length, 0);
  assert.equal(g.turnId, 'C'); // still C's turn
  play(g, 'C', '5♣');
  play(g, 'A', '2♣');
  assert.equal(g.lastTrick.plays.length, 2);
  assert.ok(!g.view(null).lastTrick.plays.some((x) => x.playerId === 'B'));
  assert.equal(g.lastTrick.winnerId, 'C');
  play(g, 'C', '6♠');
  play(g, 'A', '4♠');
  assert.equal(g.phase, 'gameOver');
});

test('remove during play: removing the last player due to play completes the trick', () => {
  const g = round2({ B: 'A♣ 3♥', C: '5♣ 6♠', A: '2♣ 4♠' }, '8♦', { B: 1, C: 0, A: 0 });
  play(g, 'B', 'A♣');
  play(g, 'C', '5♣');
  assert.equal(g.turnId, 'A');
  g.removePlayer('A');
  assert.equal(g.lastTrick.winnerId, 'B');
  assert.equal(g.player('B').tricks, 1);
  assert.equal(g.turnId, 'B');
  play(g, 'B', '3♥');
  play(g, 'C', '6♠');
  assert.equal(g.phase, 'gameOver');
});

test('remove during play: removing the dealer keeps the deal rotation', () => {
  const g = setup({ players: ['A', 'B', 'C', 'D'], pattern: 'down' }); // dealer A
  const hand = [...g.player('A').hand];
  playing(g, { B: 1, C: 1, D: 1, A: 0 });
  assert.equal(g.turnId, 'B');
  g.removePlayer('A');
  assert.equal(g.dealer.id, 'D');
  noHiddenLeak(g, 'B', hand);
  finishWithAuto(g);
  assert.equal(g.phase, 'roundOver');
  g.nextRound();
  assert.equal(g.dealer.id, 'B');
});

test('remove during play: a seat before the dealer shifts the dealer index', () => {
  const g = setup({ players: ['A', 'B', 'C', 'D'], pattern: 'down' });
  g.removePlayer('B');
  g.removePlayer('C');
  assert.equal(g.dealer.id, 'A');
  assert.equal(g.players.length, 2);
  const h = setup({ players: ['A', 'B', 'C', 'D'], pattern: 'down' });
  h.removePlayer('D');
  assert.equal(h.dealer.id, 'A');
  finishWithAuto(h);
  assert.equal(h.phase, 'roundOver');
});

test('remove down to one player abandons the round with null scores', () => {
  const g = setup({ pattern: 'down' });
  g.removePlayer('A');
  assert.equal(g.phase, 'playing');
  g.removePlayer('B');
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.turnId, null);
  assert.deepEqual(g.player('C').roundScores, [null]);
  assert.equal(g.player('C').score, 0);
  assert.equal(g.log.at(-1).text, 'Round 1 was abandoned: not enough players.');
  assert.deepEqual(g.view(null).players[0].roundScores, [null]);
});

test('abandoning the last round ends the game on current scores', () => {
  const g = setup({ pattern: 'up', players: ['A', 'B', 'C'] });
  finishWithAuto(g); // round 1 of 10
  g.round = g.sizes.length - 1;
  g.nextRound();
  assert.equal(g.round, g.sizes.length);
  g.player('C').score = 7;
  g.removePlayer('A');
  g.removePlayer('B');
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winners, ['C']);
});

test('remove after the round or game: as before', () => {
  const g = setup({ pattern: 'up', players: ['A', 'B', 'C', 'D'] });
  finishWithAuto(g);
  g.removePlayer('B');
  assert.equal(g.players.length, 3);
  assert.equal(g.phase, 'roundOver');
  g.nextRound();
  finishWithAuto(g);
  assert.equal(g.phase, 'roundOver');
});

test('random mid-round boots always let the round finish, with no leaked hands', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = seeded(seed);
    const g = new Game({ rng });
    for (const n of 'ABCDE') g.addPlayer(n, n);
    g.setPattern('down');
    g.start();
    const gone = [];
    let steps = 0;
    while (g.phase === 'playing') {
      if (g.players.length > 2 && rng() < 0.08) {
        const v = g.players[Math.floor(rng() * g.players.length)];
        gone.push([...v.hand]);
        g.removePlayer(v.id);
        continue;
      }
      if (g.phase !== 'playing') break;
      const p = g.player(g.turnId);
      if (g.stage === 'bid') g.bid(p.id, g.forbiddenBid === 0 ? 1 : 0);
      else g.play(p.id, autoCard(g, p).id);
      assert.ok(++steps < 500, `stuck (seed ${seed})`);
    }
    assert.equal(g.phase, 'roundOver', `seed ${seed}`);
    for (const hand of gone) {
      const ids = new Set(hand.map((c) => c.id));
      const played = new Set(g.log.map((l) => l.text));
      assert.ok(!cardsIn(g.view('A')).some((c) => ids.has(c.id) && !g.trick.some((t) => t.card.id === c.id) && !g.lastTrick?.plays.some((t) => t.card.id === c.id) && c.id !== g.trumpCard.id));
      assert.ok(played);
    }
  }
});
