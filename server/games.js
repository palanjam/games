// Every game the platform offers. To add one, create games/<id>/ with an
// index.js descriptor (see games/flip7/index.js) and a public/ folder holding
// play.html and board.html, then list it here.
//
// A descriptor's `create()` returns an engine with: players[] (objects with
// id and name), phase ('lobby' while players may join), addPlayer(id, name),
// removePlayer(id), player(id), start(), reset() and view(playerId), where
// view(null) is what the shared table screen sees. Rule violations throw
// GameError (server/game-error.js).
import flip7 from '../games/flip7/index.js';
import coverYourAssets from '../games/cover-your-assets/index.js';
import fiveCrowns from '../games/five-crowns/index.js';
import handAndFoot from '../games/hand-and-foot/index.js';
import ohHell from '../games/oh-hell/index.js';

export const games = new Map([flip7, coverYourAssets, fiveCrowns, handAndFoot, ohHell].map((g) => [g.id, g]));
