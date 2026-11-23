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

## House rules and decisions

- **Booting a player** (the table screen's x, or a phone's Leave) works at any
  time. Mid-round they leave at once: their hand is out of play, their score
  is dropped, and the round carries on. If it was their turn it passes to the
  next player (who still owes a turn, once someone is out). If they were the
  dealer, the next round is dealt by whoever would have dealt after them. If
  the player who went out is removed, the final turns still finish and the
  round ends normally. Their melded cards are not shown or kept anywhere.
- **Fewer than 2 players left** abandons the round: nobody scores, each
  remaining player gets a "–" for it, and the table goes to round over (or
  game over after round 11, winners on current scores).
- **Joining mid-game**: anyone can join from their phone in any phase. They
  wait, shown as "Joining next round", and are seated at the end of the seat
  order when the next round is dealt. Their total is level with last place,
  which in Five Crowns is the **highest** score, and the rounds already played
  show "–". Returning to the lobby seats them at 0. Waiting players count
  toward the 7-player limit and can be removed from the table screen.
- Choices the spec left open: removing a waiting player logs nothing; a
  removal outside a round logs "left"; a round abandoned mid-game still
  counts as a played round, so the wild rank moves on.

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
