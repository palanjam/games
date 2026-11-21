# Cover Your Assets

Grandpa Beck's *Cover Your Assets* (classic rules), one of the games on the
[Game Night](../../README.md) server. 2–6 players, each on their phone; a TV
can show every stack. The full rules and the view contract are in
[specs/cover-your-assets.md](../../specs/cover-your-assets.md).

## How to play

Start a Cover Your Assets lobby from the home page, pick **Classic** (rounds
until someone reaches $1,000,000) or **Quick** (one round), and start once
everyone has joined.

On your turn, tap cards in your hand and use the buttons, which only light
up for legal moves:

- **Make a set**: two matching assets, or one asset and a wild (Silver/Gold).
- **Pair with discard**: one hand card with the top of the discard pile.
- **Discard**: put one card on the discard pile.
- **Steal…**: challenge another player's top set with a matching asset or a
  wild. You need a set of your own, and each player's bottom set is safe.
  You then take turns playing matching cards or giving up; whoever plays
  last takes the set and every card played.

You draw back up to five after your turn. When the deck and every hand are
empty, each player scores the value of all their sets.

If someone drops out, the table screen can act for them (give up a battle,
or discard their lowest card).

## Card values

The rulebook gives the card counts but not the dollar values, so these are
inferred from its card order. If your deck says otherwise, change the
`ASSETS` table in `engine.js`.

| $5K | $10K | $15K | $20K | Wild |
|-----|------|------|------|------|
| Baseball Cards ×10, Coin Collection ×10, Piggy Bank ×10 | Cash Under the Mattress ×9, Bank Account ×9, Stocks ×9 | Speed Boat ×9, Jewels ×9, Classic Auto ×9 | Home ×8 | Silver $25K ×8, Gold $50K ×4 |

Not implemented: the advanced rules (Swap, Move, Penny Jar, two actions per
turn) and the 2–3 player draft-pile variant.

## How the engine works

- **`engine.js`**: a pure state machine. A battle is the only multi-step
  action: it holds the turn, alternating between challenger and defender,
  and a side that holds no matching card loses at once. `view(playerId)`
  includes only that player's own hand; others see hand sizes.
- **`index.js`**: the socket actions (`setMode`, `pair`, `pairDiscard`,
  `discard`, `challenge`, `respond`, `fold`, `nextRound`, `autoplay`).
- **`public/`**: phone page (`play.html`, `player.js`) and table screen
  (`board.html`, `board.js`), sharing `ui.js` and `style.css`.
- **`test/`**: engine tests with stacked decks.
