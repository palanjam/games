# Fits the Bill

A judge-picks-the-best-match party game, one of the games on the
[Game Night](../../README.md) server. 3-10 players, each on their phone; a TV
can show the table and the scores. The full rules and the view contract are
in [specs/fits-the-bill.md](../../specs/fits-the-bill.md).

## How to play

- Each player holds 7 answer cards (things: objects, places, people types,
  events). One player is the judge each round; the role passes left.
- The judge's prompt (a describing word) is revealed to everyone.
- Everyone except the judge secretly plays the answer from their hand that
  best fits the prompt. Everyone can see who has played, not what.
- When all answers are in they are shown to the table with no names, in a
  random order. The judge picks the one that fits best.
- The player behind that answer keeps the prompt card as a point, and every
  answer's owner is revealed. Everyone draws back up to 7.
- The first player to reach the target wins immediately. Target by player
  count: 3-4 players 8, 5 players 7, 6 players 6, 7 players 5, 8-10 players 4.
  Change it in the lobby (3-15).

## House rules and decisions

- The first judge is random; after that the judge is the next seat.
- The judge keeps their hand and does not play.
- Winning is immediate on the pick that reaches the target; the final
  round's result is still shown.
- The target set in the lobby is kept when the game is reset to the lobby.
- Players can only leave between rounds, and the next round needs at least 3
  players.
- When the answer deck runs out, the discards are shuffled into a new deck.
  Prompts are recycled the same way.
- Autoplay: when a non-judge is disconnected the board can play a random
  answer for them; when the judge is disconnected and all answers are in, it
  picks one at random.
- Display order of the answers is a uniform shuffle drawn from `node:crypto`,
  independent of play order, seat order and the game rng. It deliberately
  does not reject play order: rejecting it would make the order a function of
  play order and give players away (with 3 players it would always be the
  reverse of play order).
- The `submitted` list in a view is in seat order, not play order.
- Submission ids are random tokens, so they reveal neither the player nor
  the play order. The log only counts answers in ("2 of 3 answers are in"), never who
  played or which card.
- The card text is original to this project (`cards.js`).

## How the engine works

`engine.js` is a pure state machine (`Game`) with no networking or timers.
Phases: `lobby`, `playing`, `roundOver`, `gameOver`. While `playing`, the
`stage` is `submit` (non-judges play) and then `judge` (the judge picks).
`index.js` is the platform descriptor and maps socket actions (`setTarget`,
`submit`, `pick`, `nextRound`, `autoplay`) to engine methods. `view(playerId)`
gives each socket only its own hand; before the pick, submissions carry no
player ids. `new Game({ prompts, answers, rng })` accepts content and rng
overrides, which the tests use. Run the tests with
`node --test games/fits-the-bill/test/`.
