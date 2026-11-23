import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameError, ROUNDS, buildDeck, cardName } from '../engine.js';
import { bestDiscard } from "../public/melds.js";
import { SUITS, cardPoints } from '../public/melds.js';
import fiveCrowns from '../index.js';
import { games } from '../../../server/games.js';

// Cards by name: '7♥', '10★', 'K♠', or 'JK' for a Joker.
const SYMBOLS = { '★': 'stars', '♥': 'hearts', '♣': 'clubs', '♠': 'spades', '♦': 'diamonds' };
const RANKS = { J: 11, Q: 12, K: 13 };
let nextId = 1000;
function card(name) {
  if (name === 'JK') return { id: nextId++, suit: null, rank: null, joker: true };
  const r = name.slice(0, -1);
  return { id: nextId++, suit: SYMBOLS[name.at(-1)], rank: RANKS[r] ?? Number(r), joker: false };
}
const cards = (names) => (names ? names.split(' ').map(card) : []);
const names = (list) => list.map(cardName).join(' ');

// Stack the deck so seats (in deal order, left of the dealer first) receive
// `hands`, then the first discard, then `rest` to draw from.
function dealt(hands, discard, rest = '') {
  const split = hands.map((h) => h.split(' '));
  const order = [];
  for (let i = 0; i < split[0].length; i++) for (const h of split) order.push(h[i]);
  return cards([...order, discard, rest].filter(Boolean).join(' '));
}

// rng () => 0 makes A the first dealer, so with A, B, C the deal goes B, C, A
// and B plays first.
function setup({ players = ['A', 'B', 'C'], deck } = {}) {
  const g = new Game({ rng: () => 0, deck });
  for (const n of players) g.addPlayer(n, n);
  g.start();
  return g;
}

const idOf = (g, pid, name) => {
  const c = card(name);
  const found = g.player(pid).hand.find((h) => h.joker === c.joker && h.suit === c.suit && h.rank === c.rank);
  assert.ok(found, `${pid} holds no ${name}`);
  return found.id;
};

// Puts the game straight into the given round (fresh deal) for end-game tests.
function jumpToRound(g, round) {
  g.phase = 'roundOver';
  g.round = round - 1;
  g.nextRound();
}

// The turn player draws from the deck and discards the drawn card.
function pass(g) {
  const id = g.turnId;
  g.draw(id, 'deck');
  g.discardCard(id, g.player(id).drawnId);
}

// ---- deck and deal ------------------------------------------------------

test('deck: 116 cards, 6 Jokers, two of each suit and rank', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 116);
  assert.equal(new Set(deck.map((c) => c.id)).size, 116);
  assert.equal(deck.filter((c) => c.joker).length, 6);
  assert.ok(deck.filter((c) => c.joker).every((c) => c.suit === null && c.rank === null));
  for (const suit of SUITS) {
    for (let rank = 3; rank <= 13; rank++) {
      assert.equal(deck.filter((c) => c.suit === suit && c.rank === rank && !c.joker).length, 2, `${rank} ${suit}`);
    }
  }
});

test('round 1 deals three each left of the dealer, flips a discard; 3s are wild', () => {
  const g = setup({ deck: dealt(['5♥ 6♥ 7♥', '9♣ 10♠ J♦', '4★ 4♥ Q♠'], '8♦', 'K♣') });
  assert.equal(names(g.player('B').hand), '5♥ 6♥ 7♥');
  assert.equal(names(g.player('C').hand), '9♣ 10♠ J♦');
  assert.equal(names(g.player('A').hand), '4★ 4♥ Q♠');
  const v = g.view(null);
  assert.equal(v.phase, 'playing');
  assert.equal(v.round, 1);
  assert.equal(v.rounds, ROUNDS);
  assert.equal(v.handSize, 3);
  assert.equal(v.wildRank, 3);
  assert.equal(v.dealerId, 'A');
  assert.equal(v.turnId, 'B');
  assert.equal(v.stage, 'draw');
  assert.equal(cardName(v.discardTop), '8♦');
  assert.equal(v.deckCount, 1);
  assert.equal(v.discardCount, 1);
});

test('a full deal uses r + 2 cards each and the rest stays in the deck', () => {
  const g = setup({ players: ['A', 'B', 'C', 'D'] });
  for (const p of g.players) assert.equal(p.hand.length, 3);
  assert.equal(g.deck.length, 116 - 12 - 1);
  jumpToRound(g, 7);
  assert.equal(g.wildRank, 9);
  for (const p of g.players) assert.equal(p.hand.length, 9);
  assert.equal(g.deck.length + g.discard.length, 116 - 36);
});

