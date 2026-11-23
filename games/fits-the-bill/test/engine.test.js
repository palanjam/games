import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameError, HAND_SIZE, defaultTarget, shuffle } from '../engine.js';
import fitsTheBill from '../index.js';

const prompts = Array.from({ length: 40 }, (_, i) => `prompt ${i}`);
const answers = Array.from({ length: 200 }, (_, i) => `answer ${i}`);

// rng () => 0 makes seat 0 the first judge.
function setup({ n = 4, rng = () => 0, answers: a = answers } = {}) {
  const g = new Game({ rng, prompts, answers: a });
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  for (const id of ids) g.addPlayer(id, id);
  g.start();
  return { g, ids };
}
const nonJudges = (g) => g.players.filter((p) => p.id !== g.judgeId);
const playAll = (g) => {
  for (const p of nonJudges(g)) g.submit(p.id, p.hand[0].id);
};
const throwsGame = (fn) => assert.throws(fn, GameError);
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('targets by player count', () => {
  const expected = { 3: 8, 4: 8, 5: 7, 6: 6, 7: 5, 8: 4, 9: 4, 10: 4 };
  for (const [n, t] of Object.entries(expected)) {
    assert.equal(defaultTarget(Number(n)), t);
    const { g } = setup({ n: Number(n) });
    assert.equal(g.view(null).target, t);
  }
});

test('setTarget works in the lobby only, within 3-15', () => {
  const g = new Game({ prompts, answers });
  for (const id of ['a', 'b', 'c']) g.addPlayer(id, id);
  g.setTarget(3);
  assert.equal(g.view(null).target, 3);
  g.setTarget('15');
  assert.equal(g.target, 15);
  for (const bad of [2, 16, 4.5, 'x', null]) throwsGame(() => g.setTarget(bad));
  g.start();
  throwsGame(() => g.setTarget(5));
  g.reset();
  assert.equal(g.target, 15, 'kept after reset');
});

test('needs 3 to 10 players', () => {
  const g = new Game({ prompts, answers });
  g.addPlayer('a', 'a');
  g.addPlayer('b', 'b');
  throwsGame(() => g.start());
  for (let i = 2; i < 10; i++) g.addPlayer(`x${i}`, 'x');
  throwsGame(() => g.addPlayer('late', 'late'));
});

test('deal: 7 answers each, first judge from rng, judge passes left', () => {
  const { g, ids } = setup({ n: 3 });
  for (const p of g.players) assert.equal(p.hand.length, HAND_SIZE);
  assert.equal(g.judgeId, 'p0');
  playAll(g);
  g.pick('p0', g.view('p0').submissions[0].id);
  g.nextRound();
  assert.equal(g.judgeId, 'p1');
  playAll(g);
  g.pick('p1', g.view('p1').submissions[0].id);
  g.nextRound();
  assert.equal(g.judgeId, 'p2');
  playAll(g);
  g.pick('p2', g.view('p2').submissions[0].id);
  g.nextRound();
  assert.equal(g.judgeId, ids[0]);

  const { g: g2 } = setup({ n: 4, rng: () => 0.6 });
  assert.equal(g2.judgeId, 'p2');
});

test('judge cannot submit; others submit once, from their own hand', () => {
  const { g } = setup();
  const judge = g.player('p0');
  throwsGame(() => g.submit('p0', judge.hand[0].id));
  const p1 = g.player('p1');
  const other = g.player('p2').hand[0].id;
  throwsGame(() => g.submit('p1', other));
  throwsGame(() => g.submit('p1', 99999));
  const card = p1.hand[0];
  g.submit('p1', card.id);
  throwsGame(() => g.submit('p1', p1.hand[0].id));
  assert.equal(p1.hand.length, HAND_SIZE - 1);
  assert.equal(g.view('p1').you.submittedId, card.id);
  assert.equal(g.view('p2').you.submittedId, null);
  assert.deepEqual(g.view(null).submitted, ['p1']);
});

