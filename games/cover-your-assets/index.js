import { Game, GameError, MIN_PLAYERS, MAX_PLAYERS } from './engine.js';

// When the player who must act has dropped off, the board can act for them:
// give up a battle, or discard their lowest-value card on their turn.
function autoplay(game) {
  if (game.phase !== 'playing') throw new GameError('No round is in progress.');
  const actor = game.battle?.toMoveId ?? game.turnId;
  const p = actor && game.player(actor);
  if (!p || p.connected) throw new GameError('The current player is connected.');
  if (game.battle) return game.fold(actor);
  const lowest = p.hand.reduce((low, c) => (c.value < low.value ? c : low));
  game.discardCard(actor, lowest.id);
}

export default {
  id: 'cover-your-assets',
  name: 'Cover Your Assets',
  blurb: 'Pair up assets, stack them high and steal the top set from your rivals. First to $1,000,000 wins.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  create: () => new Game(),
  // Game-specific socket events. `me()` returns the sender's player id or throws.
  actions: {
    setMode: (game, { mode }) => game.setMode(mode),
    pair: (game, { cardIds }, me) => game.pair(me(), cardIds),
    pairDiscard: (game, { cardId }, me) => game.pairDiscard(me(), cardId),
    discard: (game, { cardId }, me) => game.discardCard(me(), cardId),
    challenge: (game, { targetId, cardId }, me) => game.challenge(me(), targetId, cardId),
    respond: (game, { cardId }, me) => game.respond(me(), cardId),
    fold: (game, _arg, me) => game.fold(me()),
    nextRound: (game) => game.nextRound(),
    autoplay,
  },
};
