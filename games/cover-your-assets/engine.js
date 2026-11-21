// Cover Your Assets rules engine (classic rules). Pure state machine: no
// networking, no timers.
//
// Each player's stack is an array of sets, bottom first. Only the top set can
// be stolen, and only while the owner has at least two, so the bottom set is
// always safe. A battle (challenge) is the only multi-step action: it holds
// the turn until one side gives up or runs out of eligible cards.

import { GameError } from '../../server/game-error.js';

export const TARGET_SCORE = 1_000_000;
export const HAND_SIZE = 5;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const MODES = ['classic', 'quick'];

export { GameError };

// Values are not printed in the rulebook text: they are inferred from its
// card order and counts, and kept here in one place so they are easy to fix.
export const ASSETS = [
  { key: 'baseball', name: 'Baseball Cards', count: 10, value: 5000 },
  { key: 'coins', name: 'Coin Collection', count: 10, value: 5000 },
  { key: 'piggy', name: 'Piggy Bank', count: 10, value: 5000 },
  { key: 'cash', name: 'Cash Under the Mattress', count: 9, value: 10000 },
  { key: 'bank', name: 'Bank Account', count: 9, value: 10000 },
  { key: 'stocks', name: 'Stocks', count: 9, value: 10000 },
  { key: 'boat', name: 'Speed Boat', count: 9, value: 15000 },
  { key: 'jewels', name: 'Jewels', count: 9, value: 15000 },
  { key: 'auto', name: 'Classic Auto', count: 9, value: 15000 },
  { key: 'home', name: 'Home', count: 8, value: 20000 },
  { key: 'silver', name: 'Silver', count: 8, value: 25000, wild: true },
  { key: 'gold', name: 'Gold', count: 4, value: 50000, wild: true },
];

const BY_KEY = new Map(ASSETS.map((a) => [a.key, a]));

export function makeCard(key, id) {
  const a = BY_KEY.get(key);
  if (!a) throw new Error(`Unknown asset: ${key}`);
  return { id, kind: a.wild ? 'wild' : 'asset', asset: a.key, name: a.name, value: a.value };
}

// 104 cards: every asset and wild in the table, ids 0..103.
export function buildDeck() {
  const cards = [];
  for (const a of ASSETS) for (let i = 0; i < a.count; i++) cards.push(makeCard(a.key, cards.length));
  return cards;
}