test('view.you.submitted carries the played card, which has left the hand', () => {
  const { g } = setup();
  const card = { ...g.player('p1').hand[0] };
  assert.equal(g.view('p1').you.submitted, null);
  g.submit('p1', card.id);
  const you = g.view('p1').you;
  assert.deepEqual(you.submitted, card);
  assert.ok(!you.hand.some((c) => c.id === card.id));
  assert.equal(g.view('p2').you.submitted, null);
});

test('card id 0 played still counts as submitted', () => {
  const { g } = setup();
  const p1 = g.player('p1');
  p1.hand[0].id = 0; // force the edge case the phone checks against
  g.submit('p1', 0);
  assert.equal(g.view('p1').you.submittedId, 0);
  assert.notEqual(g.view('p1').you.submittedId, null);
});

test('judging starts only once every non-judge is in', () => {
  const { g } = setup();
  const [a, b, c] = nonJudges(g);
  g.submit(a.id, a.hand[0].id);
  g.submit(b.id, b.hand[0].id);
  assert.equal(g.stage, 'submit');
  assert.deepEqual(g.view('p0').submissions, []);
  throwsGame(() => g.pick('p0', 'anything'));
  g.submit(c.id, c.hand[0].id);
  assert.equal(g.stage, 'judge');
  assert.equal(g.view('p0').submissions.length, 3);
  throwsGame(() => g.submit(a.id, a.hand[0].id));
});

test('submissions are anonymous: no player ids in any view before the pick', () => {
  const { g } = setup({ n: 5 });
  playAll(g);
  const ids = g.players.map((p) => p.id);
  for (const viewer of [null, ...ids]) {
    const v = g.view(viewer);
    assert.equal(v.result, null);
    assert.ok(v.submissions.length === 4);
    for (const s of v.submissions) assert.deepEqual(Object.keys(s).sort(), ['id', 'text']);
    const json = JSON.stringify({ submissions: v.submissions, log: v.log });
    // Submission ids and the log never name a player alongside an answer.
    for (const s of v.submissions) for (const id of ids) assert.ok(!s.id.includes(id));
    for (const l of v.log) for (const p of g.players) assert.ok(!l.text.includes(p.hand[0]?.text) || !/answer \d/.test(l.text));
    assert.ok(!/played answer \d/.test(json));
  }
  // The log never reveals which card was played.
  const texts = [...g.plays.values()].map((c) => c.text);
  for (const l of g.view(null).log) for (const t of texts) assert.ok(!l.text.includes(t));
});

// Play the non-judges in the given order; return who is behind each shown answer.
function playInOrder(g, order) {
  const plays = new Map();
  for (const id of order) {
    const card = g.player(id).hand[0];
    plays.set(card.text, id);
    g.submit(id, card.id);
  }
  return g.view('p0').submissions.map((s) => plays.get(s.text));
}
const key = (ids) => ids.join(',');

test('the log only counts answers in, never who played', () => {
  const { g } = setup({ n: 5 });
  const order = nonJudges(g).map((p) => p.id);
  const before = g.logSeq;
  for (const id of order) g.submit(id, g.player(id).hand[0].id);
  const texts = g.view(null).log.filter((l) => l.id > before).map((l) => l.text);
  assert.equal(texts.length, 4);
  for (const t of texts) for (const p of g.players) assert.ok(!t.includes(p.name), t);
  assert.ok(texts.includes('1 of 4 answers are in.'));
  assert.ok(texts.includes('3 of 4 answers are in.'));
  assert.ok(texts.includes('All answers are in.'));
});

