// Oh Hell rules engine. Pure state machine: no networking, no timers. The
// rules as played are in specs/oh-hell.md and this game's README.
//
// 3-7 players, one 52-card deck, aces high. Each round everyone is dealt
// that round's hand size and one more card is turned for trump. Everyone
// bids how many tricks they will take (the dealer, bidding last, may not make
// the bids add up to the number of tricks), then the tricks are played.
// Exactly the bid scores 10 plus a point per trick; anything else scores a
// point per trick.

import { GameError } from '../../server/game-error.js';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 7;
export const MAX_HAND = 10;
export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
export const PATTERNS = ['down-up', 'down', 'up'];
export const DEFAULT_PATTERN = 'down-up';
export const MADE_BID_BONUS = 10;

export { GameError };

const SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const FACES = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export const rankName = (rank) => FACES[rank] ?? String(rank);
export const cardName = (card) => `${rankName(card.rank)}${SUIT_SYMBOLS[card.suit]}`;

// The largest hand dealt: 10, or fewer so a card is left to turn for trump.
export const maxHand = (players) => Math.min(MAX_HAND, Math.floor(51 / players));

// Hand sizes, round by round, for a pattern.
export function handSizes(players, pattern = DEFAULT_PATTERN) {
  const max = maxHand(players);
  const down = Array.from({ length: max }, (_, i) => max - i);
  const up = [...down].reverse();
  if (pattern === 'down') return down;
  if (pattern === 'up') return up;
  return [...down, ...up.slice(1)];
}

export function buildDeck() {
  const cards = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) cards.push({ id: cards.length, rank, suit });
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