export function shuffle(cards, rng = Math.random) {
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const dollars = (v) => `$${v.toLocaleString('en-US')}`;

const isWild = (card) => card.kind === 'wild';

// Two cards make a set if they are the same asset or exactly one is wild.
export function canPair(a, b) {
  if (isWild(a) && isWild(b)) return false;
  return isWild(a) || isWild(b) || a.asset === b.asset;
}

// A card can be played into a battle over `asset` if it matches or is wild.
export const canMatch = (card, asset) => isWild(card) || card.asset === asset;

// Wilds sit below the assets so the visible top card names the set.
function ordered(cards) {
  return [...cards.filter(isWild), ...cards.filter((c) => !isWild(c))];
}

export const setValue = (set) => set.cards.reduce((s, c) => s + c.value, 0);
export const stackValue = (p) => p.stack.reduce((s, set) => s + setValue(set), 0);

function makeSet(cards) {
  const asset = cards.find((c) => !isWild(c)).asset;
  return { asset, cards: ordered(cards) };
}

export class Game {
  // `deck` lets tests stack the deck; it is used (in order) for the first round.
  constructor({ rng = Math.random, deck = null } = {}) {
    this.rng = rng;
    this.mode = 'classic';
    this.players = [];
    this.logSeq = 0;
    this.log = [];
    this.reset(deck);
  }

  // Back to the lobby with the same players, zeroed scores and the same mode.
  reset(deck = null) {
    this.phase = 'lobby'; // lobby | playing | roundOver | gameOver
    this.round = 0;
    this.nextDeck = deck ? [...deck] : null;
    this.deck = [];
    this.discard = [];
    this.dealerIndex = -1;
    this.turnId = null;
    this.battle = null;
    this.winners = [];
    for (const p of this.players) {
      p.score = 0;
      this.clearTable(p);
    }
  }

  // ---- player management -------------------------------------------------

  addPlayer(id, name) {
    if (this.phase !== 'lobby') throw new GameError('A game is already in progress.');
    if (this.players.length >= MAX_PLAYERS) throw new GameError(`The table is full (${MAX_PLAYERS} players).`);
    name = String(name ?? '').trim().slice(0, 16);
    if (!name) throw new GameError('Please enter a name.');
    const p = { id, name, score: 0 };
    this.clearTable(p);
    this.players.push(p);
    this.addLog(`${name} joined.`);
    return p;
  }

  removePlayer(id) {
    if (this.phase === 'playing') throw new GameError('Players can only be removed between rounds.');
    const seat = this.seatOf(id);
    if (seat < 0) return;
    const [p] = this.players.splice(seat, 1);
    if (seat <= this.dealerIndex) this.dealerIndex--;
    this.winners = this.winners.filter((w) => w !== id);
    this.addLog(`${p.name} left.`);
  }

  player(id) {
    return this.players.find((p) => p.id === id);
  }

  seatOf(id) {
    return this.players.findIndex((p) => p.id === id);
  }

  setMode(mode) {
    if (this.phase !== 'lobby') throw new GameError('The mode can only be changed in the lobby.');
    if (!MODES.includes(mode)) throw new GameError('Unknown game mode.');
    this.mode = mode;
  }

  // ---- round flow --------------------------------------------------------

  start() {
    if (this.phase !== 'lobby') throw new GameError('The game has already started.');
    if (this.players.length < MIN_PLAYERS) throw new GameError(`Need at least ${MIN_PLAYERS} players.`);
    this.dealerIndex = Math.floor(this.rng() * this.players.length) - 1; // startRound advances it
    this.startRound();
  }

  nextRound() {
    if (this.phase !== 'roundOver') throw new GameError('The round is not over yet.');
    if (this.players.length < MIN_PLAYERS) throw new GameError(`Need at least ${MIN_PLAYERS} players.`);
    this.startRound();
  }

  clearTable(p) {
    p.hand = [];
    p.stack = [];
    p.roundScore = 0;
  }

  // Every round uses a fresh full deck: stacks are scored, not recycled.
  startRound() {
    this.round++;
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    this.deck = this.nextDeck ?? shuffle(buildDeck(), this.rng);
    this.nextDeck = null;
    this.discard = [];
    this.battle = null;
    this.winners = [];
    for (const p of this.players) this.clearTable(p);
    this.phase = 'playing';
    this.addLog(`Round ${this.round} — ${this.players[this.dealerIndex].name} deals.`);

    // One card at a time, starting left of the dealer.
    const order = this.seatsFrom(this.dealerIndex + 1);
    for (let i = 0; i < HAND_SIZE; i++) {
      for (const p of order) if (this.deck.length) p.hand.push(this.deck.shift());
    }
    if (this.deck.length) this.discard.push(this.deck.shift());
    this.setTurn(order.find((p) => p.hand.length));
  }

  seatsFrom(start) {
    const n = this.players.length;
    return Array.from({ length: n }, (_, i) => this.players[(start + i) % n]);
  }

  setTurn(p) {
    if (!p) return this.endRound();
    this.turnId = p.id;
  }

  drawUp(p) {
    while (p.hand.length < HAND_SIZE && this.deck.length) p.hand.push(this.deck.shift());
  }

  // The turn player refills first, then a defender who spent cards; then
  // play passes left to the next player still holding cards.
  endTurn(defender = null) {
    const p = this.player(this.turnId);
    this.drawUp(p);
    if (defender) this.drawUp(defender);
    if (!this.deck.length && this.players.every((q) => !q.hand.length)) return this.endRound();
    this.setTurn(this.seatsFrom(this.seatOf(p.id) + 1).find((q) => q.hand.length));
  }

  endRound() {
    this.turnId = null;
    this.battle = null;
    for (const p of this.players) {
      p.roundScore = stackValue(p);
      p.score += p.roundScore;
    }
    const best = Math.max(...this.players.map((p) => p.score));
    if (this.mode === 'quick' || best >= TARGET_SCORE) {
      this.phase = 'gameOver';
      this.winners = this.players.filter((p) => p.score === best).map((p) => p.id);
      const names = this.winners.map((id) => this.player(id).name).join(' & ');
      this.addLog(`${names} win${this.winners.length > 1 ? '' : 's'} with ${dollars(best)}!`);
    } else {
      this.phase = 'roundOver';
      this.addLog(`Round ${this.round} over.`);
    }
  }

  // ---- turn actions ------------------------------------------------------

  assertTurn(playerId) {
    if (this.phase !== 'playing') throw new GameError('No round is in progress.');
    if (this.battle) throw new GameError('A battle is in progress.');
    if (this.turnId !== playerId) throw new GameError("It's not your turn.");
    return this.player(playerId);
  }

  // Ids arrive from the client as JSON, so compare loosely on their string form.
  handCard(p, cardId) {
    const card = p.hand.find((c) => String(c.id) === String(cardId));
    if (!card) throw new GameError("That card isn't in your hand.");
    return card;
  }

  takeFromHand(p, card) {
    p.hand.splice(p.hand.indexOf(card), 1);
  }

  pair(playerId, cardIds) {
    const p = this.assertTurn(playerId);
    if (!Array.isArray(cardIds) || cardIds.length !== 2) throw new GameError('Pick exactly two cards.');
    const [a, b] = cardIds.map((id) => this.handCard(p, id));
    if (a === b) throw new GameError('Pick two different cards.');
    if (!canPair(a, b)) throw new GameError(isWild(a) && isWild(b) ? "Two wilds can't make a set." : "Those cards don't match.");
    this.takeFromHand(p, a);
    this.takeFromHand(p, b);
    this.addSet(p, [a, b]);
    this.endTurn();
  }

  pairDiscard(playerId, cardId) {
    const p = this.assertTurn(playerId);
    const card = this.handCard(p, cardId);
    const top = this.discard.at(-1);
    if (!top) throw new GameError('The discard pile is empty.');
    if (!canPair(card, top)) throw new GameError(isWild(card) && isWild(top) ? "Two wilds can't make a set." : "That card doesn't match the discard.");
    this.takeFromHand(p, card);
    this.discard.pop();
    this.addSet(p, [card, top]);
    this.endTurn();
  }

  // A new set always goes on top, even if a set of that asset is already there.
  addSet(p, cards) {
    const set = makeSet(cards);
    p.stack.push(set);
    this.addLog(`${p.name} made a ${BY_KEY.get(set.asset).name} set (${dollars(setValue(set))}).`);
  }

  discardCard(playerId, cardId) {
    const p = this.assertTurn(playerId);
    const card = this.handCard(p, cardId);
    this.takeFromHand(p, card);
    this.discard.push(card);
    this.addLog(`${p.name} discarded ${card.name}.`);
    this.endTurn();
  }

  // ---- battles -----------------------------------------------------------

  // Why a challenge against `target` is not allowed, or null if it is.
  challengeProblem(p, target) {
    if (!target) return 'No such player.';
    if (target === p) return "You can't challenge yourself.";
    if (!p.stack.length) return 'You need a set of your own before you can steal.';
    if (target.stack.length < 2) return `${target.name}'s only set is safe.`;
    return null;
  }

  challenge(playerId, targetId, cardId) {
    const p = this.assertTurn(playerId);
    const target = this.player(targetId);
    const problem = this.challengeProblem(p, target);
    if (problem) throw new GameError(problem);
    const card = this.handCard(p, cardId);
    const set = target.stack.at(-1);
    if (!canMatch(card, set.asset)) throw new GameError(`Play a ${BY_KEY.get(set.asset).name} or a wild to challenge.`);
    this.battle = { challengerId: p.id, defenderId: target.id, toMoveId: target.id, asset: set.asset, plays: [] };
    this.addLog(`${p.name} challenges ${target.name} for their ${BY_KEY.get(set.asset).name} set!`);
    this.play(p, card);
  }

  assertToMove(playerId) {
    if (this.phase !== 'playing' || !this.battle) throw new GameError('There is no battle in progress.');
    if (this.battle.toMoveId !== playerId) throw new GameError("It's not your move.");
    return this.player(playerId);
  }

  respond(playerId, cardId) {
    const p = this.assertToMove(playerId);
    const card = this.handCard(p, cardId);
    if (!canMatch(card, this.battle.asset)) throw new GameError(`Play a ${BY_KEY.get(this.battle.asset).name} or a wild.`);
    this.play(p, card);
  }

  fold(playerId) {
    const p = this.assertToMove(playerId);
    this.addLog(`${p.name} gives up.`);
    this.resolve(this.opponent(p.id));
  }

  opponent(id) {
    const b = this.battle;
    return this.player(id === b.challengerId ? b.defenderId : b.challengerId);
  }

  // Play a card and hand the move to the other side, who loses at once if
  // they hold nothing that could answer it.
  play(p, card) {
    this.takeFromHand(p, card);
    this.battle.plays.push({ playerId: p.id, card });
    this.addLog(`${p.name} plays ${card.name}.`);
    const next = this.opponent(p.id);
    this.battle.toMoveId = next.id;
    if (!next.hand.some((c) => canMatch(c, this.battle.asset))) {
      this.addLog(`${next.name} has nothing to answer with.`);
      this.resolve(p);
    }
  }

  resolve(winner) {
    const b = this.battle;
    const defender = this.player(b.defenderId);
    const battleCards = b.plays.map((x) => x.card);
    const set = defender.stack.at(-1);
    if (winner.id === b.challengerId) {
      defender.stack.pop();
      winner.stack.push({ asset: set.asset, cards: ordered([...set.cards, ...battleCards]) });
      this.addLog(`${winner.name} steals the ${BY_KEY.get(set.asset).name} set from ${defender.name}!`);
    } else {
      set.cards = ordered([...set.cards, ...battleCards]);
      this.addLog(`${defender.name} keeps the ${BY_KEY.get(set.asset).name} set.`);
    }
    const defenderPlayed = b.plays.some((x) => x.playerId === defender.id);
    this.battle = null;
    this.endTurn(defenderPlayed ? defender : null);
  }

  // ---- views -------------------------------------------------------------

  addLog(text) {
    this.log.push({ id: ++this.logSeq, text });
    if (this.log.length > 50) this.log.shift();
  }

  // Hands are private: the viewer sees only their own; the deck order is
  // never sent. view(null) is the shared table screen.
  view(playerId) {
    const you = playerId != null ? this.player(playerId) : null;
    const setJSON = (set) => ({ asset: set.asset, cards: [...set.cards], value: setValue(set) });
    const b = this.battle;
    return {
      phase: this.phase,
      mode: this.mode,
      round: this.round,
      targetScore: TARGET_SCORE,
      handSize: HAND_SIZE,
      dealerId: this.players[this.dealerIndex]?.id ?? null,
      turnId: this.turnId,
      deckCount: this.deck.length,
      discardCount: this.discard.length,
      discardTop: this.discard.at(-1) ?? null,
      battle: b && {
        challengerId: b.challengerId,
        defenderId: b.defenderId,
        toMoveId: b.toMoveId,
        asset: b.asset,
        set: setJSON(this.player(b.defenderId).stack.at(-1)),
        plays: b.plays.map((x) => ({ playerId: x.playerId, card: x.card })),
      },
      winners: [...this.winners],
      log: [...this.log],
      you: you ? { id: you.id, hand: [...you.hand] } : null,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected ?? true,
        score: p.score,
        roundScore: p.roundScore,
        handCount: p.hand.length,
        stack: p.stack.map(setJSON),
        stackValue: stackValue(p),
      })),
    };
  }
}
