# Flip 7

A digital version of the Flip 7 card game, one of the games on the
[Game Night](../../README.md) server. Everyone plays from their phone; a TV
can show the whole table.

## How to play

Start a Flip 7 lobby from the home page and join with your name. Others join
with the room link, code or the QR code on the table screen
(`/r/<code>/board`, full-screen it with F11 / ⌃⌘F).

Anyone presses **Start game**. On your turn your phone shows **HIT** /
**STAY**; when you draw a Freeze, Flip Three or a spare Second Chance, it asks
you who to give it to. Between rounds anyone can press **Next round**. First
to 200 wins.

If someone drops out, the table screen offers to act for them (stay, or pick
a random target).

## Rules implemented

94 cards: one 0, then each number 1–12 as many times as its value; +2, +4, +6,
+8, +10 and ×2 once each; three each of Freeze, Flip Three and Second Chance.

- A duplicate number busts you (0 points) unless you hold a Second Chance,
  which cancels it. You can hold only one; extras go to another active player.
- **Freeze**: the drawer picks an active player, who banks their points and
  is out of the round.
- **Flip Three**: the drawer picks an active player, who flips three cards.
  Freeze / Flip Three drawn during it are resolved afterwards (discarded on a bust).
- Seven different numbers is a **Flip 7**: +15 and the round ends at once.
- Score = numbers (doubled by ×2) + modifiers + bonus. The dealer rotates; the
  deck carries over between rounds and the discards are reshuffled when it runs out.

## How the engine works

- **`engine.js`**: a pure state machine. It queues work as a task stack;
  when a draw needs a decision (Freeze target, etc.) it sets `pending` and
  stops until the named player answers, then resumes the deal or Flip Three.
  Every card is face up, so `view()` is the same for every seat.
- **`index.js`**: the socket actions (`hit`, `stay`, `choose`, `nextRound`,
  `autoplay`).
- **`public/`**: phone page (`play.html`, `player.js`) and table screen
  (`board.html`, `board.js`), sharing `ui.js` and `style.css`.
- **`test/`**: engine tests with stacked decks.

## House rules and decisions

- **Booting a player**: the table screen has a remove button (with a confirm)
  on every seated player. Removal is immediate, even mid-round: their cards
  leave play for the rest of the round (they rejoin the discard pile when
  the next round starts) and their score is dropped. A phone "Leave" does the same.
- **Pending choices**: if the removed player was choosing a Freeze / Flip Three
  target or a spare Second Chance recipient, the action card is discarded
  unused. If they were one of the possible targets they are dropped from the
  options (if none are left the card is discarded). A Flip Three on them ends.
- **Turn and dealer**: if it was their turn it passes to the next active player
  after their old seat. If they were the dealer, the next round is dealt by the
  player who would have dealt after them (no one is shown as dealer meanwhile).
  If fewer than 2 players remain the round is abandoned: nobody scores and it
  goes to round over.
- **Late joiners**: anyone can join from their phone at any time. They wait,
  and are seated at the end of the order when the next round starts, with the
  same score as whoever is in last place. Returning to the lobby seats them at 0.
