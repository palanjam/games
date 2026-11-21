# Hand and Foot

Canasta-style rummy, one of the games on the [Game Night](../../README.md)
server, played with the house rules below: every player for themselves, no
teams. 2–6 players, each on their phone; a TV can show the table and the
scoreboard. The full rules and the view contract are in
[specs/hand-and-foot.md](../../specs/hand-and-foot.md).

## Rules as played

- **Cards.** One deck per player plus one, each with 2 Jokers. Jokers and 2s
  are wild. Values: Joker 50, 2 and Ace 20, 8 through King 10, 4 through 7
  5, black 3 5, red 3 300.
- **Deal.** Everyone gets an 11-card hand and an 11-card foot, which stays
  face down until you pick it up. One card is turned up to start the discard
  pile. The deal rotates; the player after the dealer goes first.
- **Your turn.** Draw, meld as much as you like, then discard one card.
  - **Draw 3** from the stock, or
  - **Take 5** from the discard pile: the top 5 cards, but only if the top
    card isn't a 3 or a wild, and you must meld that top card this turn
    (with cards from your hand, or onto your pile of its rank).
- **Piles and books.** You build your own piles, one per rank (4s through
  Aces) for the whole round. A new pile needs 3 cards, at least 2 of them
  natural; naturals must always outnumber wilds. 3s are never melded. A pile
  of 7 or more is a book: clean with no wilds, dirty with any. A clean book
  takes no wilds. A pile keeps growing past 7 and is still one book.
- **Opening.** Your first lay-down each round must total at least 50, 90,
  120 or 150 points (rounds 1–4), counting wilds at face value.
- **Hand, then foot.** When you meld your whole hand you pick up your foot
  and keep playing from it. If your discard empties your hand, you pick up
  your foot and play it next turn.
- **Going out.** Discard the last card of your foot, which you may only do
  with at least 2 clean books and 1 dirty book. Until you have them you must
  keep 2 cards in your foot after melding (one to discard, one to keep).
- **Scoring.** Every card in your piles at face value, +500 per clean book,
  +300 per dirty book, +100 for going out, minus every card still in your
  hand or foot (red 3 −300, black 3 −5). If the stock runs out, the round
  ends with no going-out bonus. Highest total after 4 rounds wins.

## House rules and decisions

The user stated: individual play, red 3 −300 / black 3 −5, draw 3 from the
stock or 5 from the discard pile, no taking the discard pile under a 3 or
wild, top card must be melded, 2 clean + 1 dirty to go out, one pile per
rank that grows past 7 as one book, hand-to-foot without discarding, no
discarding the last foot card without the books, red 3s as dead cards, 4
rounds at 50 / 90 / 120 / 150 with wilds at face value. Everything below
was decided for this implementation:

- 2–6 players; decks = players + 1, each 52 cards + 2 Jokers.
- Card values other than the 3s follow the linked rules (Joker 50, 2/A 20,
  8–K 10, 4–7 5).
- Hands and feet are 11 cards. The first card turned up is never redrawn,
  even if it is a 3 or wild (it simply blocks the pile).
- Taking from the discard pile is one action carrying the meld batch: only
  the top card may be used in it; the other taken cards join your hand
  afterwards. The pile can only be taken with at least 5 cards in it.
- The opening minimum counts every card in the first batch (a `meld` or a
  pickup), including the picked-up top card.
- New piles: 3+ cards with 2+ naturals; strictly more naturals than wilds
  in every pile after every play; no wild-only piles; melds only on your own
  piles.
- Book bonuses are one per pile regardless of size: 500 clean, 300 dirty;
  going out is +100.
- Penalties count the foot whether or not it was picked up.
- In the foot, a meld must leave at least 1 card, and at least 2 unless the
  books (counted after that meld) are complete.
- Choosing to draw from an empty stock ends the round at once, no going-out
  bonus. With fewer than 3 cards left you draw what remains.
- Ties for the highest total share the win.
- Autoplay (for a disconnected turn player) draws from the stock, melds
  nothing, and discards a red 3 if held, else the highest-value natural
  card, else the cheapest wild.

## How the engine works

- **`engine.js`**: a pure state machine: deal, draw / take from the discard
  pile, meld batches, discard, hand to foot, going out, scoring, 4 rounds.
  A player's `hand` is always the cards they play from (the foot once
  picked up); `foot` holds the unseen foot until then. A meld batch
  (`[{ rank, cardIds }]`) is checked entry by entry against a scratch copy
  of the player's piles and applied only if all of it is valid.
  `view(playerId)` includes only that player's cards, never any foot
  contents, the stock order or the discards under the top card.
- **`index.js`**: the socket actions (`draw`, `pickup`, `meld`, `discard`,
  `nextRound`, `autoplay`).
- **`public/`**: phone page (`play.html`) and table screen (`board.html`).
- **`test/`**: engine tests with stacked decks and arranged hands.