test('wild cards score 20 in their round, Jokers always 50', () => {
  const [nine, joker, king] = cards('9♠ JK K♦');
  for (let round = 1; round <= ROUNDS; round++) {
    const wr = round + 2;
    assert.equal(cardPoints(nine, wr), wr === 9 ? 20 : 9);
    assert.equal(cardPoints(king, wr), wr === 13 ? 20 : 13);
    assert.equal(cardPoints(joker, wr), 50);
  }
});

// ---- players ------------------------------------------------------------

test('players: max seven', () => {
  const g = new Game({ rng: () => 0 });
  for (const n of 'ABCDEFG') g.addPlayer(n, n);
  assert.throws(() => g.addPlayer('H', 'H'), GameError);
  assert.throws(() => new Game().addPlayer('X', '  '), GameError);
  g.start();
  assert.throws(() => g.addPlayer('H', 'H'), GameError, 'capacity counts the table');
});

test('removing the dealer between rounds keeps the rotation going', () => {
  const g = setup();
  jumpToRound(g, 2); // dealer B, C plays first
  assert.equal(g.view(null).dealerId, 'B');
  g.phase = 'roundOver';
  g.removePlayer('B');
  g.nextRound();
  assert.equal(g.view(null).dealerId, 'C');
  assert.equal(g.turnId, 'A');
});

// ---- turns --------------------------------------------------------------

test('turns are draw then discard; out-of-turn and out-of-stage moves are refused', () => {
  const g = setup({ deck: dealt(['5♥ 6♥ 7♥', '9♣ 10♠ J♦', '4★ 4♥ Q♠'], '8♦', 'K♣ 4♦') });
  assert.throws(() => g.draw('C', 'deck'), { message: "It's not your turn." });
  assert.throws(() => g.discardCard('B', idOf(g, 'B', '5♥')), { message: 'Draw a card first.' });
  assert.throws(() => g.draw('B', 'sideways'), GameError);
  g.draw('B', 'discard');
  assert.equal(names(g.player('B').hand), '5♥ 6♥ 7♥ 8♦');
  assert.equal(g.view('B').you.drawnId, idOf(g, 'B', '8♦'));
  assert.equal(g.view(null).discardTop, null);
  assert.equal(g.stage, 'discard');
  assert.throws(() => g.draw('B', 'deck'), GameError);
  assert.throws(() => g.discardCard('B', 99999), { message: "That card isn't in your hand." });
  g.discardCard('B', String(idOf(g, 'B', '5♥'))); // ids may arrive as strings
  assert.equal(g.turnId, 'C');
  assert.equal(g.stage, 'draw');
  assert.equal(g.outId, null);
  assert.equal(g.view('B').you.drawnId, null);
  assert.equal(cardName(g.view(null).discardTop), '5♥');
});

test('going out needs the rest of the hand to meld; a melded hand may still play on', () => {
  const g = setup({ deck: dealt(['5♥ 6♥ 9♠', '9♣ 10♠ J♦', '4★ 4♥ Q♠'], '8♦', '7♥ K♣ 4♦') });
  g.draw('B', 'deck');
  assert.throws(() => g.discardCard('B', idOf(g, 'B', '5♥'), true), GameError);
  assert.equal(g.player('B').hand.length, 4); // nothing changed
  assert.equal(g.stage, 'discard');
  g.discardCard('B', idOf(g, 'B', '9♠')); // melded, but not going out
  assert.equal(g.outId, null);
  assert.equal(g.turnId, 'C');
  assert.equal(g.view(null).players.find((p) => p.id === 'B').laid, null);
});

