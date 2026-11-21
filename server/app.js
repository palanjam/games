import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { GameError } from './game-error.js';
import { games } from './games.js';
import { Rooms } from './rooms.js';

const root = fileURLToPath(new URL('..', import.meta.url));

export function lanAddress() {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return 'localhost';
}

// Builds the HTTP + Socket.IO server; the caller decides when to listen.
// `port` is only used to build LAN join links when no publicUrl is set.
export function createGameServer({ port, publicUrl, maxRooms = 50, idleMs = 12 * 3600_000 }) {
  const base = publicUrl?.replace(/\/+$/, '');
  const rooms = new Rooms({ maxRooms, idleMs });

  // Where phones should go. Behind a proxy, set PUBLIC_URL (or rely on the
  // forwarded host); locally, swap localhost for the LAN address so a QR code
  // shown on the TV works from a phone.
  function baseUrl(req) {
    if (base) return base;
    const host = req.get('host') ?? `localhost:${port}`;
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host)) return `http://${lanAddress()}:${port}`;
    return `${req.protocol}://${host}`;
  }

  const app = express();
  // Trust X-Forwarded-* from a reverse proxy on a private network (e.g. Traefik in Docker).
  app.set('trust proxy', 'loopback, uniquelocal');
  app.use(express.json({ limit: '1kb' }));
  app.use(express.static(`${root}/public`));
  for (const id of games.keys()) app.use(`/g/${id}`, express.static(`${root}/games/${id}/public`));

  app.get('/healthz', (_req, res) => res.send('ok'));

  app.get('/api/games', (_req, res) => {
    res.json([...games.values()].map(({ id, name, blurb, minPlayers, maxPlayers }) => ({ id, name, blurb, minPlayers, maxPlayers })));
  });

  app.post('/api/rooms', (req, res) => {
    const def = games.get(req.body?.gameId);
    if (!def) return res.status(400).json({ error: 'Unknown game.' });
    try {
      res.json({ code: rooms.create(def).code });
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      res.status(503).json({ error: err.message });
    }
  });

  app.get('/api/rooms/:code', async (req, res) => {
    const room = rooms.get(req.params.code);
    if (!room) return res.status(404).json({ error: 'No game with that code.' });
    const joinUrl = `${baseUrl(req)}/r/${room.code}`;
    const qrSvg = await QRCode.toString(joinUrl, { type: 'svg', margin: 1 });
    res.json({ code: room.code, gameId: room.def.id, gameName: room.def.name, joinUrl, qrSvg });
  });

  // A room's phone page and table screen come from its game's folder.
  const roomPage = (file) => (req, res) => {
    const room = rooms.get(req.params.code);
    if (!room) return res.redirect(`/?missing=${encodeURIComponent(req.params.code)}`);
    if (req.params.code !== room.code) return res.redirect(req.originalUrl.replace(req.params.code, room.code));
    res.sendFile(`${root}/games/${room.def.id}/public/${file}`);
  };
  app.get('/r/:code', roomPage('play.html'));
  app.get('/r/:code/board', roomPage('board.html'));

  const httpServer = createServer(app);
  const io = new Server(httpServer);

  // Each socket gets the view for its own seat, so games can hide hands.
  function broadcast(room) {
    room.syncConnected();
    const views = new Map();
    for (const id of io.sockets.adapter.rooms.get(room.channel) ?? []) {
      const socket = io.sockets.sockets.get(id);
      const playerId = socket?.data.playerId ?? null;
      if (!views.has(playerId)) views.set(playerId, room.game.view(playerId));
      socket?.emit('state', views.get(playerId));
    }
  }

  function forget(room, playerId) {
    room.remove(playerId);
    for (const id of io.sockets.adapter.rooms.get(room.channel) ?? []) {
      const s = io.sockets.sockets.get(id);
      if (s?.data.playerId === playerId) {
        s.data.playerId = null;
        s.emit('you', { playerId: null });
      }
    }
  }

  // Events every game understands; anything else goes to the game's own actions.
  const COMMON = new Set(['hello', 'join', 'leave', 'kick', 'start', 'newGame']);

  io.on('connection', (socket) => {
    const room = rooms.get(socket.handshake.auth?.room);
    if (!room) {
      socket.emit('gone');
      socket.disconnect(true);
      return;
    }
    room.touch();
    socket.join(room.channel);
    const { game, def } = room;

    // Rule violations go back to the sender only; every change is broadcast.
    const handle = (fn) => (arg) => {
      try {
        room.touch();
        fn(arg && typeof arg === 'object' ? arg : {});
        broadcast(room);
      } catch (err) {
        if (!(err instanceof GameError)) console.error(err);
        socket.emit('problem', err instanceof GameError ? err.message : 'Something went wrong.');
      }
    };
    const on = (event, fn) => socket.on(event, handle(fn));
    const me = () => {
      if (!socket.data.playerId) throw new GameError('Join the game first.');
      return socket.data.playerId;
    };
    const attach = (playerId) => {
      socket.data.playerId = playerId;
      room.attach(playerId);
    };

    on('hello', ({ token }) => {
      if (socket.data.playerId) return;
      const playerId = room.playerFor(token);
      if (playerId) {
        attach(playerId);
        socket.emit('you', { playerId, token });
      } else {
        socket.emit('you', { playerId: null });
      }
    });

    on('join', ({ name }) => {
      if (socket.data.playerId) return;
      const { id, token } = room.join(name);
      attach(id);
      socket.emit('you', { playerId: id, token });
    });

    on('leave', () => forget(room, me()));
    on('kick', ({ playerId }) => forget(room, playerId));
    on('start', () => {
      if (game.players.length < def.minPlayers) throw new GameError(`Need at least ${def.minPlayers} players.`);
      game.start();
    });
    on('newGame', () => game.reset());

    socket.onAny((event, arg) => {
      const action = Object.hasOwn(def.actions, event) && !COMMON.has(event) ? def.actions[event] : null;
      if (action) handle((a) => action(game, a, me))(arg);
    });

    socket.on('disconnect', () => {
      if (socket.data.playerId) room.detach(socket.data.playerId);
      broadcast(room);
    });

    socket.emit('state', game.view(null));
  });

  // Sweep idle rooms periodically, not just when a new one is created.
  setInterval(() => rooms.sweep(), 10 * 60_000).unref();

  return { httpServer, rooms };
}