// Suit then rank, for sorting and deterministic tie-breaks.
const bySuitRank = (a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || a.rank - b.rank;

export class Game {
  // `deck` lets tests stack the deck; it is used (in order) for the first round.
  constructor({ rng = Math.random, deck = null } = {}) {
    this.rng = rng;
    this.players = [];
    this.pattern = DEFAULT_PATTERN;
    this.logSeq = 0;
    this.log = [];
    this.reset(deck);
  }

  // Back to the lobby with the same players and zeroed scores.
  reset(deck = null) {
    this.phase = 'lobby'; // lobby | playing | roundOver | gameOver
    this.round = 0;
    this.sizes = [];
    this.nextDeck = deck ? [...deck] : null;
    this.deck = [];
    this.dealerIndex = -1;
    this.turnId = null;
    this.stage = null; // bid | play
    this.trumpCard = null;
    this.trick = [];
    this.lastTrick = null;
    this.winners = [];
    for (const p of this.players) {
      p.score = 0;
      p.roundScores = [];
      this.clearRound(p);
    }
  }

  get handSize() {
    return this.round > 0 ? this.sizes[this.round - 1] : null;
  }

  get rounds() {
    return this.sizes.length || handSizes(Math.max(this.players.length, MIN_PLAYERS), this.pattern).length;
  }

  get trumpSuit() {
    return this.trumpCard?.suit ?? null;
  }

  get ledSuit() {
    return this.trick[0]?.card.suit ?? null;
  }

  get dealer() {
    return this.players[this.dealerIndex] ?? null;
  }

  // ---- player management -------------------------------------------------

  addPlayer(id, name) {
    if (this.phase !== 'lobby') throw new GameError('A game is already in progress.');
    if (this.players.length >= MAX_PLAYERS) throw new GameError(`The table is full (${MAX_PLAYERS} players).`);
    name = String(name ?? '').trim().slice(0, 16);
    if (!name) throw new GameError('Please enter a name.');
    const p = { id, name, score: 0, roundScores: [] };
    this.clearRound(p);
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

  clearRound(p) {
    p.hand = [];
    p.bid = null;
    p.tricks = 0;
  }

  setPattern(pattern) {
    if (this.phase !== 'lobby') throw new GameError('The deal pattern can only be changed in the lobby.');
    if (!PATTERNS.includes(pattern)) throw new GameError('Unknown deal pattern.');
    this.pattern = pattern;
  }

  // ---- round flow --------------------------------------------------------

  start() {
    if (this.phase !== 'lobby') throw new GameError('The game has already started.');
    if (this.players.length < MIN_PLAYERS) throw new GameError(`Need at least ${MIN_PLAYERS} players.`);
    this.sizes = handSizes(this.players.length, this.pattern);
    this.dealerIndex = Math.floor(this.rng() * this.players.length) - 1; // startRound advances it
    this.startRound();
  }

  nextRound() {
    if (this.phase !== 'roundOver') throw new GameError('The round is not over yet.');
    if (this.players.length < MIN_PLAYERS) throw new GameError(`Need at least ${MIN_PLAYERS} players.`);
    this.startRound();
  }

  seatsFrom(start) {
    const n = this.players.length;
    return Array.from({ length: n }, (_, i) => this.players[(start + i) % n]);
  }

  startRound() {
    this.round++;
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    this.deck = this.nextDeck ?? shuffle(buildDeck(), this.rng);
    this.nextDeck = null;
    this.trick = [];
    this.lastTrick = null;
    for (const p of this.players) this.clearRound(p);
    this.phase = 'playing';
    const size = this.handSize;
    this.addLog(`Round ${this.round} of ${this.sizes.length}: ${size} card${size === 1 ? '' : 's'}, ${this.dealer.name} deals.`);

    // One card at a time from the left of the dealer, then the trump card.
    const order = this.seatsFrom(this.dealerIndex + 1);
    for (let i = 0; i < size; i++) {
      for (const p of order) p.hand.push(this.deck.shift());
    }
    this.trumpCard = this.deck.shift();
    this.addLog(`Trump is ${cardName(this.trumpCard)}.`);
    this.stage = 'bid';
    this.turnId = order[0].id;
  }

  // ---- bidding -----------------------------------------------------------

  get bidTotal() {
    return this.players.reduce((t, p) => t + (p.bid ?? 0), 0);
  }

  // The number the dealer may not bid, while it's the dealer's turn to bid.
  get forbiddenBid() {
    if (this.stage !== 'bid' || this.turnId !== this.dealer?.id) return null;
    const n = this.handSize - this.bidTotal;
    return n >= 0 ? n : null;
  }

  bid(playerId, bid) {
    if (this.phase !== 'playing' || this.stage !== 'bid') throw new GameError('It is not the bidding stage.');
    if (this.turnId !== playerId) throw new GameError('It is not your turn to bid.');
    if (!Number.isInteger(bid) || bid < 0 || bid > this.handSize) {
      throw new GameError(`Bid a whole number from 0 to ${this.handSize}.`);
    }
    if (bid === this.forbiddenBid) {
      throw new GameError(`The dealer cannot bid ${bid}: the bids would add up to the ${this.handSize} tricks.`);
    }
    const p = this.player(playerId);
    p.bid = bid;
    this.addLog(`${p.name} bids ${bid}.`);
    if (this.players.every((q) => q.bid !== null)) {
      this.stage = 'play';
      this.turnId = this.players[(this.dealerIndex + 1) % this.players.length].id;
    } else {
      this.turnId = this.players[(this.seatOf(playerId) + 1) % this.players.length].id;
    }
  }

  // ---- play --------------------------------------------------------------

  // The cards a player may legally play now: the led suit if they hold it.
  playableCards(p) {
    if (this.phase !== 'playing' || this.stage !== 'play' || this.turnId !== p.id) return [];
    const led = this.ledSuit;
    const follow = led ? p.hand.filter((c) => c.suit === led) : [];
    return follow.length ? follow : [...p.hand];
  }

  play(playerId, cardId) {
    if (this.phase !== 'playing' || this.stage !== 'play') throw new GameError('It is not the play stage.');
    if (this.turnId !== playerId) throw new GameError('It is not your turn.');
    const p = this.player(playerId);
    const card = p.hand.find((c) => c.id === cardId);
    if (!card) throw new GameError('You do not hold that card.');
    if (!this.playableCards(p).includes(card)) throw new GameError(`You must follow suit (${this.ledSuit}).`);
    p.hand.splice(p.hand.indexOf(card), 1);
    this.trick.push({ playerId, card });
    this.addLog(`${p.name} plays ${cardName(card)}.`);
    if (this.trick.length < this.players.length) {
      this.turnId = this.players[(this.seatOf(playerId) + 1) % this.players.length].id;
      return;
    }
    this.finishTrick();
  }

  // Highest trump wins; with no trump, the highest card of the led suit.
  trickWinner(plays) {
    const led = plays[0].card.suit;
    const trumps = plays.filter((x) => x.card.suit === this.trumpSuit);
    const pool = trumps.length ? trumps : plays.filter((x) => x.card.suit === led);
    return pool.reduce((a, x) => (x.card.rank > a.card.rank ? x : a)).playerId;
  }

  finishTrick() {
    const winnerId = this.trickWinner(this.trick);
    const winner = this.player(winnerId);
    winner.tricks++;
    this.lastTrick = { plays: this.trick.map((x) => ({ playerId: x.playerId, card: { ...x.card } })), winnerId };
    this.trick = [];
    this.addLog(`${winner.name} wins the trick.`);
    if (winner.hand.length === 0) {
      this.endRound();
    } else {
      this.turnId = winnerId;
    }
  }

  // ---- scoring -----------------------------------------------------------

  endRound() {
    this.turnId = null;
    this.stage = null;
    for (const p of this.players) {
      const made = p.tricks === p.bid;
      const points = p.tricks + (made ? MADE_BID_BONUS : 0);
      p.roundScores.push({ bid: p.bid, tricks: p.tricks, points });
      p.score += points;
    }
    if (this.round >= this.sizes.length) {
      this.phase = 'gameOver';
      const best = Math.max(...this.players.map((p) => p.score));
      this.winners = this.players.filter((p) => p.score === best).map((p) => p.id);
      const names = this.winners.map((id) => this.player(id).name).join(' & ');
      this.addLog(`${names} win${this.winners.length > 1 ? '' : 's'} with ${best} points!`);
    } else {
      this.phase = 'roundOver';
      this.addLog(`Round ${this.round} over.`);
    }
  }

  // ---- views -------------------------------------------------------------

  addLog(text) {
    this.log.push({ id: ++this.logSeq, text });
    if (this.log.length > 50) this.log.shift();
  }

  // Hidden information stays out: only the viewer's own hand, never the
  // undealt cards. The trump card and played cards are public.
  // view(null) is the shared table screen.
  view(playerId) {
    const you = playerId != null ? this.player(playerId) : null;
    const copy = (c) => ({ ...c });
    return {
      phase: this.phase,
      pattern: this.pattern,
      patterns: [...PATTERNS],
      round: this.round,
      rounds: this.rounds,
      handSize: this.handSize,
      dealerId: this.dealer?.id ?? null,
      turnId: this.turnId,
      stage: this.stage,
      trumpCard: this.trumpCard ? copy(this.trumpCard) : null,
      trumpSuit: this.trumpSuit,
      trick: this.trick.map((x) => ({ playerId: x.playerId, card: copy(x.card) })),
      ledSuit: this.ledSuit,
      lastTrick: this.lastTrick
        ? { plays: this.lastTrick.plays.map((x) => ({ playerId: x.playerId, card: copy(x.card) })), winnerId: this.lastTrick.winnerId }
        : null,
      bidTotal: this.bidTotal,
      forbiddenBid: this.forbiddenBid,
      outId: null,
      winners: [...this.winners],
      log: [...this.log],
      you: you
        ? {
            id: you.id,
            hand: [...you.hand].sort(bySuitRank).map(copy),
            playable: this.playableCards(you).map((c) => c.id),
          }
        : null,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected ?? true,
        score: p.score,
        roundScores: p.roundScores.map((s) => ({ ...s })),
        cardCount: p.hand.length,
        bid: p.bid,
        tricks: p.tricks,
      })),
    };
  }
}