test('a full round: go out, one final turn each, hands laid and scored', () => {
  const g = setup({ deck: dealt(['5♥ 6♥ 7♥', '9♣ 10♠ J♦', '4★ 4♥ Q♠'], '8♦', 'K♣ 5♦ 4♣') });
  g.draw('B', 'deck'); // K♣
  g.discardCard('B', idOf(g, 'B', 'K♣'), true);
  assert.equal(g.outId, 'B');
  assert.equal(g.turnId, 'C');
  let v = g.view('C');
  assert.equal(v.outId, 'B');
  const b = v.players.find((p) => p.id === 'B');
  assert.equal(b.lastTurnDone, true);
  assert.deepEqual(b.laid.points, 0);
  assert.equal(names(b.laid.melds[0]), '5♥ 6♥ 7♥');
  assert.equal(v.players.find((p) => p.id === 'C').laid, null); // still private

  // C's last turn: nothing melds.
  g.draw('C', 'deck'); // 5♦
  g.discardCard('C', idOf(g, 'C', 'J♦'));
  v = g.view(null);
  const c = v.players.find((p) => p.id === 'C');
  assert.equal(c.lastTurnDone, true);
  assert.equal(c.laid.points, 9 + 10 + 5);
  assert.equal(v.phase, 'playing');
  assert.equal(v.turnId, 'A');

  // A's last turn: the 4♣ completes a book, so A scores nothing either.
  g.draw('A', 'deck');
  g.discardCard('A', idOf(g, 'A', 'Q♠'));
  v = g.view(null);
  assert.equal(v.phase, 'roundOver');
  assert.equal(v.turnId, null);
  assert.equal(v.stage, null);
  const score = Object.fromEntries(v.players.map((p) => [p.id, p.roundScores]));
  assert.deepEqual(score, { A: [0], B: [0], C: [24] });
  assert.equal(v.players.find((p) => p.id === 'C').score, 24);
  assert.ok(v.players.every((p) => p.laid));
  assert.throws(() => g.draw('C', 'deck'), GameError);

  // Next round: the deal moves on and everything resets.
  g.nextRound();
  v = g.view(null);
  assert.equal(v.round, 2);
  assert.equal(v.wildRank, 4);
  assert.equal(v.dealerId, 'B');
  assert.equal(v.turnId, 'C');
  assert.equal(v.outId, null);
  assert.ok(v.players.every((p) => !p.laid && !p.lastTurnDone && p.handCount === 4));
  assert.equal(v.players.find((p) => p.id === 'C').score, 24);
});

test('a final-turn player may ask to go out, and scores 0 when they can', () => {
  const g = setup({ players: ['A', 'B'], deck: dealt(['5♥ 6♥ 7♥', 'J♠ J♦ 9♣'], '8♦', 'K♣ J★') });
  g.draw('B', 'deck');
  g.discardCard('B', idOf(g, 'B', 'K♣'), true);
  g.draw('A', 'deck'); // J★
  assert.throws(() => g.discardCard('A', idOf(g, 'A', 'J★'), true), GameError);
  g.discardCard('A', idOf(g, 'A', '9♣'), true);
  assert.equal(g.phase, 'roundOver');
  assert.deepEqual(g.players.map((p) => p.roundScores), [[0], [0]]);
  assert.equal(g.outId, 'B');
});

test('the draw pile is rebuilt from the discards (minus the top card) when it runs out', () => {
  const g = setup({ players: ['A', 'B'], deck: dealt(['5♥ 6♥ 9♠', 'J♠ 10♦ 9♣'], '8♦', 'K♣') });
  g.draw('B', 'deck'); // K♣, the last card
  assert.equal(g.deck.length, 0); // only one discard: nothing to shuffle yet
  g.discardCard('B', idOf(g, 'B', 'K♣'));
  g.draw('A', 'deck'); // rebuilt from the 8♦ under the K♣
  assert.equal(names(g.player('A').hand), 'J♠ 10♦ 9♣ 8♦');
  assert.equal(cardName(g.view(null).discardTop), 'K♣');
  assert.equal(g.discard.length, 1);
  assert.ok(g.log.some((l) => /shuffled/.test(l.text)));
});

test('reshuffling keeps all 116 cards in play over a long round', () => {
  const g = setup({ players: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] });
  let reshuffled = false;
  for (let t = 0; t < 200; t++) {
    const before = g.deck.length;
    pass(g);
    if (g.deck.length > before) reshuffled = true;
    const total = g.deck.length + g.discard.length + g.players.reduce((s, p) => s + p.hand.length, 0);
    assert.equal(total, 116);
  }
  assert.ok(reshuffled);
});

// ---- end of game --------------------------------------------------------

function finishRound(g) {
  // Hand the turn player three Jokers to go out, then pass everyone else.
  const id = g.turnId;
  g.player(id).hand = cards('JK JK JK');
  g.draw(id, 'deck');
  g.discardCard(id, g.player(id).drawnId, true);
  while (g.phase === 'playing') pass(g);
}

