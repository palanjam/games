// Hand and Foot rules engine (house rules: individual play). Pure state
// machine: no networking, no timers. The rules as played are in
// specs/hand-and-foot.md and this game's README.
//
// Four rounds. Everyone gets an 11-card hand and an 11-card foot. A turn is
// draw (3 from the stock, or the top 5 of the discard pile with a meld batch
// that uses the top card), then any number of meld batches, then a discard.
// Each player builds their own piles, at most one per rank; 7+ cards make a
// book. You play your hand, then your foot, and go out by discarding the last
// card of your foot once you hold 2 clean books and 1 dirty book. Highest
// total after round 4 wins.

import { GameError } from '../../server/game-error.js';

export const ROUNDS = 4;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const HAND_SIZE = 11;
export const STOCK_DRAW = 3;
export const PICKUP_COUNT = 5;
export const OPENING_MINIMUMS = [50, 90, 120, 150];
export const BOOK_SIZE = 7;
export const CLEAN_BOOK_BONUS = 500;
export const DIRTY_BOOK_BONUS = 300;
export const GOING_OUT_BONUS = 100;
export const CLEAN_BOOKS_TO_GO_OUT = 2;
export const DIRTY_BOOKS_TO_GO_OUT = 1;
export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];

export { GameError };

const SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const FACES = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export const rankName = (rank) => FACES[rank] ?? String(rank);

export function cardName(card) {
  return card.joker ? 'Joker' : `${rankName(card.rank)}${SUIT_SYMBOLS[card.suit]}`;
}

export const isWild = (card) => card.joker || card.rank === 2;
export const isThree = (card) => !card.joker && card.rank === 3;
export const isRed = (card) => card.suit === 'hearts' || card.suit === 'diamonds';
export const isRedThree = (card) => isThree(card) && isRed(card);

// Face value: used for melds, opening totals and penalties alike.
export function cardValue(card) {
  if (card.joker) return 50;
  if (card.rank === 3) return isRed(card) ? 300 : 5;
  if (card.rank === 2 || card.rank === 14) return 20;
  if (card.rank >= 8) return 10;
  return 5;
}

export const sumValues = (cards) => cards.reduce((t, c) => t + cardValue(c), 0);

// A pile of 7+ cards is a book: clean without wilds, dirty with any.
export function bookType(cards) {
  if (cards.length < BOOK_SIZE) return null;
  return cards.some(isWild) ? 'dirty' : 'clean';
}

