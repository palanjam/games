# Manage players mid-game (boot and late join)

The user's request, verbatim:

> On the board page, I need a way to manage users in a game. When someone
> leaves the game, I'd like to be able to boot them from the game. And is
> there a way to add a player mid session?

Their answers to the follow-up questions:
- Booting mid-round: **leave right away**. They are removed at once and the
  round carries on without them. Their hidden cards go out of play. Their
  score is dropped.
- Late joiners: **next round, lowest score**. They can join from their phone
  at any time, are seated when the next round starts, and start level with
  whoever is in last place.

This applies to every game: Flip 7, Cover Your Assets, Five Crowns, Hand and
Foot, Oh Hell, Fits the Bill.

## Engine contract additions

Every engine gains:

- `waiting`: array of `{ id, name }`, players who joined after the game
  started. Empty in the lobby.
- `addPlayer(id, name)`: in the lobby, unchanged. In any other phase it
  validates the name the same way, checks capacity against
  `players.length + waiting.length`, appends `{ id, name }` to `waiting`
  and logs `"<name> will join next round."`. It never throws "A game is
  already in progress." any more.
- `isWaiting(id)`: true if `id` is in `waiting`.
- Seating: at the start of every round after the first (the code path
  `nextRound` takes, before the dealer/judge rotation, deck size, hand size
  or turn order are computed for the new round), every waiting player is
  seated at the end of the seat order, with the game's usual fresh-player
  state, and:
  - **score** = last place's current score among the seated players
    (lowest score, except **Five Crowns** where the lowest score wins, so
    last place is the **highest** score). With no seated players, 0.
  - **roundScores** (where the game has them) padded with one `null` entry
    per round already played, so score grids line up. Pages render a
    `null` entry as "–".
  - log `"<name> joins with <score> points."`
  `reset()` (back to the lobby) seats every waiting player with the usual
  zeroed state, and empties `waiting`.
- `nextRound()` / any "enough players" check before a new round counts
  seated plus waiting players.
- `removePlayer(id)`: allowed in **every** phase.
  - Waiting player: removed from `waiting`. Nothing else changes.
  - Lobby, roundOver, gameOver: as today (dealer/judge index adjustments
    included).
  - **playing** (mid-round): the player is removed at once and the round
    continues without them:
    - Their hidden cards (hand, foot, face-down cards) leave play for the
      rest of the round. Never reveal them in the log or any view.
    - Cards they had on the table (melds, piles, collected stacks) leave
      with them, unless the game section below says otherwise.
    - Seat indexes (dealer, judge, turn, leader, whoever started a battle,
      etc.) are adjusted so they still point at the same remaining players.
    - If it was their turn, the turn passes to the next seated player
      after their old seat, in the state a normal turn starts in.
    - If they were the dealer, the deal rotation continues as if their
      seat were gone: next round's dealer is the player who would have
      dealt after them.
    - Any pending interaction that waits on them (a choice, a target, a
      battle, a submission, a final turn) is resolved or cancelled so the
      game never waits for a player who is not there. Each game section
      below says how; where it doesn't, choose the simplest outcome that
      keeps the rules consistent and record it in the game README under
      "House rules and decisions".
    - If fewer than 2 seated players remain, the round is **abandoned**:
      nobody scores this round (each remaining player gets a `null`
      roundScores entry where the game keeps them), log
      `"Round <n> was abandoned: not enough players."`, and the phase
      becomes `roundOver` (or `gameOver` if that was the last round of a
      fixed-length game, winners decided as usual on current scores).
    - Log `"<name> was removed from the game."` (the server calls
      `removePlayer` for both a board boot and a phone "leave"; one
      message for both is fine).
  - Winners lists drop the removed player, as today.
- `view(...)` includes `waiting: [{ id, name }]` for everyone.

Engines must stay deterministic for tests (use the injected rng).

## Per game notes