test('after round 11 the lowest total wins, ties share the win', () => {
  const g = setup();
  jumpToRound(g, ROUNDS);
  assert.equal(g.wildRank, 13);
  assert.equal(g.player('A').hand.length, 13);
  for (const p of g.players) {
    p.score = { A: 10, B: 10, C: 30 }[p.id];
    p.hand = cards('JK JK JK'); // everyone melds out to 0 this round
  }
  finishRound(g);
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winners, ['A', 'B']);
  assert.deepEqual(g.view(null).winners, ['A', 'B']);
  assert.throws(() => g.nextRound(), GameError);
  g.removePlayer('A');
  assert.deepEqual(g.winners, ['B']);
});

test('a whole game plays out to round 11 with autoplay', () => {
  const g = new Game({ rng: mulberry(3) });
  for (const n of ['A', 'B', 'C']) g.addPlayer(n, n);
  g.start();
  for (const p of g.players) p.connected = false;
  for (let steps = 0; g.phase !== 'gameOver'; steps++) {
    assert.ok(steps < 20000, 'game should finish');
    if (g.phase === 'roundOver') g.nextRound();
    else fiveCrowns.actions.autoplay(g, {}, () => null);
  }
  assert.equal(g.round, ROUNDS);
  for (const p of g.players) {
    assert.equal(p.roundScores.length, ROUNDS);
    assert.equal(p.score, p.roundScores.reduce((a, b) => a + b, 0));
  }
  const best = Math.min(...g.players.map((p) => p.score));
  assert.deepEqual(g.winners, g.players.filter((p) => p.score === best).map((p) => p.id));
  g.reset();
  assert.equal(g.phase, 'lobby');
  assert.ok(g.players.every((p) => p.score === 0 && p.roundScores.length === 0));
});

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- autoplay -----------------------------------------------------------

test('autoplay only acts for an offline turn player, and goes out when it can', () => {
  const g = setup({ deck: dealt(['5♥ 6♥ 9♠', '9♣ 10♠ J♦', '4★ 4♥ Q♠'], '8♦', '7♥ K♣ 4♦') });
  const autoplay = (game) => fiveCrowns.actions.autoplay(game, {}, () => null);
  for (const p of g.players) p.connected = true;
  assert.throws(() => autoplay(g), { message: 'The current player is connected.' });
  g.player('B').connected = false;
  autoplay(g); // draws 7♥, drops the 9♠ and goes out
  assert.equal(g.outId, 'B');
  assert.equal(names(g.player('B').hand), '5♥ 6♥ 7♥');
  assert.equal(cardName(g.discard.at(-1)), '9♠');

  // Mid-turn (already drawn) it just discards.
  g.draw('C', 'deck'); // K♣
  g.player('C').connected = false;
  autoplay(g);
  assert.equal(cardName(g.discard.at(-1)), 'K♣');
  assert.equal(g.turnId, 'A');
});

// ---- views --------------------------------------------------------------

test('views hide other hands and the deck order', () => {
  const g = setup();
  const keys = ['id', 'name', 'connected', 'score', 'handCount', 'lastTurnDone', 'laid', 'roundScores'];
  const table = g.view(null);
  assert.equal(table.you, null);
  assert.equal(table.deck, undefined);
  for (const p of table.players) {
    assert.deepEqual(Object.keys(p).sort(), [...keys].sort());
    assert.equal(p.handCount, 3);
    assert.equal(p.laid, null);
  }
  const mine = g.view('B');
  assert.deepEqual(mine.you.hand, g.player('B').hand);
  assert.equal(mine.you.drawnId, null);
  // The only cards anywhere in the view: B's hand and the discard top.
  const seen = JSON.stringify(mine).match(/"joker":/g).length;
  assert.equal(seen, 3 + 1);
  assert.equal(JSON.stringify(table).match(/"joker":/g).length, 1);
  mine.you.hand.pop(); // a copy, not the live hand
  assert.equal(g.player('B').hand.length, 3);
});

test('the lobby view has no round details', () => {
  const g = new Game();
  g.addPlayer('A', 'A');
  const v = g.view('A');
  assert.equal(v.phase, 'lobby');
  assert.equal(v.round, 0);
  assert.equal(v.wildRank, null);
  assert.equal(v.stage, null);
  assert.deepEqual(v.you, { id: 'A', hand: [], drawnId: null });
});

