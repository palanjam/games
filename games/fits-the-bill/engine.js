// Fits the Bill rules engine. Pure state machine: no networking, no timers.
//
// A judge reveals a prompt, every other player secretly plays an answer from
// their hand, the judge picks the best match. Answers are shown anonymously
// and shuffled; the names are revealed only after the pick.

import { randomBytes, randomInt } from 'node:crypto';
import { GameError } from '../../server/game-error.js';

export { GameError };

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;
export const HAND_SIZE = 7;
export const MIN_TARGET = 3;
export const MAX_TARGET = 15;

// Points needed to win by player count.
export function defaultTarget(n) {
  if (n <= 4) return 8;
  if (n === 5) return 7;
  if (n === 6) return 6;
  if (n === 7) return 5;
  return 4;
}

export function shuffle(items, rng = Math.random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Display order for the answers: uniform, from crypto, independent of the
// game rng, play order and seat order, so the order says nothing about who
// played what (rejecting play order would itself leak it).
const cryptoRng = () => randomInt(2 ** 47) / 2 ** 47;

// Built-in content. Missing only while cards.js is being written; the
// constructor then needs { prompts, answers }.
const defaultContent = await import('./cards.js').then(
  (m) => ({ prompts: m.PROMPTS, answers: m.ANSWERS }),
  () => ({}),
);

export class Game {
  // `prompts` / `answers` (arrays of strings) override the built-in content.
  constructor({ rng = Math.random, prompts, answers } = {}) {
    this.rng = rng;
    this.promptTexts = prompts ?? defaultContent.prompts;
    this.answerTexts = answers ?? defaultContent.answers;
    if (!this.promptTexts || !this.answerTexts) throw new Error('Fits the Bill has no card content.');
    this.targetOverride = null;
    this.players = [];
    this.logSeq = 0;
    this.log = [];
    this.reset();
  }

  // Back to the lobby with the same players and zeroed scores. A target
  // chosen with setTarget is kept.
  reset() {
    this.phase = 'lobby'; // lobby | playing | roundOver | gameOver
    this.round = 0;
    this.stage = null; // 'submit' | 'judge' | null
    this.judgeIndex = -1;
    this.prompt = null;
    this.answerDeck = [];
    this.answerDiscard = [];
    this.promptDeck = [];
    this.promptDiscard = [];
    this.plays = new Map(); // playerId -> card, this round
    this.playOrder = []; // playerIds in the order they played, this round
    this.submissions = []; // { id, playerId, card }, in display order
    this.result = null;
    this.winners = [];
    for (const p of this.players) this.clearPlayer(p);
  }

  clearPlayer(p) {
    p.hand = [];
    p.won = [];
    p.score = 0;
  }

  // ---- player management -------------------------------------------------

  addPlayer(id, name) {
    if (this.phase !== 'lobby') throw new GameError('A game is already in progress.');
    if (this.players.length >= MAX_PLAYERS) throw new GameError(`The table is full (${MAX_PLAYERS} players).`);
    name = String(name ?? '').trim().slice(0, 16);
    if (!name) throw new GameError('Please enter a name.');
    const p = { id, name };
    this.clearPlayer(p);
    this.players.push(p);
    this.addLog(`${name} joined.`);
    return p;
  }

  removePlayer(id) {
    if (this.phase === 'playing') throw new GameError('Players can only be removed between rounds.');
    const seat = this.seatOf(id);
    if (seat < 0) return;
    const [p] = this.players.splice(seat, 1);
    if (seat <= this.judgeIndex) this.judgeIndex--;
    this.answerDiscard.push(...p.hand);
    this.winners = this.winners.filter((w) => w !== id);
    this.addLog(`${p.name} left.`);
  }

  player(id) {
    return this.players.find((p) => p.id === id);
  }

  seatOf(id) {
    return this.players.findIndex((p) => p.id === id);
  }

  get target() {
    return this.targetOverride ?? defaultTarget(this.players.length);
  }

  get judgeId() {
    return this.phase === 'lobby' ? null : (this.players[this.judgeIndex]?.id ?? null);
  }

  setTarget(target) {
    if (this.phase !== 'lobby') throw new GameError('The target can only be changed in the lobby.');
    const n = Number(target);
    if (!Number.isInteger(n) || n < MIN_TARGET || n > MAX_TARGET) {
      throw new GameError(`The target must be a whole number from ${MIN_TARGET} to ${MAX_TARGET}.`);
    }
    this.targetOverride = n;
  }

  // ---- round flow --------------------------------------------------------

  start() {
    if (this.phase !== 'lobby') throw new GameError('The game has already started.');
    if (this.players.length < MIN_PLAYERS) throw new GameError(`Need at least ${MIN_PLAYERS} players.`);
    this.answerDeck = shuffle(this.answerTexts.map((text, id) => ({ id, text })), this.rng);
    this.promptDeck = shuffle(this.promptTexts.map((text, id) => ({ id, text })), this.rng);
    for (const p of this.players) this.refill(p);
    this.judgeIndex = Math.floor(this.rng() * this.players.length) - 1; // startRound advances it
    this.startRound();
  }

  nextRound() {
    if (this.phase !== 'roundOver') throw new GameError('The round is not over yet.');
    if (this.players.length < MIN_PLAYERS) throw new GameError(`Need at least ${MIN_PLAYERS} players.`);
    this.startRound();
  }

  startRound() {
    this.round++;
    this.judgeIndex = (this.judgeIndex + 1) % this.players.length;
    if (!this.promptDeck.length) {
      this.promptDeck = shuffle(this.promptDiscard, this.rng);
      this.promptDiscard = [];
    }
    this.prompt = this.promptDeck.shift() ?? null;
    if (!this.prompt) throw new GameError('There are no prompt cards.');
    this.plays = new Map();
    this.playOrder = [];
    this.submissions = [];
    this.result = null;
    for (const p of this.players) this.refill(p);
    this.phase = 'playing';
    this.stage = 'submit';
    this.addLog(`Round ${this.round}: ${this.players[this.judgeIndex].name} is judging "${this.prompt.text}".`);
  }

  refill(p) {
    while (p.hand.length < HAND_SIZE) {
      if (!this.answerDeck.length) {
        if (!this.answerDiscard.length) return;
        this.answerDeck = shuffle(this.answerDiscard, this.rng);
        this.answerDiscard = [];
      }
      p.hand.push(this.answerDeck.shift());
    }
  }

  submit(playerId, cardId) {
    if (this.phase !== 'playing' || this.stage !== 'submit') throw new GameError('It is not time to play an answer.');
    const p = this.player(playerId);
    if (!p) throw new GameError('You are not in this game.');
    if (playerId === this.judgeId) throw new GameError('The judge does not play an answer.');
    if (this.plays.has(playerId)) throw new GameError('You have already played an answer.');
    const card = p.hand.find((c) => c.id === cardId);
    if (!card) throw new GameError('That card is not in your hand.');
    p.hand = p.hand.filter((c) => c !== card);
    this.plays.set(playerId, card);
    this.playOrder.push(playerId);
    const needed = this.players.length - 1;
    if (this.playOrder.length === needed) this.beginJudging();
    else this.addLog(`${this.playOrder.length} of ${needed} answers are in.`);
  }

  // Anonymous and in a uniformly random order that does not depend on play
  // order, seat order or the game rng.
  beginJudging() {
    const subs = this.playOrder.map((playerId) => ({
      id: randomBytes(6).toString('hex'),
      playerId,
      card: this.plays.get(playerId),
    }));
    const chosen = shuffle(subs, cryptoRng);
    this.submissions = chosen;
    this.stage = 'judge';
    this.addLog('All answers are in.');
  }

  pick(playerId, submissionId) {
    if (this.phase !== 'playing' || this.stage !== 'judge') throw new GameError('The answers are not all in yet.');
    if (playerId !== this.judgeId) throw new GameError('Only the judge picks.');
    const sub = this.submissions.find((s) => s.id === submissionId);
    if (!sub) throw new GameError('That is not one of the answers.');
    const winner = this.player(sub.playerId);
    winner.won.push(this.prompt.text);
    winner.score = winner.won.length;
    this.result = {
      winnerId: winner.id,
      submissionId: sub.id,
      plays: this.submissions.map((s) => ({ submissionId: s.id, playerId: s.playerId, text: s.card.text })),
    };
    this.addLog(`${winner.name} wins "${this.prompt.text}" with ${sub.card.text}.`);
    this.answerDiscard.push(...this.submissions.map((s) => s.card));
    this.promptDiscard.push(this.prompt);
    this.stage = null;
    for (const p of this.players) if (p.id !== this.judgeId) this.refill(p);
    if (winner.score >= this.target) {
      this.phase = 'gameOver';
      this.winners = [winner.id];
      this.addLog(`${winner.name} wins the game!`);
    } else {
      this.phase = 'roundOver';
    }
  }

  // The board plays for disconnected players. Returns what it did.
  autoplay() {
    if (this.phase !== 'playing') throw new GameError('No round is in progress.');
    if (this.stage === 'submit') {
      const idle = this.players.filter(
        (p) => p.id !== this.judgeId && !this.plays.has(p.id) && !(p.connected ?? true),
      );
      if (!idle.length) throw new GameError('Nobody who is disconnected still has to play.');
      for (const p of idle) {
        if (this.stage !== 'submit') break;
        const card = p.hand[Math.floor(this.rng() * p.hand.length)];
        this.submit(p.id, card.id);
      }
      return;
    }
    const judge = this.player(this.judgeId);
    if (judge.connected ?? true) throw new GameError('The judge is connected.');
    const sub = this.submissions[Math.floor(this.rng() * this.submissions.length)];
    this.pick(judge.id, sub.id);
  }

  // ---- views -------------------------------------------------------------

  addLog(text) {
    this.log.push({ id: ++this.logSeq, text });
    if (this.log.length > 50) this.log.shift();
  }

  // Hidden information stays out: only the viewer's own hand, no deck order,
  // and no link between submissions and players until the pick.
  // view(null) is the shared table screen.
  view(playerId) {
    const you = playerId != null ? this.player(playerId) : null;
    const showSubs = this.stage === 'judge' || this.result != null;
    return {
      phase: this.phase,
      target: this.target,
      round: this.round,
      judgeId: this.judgeId,
      stage: this.stage,
      prompt: this.prompt ? { ...this.prompt } : null,
      // Seat order, so the order of play is not leaked.
      submitted: this.players.filter((p) => this.plays.has(p.id)).map((p) => p.id),
      submissions: showSubs ? this.submissions.map((s) => ({ id: s.id, text: s.card.text })) : [],
      result: this.result
        ? { ...this.result, plays: this.result.plays.map((x) => ({ ...x })) }
        : null,
      winners: [...this.winners],
      log: [...this.log],
      you: you
        ? {
            id: you.id,
            hand: you.hand.map((c) => ({ ...c })),
            submittedId: this.plays.get(you.id)?.id ?? null,
            // The card you played this round (it has left your hand).
            submitted: this.plays.has(you.id) ? { ...this.plays.get(you.id) } : null,
          }
        : null,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected ?? true,
        score: p.score,
        won: [...p.won],
        cardCount: p.hand.length,
      })),
    };
  }
}
