# Cover Your Assets

Add Grandpa Beck's *Cover Your Assets* (classic rules, 2024 rulebook) as the
second game on the platform, at `games/cover-your-assets/`.

## Rules implemented

**Deck (104 cards, advanced cards removed).** Card values are not in the
rulebook text; they are inferred from the rulebook's card order and counts
and live in one table so they are easy to correct.

| Key | Name | Count | Value |
|-----|------|-------|-------|
| baseball | Baseball Cards | 10 | 5,000 |
| coins | Coin Collection | 10 | 5,000 |
| piggy | Piggy Bank | 10 | 5,000 |
| cash | Cash Under the Mattress | 9 | 10,000 |
| bank | Bank Account | 9 | 10,000 |
| stocks | Stocks | 9 | 10,000 |
| boat | Speed Boat | 9 | 15,000 |
| jewels | Jewels | 9 | 15,000 |
| auto | Classic Auto | 9 | 15,000 |
| home | Home | 8 | 20,000 |
| silver (wild) | Silver | 8 | 25,000 |
| gold (wild) | Gold | 4 | 50,000 |

**Setup.** 2–6 players. Deal 5 cards each, starting left of the dealer; flip
one card face up to start the discard pile. The player left of the dealer
goes first. The dealer rotates each round; every round starts from a fresh
shuffled full deck.

**A turn** is exactly one action:

1. **Form a set from hand**: two identical assets, or one asset + one wild.
   Never two wilds, never more than two cards.
2. **Form a set with the discard**: one hand card + the top discard, same
   pairing rules (either one may be the wild, not both). The next card down
   becomes the top discard.
3. **Discard** one card face up onto the discard pile.
4. **Challenge** (attempt to steal): you must already have ≥1 set; the
   target (not you) must have ≥2 sets, because each player's first (bottom)
   set is safe. Only the target's top set can be challenged. Play an asset
   matching that set or any wild. Then the defender and challenger take
   turns, each playing one matching asset or wild, or giving up. A side that
   gives up, or has no matching asset or wild in hand, loses (resolve
   automatically when the side to move holds no eligible card). The winner
   takes the contested set plus every card played in the battle as one set:
   if the challenger wins it goes on top of the challenger's stack; if the
   defender wins, the battle cards join the defender's same top set. No
   drawing during a battle.

A new set always goes on top of your stack and is never merged with an
existing set of the same asset. Within a set, wilds sit below assets (store
wilds first, assets last, so the top card is an asset).

**End of turn**: the turn player draws back up to 5 (while the deck lasts),
then, if a defender played cards during this turn, the defender draws back
up to 5. Play passes left, skipping players with empty hands.

**End of round**: when the deck is empty and every hand is empty. Each
player's round score is the total value of every card in their stack, added
to their running score.

**Game end**, chosen in the lobby:

- `classic` (default): play rounds until someone reaches $1,000,000; the
  highest total then wins (ties share the win).
- `quick`: one round; highest score wins.

Not implemented: advanced rules (Swap, Move, Penny Jar, two actions per
turn) and the 2–3 player draft-pile variant; 2–3 players use classic rules.

## Server contract

`games/cover-your-assets/index.js` default-exports a descriptor shaped like
`games/flip7/index.js` (`id: 'cover-your-assets'`, `name: 'Cover Your
Assets'`, `blurb`, `minPlayers: 2`, `maxPlayers: 6`, `create`, `actions`),
and is added to `server/games.js`. The engine (`engine.js`) is a pure class
with no I/O, importing `GameError` from `../../server/game-error.js`, and
meets the engine contract described in `server/games.js`.

Socket events (game actions; `me()` = sender's player id):

| Event | Arg | Effect |
|-------|-----|--------|
| `setMode` | `{ mode: 'classic' \| 'quick' }` | lobby only |
| `pair` | `{ cardIds: [a, b] }` | form a set from two hand cards |
| `pairDiscard` | `{ cardId }` | form a set with the top discard |
| `discard` | `{ cardId }` | discard a hand card |
| `challenge` | `{ targetId, cardId }` | start a battle |
| `respond` | `{ cardId }` | the side to move plays a card |
| `fold` | `{}` | the side to move gives up |
| `nextRound` | `{}` | from `roundOver` |
| `autoplay` | `{}` | the actor is offline: in a battle they fold; otherwise discard their lowest-value card |

Players may only be removed outside `playing`.

`view(playerId)` returns (hands are private: only the viewer's own hand is
included, other players expose only `handCount`; the deck order is never
exposed):

```js
{
  phase: 'lobby' | 'playing' | 'roundOver' | 'gameOver',
  mode: 'classic' | 'quick',
  round, targetScore: 1000000, handSize: 5,
  dealerId, turnId,
  deckCount, discardCount,
  discardTop: Card | null,
  battle: null | {
    challengerId, defenderId, toMoveId,
    asset,                         // key of the contested set
    set: Set,                      // the contested set as it stands
    plays: [{ playerId, card }],   // cards played so far, in order
  },
  winners: [playerId],
  log: [{ id, text }],             // last 50
  you: null | { id, hand: [Card] },
  players: [{
    id, name, connected, score, roundScore, handCount,
    stack: [Set],                  // bottom first; last = top (stealable if length >= 2)
    stackValue,
  }],
}
// Card: { id, kind: 'asset' | 'wild', asset, name, value }   (wild: asset 'silver' | 'gold')
// Set:  { asset, cards: [Card], value }                       (wilds first, assets last)
```

## Pages

`games/cover-your-assets/public/` holds `play.html` (phone) and
`board.html` (table screen), loading `/socket.io/socket.io.js` and modules
under `/g/cover-your-assets/`. They use `/lib/room.js` (`socket`,
`claimSeat`, `code`, `roomInfo`, `esc`, `toast`, `[data-emit]` and
`[data-share]` click delegation). Look at Flip 7's pages for structure;
give this game its own look (money greens and gold).

- **Phone**: join form; lobby with room code, invite button, table-screen
  link, player list, mode choice, start. In play: your stack, your hand
  (tap to select), the top discard, and buttons enabled only for legal
  moves (Make a set, Pair with discard, Discard, Steal → pick a target whose
  top set the selected card can challenge). Each other player's top set,
  stack size/value and hand size. A battle panel showing the contested set
  and plays; when you are to move, your eligible cards plus Give up.
  Results table with Next round / New game. Must work at 360px wide.
- **Board**: lobby with QR code, URL, room code, players (kick), mode;
  table with every player's stack (top set prominent), deck and discard,
  the current battle, scores toward $1M, a log, an offline-autoplay button,
  and Back to lobby.
