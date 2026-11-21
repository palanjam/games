# Oh Hell

The user's request, verbatim:

> Get some agents to make more games. Oh Hell:
> https://officialgamerules.org/game-rules/oh-hell/. Apples to Apples:
> https://officialgamerules.org/game-rules/apples-to-apples/.

Oh Hell is a traditional trick-taking card game. The linked page is an
overview that leaves gaps; everything it does not settle is decided below,
and the game README must list those under "House rules and decisions".

## Rules as implemented

**Players and cards.** 3–7 players, one standard 52-card deck, no Jokers.
Aces high; suits have no rank order.

**Deal pattern** (chosen in the lobby with a `setPattern` action, like
Cover Your Assets' `setMode`; default `down-up`). Let MAX = min(10,
floor(51 / players)), so at least one card is always left to turn for trump.
- `down-up`: MAX, MAX−1 … 1 … MAX (2·MAX − 1 rounds; 19 with 3–5 players)
- `down`: MAX … 1
- `up`: 1 … MAX

**Deal.** The first dealer is random, then the deal passes left each round.
Each player gets that round's hand size; the next card is turned face up
and its suit is trump for the round.

**Bidding.** Starting left of the dealer, each player bids once, 0 up to the
hand size; the dealer bids last. Hook: the dealer may not bid the number
that makes the total of all bids equal the hand size (the number of tricks).
Bids are public as they are made.

**Play.** The player left of the dealer leads the first trick. Players must
follow the led suit if they can; otherwise they may play any card. The
highest trump wins the trick, or if no trump was played, the highest card of
the led suit. The trick winner leads the next.

**Scoring** each round: 1 point per trick won, plus 10 if the tricks won
exactly equal the bid (a made bid of 0 scores 10). No negative scores.
After the last round the highest total wins; ties share the win.

## Engine contract

Card: `{ id, rank, suit }`, `rank` 2..14 (11 J, 12 Q, 13 K, 14 A), `suit`
one of `hearts diamonds clubs spades`.

Socket actions (`games/oh-hell/index.js`, `me()` = sender):
- `setPattern { pattern }` (lobby only)
- `bid { bid }` (integer; your turn in the bidding stage)
- `play { cardId }` (your turn in the play stage; must follow suit)
- `nextRound {}`
- `autoplay {}`: the board acts for a disconnected turn player: bid the
  smallest legal bid; play the lowest legal card.

After the last card of a trick is played, the completed trick stays visible
in the view (`lastTrick`) so phones can see who won it.

`view(playerId)` (hidden information: never include other players' hands or
the undealt deck; the trump card is public):

```
{
  phase,            // lobby | playing | roundOver | gameOver
  pattern, patterns,           // current and allowed patterns
  round, rounds, handSize,
  dealerId, turnId,
  stage,            // 'bid' | 'play' | null
  trumpCard, trumpSuit,
  trick: [{ playerId, card }],      // the trick in progress, in play order
  ledSuit,                          // suit led in the current trick, or null
  lastTrick: null | { plays: [{ playerId, card }], winnerId },
  bidTotal,                         // sum of bids made so far this round
  forbiddenBid,                     // the number the dealer may not bid, when it's the dealer's turn to bid; else null
  outId: null, winners, log,
  you: null | { id, hand, playable },   // playable: card ids you may legally play now (empty if not your play turn)
  players: [{
    id, name, connected, score, roundScores,
    cardCount, bid, tricks,          // bid null until made
  }],
}
```

`roundScores` entries: `{ bid, tricks, points }`. `log` follows the existing
games' format and must not reveal hidden cards.

## Pages

Phone (`play.html`): your hand sorted by suit then rank, trump card and
suit shown prominently, everyone's bid / tricks this round. Bidding: a row
of number buttons 0..handSize, with the hook's forbidden number disabled for
the dealer. Play: tap a playable card (others dimmed) to play it. Show the
current trick, and the last completed trick with its winner. Round over: the
round's bids, tricks and points, and the score grid. Lobby: the deal-pattern
picker. Errors arrive as toasts (`problem`).

Board (`board.html`): trump card, the current trick laid out by player, each
player's bid / tricks / score, the score grid, round results, and the "play
for" button for a disconnected turn player, like the other games.

## Acceptance

- Engine unit tests cover: MAX per player count and every pattern's hand
  sizes; deal, trump card and dealer rotation; bidding order, range and the
  hook; following suit and trick winners (trump beats led suit, off-suit
  never wins); trick winner leads next; scoring (made bids incl. 0, missed
  bids); game end and shared wins; autoplay is always legal; views hide
  other hands and the deck.
- `npm test` passes. Pages work for a full round with `?seat=` players.
