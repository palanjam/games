import { Game, MIN_PLAYERS, MAX_PLAYERS } from './engine.js';

// The board plays for disconnected players (see Game.autoplay).
function autoplay(game) {
  game.autoplay();
}

export default {
  id: 'fits-the-bill',
  name: 'Fits the Bill',
  blurb: 'One player judges a describing word; everyone else plays the thing they think fits it best. Win rounds, collect words, first to the target wins.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  create: () => new Game(),
  // Game-specific socket events. `me()` returns the sender's player id or throws.
  actions: {
    setTarget: (game, { target }) => game.setTarget(target),
    submit: (game, { cardId }, me) => game.submit(me(), cardId),
    pick: (game, { submissionId }, me) => game.pick(me(), submissionId),
    nextRound: (game) => game.nextRound(),
    autoplay,
  },
};

