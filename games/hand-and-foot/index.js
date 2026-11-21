import { Game, GameError, MIN_PLAYERS, MAX_PLAYERS, cardValue, isWild, isRedThree } from './engine.js';

// The card autoplay throws away: a red 3 if held, else the highest-value
// natural card, else (only wilds left) the cheapest wild. Ties go to the
// first such card. Returns null if no discard is legal.
export function autoDiscard(game, p) {
  if (p.hand.length === 1 && p.inFoot && !game.canGoOut(p)) return null;
  const redThree = p.hand.find(isRedThree);
  if (redThree) return redThree;
  const best = (cards, better) => cards.reduce((a, c) => (a && !better(c, a) ? a : c), null);
  return (
    best(p.hand.filter((c) => !isWild(c)), (c, a) => cardValue(c) > cardValue(a)) ??
    best(p.hand, (c, a) => cardValue(c) < cardValue(a))
  );
}

// When the turn player has dropped off, the board can play for them: draw
// from the stock, meld nothing, and discard (see autoDiscard).
function autoplay(game) {
  if (game.phase !== 'playing') throw new GameError('No round is in progress.');
  const p = game.player(game.turnId);
  if (!p || (p.connected ?? true)) throw new GameError('The current player is connected.');
  if (game.stage === 'draw') {
    game.draw(p.id);
    if (game.phase !== 'playing') return; // the stock was empty: round over
  }
  const card = autoDiscard(game, p);
  if (!card) throw new GameError(`${p.name} has no legal discard.`);
  game.discardCard(p.id, card.id);
}

export default {
  id: 'hand-and-foot',
  name: 'Hand and Foot',
  blurb: 'Canasta-style rummy, every player for themselves: play your hand, then your foot, build books, and go out with 2 clean and 1 dirty. Highest score after 4 rounds wins.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  create: () => new Game(),
  // Game-specific socket events. `me()` returns the sender's player id or throws.
  actions: {
    draw: (game, _arg, me) => game.draw(me()),
    pickup: (game, { melds }, me) => game.pickup(me(), melds),
    meld: (game, { melds }, me) => game.meld(me(), melds),
    discard: (game, { cardId }, me) => game.discardCard(me(), cardId),
    nextRound: (game) => game.nextRound(),
    autoplay,
  },
};