test('the log keeps the last 50 entries', () => {
  const g = setup();
  for (let i = 0; i < 80; i++) g.addLog(`entry ${i}`);
  const { log } = g.view(null);
  assert.equal(log.length, 50);
  assert.equal(log.at(-1).text, 'entry 79');
});

// ---- descriptor ---------------------------------------------------------

test('Five Crowns is registered with its actions', () => {
  assert.equal(games.get('five-crowns'), fiveCrowns);
  assert.equal(fiveCrowns.name, 'Five Crowns');
  assert.equal(fiveCrowns.minPlayers, 2);
  assert.equal(fiveCrowns.maxPlayers, 7);
  assert.deepEqual(Object.keys(fiveCrowns.actions).sort(), ['autoplay', 'discard', 'draw', 'nextRound']);
  const g = fiveCrowns.create();
  for (const n of ['A', 'B']) g.addPlayer(n, n);
  g.start();
  const me = () => g.turnId;
  fiveCrowns.actions.draw(g, { from: 'deck' }, me);
  const drawn = g.player(g.turnId).drawnId;
  fiveCrowns.actions.discard(g, { cardId: drawn, goOut: 'yes' }, me); // only `true` means go out
  assert.equal(g.outId, null);
});

// ---- boot and late join -------------------------------------------------

// The turn player melds three hearts, draws, discards the drawn card and goes out.
function goOut(g) {
  const id = g.turnId;
  g.player(id).hand = cards('5♥ 6♥ 7♥');
  g.draw(id, 'deck');
  g.discardCard(id, g.player(id).drawnId, true);
}

// Plays the current round out with autoplay-style turns until it is over.
function playOut(g) {
  for (let i = 0; i < 2000 && g.phase === 'playing'; i++) {
    const id = g.turnId;
    g.draw(id, 'deck');
    
    const { cardId, points } = bestDiscard(g.player(id).hand, g.wildRank);
    g.discardCard(id, cardId, points === 0);
  }
  assert.notEqual(g.phase, 'playing', 'round never ended');
}

test('join mid-round waits, shows in the view, and counts against capacity', () => {
  const g = setup();
  g.addPlayer('D', 'D');
  assert.deepEqual(g.waiting, [{ id: 'D', name: 'D' }]);
  assert.ok(g.isWaiting('D'));
  assert.equal(g.players.length, 3);
  assert.deepEqual(g.view('D').waiting, [{ id: 'D', name: 'D' }]);
  assert.equal(g.log.at(-1).text, 'D will join next round.');
  for (const n of 'EFG') g.addPlayer(n, n);
  assert.throws(() => g.addPlayer('H', 'H'), GameError);
  assert.throws(() => g.addPlayer('X', ' '), GameError);
});

test('the next round seats waiting players at the highest score, with padded round scores', () => {
  const g = setup();
  g.player('A').score = 30; g.player('A').roundScores = [30];
  g.player('B').score = 10; g.player('B').roundScores = [10];
  g.player('C').score = 20; g.player('C').roundScores = [20];
  g.round = 1; g.phase = 'roundOver';
  g.addPlayer('D', 'D');
  g.nextRound();
  assert.deepEqual(g.waiting, []);
  assert.equal(g.players.at(-1).id, 'D');
  assert.equal(g.player('D').score, 30);
  assert.deepEqual(g.player('D').roundScores, [null]);
  assert.equal(g.player('D').hand.length, g.wildRank);
  assert.ok(g.log.some((l) => l.text === 'D joins with 30 points.'));
  playOut(g);
  assert.deepEqual(g.player('D').roundScores.length, 2);
});

test('a lone seated player is joined by a waiting one for the next round', () => {
  const g = setup({ players: ['A', 'B'] });
  g.removePlayer('A'); // abandons: only B left
  assert.equal(g.phase, 'roundOver');
  assert.throws(() => g.nextRound(), GameError);
  g.addPlayer('C', 'C');
  g.nextRound();
  assert.equal(g.players.length, 2);
  assert.equal(g.player('C').score, 0);
});

test('reset seats waiting players at zero', () => {
  const g = setup();
  g.player('A').score = 50;
  g.addPlayer('D', 'D');
  g.reset();
  assert.deepEqual(g.waiting, []);
  assert.equal(g.player('D').score, 0);
  assert.deepEqual(g.player('D').roundScores, []);
  assert.equal(g.player('A').score, 0);
});

