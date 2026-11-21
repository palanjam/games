import { Game, GameError, MIN_PLAYERS, MAX_PLAYERS } from './engine.js';
import { bestDiscard } from './public/melds.js';

// When the turn player has dropped off, the board can play for them: draw
// from the deck, then make the discard that leaves the fewest points, going
// out if that melds the whole hand.
function autoplay(game) {
  if (game.phase !== 'playing') throw new GameError('No round is in progress.');
  const p = game.player(game.turnId);
  if (!p || p.connected) throw new GameError('The current player is connected.');
  if (game.stage === 'draw') game.draw(p.id, 'deck');
  const { cardId, points } = bestDiscard(p.hand, game.wildRank);
  game.discardCard(p.id, cardId, points === 0);
}

export default {
  id: 'five-crowns',
  name: 'Five Crowns',
  blurb: 'The five-suited rummy game: eleven rounds, a new wild card each round. Meld your hand and go out; lowest score wins.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  create: () => new Game(),
  // Game-specific socket events. `me()` returns the sender's player id or throws.
  actions: {
    draw: (game, { from }, me) => game.draw(me(), from),
    discard: (game, { cardId, goOut }, me) => game.discardCard(me(), cardId, goOut === true),
    nextRound: (game) => game.nextRound(),
    autoplay,
  },
};