- **Flip 7**: cards in front of a removed player leave play. A pending
  action card waiting on them (as the chooser, or as the target) is
  resolved: if they were choosing, the action is discarded unused; if they
  were the only legal target, likewise. A Flip Three sequence in progress
  on them ends. Then play continues from the next player as normal.
- **Cover Your Assets**: their hand and asset stacks leave play. A battle
  involving them (as attacker or defender) is cancelled: cards they played
  into it leave play, the contested asset stays with its owner if that
  owner is still seated, cards played by remaining players go to the
  discard pile, and the turn continues as the game's rules say after a
  battle ends (the attacker's turn ends if the attacker remains; if the
  attacker was removed, the turn passes from the attacker's old seat).
- **Five Crowns**: last place is the **highest** score. If someone has
  gone out and others are taking their final turns, removing a player
  just skips them; the round ends when every remaining player has had
  their final turn. If the player who went out is removed, the final
  turns still finish and the round ends as normal.
- **Hand and Foot**: hand, foot and piles leave play. The deck count for
  the next round uses the new player count as usual.
- **Oh Hell**: the deal-pattern schedule stays the one set at start, but a
  round's hand size is capped at `floor(51 / players)` for the current
  player count (late joiners can make the table bigger). Removal during
  bidding drops their bid; if they were the dealer, the dealer role moves
  to the previous seat (that player bids last and the hook applies to
  them; if they have already bid, the hook is not re-checked). Removal
  during play: their card in the current trick (if any) is removed from
  it, the trick completes when every remaining player has played, and if
  they were leading the next trick, the lead passes to the next seat.
  Their tricks leave with them.
- **Fits the Bill**: the target is fixed when the game starts (a
  `setTarget` override, else `defaultTarget` for the starting player
  count), so joins and boots don't move it. Score is no longer derived
  from `won.length`: keep `score` as its own number (a late joiner starts
  with last place's score and no won prompts). If the **judge** is
  removed mid-round, the round is cancelled: every submitted answer goes
  back to its player's hand, the prompt goes to the prompt discard, phase
  `roundOver` with `result` null, log `"The judge left: round <n> is
  cancelled."`. If a non-judge is removed in the submit stage, their
  played answer (if any) is discarded, and if every remaining non-judge
  has now played, judging begins. In the judge stage, their submission is
  removed; if none are left, the round is cancelled as above.

## Pages

**Board (table screen)**, while a game is running (any phase but lobby):
- Each seated player's name in the board's player list or score area gets
  a small remove button, reusing the lobby's `x` style:
  `<button class="x" title="Remove" data-emit="kick" data-arg='{"playerId":…}' data-confirm="Remove <name> from the game?">×</button>`.
  The confirm is required (no accidental boots).
- A line "Joining next round: A, B" when `waiting` is non-empty, each name
  with the same remove button (confirm text "Remove <name>?").
- The lobby is unchanged.

**Phone**:
- The join form works in every phase. When the phase is not the lobby,
  it says a game is in progress and they'll be dealt in at the start of
  the next round.
- A waiting player (their id is in `state.waiting`) sees "You're in! You'll
  be dealt in at the start of the next round.", the current scores, and a
  Leave button (`data-emit="leave"`).
- Score grids render `null` round entries as "–".

## Server

`server/rooms.js`: `join` checks capacity against seated plus waiting;
`playerFor(token)` accepts a waiting player too, so a waiting phone that
reconnects keeps its place.

## Acceptance

Per game, engine tests cover:
- join mid-round goes to `waiting`, is in the view, capacity counts it;
- the next round seats them with last place's score (Five Crowns: the
  highest) and padded roundScores; `reset()` seats them at 0;
- removing a waiting player;
- removing a player mid-round in each case the game section names (their
  turn, not their turn, dealer, pending interaction), and the round then
  plays to completion with the remaining players (no stuck state);
- removing down to 1 player abandons the round;
- no view or log leaks the removed player's hidden cards.

`npm test` passes. Pages: board shows the remove buttons and the waiting
line; phone join/waiting views work with `?seat=` players.
