# Five Crowns

SET Enterprises' *Five Crowns*, one of the games on the
[Game Night](../../README.md) server. 2–7 players, each on their phone; a TV
can show the table and the scoreboard. The full rules and the view contract
are in [specs/five-crowns.md](../../specs/five-crowns.md).

## How to play

Start a Five Crowns lobby from the home page and start once everyone has
joined. There are 11 rounds: round 1 deals 3 cards and 3s are wild, round 11
deals 13 and Kings are wild. Jokers are always wild.

On your turn, **Draw from deck** or **Take** the top discard, then tap a card
and **Discard** it. Your phone always shows your hand arranged into its best
books (same rank) and runs (same suit, in sequence) and the points left over.
When everything but the card you're discarding melds, **Discard & go out**
lights up. After someone goes out, everyone else gets one last turn; their
hands are laid down automatically and the leftover cards count against them
(face value, J/Q/K 11/12/13, the round's wild cards 20, Jokers 50). Lowest
total after 11 rounds wins.

If someone drops out, the table screen can take their turn for them.

## How the engine works

- **`public/melds.js`**: the meld solver, shared by the server and the
  phones. An exact search (memoised over which cards are still unplaced)
  for the arrangement with the fewest penalty points; `bestDiscard` builds
  on it for autoplay. Melds made only of wilds count.
- **`engine.js`**: a pure state machine: deal, draw, discard / go out,
  final turns, scoring, 11 rounds. `view(playerId)` includes only that
  player's hand; laid hands become public once a player goes out or
  finishes their final turn.
- **`index.js`**: the socket actions (`draw`, `discard`, `nextRound`,
  `autoplay`).
- **`public/`**: phone page (`play.html`, `player.js`) and table screen
  (`board.html`, `board.js`), sharing `ui.js` and `style.css`.
- **`test/`**: solver tests (checked against a brute force on random hands)
  and engine tests with stacked decks.