test('display order is not play order for a stacked rng', () => {
  // rng () => 0.999 makes a Fisher-Yates shuffle the identity, so an order
  // drawn from the game rng would equal play order every time.
  const identity = () => 0.999;
  assert.deepEqual(shuffle([1, 2, 3, 4], identity), [1, 2, 3, 4]);
  for (const n of [3, 4]) {
    const seen = new Map();
    const trials = 300;
    for (let i = 0; i < trials; i++) {
      const { g } = setup({ n, rng: identity });
      const order = nonJudges(g).map((p) => p.id);
      const shown = playInOrder(g, order);
      assert.equal(new Set(shown).size, n - 1);
      seen.set(key(shown), (seen.get(key(shown)) ?? 0) + 1);
    }
    const perms = n === 3 ? 2 : 6;
    assert.equal(seen.size, perms, `every order appears for ${n} players`);
  }
});

test('3 players: the display order is not fixed by play order', () => {
  // Over several rng seeds and both play orders, the first-played answer is
  // shown first about half the time; it is never forced either way.
  let firstShownFirst = 0;
  let total = 0;
  for (const rng of [() => 0, () => 0.5, () => 0.999, mulberry32(1), mulberry32(7), mulberry32(42)]) {
    for (let i = 0; i < 100; i++) {
      const { g } = setup({ n: 3, rng });
      const order = nonJudges(g).map((p) => p.id);
      if (i % 2) order.reverse();
      const shown = playInOrder(g, order);
      if (shown[0] === order[0]) firstShownFirst++;
      total++;
    }
  }
  // 600 fair coin flips: mean 300, sd about 12.
  assert.ok(firstShownFirst > 220 && firstShownFirst < 380, `${firstShownFirst} of ${total}`);
});

test('4 players: play order and its rotations are not over- or under-represented', () => {
  const counts = new Map();
  const trials = 1200;
  for (let i = 0; i < trials; i++) {
    const { g } = setup({ n: 4, rng: mulberry32(i) });
    const order = nonJudges(g).map((p) => p.id);
    const shown = playInOrder(g, order);
    // Express the shown order relative to play order (0 = first played).
    const rel = key(shown.map((id) => order.indexOf(id)));
    counts.set(rel, (counts.get(rel) ?? 0) + 1);
  }
  assert.equal(counts.size, 6);
  // Expected 200 each, sd about 13.
  for (const [rel, c] of counts) assert.ok(c > 140 && c < 260, `${rel}: ${c}`);
});

test('submission ids are opaque and unique', () => {
  // Submission ids are opaque and unique.
  const { g } = setup();
  playAll(g);
  const subIds = g.view(null).submissions.map((s) => s.id);
  assert.equal(new Set(subIds).size, 3);
  for (const id of subIds) assert.match(id, /^[0-9a-f]{12}$/);
});

test('pick awards the point and reveals who played what', () => {
  const { g } = setup();
  const plays = new Map();
  for (const p of nonJudges(g)) {
    plays.set(p.hand[0].text, p.id);
    g.submit(p.id, p.hand[0].id);
  }
  const subs = g.view('p0').submissions;
  throwsGame(() => g.pick('p1', subs[0].id));
  throwsGame(() => g.pick('p0', 'nope'));
  const choice = subs[1];
  const prompt = g.view(null).prompt.text;
  g.pick('p0', choice.id);
  const v = g.view(null);
  assert.equal(g.phase, 'roundOver');
  assert.equal(v.stage, null);
  assert.equal(v.result.winnerId, plays.get(choice.text));
  assert.equal(v.result.submissionId, choice.id);
  assert.equal(v.result.plays.length, 3);
  for (const x of v.result.plays) assert.equal(plays.get(x.text), x.playerId);
  const winner = v.players.find((p) => p.id === v.result.winnerId);
  assert.equal(winner.score, 1);
  assert.deepEqual(winner.won, [prompt]);
  assert.equal(v.players.filter((p) => p.score > 0).length, 1);
  throwsGame(() => g.pick('p0', choice.id));
  throwsGame(() => g.submit('p1', g.player('p1').hand[0].id));
});

