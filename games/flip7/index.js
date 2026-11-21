import { Game, GameError, MIN_PLAYERS, MAX_PLAYERS, TARGET_SCORE } from './engine.js';

// When the player who must act has dropped off, the board can act for them:
// pick a random target for a pending choice, or stay on their turn.
function autoplay(game) {
  const actor = game.pending?.chooserId ?? game.turnId;
  if (!actor || game.player(actor)?.connected) throw new GameError('The current player is connected.');
  if (game.pending) {
    const { options } = game.pending;
    game.choose(actor, options[Math.floor(Math.random() * options.length)]);
  } else {
    game.stay(actor);
  }
}

export default {
  id: 'flip7',
  name: 'Flip 7',
  blurb: `Push your luck: flip cards for points, but a duplicate number busts you. First to ${TARGET_SCORE} wins.`,
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  create: () => new Game(),
  // Game-specific socket events. `me()` returns the sender's player id or throws.
  actions: {
    hit: (game, _arg, me) => game.hit(me()),
    stay: (game, _arg, me) => game.stay(me()),
    choose: (game, { targetId }, me) => game.choose(me(), targetId),
    nextRound: (game) => game.nextRound(),
    autoplay,
  },
};
