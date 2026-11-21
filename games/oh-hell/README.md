# Oh Hell

The trick-taking classic (also Contract Whist), one of the games on the
[Game Night](../../README.md) server. 3-7 players, each on their phone; a TV
can show the table and the scoreboard. Rules reference:
[officialgamerules.org](https://officialgamerules.org/game-rules/oh-hell/).
The full spec and view contract are in [specs/oh-hell.md](../../specs/oh-hell.md).

## How to play

Each round everyone is dealt that round's number of cards and one more card
is turned up: its suit is trump. Starting left of the dealer, everyone bids
how many tricks they expect to win. The player left of the dealer leads;
you must follow the led suit if you can, otherwise play anything. The
highest trump wins the trick, or with no trump the highest card of the led
suit (aces high). The winner leads next.

Score 1 point per trick, plus 10 if you won exactly your bid (a made bid of
0 scores 10). Highest total after the last round wins.

**The hook:** the dealer bids last and may not bid the number that makes the
bids add up to the number of tricks, so someone always misses.

The lobby picks the deal pattern: `down-up` (default; 10 down to 1 and back
up to 10 with 3-5 players), `down` or `up`. With 6 or 7 players the largest
hand is 8 or 7 so a card is always left for trump.

If someone drops out, the table screen can bid and play for them.

## House rules and decisions

- 3-7 players, one 52-card deck, no Jokers, aces high, suits unranked.
- Largest hand = min(10, floor(51 / players)); `down-up` has 2*MAX - 1 rounds
  (the one-card round is played once).
- First dealer is random; the deal passes left each round. Cards are dealt
  one at a time from the left of the dealer; the next card is trump.
- Bidding goes from left of the dealer, the dealer last; bids are public.
  The hook applies only when the forbidden number is within 0..hand size
  (if the others already bid over the hand size, nothing is forbidden).
- Scoring never goes negative; ties for the highest total share the win.
- Disconnected players: the board can bid the smallest legal bid (0, or 1
  when the hook forbids 0) and play the lowest legal card (ties broken by
  suit order hearts, diamonds, clubs, spades).
- The last completed trick stays in the view (`lastTrick`) so phones can see
  who won it; after the last trick of a round it stays visible on the
  round-over / game-over screen.
- A player who leaves mid-round is not supported; players can only be
  removed between rounds.

## How the engine works

- **`engine.js`**: a pure state machine (no networking or timers): deal,
  bid (with the hook), play (follow suit, trick winner), scoring, deal
  patterns. `view(playerId)` includes only that player's hand (sorted by
  suit then rank) and `playable` card ids; the trump card and played cards
  are public, the undealt deck never leaves the engine.
- **`index.js`**: the descriptor and socket actions (`setPattern`, `bid`,
  `play`, `nextRound`, `autoplay`).
- **`public/`**: phone page and table screen.
- **`test/engine.test.js`**: engine tests with stacked decks and a fixed
  rng (`() => 0` makes the first player the first dealer).