test('nextRound only from roundOver, and refills hands to 7', () => {
  const { g } = setup();
  throwsGame(() => g.nextRound());
  playAll(g);
  g.pick('p0', g.view(null).submissions[0].id);
  for (const p of g.players) assert.equal(p.hand.length, HAND_SIZE);
  g.nextRound();
  assert.equal(g.phase, 'playing');
  assert.equal(g.stage, 'submit');
  assert.equal(g.view(null).result, null);
  assert.deepEqual(g.view(null).submitted, []);
});

test('discards are reshuffled into a new answer deck', () => {
  // 4 players x 7 = 28 dealt; 32 answers leaves 4 in the deck.
  const small = Array.from({ length: 32 }, (_, i) => `a${i}`);
  const { g } = setup({ answers: small });
  assert.equal(g.answerDeck.length, 4);
  const seen = new Set();
  for (let r = 0; r < 4; r++) {
    playAll(g);
    g.pick(g.judgeId, g.view(null).submissions[0].id);
    for (const p of g.players) assert.equal(p.hand.length, HAND_SIZE, `round ${r}`);
    const all = g.players.flatMap((p) => p.hand.map((c) => c.id)).concat(g.answerDeck.map((c) => c.id), g.answerDiscard.map((c) => c.id));
    assert.equal(new Set(all).size, 32, 'no card lost or duplicated');
    all.forEach((x) => seen.add(x));
    if (g.phase === 'gameOver') break;
    g.nextRound();
  }
  assert.ok(g.answerDiscard.length < 12, 'discards were recycled');
});

test('first to the target wins at once', () => {
  const { g } = setup({ n: 3 });
  g.reset();
  g.setTarget(3);
  g.start();
  let rounds = 0;
  while (g.phase !== 'gameOver') {
    assert.ok(rounds++ < 20);
    playAll(g);
    // Always pick p1's answer if present, else p2's.
    const target = g.judgeId === 'p1' ? 'p2' : 'p1';
    const sub = [...g.submissions].find((s) => s.playerId === target);
    g.pick(g.judgeId, sub.id);
    if (g.phase === 'roundOver') g.nextRound();
  }
  const v = g.view(null);
  assert.equal(v.winners.length, 1);
  assert.equal(v.players.find((p) => p.id === v.winners[0]).score, 3);
  assert.equal(v.stage, null);
  assert.ok(v.result);
  throwsGame(() => g.nextRound());
  g.reset();
  assert.equal(g.phase, 'lobby');
  assert.ok(g.players.every((p) => p.score === 0 && p.won.length === 0));
});

test('autoplay plays for disconnected non-judges only', () => {
  const { g } = setup();
  throwsGame(() => g.autoplay());
  g.player('p1').connected = false;
  g.player('p2').connected = true;
  g.player('p3').connected = true;
  g.player('p0').connected = true;
  fitsTheBill.actions.autoplay(g);
  assert.deepEqual(g.view(null).submitted, ['p1']);
  assert.equal(g.stage, 'submit');
  throwsGame(() => g.autoplay());
  g.submit('p2', g.player('p2').hand[0].id);
  g.submit('p3', g.player('p3').hand[0].id);
  assert.equal(g.stage, 'judge');
  throwsGame(() => g.autoplay(), 'judge is connected');
  g.player('p0').connected = false;
  g.autoplay();
  assert.equal(g.phase, 'roundOver');
  assert.ok(g.result);
});

test('autoplay plays for every disconnected player at once and can finish the submit stage', () => {
  const { g } = setup();
  for (const p of g.players) p.connected = false;
  g.autoplay();
  assert.equal(g.stage, 'judge');
});

test('views hide other hands and the decks', () => {
  const { g } = setup();
  const v = g.view('p1');
  assert.deepEqual(v.you.hand, g.player('p1').hand);
  const json = JSON.stringify(v);
  for (const c of g.player('p2').hand) assert.ok(!json.includes(`"text":"${c.text}"`) || v.prompt.text === c.text);
  for (const c of g.answerDeck.slice(0, 20)) assert.ok(!json.includes(`"${c.text}"`));
  assert.equal(v.players.find((p) => p.id === 'p2').cardCount, HAND_SIZE);
  assert.equal(g.view(null).you, null);
  assert.ok(!('hand' in v.players[0]));
  assert.ok(!('answerDeck' in v) && !('deck' in v));
});

