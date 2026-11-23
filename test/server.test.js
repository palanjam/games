import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createGameServer } from '../server/app.js';

let url;
let server;
const clients = [];

before(async () => {
  ({ httpServer: server } = createGameServer({ port: 0, publicUrl: 'https://games.example.com/' }));
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://localhost:${server.address().port}`;
});

after(() => {
  for (const c of clients) c.close();
  server.close();
});

const post = (path, body) =>
  fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function createRoom(gameId) {
  const res = await post('/api/rooms', { gameId });
  assert.equal(res.status, 200);
  return (await res.json()).code;
}

// A socket in `room`, with a helper that resolves on the next `event`.
function client(room) {
  const socket = connect(url, { auth: { room }, transports: ['websocket'], forceNew: true });
  clients.push(socket);
  socket.next = (event) => new Promise((resolve) => socket.once(event, resolve));
  return socket;
}

async function join(room, name) {
  const s = client(room);
  await s.next('state');
  const youP = s.next('you');
  const stateP = new Promise((resolve) => s.once('you', () => s.once('state', resolve)));
  s.emit('join', { name });
  const [you] = await Promise.all([youP, stateP]); // `you`, then the join broadcast
  return Object.assign(s, { playerId: you.playerId, token: you.token });
}

test('lists games and rejects unknown ones', async () => {
  const games = await (await fetch(`${url}/api/games`)).json();
  assert.ok(games.some((g) => g.id === 'flip7'));
  assert.equal((await post('/api/rooms', { gameId: 'nope' })).status, 400);
});

test('room info uses PUBLIC_URL for the join link', async () => {
  const code = await createRoom('flip7');
  assert.match(code, /^[A-Z]{4}$/);
  const info = await (await fetch(`${url}/api/rooms/${code.toLowerCase()}`)).json();
  assert.equal(info.joinUrl, `https://games.example.com/r/${code}`);
  assert.match(info.qrSvg, /^<svg/);
  assert.equal((await fetch(`${url}/api/rooms/ZZZZ`)).status, 404);
});

test('room pages serve the game, unknown rooms redirect home', async () => {
  const code = await createRoom('flip7');
  const page = await fetch(`${url}/r/${code}`);
  assert.match(await page.text(), /\/g\/flip7\/player\.js/);
  const board = await fetch(`${url}/r/${code}/board`);
  assert.match(await board.text(), /\/g\/flip7\/board\.js/);
  const missing = await fetch(`${url}/r/QQQQ`, { redirect: 'manual' });
  assert.equal(missing.status, 302);
  assert.equal(missing.headers.get('location'), '/?missing=QQQQ');
});

test('sockets for an unknown room are told it is gone', async () => {
  const s = client('QQQQ');
  await s.next('gone');
});

test('rooms are isolated and players rejoin with their token', async () => {
  const a = await createRoom('flip7');
  const b = await createRoom('flip7');
  const ann = await join(a, 'Ann');
  const bob = await join(a, 'Bob');
  const other = await join(b, 'Cat');

  const annState = ann.next('state');
  const otherSaw = [];
  other.on('state', (s) => otherSaw.push(s));
  ann.emit('start');
  const s = await annState;
  assert.equal(s.phase, 'playing');
  assert.deepEqual(s.players.map((p) => p.name), ['Ann', 'Bob']);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(otherSaw.length, 0, 'other room got no broadcast');

  // Reconnect as Bob with the stored token.
  bob.close();
  const again = client(a);
  await again.next('state');
  again.emit('hello', { token: bob.token });
  assert.equal((await again.next('you')).playerId, bob.playerId);
});

test('game actions are routed, unknown events ignored, rule errors reported', async () => {
  const code = await createRoom('flip7');
  const ann = await join(code, 'Ann');
  ann.emit('hit');
  assert.equal(await ann.next('problem'), 'No round is in progress.');
  ann.emit('constructor');
  ann.emit('start');
  assert.equal(await ann.next('problem'), 'Need at least 2 players.');
});

test('late joiners wait for the next round, keep their place on reconnect, and can be booted', async () => {
  const code = await createRoom('flip7');
  const ann = await join(code, 'Ann');
  await join(code, 'Bob');
  // Resolves on the first state broadcast that passes `ok`.
  const until = (s, ok) => new Promise((resolve) => {
    const on = (st) => { if (ok(st)) { s.off('state', on); resolve(st); } };
    s.on('state', on);
  });
  const started = until(ann, (st) => st.phase === 'playing');
  ann.emit('start');
  await started;

  const seen = until(ann, (st) => st.waiting.length > 0);
  const cat = await join(code, 'Cat');
  assert.ok(cat.playerId);
  const s = await seen;
  assert.deepEqual(s.waiting.map((w) => w.name), ['Cat']);
  assert.ok(!s.players.some((p) => p.id === cat.playerId));

  cat.close();
  const again = client(code);
  await again.next('state');
  again.emit('hello', { token: cat.token });
  assert.equal((await again.next('you')).playerId, cat.playerId);

  const told = again.next('you');
  ann.emit('kick', { playerId: cat.playerId });
  assert.equal((await told).playerId, null);
});
