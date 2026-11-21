# Five Crowns

Add SET Enterprises' *Five Crowns* as the third game on the platform, at
`games/five-crowns/`.

## Rules implemented

**Deck (116 cards).** Two decks of 58: five suits (stars, hearts, clubs,
spades, diamonds), each ranked 3–10, J (11), Q (12), K (13), plus 3 Jokers
per deck (6 total).

**Rounds.** 11 rounds. In round *r* (1–11) each player is dealt *r* + 2
cards (3 up to 13), and that number is the round's **wild rank** (3s wild in
round 1 … Kings wild in round 11). Jokers are always wild. The dealer
rotates; the player left of the dealer goes first. After the deal, flip one
card face up to start the discard pile. If the draw pile runs out, shuffle
the discard pile (except its top card) into a new draw pile.

**A turn**: draw one card (top of the draw pile or top of the discard pile),
then discard one card. While discarding, a player may **go out** if every
other card in their hand can be arranged into melds:

- **Book**: 3+ cards of the same rank (suits may repeat; there are two decks).
- **Run**: 3+ consecutive ranks in one suit (3 is low, K is high, no wrap).
- Wilds (Jokers and the round's wild rank) stand in for any card in a book
  or run. A meld may be made entirely of wilds.

**After someone goes out**, every other player takes exactly one more turn
(draw, discard), in order. At the end of that turn their hand is laid down
in the best possible arrangement automatically (players never arrange melds
by hand), and the cards left over score against them. A player who can go
out on their last turn scores 0.

**Scoring** (unmelded cards): 3–10 face value, J 11, Q 12, K 13, cards of
the round's wild rank 20, Jokers 50. The player who went out scores 0.
Lowest total after round 11 wins; ties share the win.

Player count 2–7.

## Meld solver (shared by server and phones)

`games/five-crowns/public/melds.js`, a pure ES module with no imports, used
by the engine and by the phone page (served at
`/g/five-crowns/melds.js`):

```js
export const SUITS = ['stars', 'hearts', 'clubs', 'spades', 'diamonds'];
export function isWild(card, wildRank)    // joker, or rank === wildRank
export function cardPoints(card, wildRank) // 50 joker, 20 wild rank, else rank
// Best arrangement: the one with the fewest penalty points left over.
export function arrange(cards, wildRank)   // -> { melds: [[Card]], deadwood: [Card], points }
// Which single discard leaves the fewest points (ties: discard the highest-value card).
export function bestDiscard(cards, wildRank) // -> { cardId, points }
```

`arrange` must be exact (an exhaustive search with memoisation is fine: at
most 14 cards) and fast enough to call on every render (well under 50 ms for
14 cards with several wilds). Order cards within a run by rank, with wilds
placed in the gaps they fill.

## Server contract

`games/five-crowns/index.js` default-exports a descriptor shaped like
`games/flip7/index.js` (`id: 'five-crowns'`, `name: 'Five Crowns'`,
`blurb`, `minPlayers: 2`, `maxPlayers: 7`, `create`, `actions`) and is
added to `server/games.js`. The engine (`engine.js`) is a pure class with
no I/O, importing `GameError` from `../../server/game-error.js` and the
solver from `./public/melds.js`, and meets the engine contract described in
`server/games.js`. Its constructor accepts `{ rng, deck }` (deck used in
order for the first round) so tests can stack the deck, like Flip 7.

Socket events (game actions; `me()` = sender's player id):

| Event | Arg | Effect |
|-------|-----|--------|
| `draw` | `{ from: 'deck' \| 'discard' }` | your turn, draw stage |
| `discard` | `{ cardId, goOut?: boolean }` | your turn, discard stage; `goOut` is rejected unless the remaining hand melds completely (points 0) |
| `nextRound` | `{}` | from `roundOver` |
| `autoplay` | `{}` | the turn player is offline: draw from the deck, then make the `bestDiscard` (going out if that leaves 0) |

A discard that leaves a melded hand without `goOut: true` is allowed (the
player keeps playing). Players may only be removed outside `playing`.

`view(playerId)` returns (hands are private; the deck order is never sent):

```js
{
  phase: 'lobby' | 'playing' | 'roundOver' | 'gameOver',
  round, rounds: 11, handSize, wildRank,
  dealerId, turnId, stage: 'draw' | 'discard' | null,
  outId: null | playerId,          // who went out this round
  deckCount, discardCount,
  discardTop: Card | null,
  winners: [playerId],
  log: [{ id, text }],             // last 50
  you: null | { id, hand: [Card], drawnId: cardId | null },
  players: [{
    id, name, connected, score, handCount,
    lastTurnDone: boolean,         // after someone went out: has had their final turn
    laid: null | { melds: [[Card]], deadwood: [Card], points },
                                   // public once they went out or finished their final turn
    roundScores: [number],         // one per finished round
  }],
}
// Card: { id, suit: 'stars'|'hearts'|'clubs'|'spades'|'diamonds'|null, rank: 3..13 | null, joker: boolean }
```

## Pages

`games/five-crowns/public/` holds `play.html` (phone) and `board.html`
(table screen), loading `/socket.io/socket.io.js` and modules under
`/g/five-crowns/`. They use `/lib/room.js` (`socket`, `claimSeat`, `code`,
`roomInfo`, `esc`, `toast`, `[data-emit]` and `[data-share]` click
delegation); include `.toast` CSS. Look at the Flip 7 and Cover Your Assets
pages for structure; give this game its own look (deep purple/royal blue
with gold crowns). Five distinct suit colours and symbols (★ ♥ ♣ ♠ ♦),
Jokers and the round's wild cards visibly marked as wild.

- **Phone** (must work at 360px; touch targets ≥44px): join; lobby (room
  code, invite, table-screen link, players, start, leave). In play: round
  N/11, "Wild: 7s", your hand shown as `arrange()` groups (melds, then
  leftover cards) with the leftover points, the discard top and deck. Draw
  stage: two big buttons (Draw from deck / Take <card>). Discard stage: tap a
  card to select it, then **Discard** or **Discard & go out** (enabled only
  if the rest of the hand melds completely; computed with `arrange`). A
  "last turn!" banner once someone has gone out. Others: name, hand size,
  score, laid-down melds when public. Round over: each player's laid hand
  and round points; scoreboard per round; Next round / New game.
- **Board**: lobby with QR, URL, code, player chips (kick); table: round,
  wild rank (big), deck and discard, whose turn and stage, each player's
  hand size (card backs) or laid melds, a scoreboard grid (rounds × players,
  totals, lowest highlighted), log, offline-autoplay button, Back to lobby.