// One deck per player plus one, each 52 cards and 2 Jokers; ids 0..n-1.
export function buildDeck(decks) {
  const cards = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (let rank = 2; rank <= 14; rank++) cards.push({ id: cards.length, rank, suit, joker: false });
    }
    for (let j = 0; j < 2; j++) cards.push({ id: cards.length, rank: null, suit: null, joker: true });
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
    this.logSeq = 0;
    this.log = [];
    this.reset(deck);
  }

  // Back to the lobby with the same players and zeroed scores.
  reset(deck = null) {
    this.phase = 'lobby'; // lobby | playing | roundOver | gameOver
    this.round = 0;
    this.nextDeck = deck ? [...deck] : null;
    this.stock = [];
    this.discard = [];
    this.dealerIndex = -1;
    this.turnId = null;
    this.stage = null; // draw | play while a turn is under way
    this.outId = null;
    this.winners = [];
    for (const p of this.players) {
      p.score = 0;
      p.roundScores = [];
      this.clearCards(p);
    }
  }

  get openingMin() {
    return this.round > 0 ? OPENING_MINIMUMS[this.round - 1] : null;
  }

  // ---- player management -------------------------------------------------

  addPlayer(id, name) {
    if (this.phase !== 'lobby') throw new GameError('A game is already in progress.');
    if (this.players.length >= MAX_PLAYERS) throw new GameError(`The table is full (${MAX_PLAYERS} players).`);
    name = String(name ?? '').trim().slice(0, 16);
    if (!name) throw new GameError('Please enter a name.');
    const p = { id, name, score: 0, roundScores: [] };
    this.clearCards(p);
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

  // `hand` is always the cards being played from: the hand, then the foot
  // once picked up. `foot` holds the unseen foot until then.
  clearCards(p) {
    p.hand = [];
    p.foot = [];
    p.inFoot = false;
    p.opened = false;
    p.piles = [];
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

  // Every round is dealt from fresh decks: one per player plus one.
  startRound() {
    this.round++;
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    this.stock = this.nextDeck ?? shuffle(buildDeck(this.players.length + 1), this.rng);
    this.nextDeck = null;
    this.discard = [];
    this.outId = null;
    for (const p of this.players) this.clearCards(p);
    this.phase = 'playing';
    this.addLog(`Round ${this.round} — ${this.players[this.dealerIndex].name} deals. Opening minimum ${this.openingMin}.`);

    // Hands one card at a time from the left of the dealer, then feet the
    // same way, then one card turned up to start the discard pile.
    const order = this.seatsFrom(this.dealerIndex + 1);
    for (const key of ['hand', 'foot']) {
      for (let i = 0; i < HAND_SIZE; i++) {
        for (const p of order) if (this.stock.length) p[key].push(this.stock.shift());
      }
    }
    if (this.stock.length) this.discard.push(this.stock.shift());
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

  passTurn(p) {
    this.setTurn(this.players[(this.seatOf(p.id) + 1) % this.players.length]);
  }

  scoreFor(p) {
    const melded = p.piles.reduce((t, pile) => t + sumValues(pile.cards), 0);
    const { clean, dirty } = this.books(p);
    const bonus = clean * CLEAN_BOOK_BONUS + dirty * DIRTY_BOOK_BONUS;
    const wentOut = p.id === this.outId ? GOING_OUT_BONUS : 0;
    const penalty = sumValues(p.hand) + sumValues(p.foot);
    return { melded, bonus, wentOut, penalty, total: melded + bonus + wentOut - penalty };
  }

  endRound() {
    this.turnId = null;
    this.stage = null;
    for (const p of this.players) {
      const s = this.scoreFor(p);
      p.roundScores.push(s);
      p.score += s.total;
    }
    if (this.round >= ROUNDS) {
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

  // ---- books and piles ---------------------------------------------------

  books(p) {
    let clean = 0;
    let dirty = 0;
    for (const pile of p.piles) {
      const b = bookType(pile.cards);
      if (b === 'clean') clean++;
      else if (b === 'dirty') dirty++;
    }
    return { clean, dirty };
  }

  canGoOut(p) {
    const { clean, dirty } = this.books(p);
    return clean >= CLEAN_BOOKS_TO_GO_OUT && dirty >= DIRTY_BOOKS_TO_GO_OUT;
  }

  get discardTop() {
    return this.discard.at(-1) ?? null;
  }

  get discardBlocked() {
    const top = this.discardTop;
    return !top || isThree(top) || isWild(top);
  }

  // ---- turn actions ------------------------------------------------------

  assertTurn(playerId, stage) {
    if (this.phase !== 'playing') throw new GameError('No round is in progress.');
    if (this.turnId !== playerId) throw new GameError("It's not your turn.");
    if (this.stage !== stage) {
      throw new GameError(stage === 'draw' ? "You've already drawn this turn." : 'Draw first: 3 from the stock or 5 from the discard pile.');
    }
    return this.player(playerId);
  }

  // Draw 3 from the stock (or what is left). Choosing an empty stock ends
  // the round, with no going-out bonus for anyone.
  draw(playerId) {
    const p = this.assertTurn(playerId, 'draw');
    if (!this.stock.length) {
      this.addLog(`The stock is empty: round ${this.round} ends with nobody out.`);
      this.endRound();
      return;
    }
    const drawn = this.stock.splice(0, STOCK_DRAW);
    p.hand.push(...drawn);
    this.addLog(`${p.name} drew ${drawn.length} from the stock.`);
    this.stage = 'play';
  }

  // Take the top 5 of the discard pile (fewer if it is smaller). Not allowed
  // when the top card is a 3 or a wild. The batch must meld the top card;
  // the other cards join the player's cards afterwards.
  pickup(playerId, melds) {
    const p = this.assertTurn(playerId, 'draw');
    const top = this.discardTop;
    if (!top) throw new GameError('The discard pile is empty.');
    if (isThree(top)) throw new GameError("You can't take the discard pile when a 3 is on top.");
    if (isWild(top)) throw new GameError("You can't take the discard pile when a wild card is on top.");
    const taken = this.discard.slice(-PICKUP_COUNT);
    const others = taken.slice(0, -1);
    const plan = this.planMelds(p, melds, top);
    if (!plan.used.has(top)) throw new GameError(`You must meld the ${cardName(top)} from the top of the discard pile.`);
    this.checkLeftover(p, plan, others.length);

    this.discard.splice(-taken.length);
    this.addLog(`${p.name} took ${taken.length} from the discard pile.`);
    this.applyMelds(p, plan);
    p.hand.push(...others);
    this.stage = 'play';
    this.maybePickUpFoot(p);
  }

  meld(playerId, melds) {
    const p = this.assertTurn(playerId, 'play');
    const plan = this.planMelds(p, melds, null);
    this.checkLeftover(p, plan, 0);
    this.applyMelds(p, plan);
    this.maybePickUpFoot(p);
  }

  // Validates a whole batch against a scratch copy of the player's piles and
  // returns what to apply. Nothing changes if any entry is invalid.
  planMelds(p, melds, extra) {
    if (!Array.isArray(melds) || !melds.length) throw new GameError('Choose some cards to lay down.');
    const available = extra ? [...p.hand, extra] : [...p.hand];
    const used = new Set();
    const piles = new Map(p.piles.map((pile) => [pile.rank, [...pile.cards]]));
    const entries = [];
    let total = 0;

    for (const entry of melds) {
      const rank = Number(entry?.rank);
      if (!Number.isInteger(rank) || rank < 4 || rank > 14) {
        throw new GameError(rank === 3 ? '3s can never be laid down.' : 'Piles are made of 4s through Aces.');
      }
      const ids = entry.cardIds;
      if (!Array.isArray(ids) || !ids.length) throw new GameError('Choose some cards to lay down.');
      const cards = ids.map((id) => {
        const card = available.find((c) => String(c.id) === String(id));
        if (!card) throw new GameError("That card isn't in your hand.");
        if (used.has(card)) throw new GameError('You used the same card twice.');
        used.add(card);
        return card;
      });
      const label = `${rankName(rank)}s`;
      for (const c of cards) {
        if (isThree(c)) throw new GameError('3s can never be laid down.');
        if (!isWild(c) && c.rank !== rank) throw new GameError(`The ${cardName(c)} doesn't belong on the ${label}.`);
      }

      const existing = piles.get(rank);
      const wilds = cards.filter(isWild).length;
      if (existing) {
        if (wilds && bookType(existing) === 'clean') throw new GameError(`Your ${label} are a clean book: no wild cards on it.`);
      } else {
        if (cards.length < 3) throw new GameError(`A new pile needs at least 3 cards (${label}).`);
        if (cards.length - wilds < 2) throw new GameError(`A new pile needs at least 2 natural cards (${label}).`);
      }
      const pile = [...(existing ?? []), ...cards];
      const pileWilds = pile.filter(isWild).length;
      if (pile.length - pileWilds <= pileWilds) throw new GameError(`Your ${label} need more natural cards than wild cards.`);
      piles.set(rank, pile);
      entries.push({ rank, cards });
      total += sumValues(cards);
    }

    if (!p.opened && total < this.openingMin) {
      throw new GameError(`Your first lay-down this round must total at least ${this.openingMin} (that's ${total}).`);
    }
    const booksAfter = { clean: 0, dirty: 0 };
    for (const cards of piles.values()) {
      const b = bookType(cards);
      if (b) booksAfter[b]++;
    }
    const canGoOut = booksAfter.clean >= CLEAN_BOOKS_TO_GO_OUT && booksAfter.dirty >= DIRTY_BOOKS_TO_GO_OUT;
    return { entries, used, total, canGoOut };
  }

  // In the foot you always need a card left to discard, and until you have
  // the books to go out, a card to keep after that discard.
  checkLeftover(p, plan, incoming) {
    if (!p.inFoot) return;
    const left = p.hand.filter((c) => !plan.used.has(c)).length + incoming;
    if (left === 0) throw new GameError('Keep a card to discard.');
    if (left < 2 && !plan.canGoOut) {
      throw new GameError("Keep two cards: you can't discard your last card until you have 2 clean books and 1 dirty book.");
    }
  }

  applyMelds(p, plan) {
    p.hand = p.hand.filter((c) => !plan.used.has(c));
    for (const { rank, cards } of plan.entries) {
      let pile = p.piles.find((x) => x.rank === rank);
      if (!pile) {
        pile = { rank, cards: [] };
        p.piles.push(pile);
        p.piles.sort((a, b) => a.rank - b.rank);
      }
      pile.cards.push(...cards);
    }
    if (!p.opened) {
      p.opened = true;
      this.addLog(`${p.name} opened with ${plan.total} points.`);
    }
    const count = plan.entries.reduce((t, e) => t + e.cards.length, 0);
    const where = [...new Set(plan.entries.map((e) => `${rankName(e.rank)}s`))].join(', ');
    this.addLog(`${p.name} laid down ${count} card${count === 1 ? '' : 's'} (${where}).`);
  }

  // A hand emptied by melding is replaced by the foot straight away.
  maybePickUpFoot(p) {
    if (p.inFoot || p.hand.length) return;
    this.pickUpFoot(p);
  }

  pickUpFoot(p) {
    p.hand = p.foot;
    p.foot = [];
    p.inFoot = true;
    this.addLog(`${p.name} picked up their foot.`);
  }

  // Ids arrive from the client as JSON, so compare loosely on their string form.
  handCard(p, cardId) {
    const card = p.hand.find((c) => String(c.id) === String(cardId));
    if (!card) throw new GameError("That card isn't in your hand.");
    return card;
  }

  // Discarding ends the turn. Discarding the last card of the hand picks up
  // the foot (played next turn); discarding the last card of the foot goes
  // out, which needs 2 clean books and 1 dirty book.
  discardCard(playerId, cardId) {
    const p = this.assertTurn(playerId, 'play');
    const card = this.handCard(p, cardId);
    const last = p.hand.length === 1;
    if (last && p.inFoot && !this.canGoOut(p)) {
      throw new GameError("You can't discard your last card until you have 2 clean books and 1 dirty book.");
    }
    p.hand = p.hand.filter((c) => c !== card);
    this.discard.push(card);
    // The card is not named: only the top discard is visible, so players must
    // remember what lies under it.
    this.addLog(`${p.name} discarded.`);
    if (last && p.inFoot) {
      this.outId = p.id;
      this.addLog(`${p.name} goes out!`);
      this.endRound();
      return;
    }
    if (last) this.pickUpFoot(p);
    this.passTurn(p);
  }

  // ---- views -------------------------------------------------------------

  addLog(text) {
    this.log.push({ id: ++this.logSeq, text });
    if (this.log.length > 50) this.log.shift();
  }

  // Hidden information stays out: only the viewer's own playing cards, no
  // foot contents, no stock order, only the discard pile's top card.
  // view(null) is the shared table screen.
  view(playerId) {
    const you = playerId != null ? this.player(playerId) : null;
    return {
      phase: this.phase,
      round: this.round,
      rounds: ROUNDS,
      openingMin: this.openingMin,
      dealerId: this.players[this.dealerIndex]?.id ?? null,
      turnId: this.turnId,
      stage: this.stage,
      stockCount: this.stock.length,
      discardCount: this.discard.length,
      discardTop: this.discardTop ? { ...this.discardTop } : null,
      discardBlocked: this.discardBlocked,
      outId: this.outId,
      winners: [...this.winners],
      log: [...this.log],
      you: you
        ? { id: you.id, cards: you.hand.map((c) => ({ ...c })), inFoot: you.inFoot, footCount: you.foot.length, opened: you.opened }
        : null,
      players: this.players.map((p) => {
        const { clean, dirty } = this.books(p);
        return {
          id: p.id,
          name: p.name,
          connected: p.connected ?? true,
          score: p.score,
          roundScores: p.roundScores.map((s) => ({ ...s })),
          cardCount: p.hand.length,
          footCount: p.foot.length,
          inFoot: p.inFoot,
          opened: p.opened,
          piles: p.piles.map((pile) => ({ rank: pile.rank, cards: pile.cards.map((c) => ({ ...c })), book: bookType(pile.cards) })),
          cleanBooks: clean,
          dirtyBooks: dirty,
          canGoOut: clean >= CLEAN_BOOKS_TO_GO_OUT && dirty >= DIRTY_BOOKS_TO_GO_OUT,
        };
      }),
    };
  }
}
