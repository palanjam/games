// Flip 7 rules engine. Pure state machine: no networking, no timers.
//
// Control flow uses a task stack so that a player decision (choosing who to
// Freeze, who gets a Flip Three, who receives a spare Second Chance) can pause
// the deal or a Flip Three sequence mid-way and resume once the choice is made.

import { GameError } from '../../server/game-error.js';

export const TARGET_SCORE = 200;
export const FLIP7_BONUS = 15;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;

const ACTION_NAMES = { freeze: 'Freeze', flipThree: 'Flip Three', secondChance: 'Second Chance' };

export { GameError };

// 94 cards: 0 x1, 1 x1, 2 x2 ... 12 x12; +2/+4/+6/+8/+10 and x2 once each;
// Freeze, Flip Three and Second Chance three times each.
export function buildDeck() {
  const cards = [];
  const add = (type, value) => cards.push({ id: cards.length, type, value });
  add('number', 0);
  for (let n = 1; n <= 12; n++) for (let i = 0; i < n; i++) add('number', n);
  for (const v of [2, 4, 6, 8, 10]) add('modifier', v);
  add('multiplier', 2);
  for (const a of Object.keys(ACTION_NAMES)) for (let i = 0; i < 3; i++) add('action', a);
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

export function cardLabel(card) {
  switch (card.type) {
    case 'number': return String(card.value);
    case 'modifier': return `+${card.value}`;
    case 'multiplier': return `x${card.value}`;
    default: return ACTION_NAMES[card.value];
  }
}

// Number cards (doubled by x2), then +modifiers, then the Flip 7 bonus.
export function scoreHand(p) {
  if (p.status === 'busted') return 0;
  let total = p.numbers.reduce((s, c) => s + c.value, 0);
  if (p.modifiers.some((c) => c.type === 'multiplier')) total *= 2;
  total += p.modifiers.filter((c) => c.type === 'modifier').reduce((s, c) => s + c.value, 0);
  if (p.numbers.length >= 7) total += FLIP7_BONUS;
  return total;
}

export class Game {
  // `deck` lets tests stack the deck; it is used (in order) for the first round.
  constructor({ rng = Math.random, targetScore = TARGET_SCORE, deck = null } = {}) {
    this.rng = rng;
    this.targetScore = targetScore;
    this.players = [];
    this.waiting = []; // joined after the game started; seated at the next round
    this.logSeq = 0;
    this.log = [];
    this.reset(deck);
  }

  // Back to the lobby with the same players and zeroed scores.
  reset(deck = null) {
    this.phase = 'lobby'; // lobby | playing | roundOver | gameOver
    this.round = 0;
    this.deck = deck ? [...deck] : shuffle(buildDeck(), this.rng);
    this.discard = [];
    this.outOfPlay = []; // a removed player's cards, back in the discard pile next round
    this.dealerIndex = -1;
    this.turnId = null;
    this.pending = null;
    this.tasks = [];
    this.winners = [];
    this.dealerRemoved = false;
    this.resumeSeat = null;
    for (const w of this.waiting) {
      const p = { id: w.id, name: w.name, score: 0 };
      this.clearHand(p);
      this.players.push(p);
    }
    this.waiting = [];
    for (const p of this.players) {
      p.score = 0;
      this.clearHand(p);
    }
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
    const p = { id, name, score: 0 };
    this.clearHand(p);
    this.players.push(p);
    this.addLog(`${name} joined.`);
    return p;
  }

  isWaiting(id) {
    return this.waiting.some((w) => w.id === id);
  }

  // Allowed in every phase. Mid-round the player leaves at once: their cards
  // go out of play and anything waiting on them is resolved or dropped.
  removePlayer(id) {
    const wi = this.waiting.findIndex((w) => w.id === id);
    if (wi >= 0) {
      const [w] = this.waiting.splice(wi, 1);
      this.addLog(`${w.name} was removed from the game.`);
      return;
    }
    const seat = this.seatOf(id);
    if (seat < 0) return;
    const [p] = this.players.splice(seat, 1);
    if (seat <= this.dealerIndex) {
      // The next dealer is whoever now sits in the removed dealer's seat.
      if (seat === this.dealerIndex) this.dealerRemoved = true;
      this.dealerIndex--;
    }
    if (this.phase === 'lobby') {
      this.addLog(`${p.name} left.`);
      return;
    }
    this.addLog(`${p.name} was removed from the game.`);
    if (this.phase === 'gameOver') this.winners = this.winners.filter((w) => w !== id);
    // Their cards leave play for the rest of the round, then rejoin the
    // discard pile when the next round starts (so the deck stays whole).
    this.outOfPlay.push(...p.numbers, ...p.modifiers);
    if (p.secondChance) this.outOfPlay.push(p.secondChance);
    if (p.bustCard) this.outOfPlay.push(p.bustCard);
    if (this.phase !== 'playing') return;

    const wasTurn = this.turnId === id;
    if (wasTurn) {
      this.turnId = null;
      this.resumeSeat = seat;
    } else if (this.turnId === null && this.resumeSeat !== null && seat < this.resumeSeat) {
      this.resumeSeat--;
    }
    const pend = this.pending;
    if (pend) {
      if (pend.chooserId === id) {
        this.discard.push(pend.card);
        this.pending = null;
      } else {
        pend.options = pend.options.filter((o) => o !== id);
        if (!pend.options.length) {
          this.discard.push(pend.card);
          this.pending = null;
        }
      }
    }
    if (this.players.length < MIN_PLAYERS) return this.abandonRound();
    if (wasTurn && !this.pending && !this.tasks.length) this.setTurn(this.nextActiveFrom(seat));
    else this.run();
  }

  abandonRound() {
    this.dropTasks();
    this.turnId = null;
    this.resumeSeat = null;
    for (const p of this.players) p.roundScore = 0;
    this.phase = 'roundOver';
    this.addLog(`Round ${this.round} was abandoned: not enough players.`);
  }

  // Waiting players take the last seats, level with whoever is in last place.
  seatWaiting() {
    if (!this.waiting.length) return;
    const score = this.players.length ? Math.min(...this.players.map((p) => p.score)) : 0;
    for (const w of this.waiting) {
      const p = { id: w.id, name: w.name, score };
      this.clearHand(p);
      this.players.push(p);
      this.addLog(`${w.name} joins with ${score} points.`);
    }
    this.waiting = [];
  }

  player(id) {
    return this.players.find((p) => p.id === id);
  }

  seatOf(id) {
    return this.players.findIndex((p) => p.id === id);
  }

  // ---- player actions ----------------------------------------------------

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

  hit(playerId) {
    this.assertTurn(playerId);
    this.tasks.push({ type: 'nextTurn' }, { type: 'draw', playerId });
    this.run();
  }

  stay(playerId) {
    this.assertTurn(playerId);
    const p = this.player(playerId);
    p.status = 'stayed';
    this.addLog(`${p.name} stays with ${scoreHand(p)}.`);
    this.tasks.push({ type: 'nextTurn' });
    this.run();
  }

  choose(playerId, targetId) {
    const pend = this.pending;
    if (!pend || pend.chooserId !== playerId) throw new GameError('There is nothing for you to choose.');
    if (!pend.options.includes(targetId)) throw new GameError('That player cannot be chosen.');
    this.pending = null;
    const chooser = this.player(playerId);
    if (pend.kind === 'secondChance') this.giveSecondChance(chooser, pend.card, targetId);
    else this.applyAction(chooser, pend.card, targetId);
    this.run();
  }

  assertTurn(playerId) {
    if (this.phase !== 'playing') throw new GameError('No round is in progress.');
    if (this.pending) throw new GameError('Waiting for a choice to be made.');
    if (this.turnId !== playerId) throw new GameError("It's not your turn.");
  }

  // ---- round flow --------------------------------------------------------

  clearHand(p) {
    p.numbers = [];
    p.modifiers = [];
    p.secondChance = null;
    p.bustCard = null;
    p.status = 'waiting'; // waiting | active | stayed | frozen | busted | flip7
    p.roundScore = 0;
  }

  startRound() {
    this.round++;
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    this.dealerRemoved = false;
    this.discard.push(...this.outOfPlay);
    this.outOfPlay = [];
    for (const p of this.players) {
      this.discard.push(...p.numbers, ...p.modifiers);
      if (p.secondChance) this.discard.push(p.secondChance);
      if (p.bustCard) this.discard.push(p.bustCard);
      this.clearHand(p);
      p.status = 'active';
    }
    this.phase = 'playing';
    this.turnId = null;
    this.pending = null;
    this.addLog(`Round ${this.round} — ${this.players[this.dealerIndex].name} deals.`);

    // Deal one card to each player, starting left of the dealer, then begin turns.
    const order = this.seatsFrom(this.dealerIndex + 1);
    this.tasks = [{ type: 'startTurns' }, ...order.reverse().map((p) => ({ type: 'draw', playerId: p.id }))];
    this.run();
  }

  seatsFrom(start) {
    const n = this.players.length;
    return Array.from({ length: n }, (_, i) => this.players[(start + i) % n]);
  }

  nextActiveFrom(start) {
    return this.seatsFrom(start).find((p) => p.status === 'active') ?? null;
  }

  run() {
    while (this.phase === 'playing' && !this.pending && this.tasks.length) {
      const t = this.tasks.pop();
      switch (t.type) {
        case 'draw': this.execDraw(t); break;
        case 'action': this.execAction(t); break;
        case 'flipThreeEnd': this.execFlipThreeEnd(t); break;
        case 'startTurns': this.setTurn(this.nextActiveFrom(this.dealerIndex + 1)); break;
        case 'nextTurn': {
          const seat = this.seatOf(this.turnId);
          this.setTurn(this.nextActiveFrom(seat >= 0 ? seat + 1 : this.resumeSeat ?? 0));
          break;
        }
      }
    }
  }

  setTurn(p) {
    if (!p) return this.endRound();
    this.turnId = p.id;
    this.resumeSeat = null;
  }

  drawCard() {
    if (!this.deck.length) {
      if (!this.discard.length) return null;
      this.deck = shuffle(this.discard, this.rng);
      this.discard = [];
      this.addLog('Deck ran out — discard pile shuffled in.');
    }
    return this.deck.shift();
  }

  // `ctx` is set while resolving a Flip Three: Freeze / Flip Three drawn
  // during it are held until all three cards are flipped.
  execDraw({ playerId, ctx }) {
    const p = this.player(playerId);
    if (!p || p.status !== 'active') return;
    const card = this.drawCard();
    if (!card) {
      this.addLog('No cards left to draw!');
      return this.endRound();
    }
    switch (card.type) {
      case 'number':
        if (p.numbers.some((c) => c.value === card.value)) {
          if (p.secondChance) {
            this.discard.push(card, p.secondChance);
            p.secondChance = null;
            this.addLog(`${p.name} drew a second ${card.value} — saved by Second Chance!`);
          } else {
            p.status = 'busted';
            p.bustCard = card;
            this.addLog(`${p.name} drew a second ${card.value} and BUSTED!`);
          }
        } else {
          p.numbers.push(card);
          this.addLog(`${p.name} drew ${card.value}.`);
          if (p.numbers.length >= 7) {
            p.status = 'flip7';
            this.addLog(`${p.name} FLIPPED 7! +${FLIP7_BONUS} bonus.`);
            this.endRound();
          }
        }
        break;
      case 'modifier':
      case 'multiplier':
        p.modifiers.push(card);
        this.addLog(`${p.name} drew ${cardLabel(card)}.`);
        break;
      case 'action':
        this.addLog(`${p.name} drew ${cardLabel(card)}!`);
        if (card.value === 'secondChance') this.receiveSecondChance(p, card);
        else if (ctx) ctx.deferred.push(card);
        else this.tasks.push({ type: 'action', playerId, card });
        break;
    }
  }

  execAction({ playerId, card }) {
    const p = this.player(playerId);
    if (!p) return this.discard.push(card);
    const options = this.players.filter((q) => q.status === 'active').map((q) => q.id);
    if (!options.length) return this.discard.push(card);
    if (options.length === 1) return this.applyAction(p, card, options[0]);
    this.pending = { kind: 'target', card, chooserId: p.id, options };
  }

  applyAction(chooser, card, targetId) {
    const target = this.player(targetId);
    const who = target === chooser ? 'themselves' : target.name;
    this.discard.push(card);
    if (card.value === 'freeze') {
      target.status = 'frozen';
      this.addLog(`${chooser.name} froze ${who} — banked ${scoreHand(target)}.`);
    } else {
      this.addLog(`${chooser.name} gave ${who} a Flip Three!`);
      const ctx = { deferred: [] };
      const draw = { type: 'draw', playerId: targetId, ctx };
      this.tasks.push({ type: 'flipThreeEnd', playerId: targetId, ctx }, draw, draw, draw);
    }
  }

  execFlipThreeEnd({ playerId, ctx }) {
    const p = this.player(playerId);
    if (p?.status === 'active') {
      for (const card of [...ctx.deferred].reverse()) this.tasks.push({ type: 'action', playerId, card });
    } else {
      this.discard.push(...ctx.deferred);
    }
  }

  // A player may hold only one Second Chance; extras go to another active
  // player without one, or are discarded if nobody qualifies.
  receiveSecondChance(p, card) {
    if (!p.secondChance) {
      p.secondChance = card;
      return;
    }
    const options = this.players
      .filter((q) => q !== p && q.status === 'active' && !q.secondChance)
      .map((q) => q.id);
    if (!options.length) {
      this.discard.push(card);
      this.addLog(`Nobody can take the extra Second Chance — discarded.`);
    } else if (options.length === 1) {
      this.giveSecondChance(p, card, options[0]);
    } else {
      this.pending = { kind: 'secondChance', card, chooserId: p.id, options };
    }
  }

  giveSecondChance(giver, card, targetId) {
    const target = this.player(targetId);
    target.secondChance = card;
    this.addLog(`${giver.name} gave a Second Chance to ${target.name}.`);
  }

  // Ends any unfinished work, discarding the action cards it still held (a
  // pending card, queued actions, cards held back during a Flip Three).
  dropTasks() {
    if (this.pending) this.discard.push(this.pending.card);
    for (const t of this.tasks) {
      if (t.type === 'action') this.discard.push(t.card);
      else if (t.type === 'flipThreeEnd') this.discard.push(...t.ctx.deferred);
    }
    this.tasks = [];
    this.pending = null;
  }

  endRound() {
    this.dropTasks();
    this.turnId = null;
    for (const p of this.players) {
      p.roundScore = scoreHand(p);
      p.score += p.roundScore;
    }
    const best = Math.max(...this.players.map((p) => p.score));
    if (best >= this.targetScore) {
      this.phase = 'gameOver';
      this.winners = this.players.filter((p) => p.score === best).map((p) => p.id);
      const names = this.winners.map((id) => this.player(id).name).join(' & ');
      this.addLog(`${names} win${this.winners.length > 1 ? '' : 's'} with ${best} points!`);
    } else {
      this.phase = 'roundOver';
      this.addLog(`Round ${this.round} over.`);
    }
  }

  addLog(text) {
    this.log.push({ id: ++this.logSeq, text });
    if (this.log.length > 50) this.log.shift();
  }

  // Everything in Flip 7 is face up, so every client gets the same view.
  view() {
    return this.toJSON();
  }

  toJSON() {
    return {
      phase: this.phase,
      round: this.round,
      targetScore: this.targetScore,
      dealerId: this.dealerRemoved ? null : this.players[this.dealerIndex]?.id ?? null,
      waiting: this.waiting.map((w) => ({ id: w.id, name: w.name })),
      turnId: this.turnId,
      pending: this.pending && { ...this.pending, label: cardLabel(this.pending.card) },
      deckCount: this.deck.length,
      discardCount: this.discard.length,
      winners: this.winners,
      log: this.log,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected ?? true,
        score: p.score,
        status: p.status,
        numbers: p.numbers,
        modifiers: p.modifiers,
        secondChance: p.secondChance,
        bustCard: p.bustCard,
        handScore: scoreHand(p),
        roundScore: p.roundScore,
      })),
    };
  }
}