test('players can be removed between rounds', () => {
  const { g } = setup({ n: 4 });
  playAll(g);
  g.pick('p0', g.view(null).submissions[0].id);
  g.removePlayer('p0');
  assert.equal(g.players.length, 3);
  g.nextRound();
  assert.equal(g.judgeId, 'p1');
});

// Play the current round out with whoever is seated, then keep going.
function finishRound(g) {
  if (g.stage === 'submit') playAll(g);
  assert.equal(g.stage, 'judge');
  g.pick(g.judgeId, g.view(null).submissions[0].id);
}
const handIds = (g) => g.players.flatMap((p) => p.hand.map((c) => c.id));

test('joining mid-round goes to waiting, shows in the view and counts for capacity', () => {
  const { g } = setup({ n: 4 });
  g.addPlayer('late', 'Late');
  assert.ok(g.isWaiting('late'));
  assert.deepEqual(g.view(null).waiting, [{ id: 'late', name: 'Late' }]);
  assert.deepEqual(g.view('p1').waiting, [{ id: 'late', name: 'Late' }]);
  assert.equal(g.players.length, 4);
  assert.ok(g.log.at(-1).text.includes('Late will join next round.'));
  throwsGame(() => g.addPlayer('x', '  '));
  for (let i = 0; i < 5; i++) g.addPlayer(`w${i}`, 'w');
  throwsGame(() => g.addPlayer('over', 'over'));
  assert.equal(g.waiting.length, 6);
});

test('the next round seats waiting players with last place score; the target stays fixed', () => {
  const { g } = setup({ n: 3 });
  const target = g.target;
  g.addPlayer('late', 'Late');
  assert.equal(g.target, target);
  finishRound(g); // someone has 1 point, two have 0
  g.addPlayer('late2', 'Late2');
  g.nextRound();
  assert.deepEqual(g.players.map((p) => p.id).slice(-2), ['late', 'late2']);
  const late = g.player('late');
  assert.equal(late.score, 0);
  assert.equal(late.won.length, 0);
  assert.equal(late.hand.length, HAND_SIZE);
  assert.deepEqual(g.waiting, []);
  assert.equal(g.target, target, 'five players now but the target is fixed');
  assert.ok(g.log.some((l) => l.text === 'Late joins with 0 points.'));
  // Round 2 judge is seat after round 1's: the new seats come last.
  assert.equal(g.judgeId, 'p1');
  playAll(g);
  assert.equal(g.stage, 'judge');
  assert.equal(g.view(null).submissions.length, 4);
});

test('a late joiner starts level with the lowest score, not at zero', () => {
  const { g } = setup({ n: 3 });
  for (let r = 0; r < 3; r++) {
    // Always pick a play by p1 or p2 when possible so everybody ends up > 0.
    playAll(g);
    const sub = g.submissions.find((s) => s.playerId !== g.judgeId && s.playerId === g.players[(g.judgeIndex + 1) % 3].id);
    g.pick(g.judgeId, sub.id);
    g.nextRound();
  }
  const low = Math.min(...g.players.map((p) => p.score));
  assert.ok(low >= 1);
  g.addPlayer('late', 'Late');
  finishRound(g);
  const low2 = Math.min(...g.players.map((p) => p.score));
  g.nextRound();
  assert.equal(g.player('late').score, low2);
  assert.equal(g.player('late').won.length, 0);
});

test('nextRound counts waiting players toward the minimum', () => {
  const { g } = setup({ n: 3 });
  finishRound(g);
  g.removePlayer('p2');
  throwsGame(() => g.nextRound());
  g.addPlayer('late', 'Late');
  g.nextRound();
  assert.equal(g.players.length, 3);
});

