import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { Game, GameError } from './src/game.js';

const PORT = Number(process.env.PORT) || 3000;
const publicDir = fileURLToPath(new URL('./public', import.meta.url));

function lanAddress() {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return 'localhost';
}

const joinUrl = process.env.PUBLIC_URL || `http://${lanAddress()}:${PORT}/`;
const qrSvg = await QRCode.toString(joinUrl, { type: 'svg', margin: 1 });

const game = new Game();
const tokens = new Map(); // session token -> player id
const sockets = new Map(); // player id -> number of connected sockets

const app = express();
app.use(express.static(publicDir));
app.get('/board', (_req, res) => res.sendFile(`${publicDir}/board.html`));
app.get('/api/info', (_req, res) => res.json({ joinUrl, qrSvg }));

const httpServer = createServer(app);
const io = new Server(httpServer);

function broadcast() {
  for (const p of game.players) p.connected = (sockets.get(p.id) ?? 0) > 0;
  io.emit('state', game.toJSON());
}

function attach(socket, playerId) {
  socket.data.playerId = playerId;
  sockets.set(playerId, (sockets.get(playerId) ?? 0) + 1);
}

function forget(playerId) {
  for (const [token, id] of tokens) if (id === playerId) tokens.delete(token);
  sockets.delete(playerId);
  for (const s of io.sockets.sockets.values()) {
    if (s.data.playerId === playerId) {
      s.data.playerId = null;
      s.emit('you', { playerId: null });
    }
  }
}

// When the player who must act has dropped off, the board can act for them:
// pick a random target for a pending choice, or stay on their turn.
function autoplay() {
  const actor = game.pending?.chooserId ?? game.turnId;
  if (!actor || game.player(actor)?.connected) throw new GameError('The current player is connected.');
  if (game.pending) {
    const { options } = game.pending;
    game.choose(actor, options[Math.floor(Math.random() * options.length)]);
  } else {
    game.stay(actor);
  }
}

io.on('connection', (socket) => {
  // Wrap a handler so rule violations go back to the sender and every change is broadcast.
  const on = (event, fn) =>
    socket.on(event, (arg = {}) => {
      try {
        fn(arg);
        broadcast();
      } catch (err) {
        if (!(err instanceof GameError)) console.error(err);
        socket.emit('problem', err instanceof GameError ? err.message : 'Something went wrong.');
      }
    });
  const me = () => {
    if (!socket.data.playerId) throw new GameError('Join the game first.');
    return socket.data.playerId;
  };

  on('hello', ({ token }) => {
    const playerId = tokens.get(token);
    if (playerId && game.player(playerId)) {
      attach(socket, playerId);
      socket.emit('you', { playerId, token });
    } else {
      socket.emit('you', { playerId: null });
    }
  });

  on('join', ({ name }) => {
    if (socket.data.playerId) return;
    const id = randomUUID();
    game.addPlayer(id, name);
    const token = randomUUID();
    tokens.set(token, id);
    attach(socket, id);
    socket.emit('you', { playerId: id, token });
  });

  on('leave', () => {
    const id = me();
    game.removePlayer(id);
    forget(id);
  });

  on('hit', () => game.hit(me()));
  on('stay', () => game.stay(me()));
  on('choose', ({ targetId }) => game.choose(me(), targetId));

  // Table-level controls, available to players and the board alike.
  on('start', () => game.start());
  on('nextRound', () => game.nextRound());
  on('newGame', () => game.reset());
  on('autoplay', () => autoplay());
  on('kick', ({ playerId }) => {
    game.removePlayer(playerId);
    forget(playerId);
  });

  socket.on('disconnect', () => {
    const id = socket.data.playerId;
    if (id) sockets.set(id, Math.max(0, (sockets.get(id) ?? 1) - 1));
    broadcast();
  });

  socket.emit('state', game.toJSON());
});

httpServer.listen(PORT, () => {
  console.log(`Flip 7 is running.`);
  console.log(`  Table screen:  http://localhost:${PORT}/board`);
  console.log(`  Players join:  ${joinUrl}`);
});
