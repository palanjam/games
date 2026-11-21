---
type: decision
date: 2026-11-21
---
# Five Crowns hands are arranged by a solver, not by players

Context: in the card game players lay out their books and runs by hand.
Dragging cards into groups on a phone is fiddly, and a wrongly arranged
final hand would cost real points.

Decision: `games/five-crowns/public/melds.js` finds the arrangement with the
fewest leftover points by exact search. The same module runs on the server
(validating "go out", laying down final-turn hands) and on the phones
(showing the hand grouped, enabling "Discard & go out"), so the two can
never disagree. Melds made only of wilds (e.g. three Jokers) are allowed.

Why: it removes a whole UI and every "you could have melded that" argument.
Trade-off: nobody can choose a worse arrangement on purpose, which never
helps in Five Crowns anyway. If house rules forbid wild-only melds, change
the spare-wild handling at the end of `arrange()`.
