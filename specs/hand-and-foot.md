# Hand and Foot

The user's request, verbatim:

> Let's add a new game. Hand and Foot. Here's the rules:
> https://officialgamerules.org/game-rules/hand-and-foot/. I play with some
> variation to it though. There are no teams. Everyone plays individually.
> The red 3 is -300 the black 3 is -5. You draw 3 from the stock pile or draw
> 5 from the discard pile. You can't draw from discard pile if a 3 or wild is
> on top. To go out, you have to have at least 2 clean and one dirty book. You
> can make as many books as you want but you can only have one pile of the
> same face card. You can go from your hand to your foot in the same turn if
> you can place your hand down without discarding. When in your foot, you
> can't discard your last card before you have the minimum 2 clean one dirty
> book.

Follow-up answers from the user:
- Taking from the discard pile: take the top 5 freely, but the top card must
  be melded right away, either in a new meld (3+ cards) or onto your pile of
  that rank. Any of the other picked-up cards can be used too, in that
  meld or elsewhere (e.g. three 5s in the pile can be melded at once).
  Only the top discard is visible; you never see the other cards before
  taking them. So the pickup's first meld uses the top card with your own
  cards, and the rest of what you took is meldable straight after.
- Red 3s are dead cards: never laid down, discarded like any card, -300 each
  if still held at round end.
- One pile per rank. A pile keeps growing past 7 cards; it is one book no
  matter how big (14 cards is still one book).
- 4 rounds, opening minimums 50 / 90 / 120 / 150, wilds at face value.

Anything below that the user did not state is a decision made here; the
game README must list it under "House rules and decisions".

## Rules as implemented

**Players and cards.** 2–6 players, individual play (no teams). Decks =
players + 1, each a 52-card deck plus 2 Jokers. Wilds: Jokers and 2s.

**Card values** (used for melds, opening totals and penalties):
Joker 50, 2 20, Ace 20, K/Q/J/10/9/8 10, 7/6/5/4 5, black 3 5, red 3 300.

**Deal.** Each player gets an 11-card hand and an 11-card foot (face down,
unseen until picked up). One stock card is turned up to start the discard
pile. The dealer rotates each round; the player after the dealer starts.

**Turn.** Draw, then play (meld as much as you like), then discard one card.
- *Draw from stock*: take 3 (or whatever is left if fewer). If the stock is
  empty when you choose stock, the round ends immediately with no going-out
  bonus.
- *Take from the discard pile*: only if the top card is not a 3 (red or
  black) and not a wild. Take the top 5 (fewer if the pile is smaller). This
  is one atomic action carrying a batch of melds that must include the top
  card, built from it and the player's own cards (the other taken cards are
  unseen until picked up); if the batch is invalid, nothing happens. The
  other taken cards then join the player's cards and can be melded anywhere
  later that turn. Only the top discard is ever visible.

**Melds and piles.** Each player has their own piles; a player has at most
one pile per rank (4–K, A) for the whole round. A new pile needs at least 3
cards, at least 2 of them natural. In every pile, naturals must outnumber
wilds (strictly more naturals than wilds) after every play. 3s can never be
melded. A pile of 7+ cards is a book: clean if it has no wilds, dirty
otherwise. Wilds cannot be added to a clean book. Wild-only piles are not
allowed. Cards are only ever melded onto your own piles.

**Opening.** Until a player has opened this round, their first meld batch
(a `meld` action or a discard-pile pickup) must total at least the round's
minimum (50, 90, 120, 150 in rounds 1–4), counting the face value of every
card in that batch. After that they meld freely.

**Hand to foot.** You play from your hand until it is empty, then from your
foot.
- If a meld batch empties your hand, you pick up your foot at once and keep
  playing from it this turn.
- If your discard empties your hand, you pick up your foot and your turn
  ends; you play it next turn.

**Going out.** You go out by discarding the last card of your foot, and only
if you have at least 2 clean books and 1 dirty book. While in your foot:
- a discard may not leave you with 0 cards unless you have those books;
- a meld batch may never leave you with 0 cards (you need a card to
  discard), and while you lack the books it must leave at least 2.
Going out ends the round.

