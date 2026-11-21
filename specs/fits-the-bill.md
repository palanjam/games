# Fits the Bill (a judge-picks-the-best-match party game)

The user's request, verbatim:

> Get some agents to make more games. Oh Hell:
> https://officialgamerules.org/game-rules/oh-hell/. Apples to Apples:
> https://officialgamerules.org/game-rules/apples-to-apples/.

Apples to Apples is a commercial game whose name and card text belong to
its publisher. This game uses the same well-known mechanics (a judge reveals
a describing word, everyone plays a thing card, the judge picks the best
match) under an original name, **Fits the Bill**, with entirely original card
text. Never use the commercial game's name, card wording, colours-as-branding
("red/green apple" cards) or look. In code and copy the two card types are
**prompts** (describing words, e.g. an adjective) and **answers** (things:
nouns, people types, places, events).

## Rules as implemented

**Players.** 3–10 players.

**Cards.** An answer deck and a prompt deck, both original content in
`games/fits-the-bill/cards.js` (see Content). Each player holds 7 answers.

**Judge.** The first judge is random; the role passes left each round. The
judge does not play an answer that round and keeps their hand.

**Round.**
1. The top prompt is revealed to everyone.
2. Every non-judge secretly plays one answer. Everyone can see who has
   played, not what.
3. When every non-judge has played (the board can play for disconnected
   players; see Autoplay), the
   answers are shown to everyone in a random order with no names. The
   order must not follow play order or seat order.
4. The judge picks one. Its player wins the prompt card (1 point) and the
   names behind every answer are revealed.
5. Played answers are discarded; every non-judge draws back to 7. If the
   answer deck runs out, the discards are shuffled into a new deck.
6. Phase goes to `roundOver` until someone presses next round.

**Winning.** The first player to reach the target wins at once: 3–4 players
8, 5 players 7, 6 players 6, 7 players 5, 8–10 players 4. Players can
change the target in the lobby with `setTarget { target }` (3–15).

**Autoplay.** The board may act for disconnected players: play a random
answer for every disconnected non-judge who has not played, or, if the judge
is disconnected once all answers are in, pick one at random.

## Content

`games/fits-the-bill/cards.js` exports `PROMPTS` (at least 150 describing
words, mostly adjectives) and `ANSWERS` (at least 500 things). All text is
written fresh for this project:
- family friendly, fun for adults and older kids;
- no real brands, trademarks or living people; well-known historical
  figures, places, animals, foods, events and everyday objects are fine;
- not copied or paraphrased from any commercial party game's card list;
- answers are short noun phrases (1–4 words), prompts single words or very
  short phrases;
- no duplicates (check in a test).

## Engine contract

Socket actions (`games/fits-the-bill/index.js`, `me()` = sender):
- `setTarget { target }` (lobby only)
- `submit { cardId }`: a non-judge plays an answer from their hand.
- `pick { submissionId }`: the judge picks; only once all are in.
- `nextRound {}`
- `autoplay {}` (see Autoplay)

`view(playerId)` (hidden information: never include other players' hands,
deck order, or who played which answer before the pick):

```
{
  phase,            // lobby | playing | roundOver | gameOver
  target, round, judgeId,
  stage,            // 'submit' | 'judge' | null
  prompt,           // { id, text } or null
  submitted: [playerId],            // who has played this round (not what)
  submissions: [{ id, text }],      // only once stage is 'judge' or later; shuffled; no player ids
  result: null | { winnerId, submissionId, plays: [{ submissionId, playerId, text }] },  // after the pick
  winners, log,
  you: null | { id, hand: [{ id, text }], submittedId },  // submittedId: the card you played this round
  players: [{ id, name, connected, score, won: [prompt text], cardCount }],
}
```

Submission ids must not reveal the player (not derived from player or card
ids in a guessable way, and not in play order). `log` must not reveal who
played what before the pick.

## Pages

Phone: the prompt big at the top. Non-judge: your hand as tappable answer
cards; confirm to play; then "waiting for N". Judge: "You're judging",
then the anonymous answers to tap and confirm. After the pick: the winning
answer and who played each answer. Score list with each player's won
prompts. Lobby: the target picker. Errors as toasts (`problem`).

Board: the prompt, who has played (names, not cards), then the anonymous
answers as large cards, then the result; scores; the "play for" button for
disconnected players, like the other games. Give it its own look: no
red/green apple styling.

## Acceptance

- Engine tests cover: targets by player count and setTarget; judge
  rotation; judge cannot submit, non-judges submit once from their own hand;
  judging only once every non-judge is in; anonymous shuffled
  submissions (no player ids in any view before the pick, order not equal to
  play order for a stacked rng); pick awards the point and reveals; refill to
  7 and reshuffle of discards; immediate win at the target; autoplay; views
  hide other hands.
- Content test: counts, no duplicates, no empty strings.
- `npm test` passes. Pages work for a full round with `?seat=` players.