test('removing a waiting player changes nothing else', () => {
  const g = setup();
  g.addPlayer('D', 'D');
  const log = g.log.length;
  g.removePlayer('D');
  assert.deepEqual(g.waiting, []);
  assert.equal(g.players.length, 3);
  assert.equal(g.phase, 'playing');
  assert.equal(g.log.length, log);
});

test('removing the turn player passes the turn on and the round finishes', () => {
  const g = setup(); // B plays first
  const handB = names(g.player('B').hand);
  assert.equal(g.turnId, 'B');
  g.removePlayer('B');
  assert.equal(g.turnId, 'C');
  assert.equal(g.stage, 'draw');
  assert.equal(g.log.at(-1).text, 'B was removed from the game.');
  const seen = JSON.stringify([g.view(null), g.view('A'), g.view('C'), g.log]);
  assert.ok(!JSON.stringify(g.log).includes(handB));
  assert.ok(!seen.includes('"id":"B"'));
  playOut(g);
  assert.equal(g.players.length, 2);
  assert.ok(g.players.every((p) => p.roundScores.length === 1));
});

test('removing a player who is not on turn leaves the turn alone', () => {
  const g = setup();
  g.removePlayer('C');
  assert.equal(g.turnId, 'B');
  assert.equal(g.stage, 'draw');
  playOut(g);
  assert.equal(g.phase, 'roundOver');
});

test('removing the dealer mid-round: the next deal goes to who would have dealt after', () => {
  const g = setup(); // A deals, B first, rotation B C A
  g.removePlayer('A');
  playOut(g);
  g.nextRound();
  assert.equal(g.view(null).dealerId, 'B');
  const g2 = setup();
  jumpToRound(g2, 2); // dealer B
  g2.removePlayer('B');
  playOut(g2);
  g2.nextRound();
  assert.equal(g2.view(null).dealerId, 'C');
});

test('removal during final turns skips them and the round still ends', () => {
  const g = setup({ deck: dealt(['5♥ 6♥ 7♥', '9♣ 10♠ J♦', '4★ 4♥ Q♠'], '8♦', '3♣ 3♠ 5♣ 8♣ 9♦ K♣') });
  // B goes out: draws the 8, melds 5-6-7 hearts, discards nothing meldable? use direct state
  goOut(g);
  assert.equal(g.turnId, 'C');
  g.removePlayer('A'); // A had a final turn pending
  assert.equal(g.turnId, 'C');
  pass(g);
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.players.length, 2);
});

test('removing the player who went out: final turns finish and the round ends', () => {
  const g = setup();
  goOut(g);
  assert.equal(g.outId, 'B');
  assert.equal(g.turnId, 'C');
  g.removePlayer('B');
  assert.equal(g.turnId, 'C');
  pass(g);
  assert.equal(g.turnId, 'A');
  pass(g);
  assert.equal(g.phase, 'roundOver');
  assert.deepEqual(g.player('A').roundScores.length, 1);
});

test('removing the turn player in a final turn leaves one player: the round is abandoned', () => {
  const g = setup({ players: ['A', 'B'] }); // B first
  goOut(g);
  assert.equal(g.turnId, 'A');
  g.removePlayer('A'); // leaves one player: abandoned
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.round, 1);
});

test('down to one player abandons the round with null scores', () => {
  const g = setup();
  g.removePlayer('B');
  g.removePlayer('C');
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.turnId, null);
  assert.deepEqual(g.player('A').roundScores, [null]);
  assert.equal(g.player('A').score, 0);
  assert.ok(g.log.some((l) => l.text === 'Round 1 was abandoned: not enough players.'));
  assert.deepEqual(g.view('A').you.hand, []);
});

test('abandoning the last round ends the game on current scores', () => {
  const g = setup();
  jumpToRound(g, ROUNDS);
  g.player('A').score = 5; g.player('B').score = 9; g.player('C').score = 7;
  g.removePlayer('A');
  g.removePlayer(g.turnId === 'B' ? 'C' : 'B');
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winners.length, 1);
});

test('a removed player drops out of winners and views never show their cards', () => {
  const g = setup();
  const ids = g.player('B').hand.map((c) => c.id);
  g.removePlayer('B');
  const json = JSON.stringify([g.view(null), g.view('A'), g.log]);
  assert.ok(!json.includes('"id":"B"'));
  for (const id of ids) assert.ok(!json.includes(`"id":${id},"suit"`));
});