**Scoring** (each player, each round):
+ face value of every card in your piles
+ 500 per clean book, 300 per dirty book (one bonus per pile, whatever its size)
+ 100 for going out
− value of every card left in your hand and in your foot (picked up or not),
  red 3 −300, black 3 −5.
Scores accumulate; highest total after round 4 wins (ties share the win).

## Engine contract

Card: `{ id, rank, suit, joker }`. `rank` 2..14 (11 J, 12 Q, 13 K, 14 A),
`suit` one of `hearts diamonds clubs spades`; Jokers have `rank: null,
suit: null, joker: true`. Red = hearts/diamonds. ids are unique per game.

Socket actions (`games/hand-and-foot/index.js` `actions`, `me()` = sender):
- `draw {}`: draw from stock.
- `pickup { melds }`: take from the discard pile with a meld batch.
- `meld { melds }`: lay down a batch during the play stage.
- `discard { cardId }`: ends the turn (or goes out).
- `nextRound {}`, `autoplay {}` (board acts for a disconnected turn player:
  draw from stock, meld nothing, discard a red 3 if held, else the
  highest-value non-wild card; never make an illegal discard).

A meld batch is `[{ rank, cardIds }]`: `rank` names the pile (new or
existing); `cardIds` are cards from the player's current cards (plus, for
`pickup`, the discard pile's top card, which must be used; the other taken
cards join the player's cards after the batch and can be melded later
that turn). Each entry is applied in order
against the state left by the previous one, and the whole batch is
validated before anything changes. Errors throw `GameError` with a
player-readable message.

`view(playerId)` (hidden information: never include other players' cards or
foot contents, any player's unseen foot, the stock order, or discard-pile
cards other than the top. Players may only see the top discard, never the
other cards a pickup would take):

```
{
  phase,            // lobby | playing | roundOver | gameOver
  round, rounds,    // rounds = 4
  openingMin,       // this round's minimum
  dealerId, turnId,
  stage,            // 'draw' | 'play' | null
  stockCount, discardCount,
  discardTop,       // card or null
  discardBlocked,   // true if the top card is a 3 or wild (or pile empty)
  outId, winners, log,
  you: null | {
    id,
    cards,          // the cards you are playing from now (hand, or foot once in it)
    inFoot,         // whether you have picked up your foot
    footCount,      // cards still in an unpicked foot (0 once picked up)
    opened,
  },
  players: [{
    id, name, connected, score, roundScores,
    cardCount,      // cards held (hand or foot, whichever is in play)
    footCount, inFoot, opened,
    piles: [{ rank, cards, book }],   // book: null | 'clean' | 'dirty'
    cleanBooks, dirtyBooks,
    canGoOut,       // has 2 clean + 1 dirty
  }],
}
```

`roundScores` entries: `{ melded, bonus, wentOut, penalty, total }`.
`log` follows the existing games' log format.

## Pages

Phone (`play.html`): your cards sorted by rank (wilds and 3s grouped
clearly, red 3s marked), tap to select. Build a batch: selected naturals of
one rank (plus optional wilds) become an entry for that rank; wilds alone
are added by tapping one of your piles. Show the batch, its point total and
the opening minimum while not opened; "Lay down" sends `meld`. In the draw
stage: "Draw 3" and "Take 5" (disabled when blocked); taking 5 asks you to
build a batch that uses the top card (with your own cards), then sends
`pickup`; the other taken cards then appear in your cards for the rest of
the turn. Show your piles
with book state, your foot status, your book progress toward 2 clean + 1
dirty, and whether discarding your last card is allowed. Errors appear as
toasts (`problem`). Other players: name, card count, foot status, piles.

Board (`board.html`): every player's piles and books, card/foot counts,
scores, turn, stock and discard top, round results table, and the
"play for" button for a disconnected turn player, like the other games.

## Acceptance

- Engine unit tests cover every rule above, including: discard blocked by
  3s and wilds; pickup takes 5 and rejects batches without the top card;
  opening minimum per round; one pile per rank; wild ratio and no wilds on
  a clean book; piles past 7 count as one book; hand→foot by meld (same
  turn) and by discard (next turn); foot meld/discard limits; going out;
  empty-stock round end; scoring incl. red/black 3 penalties and unpicked
  foot; view hides hidden information.
- Registered in `server/games.js`; `npm test` passes.
- Pages work for a full round with `?seat=` players.
