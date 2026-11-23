// Five Crowns rules engine. Pure state machine: no networking, no timers.
//
// Eleven rounds; in round r everyone holds r + 2 cards and that rank is wild.
// A turn is two stages, draw then discard. Once someone goes out, every other
// player gets one final turn, after which their hand is laid down in its best
// arrangement (the shared solver in public/melds.js) and the leftover cards
// score against them. Lowest total after the last round wins.

import { GameError } from '../../server/game-error.js';
import { SUITS, arrange } from './public/melds.js';

export const ROUNDS = 11;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 7;
export const JOKERS_PER_DECK = 3;

export { GameError };

const SUIT_SYMBOLS = { stars: '★', hearts: '♥', clubs: '♣', spades: '♠', diamonds: '♦' };
const FACES = { 11: 'J', 12: 'Q', 13: 'K' };

export const rankName = (rank) => FACES[rank] ?? String(rank);

export function cardName(card) {
  return card.joker ? 'Joker' : `${rankName(card.rank)}${SUIT_SYMBOLS[card.suit]}`;
}

// 116 cards, ids 0..115: two decks of five suits 3..K plus three Jokers each.
export function buildDeck() {
  const cards = [];
  for (let d = 0; d < 2; d++) {
    for (const suit of SUITS) {
      for (let rank = 3; rank <= 13; rank++) cards.push({ id: cards.length, suit, rank, joker: false });
    }
    for (let j = 0; j < JOKERS_PER_DECK; j++) cards.push({ id: cards.length, suit: null, rank: null, joker: true });
  }
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

export class Game {
  // `deck` lets tests stack the deck; it is used (in order) for the first round.
  constructor({ rng = Math.random, deck = null } = {}) {
    this.rng = rng;
    this.players = [];
    this.waiting = []; // late joiners, seated when the next round starts
    this.logSeq = 0;
    this.log = [];
    this.reset(deck);
  }

  // Back to the lobby with the same players and zeroed scores.
  reset(deck = null) {
    this.phase = 'lobby'; // lobby | playing | roundOver | gameOver
    this.round = 0;
    this.nextDeck = deck ? [...deck] : null;
    this.deck = [];
    this.discard = [];
    this.dealerIndex = -1;
    this.turnId = null;
    this.stage = null; // draw | discard while a turn is under way
    this.outId = null;
    this.winners = [];
    for (const p of this.players) {
      p.score = 0;
      p.roundScores = [];
      this.clearHand(p);
    }
    for (const w of this.waiting) {
      const p = { id: w.id, name: w.name, score: 0, roundScores: [] };
      this.clearHand(p);
      this.players.push(p);
    }
    this.waiting = [];
  }

  // The round's wild rank is also its hand size: 3s in round 1 ... Kings in 11.
  get wildRank() {
    return this.round > 0 ? this.round + 2 : null;
  }

  // ---- player management -------------------------------------------------

  addPlayer(id, name) {
    if (this.players.length + this.waiting.length >= MAX_PLAYERS) throw new GameError(`The table is full (${MAX_PLAYERS} players).`);
    name = String(name ?? '').trim().slice(0, 16);
    if (!name) throw new GameError('Please enter a name.');
    if (this.phase !== 'lobby') {
      const w = { id, name };
      this.waiting.push(w);
      this.addLog(`${name} will join next round.`);
      return w;
    }
    const p = { id, name, score: 0, roundScores: [] };
    this.clearHand(p);
    this.players.push(p);
    this.addLog(`${name} joined.`);
    return p;
  }

  isWaiting(id) {
    return this.waiting.some((w) => w.id === id);
  }

  // Allowed in every phase. Mid-round the player's hand goes out of play and
  // the round carries on without them.
  removePlayer(id) {
    const wait = this.waiting.findIndex((w) => w.id === id);
    if (wait >= 0) {
      this.waiting.splice(wait, 1);
      return;
    }
    const seat = this.seatOf(id);
    if (seat < 0) return;
    const [p] = this.players.splice(seat, 1);
    // If the dealer goes, the dealer index points at the seat before, so the
    // next deal goes to whoever would have dealt after them.
    if (seat <= this.dealerIndex) this.dealerIndex--;
    this.winners = this.winners.filter((w) => w !== id);
    if (this.phase !== 'playing') {
      this.addLog(`${p.name} left.`);
      return;
    }
    this.addLog(`${p.name} was removed from the game.`);
    if (this.players.length < MIN_PLAYERS) return this.abandonRound();
    if (this.turnId === id) {
      // Their old seat now holds the next player; skip anyone who already had a final turn.
      const next = this.seatsFrom(seat).find((q) => !q.lastTurnDone);
      this.turnId = null;
      if (!next) return this.endRound();
      this.setTurn(next);
    }
  }

  // Too few players left to play on: nobody scores, the round just ends.
  abandonRound() {
    this.turnId = null;
    this.stage = null;
    for (const p of this.players) {
      this.clearHand(p);
      p.roundScores.push(null);
    }
    this.addLog(`Round ${this.round} was abandoned: not enough players.`);
    this.finishRound();
  }

  // Waiting players take the last seats, level with last place (the highest score).
  seatWaiting() {
    if (!this.waiting.length) return;
    const score = this.players.length ? Math.max(...this.players.map((p) => p.score)) : 0;
    for (const w of this.waiting) {
      const p = { id: w.id, name: w.name, score, roundScores: Array(this.round).fill(null) };
      this.clearHand(p);
      this.players.push(p);
      this.addLog(`${p.name} joins with ${score} points.`);
    }
    this.waiting = [];
  }

  player(id) {
    return this.players.find((p) => p.id === id);
  }

  seatOf(id) {
    return this.players.findIndex((p) => p.id === id);
  }

  clearHand(p) {
    p.hand = [];
    p.drawnId = null;
    p.laid = null;
    p.lastTurnDone = false;
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
    if (this.players.length + this.waiting.length < MIN_PLAYERS) throw new GameError(`Need at least ${MIN_PLAYERS} players.`);
    this.seatWaiting();
    this.startRound();
  }

  // Every round is dealt from a fresh full deck.
  startRound() {
    this.round++;
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    this.deck = this.nextDeck ?? shuffle(buildDeck(), this.rng);
    this.nextDeck = null;
    this.discard = [];
    this.outId = null;
    for (const p of this.players) this.clearHand(p);
    this.phase = 'playing';
    this.addLog(`Round ${this.round} — ${this.players[this.dealerIndex].name} deals. ${rankName(this.wildRank)}s are wild.`);

    // One card at a time, starting left of the dealer, who also plays first.
    const order = this.seatsFrom(this.dealerIndex + 1);
    for (let i = 0; i < this.wildRank; i++) {
      for (const p of order) if (this.deck.length) p.hand.push(this.deck.shift());
    }
    if (this.deck.length) this.discard.push(this.deck.shift());
    this.setTurn(order[0]);
  }

  seatsFrom(start) {
    const n = this.players.length;
    return Array.from({ length: n }, (_, i) => this.players[(start + i) % n]);
  }

  setTurn(p) {
    this.turnId = p.id;
    this.stage = 'draw';
  }

  // After someone goes out, play continues in seat order only through the
  // players who still have their final turn to take.
  passTurn(p) {
    const next = this.seatsFrom(this.seatOf(p.id) + 1).find((q) => q !== p && !q.lastTurnDone);
    if (!next) return this.endRound();
    this.setTurn(next);
  }

  endRound() {
    this.turnId = null;
    this.stage = null;
    for (const p of this.players) {
      const points = p.id === this.outId ? 0 : p.laid.points;
      p.roundScores.push(points);
      p.score += points;
    }
    this.finishRound(true);
  }

  // Ends the round, or the game after the last one.
  finishRound(scored = false) {
    if (this.round >= ROUNDS) {
      this.phase = 'gameOver';
      const best = Math.min(...this.players.map((p) => p.score));
      this.winners = this.players.filter((p) => p.score === best).map((p) => p.id);
      if (this.winners.length) {
        const names = this.winners.map((id) => this.player(id).name).join(' & ');
        this.addLog(`${names} win${this.winners.length > 1 ? '' : 's'} with ${best} points!`);
      }
    } else {
      this.phase = 'roundOver';
      if (scored) this.addLog(`Round ${this.round} over.`);
    }
  }

  // The draw pile is rebuilt from the discards (all but the top card) as soon
  // as it runs out, so there is always something to draw.
  refillDeck() {
    if (this.deck.length || this.discard.length < 2) return;
    const top = this.discard.pop();
    this.deck = shuffle(this.discard, this.rng);
    this.discard = [top];
    this.addLog('The draw pile ran out: the discards were shuffled into a new one.');
  }

  // ---- turn actions ------------------------------------------------------

  assertTurn(playerId, stage) {
    if (this.phase !== 'playing') throw new GameError('No round is in progress.');
    if (this.turnId !== playerId) throw new GameError("It's not your turn.");
    if (this.stage !== stage) throw new GameError(stage === 'draw' ? "You've already drawn: now discard a card." : 'Draw a card first.');
    return this.player(playerId);
  }

  draw(playerId, from) {
    const p = this.assertTurn(playerId, 'draw');
    let card;
    if (from === 'deck') {
      this.refillDeck();
      card = this.deck.shift();
      if (!card) throw new GameError('The draw pile is empty.');
      this.addLog(`${p.name} drew from the deck.`);
      this.refillDeck();
    } else if (from === 'discard') {
      card = this.discard.pop();
      if (!card) throw new GameError('The discard pile is empty.');
      this.addLog(`${p.name} took the ${cardName(card)}.`);
    } else {
      throw new GameError('Draw from the deck or the discard pile.');
    }
    p.hand.push(card);
    p.drawnId = card.id;
    this.stage = 'discard';
  }

  // Ids arrive from the client as JSON, so compare loosely on their string form.
  handCard(p, cardId) {
    const card = p.hand.find((c) => String(c.id) === String(cardId));
    if (!card) throw new GameError("That card isn't in your hand.");
    return card;
  }

  // Discarding ends the turn. Going out needs every remaining card in a meld;
  // a final turn (after someone else went out) lays the hand down either way.
  discardCard(playerId, cardId, goOut = false) {
    const p = this.assertTurn(playerId, 'discard');
    const card = this.handCard(p, cardId);
    const rest = p.hand.filter((c) => c !== card);
    const laid = goOut || this.outId ? arrange(rest, this.wildRank) : null;
    if (goOut && laid.points > 0) throw new GameError("You can't go out: not all of your other cards meld yet.");

    p.hand = rest;
    p.drawnId = null;
    this.discard.push(card);
    this.addLog(`${p.name} discarded the ${cardName(card)}.`);

    if (this.outId) {
      p.laid = laid;
      p.lastTurnDone = true;
      this.addLog(laid.points ? `${p.name} lays down with ${laid.points} points left.` : `${p.name} melds everything too!`);
    } else if (goOut) {
      this.outId = p.id;
      p.laid = laid;
      p.lastTurnDone = true;
      this.addLog(`${p.name} goes out! Everyone else gets one last turn.`);
    }
    this.passTurn(p);
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
    const laidJSON = (l) => l && { melds: l.melds.map((m) => [...m]), deadwood: [...l.deadwood], points: l.points };
    return {
      phase: this.phase,
      round: this.round,
      rounds: ROUNDS,
      waiting: this.waiting.map((w) => ({ id: w.id, name: w.name })),
      handSize: this.wildRank,
      wildRank: this.wildRank,
      dealerId: this.players[this.dealerIndex]?.id ?? null,
      turnId: this.turnId,
      stage: this.stage,
      outId: this.outId,
      deckCount: this.deck.length,
      discardCount: this.discard.length,
      discardTop: this.discard.at(-1) ?? null,
      winners: [...this.winners],
      log: [...this.log],
      you: you ? { id: you.id, hand: [...you.hand], drawnId: you.drawnId } : null,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected ?? true,
        score: p.score,
        handCount: p.hand.length,
        lastTurnDone: p.lastTurnDone,
        laid: laidJSON(p.laid),
        roundScores: [...p.roundScores],
      })),
    };
  }
}
