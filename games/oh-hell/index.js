import { Game, GameError, MIN_PLAYERS, MAX_PLAYERS, cardName } from './engine.js';

// The card autoplay plays: the lowest legal card (ties go to the suit order
// hearts, diamonds, clubs, spades).
export function autoCard(game, p) {
  const order = ['hearts', 'diamonds', 'clubs', 'spades'];
  return game
    .playableCards(p)
    .reduce((a, c) => (!a || c.rank < a.rank || (c.rank === a.rank && order.indexOf(c.suit) < order.indexOf(a.suit)) ? c : a), null);
}

// When the turn player has dropped off, the board acts for them: bid the
// smallest legal bid, or play the lowest legal card.
function autoplay(game) {
  if (game.phase !== 'playing') throw new GameError('No round is in progress.');
  const p = game.player(game.turnId);
  if (!p || (p.connected ?? true)) throw new GameError('The current player is connected.');
  if (game.stage === 'bid') {
    game.bid(p.id, game.forbiddenBid === 0 ? 1 : 0);
    return;
  }
  const card = autoCard(game, p);
  if (!card) throw new GameError(`${p.name} has no legal card to play.`);
  game.play(p.id, card.id);
}

export { cardName };

export default {
  id: 'oh-hell',
  name: 'Oh Hell',
  blurb: 'Trick-taking with a twist: bid exactly how many tricks you will win, with trump changing every round. Hit your bid for 10 bonus points; the dealer can never make the bids add up.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  create: () => new Game(),
  // Game-specific socket events. `me()` returns the sender's player id or throws.
  actions: {
    setPattern: (game, { pattern }) => game.setPattern(pattern),
    bid: (game, { bid }, me) => game.bid(me(), bid),
    play: (game, { cardId }, me) => game.play(me(), cardId),
    nextRound: (game) => game.nextRound(),
    autoplay,
  },
};