test('reset seats waiting players at zero', () => {
  const { g } = setup({ n: 3 });
  g.addPlayer('late', 'Late');
  finishRound(g);
  g.reset();
  assert.equal(g.phase, 'lobby');
  assert.deepEqual(g.waiting, []);
  assert.equal(g.player('late').score, 0);
  assert.equal(g.players.length, 4);
  g.start();
  assert.equal(g.target, defaultTarget(4));
});

test('removing a waiting player changes nothing else', () => {
  const { g } = setup({ n: 3 });
  g.addPlayer('late', 'Late');
  const before = g.players.map((p) => p.id);
  g.removePlayer('late');
  assert.deepEqual(g.waiting, []);
  assert.deepEqual(g.players.map((p) => p.id), before);
  assert.equal(g.phase, 'playing');
  assert.equal(g.stage, 'submit');
});

test('removing a non-judge who has played during submit discards their answer and play continues', () => {
  const { g } = setup({ n: 5 });
  g.submit('p1', g.player('p1').hand[0].id);
  const played = g.plays.get('p1');
  g.removePlayer('p1');
  assert.equal(g.players.length, 4);
  assert.ok(g.answerDiscard.includes(played));
  assert.ok(!g.view(null).submitted.includes('p1'));
  finishRound(g);
  assert.equal(g.phase, 'roundOver');
  assert.ok(!handIds(g).includes(played.id));
});

test('removing the last non-judge who had not played starts judging', () => {
  const { g } = setup({ n: 4 });
  g.submit('p1', g.player('p1').hand[0].id);
  g.submit('p2', g.player('p2').hand[0].id);
  g.removePlayer('p3');
  assert.equal(g.stage, 'judge');
  assert.equal(g.view(null).submissions.length, 2);
  g.pick('p0', g.view(null).submissions[0].id);
  assert.equal(g.phase, 'roundOver');
});

test('removing a seat before the judge keeps the judge and the rotation', () => {
  const { g } = setup({ n: 5, rng: () => 0.5 }); // judge is seat 2
  assert.equal(g.judgeId, 'p2');
  g.removePlayer('p0');
  assert.equal(g.judgeId, 'p2');
  finishRound(g);
  g.nextRound();
  assert.equal(g.judgeId, 'p3');
});

test('removing a non-judge in the judge stage removes their submission', () => {
  const { g } = setup({ n: 4 });
  playAll(g);
  const sub = g.submissions.find((s) => s.playerId === 'p2');
  g.removePlayer('p2');
  assert.equal(g.stage, 'judge');
  const subs = g.view(null).submissions;
  assert.equal(subs.length, 2);
  assert.ok(!subs.some((s) => s.id === sub.id));
  g.pick('p0', subs[0].id);
  assert.equal(g.phase, 'roundOver');
  g.nextRound();
  assert.equal(g.round, 2);
});

test('removing the judge cancels the round and returns answers to hands', () => {
  const { g } = setup({ n: 4 });
  const prompt = g.prompt;
  g.submit('p1', g.player('p1').hand[0].id);
  g.removePlayer('p0');
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.result, null);
  assert.equal(g.stage, null);
  assert.ok(g.promptDiscard.includes(prompt));
  assert.equal(g.player('p1').hand.length, HAND_SIZE);
  assert.ok(g.log.some((l) => l.text === 'The judge left: round 1 is cancelled.'));
  g.nextRound();
  assert.equal(g.judgeId, 'p1', 'the judge role passes to whoever followed them');
  finishRound(g);
  assert.equal(g.phase, 'roundOver');
});

test('removing the judge in the judge stage cancels the round too', () => {
  const { g } = setup({ n: 4 });
  playAll(g);
  g.removePlayer('p0');
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.view(null).submissions.length, 0);
  for (const id of ['p1', 'p2', 'p3']) assert.equal(g.player(id).hand.length, HAND_SIZE);
  g.nextRound();
  finishRound(g);
});

