import { randomInt, randomUUID } from 'node:crypto';
import { GameError } from './game-error.js';

// No vowels or look-alikes (0/O, 1/I/L), so codes are easy to read out and
// never spell words.
const CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXZ';
const CODE_LENGTH = 4;

// A lobby: one game instance plus the session tokens of the people seated at it.
export class Room {
  constructor(code, def) {
    this.code = code;
    this.def = def;
    this.game = def.create();
    this.tokens = new Map(); // session token -> player id
    this.sockets = new Map(); // player id -> number of connected sockets
    this.touch();
  }

  touch() {
    this.lastActive = Date.now();
  }

  // Socket.IO room name, so rooms never receive each other's broadcasts.
  get channel() {
    return `room:${this.code}`;
  }

  playerFor(token) {
    const id = this.tokens.get(token);
    return id && this.game.player(id) ? id : null;
  }

  join(name) {
    if (this.game.players.length >= this.def.maxPlayers) {
      throw new GameError(`The table is full (${this.def.maxPlayers} players).`);
    }
    const id = randomUUID();
    this.game.addPlayer(id, name);
    const token = randomUUID();
    this.tokens.set(token, id);
    return { id, token };
  }

  attach(playerId) {
    this.sockets.set(playerId, (this.sockets.get(playerId) ?? 0) + 1);
  }

  detach(playerId) {
    this.sockets.set(playerId, Math.max(0, (this.sockets.get(playerId) ?? 1) - 1));
  }

  remove(playerId) {
    this.game.removePlayer(playerId);
    for (const [token, id] of this.tokens) if (id === playerId) this.tokens.delete(token);
    this.sockets.delete(playerId);
  }

  // Engines read `connected` to show who is offline and to allow autoplay.
  syncConnected() {
    for (const p of this.game.players) p.connected = (this.sockets.get(p.id) ?? 0) > 0;
  }
}

export class Rooms {
  constructor({ maxRooms, idleMs }) {
    this.maxRooms = maxRooms;
    this.idleMs = idleMs;
    this.rooms = new Map();
  }

  get(code) {
    return this.rooms.get(String(code ?? '').toUpperCase());
  }

  create(def) {
    this.sweep();
    if (this.rooms.size >= this.maxRooms) throw new GameError('Too many games are running right now. Try again later.');
    let code;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, def);
    this.rooms.set(code, room);
    return room;
  }

  // Close rooms nobody has used for a while (any connection or action counts
  // as use). Their players' phones fall back to the home page.
  sweep() {
    const cutoff = Date.now() - this.idleMs;
    for (const [code, room] of this.rooms) if (room.lastActive < cutoff) this.rooms.delete(code);
  }
}