test('the judge seat at the end of the order rotates correctly after removal', () => {
  const { g } = setup({ n: 4, rng: () => 0.99 }); // judge is the last seat
  assert.equal(g.judgeId, 'p3');
  g.removePlayer('p3');
  g.nextRound();
  assert.equal(g.judgeId, 'p0');
  finishRound(g);
});

test('removing down to one player abandons the round', () => {
  const { g } = setup({ n: 3 });
  g.removePlayer('p1');
  assert.equal(g.phase, 'playing');
  g.removePlayer('p2');
  assert.equal(g.phase, 'roundOver');
  assert.equal(g.result, null);
  assert.ok(g.log.some((l) => l.text === 'Round 1 was abandoned: not enough players.'));
  assert.equal(g.players.every((p) => p.score === 0), true);
  throwsGame(() => g.nextRound());
  g.addPlayer('a', 'A');
  g.addPlayer('b', 'B');
  g.nextRound();
  assert.equal(g.players.length, 3);
  finishRound(g);
});

test('a removed player stays out of every view and the log leaks no cards', () => {
  const { g } = setup({ n: 4 });
  const secret = g.player('p2').hand.map((c) => c.text);
  g.submit('p2', g.player('p2').hand[0].id);
  const played = g.plays.get('p2').text;
  g.removePlayer('p2');
  for (const v of [g.view(null), g.view('p1'), g.view('p0')]) {
    const json = JSON.stringify(v);
    for (const t of secret) assert.ok(!json.includes(`"${t}"`), `${t} leaked`);
    assert.ok(!v.players.some((p) => p.id === 'p2'));
    assert.ok(!v.submitted.includes('p2'));
  }
  assert.ok(!g.log.some((l) => secret.includes(l.text) || l.text.includes(played)));
  assert.equal(g.log.at(-1).text, `${'p2'} was removed from the game.`);
});

test('a bot-free full game with joins and boots in the middle plays to the end', () => {
  const rng = mulberry32(7);
  const g = new Game({ rng, prompts, answers });
  for (const id of ['a', 'b', 'c', 'd']) g.addPlayer(id, id);
  g.setTarget(3);
  g.start();
  let n = 0;
  while (g.phase !== 'gameOver' && n++ < 200) {
    if (n === 2) g.addPlayer('late', 'late');
    if (n === 3) g.removePlayer(g.players[1].id);
    if (n === 4) g.removePlayer(g.judgeId);
    if (g.phase === 'roundOver') { g.nextRound(); continue; }
    if (g.stage === 'submit') playAll(g);
    if (g.stage === 'judge') g.pick(g.judgeId, g.submissions[0].id);
  }
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.winners.length, 1);
});

// The pages show "Round n was cancelled" / "Game over" for these states rather
// than a "?" name: a cancelled round has no result, and a removed winner
// leaves no winners.
test('states the pages must render without a winner name', () => {
  const { g } = setup({ n: 4 });
  g.removePlayer(g.judgeId);
  let v = g.view(null);
  assert.equal(v.phase, 'roundOver');
  assert.equal(v.result, null);

  const { g: g2 } = setup({ n: 3 });
  g2.targetOverride = 3;
  while (g2.phase !== 'gameOver') {
    if (g2.phase === 'roundOver') g2.nextRound();
    playAll(g2);
    g2.pick(g2.judgeId, g2.submissions[0].id);
  }
  g2.removePlayer(g2.winners[0]);
  v = g2.view(null);
  assert.equal(v.phase, 'gameOver');
  assert.deepEqual(v.winners, []);
});

test('descriptor', () => {
  assert.equal(fitsTheBill.id, 'fits-the-bill');
  assert.equal(fitsTheBill.minPlayers, 3);
  assert.equal(fitsTheBill.maxPlayers, 10);
  assert.deepEqual(Object.keys(fitsTheBill.actions).sort(), ['autoplay', 'nextRound', 'pick', 'setTarget', 'submit']);
  assert.ok(shuffle([1, 2, 3], () => 0).length === 3);
});
