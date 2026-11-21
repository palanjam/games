---
type: decision
date: 2026-11-21
supersedes: 2026-11-20-public-state-broadcast.md
---
# One server hosts many games, each lobby is a room with its own per-player view

Context: the Flip 7 server ran a single game for one household. It is
becoming a hub where anyone can pick a game, start a lobby and share it,
including over the internet behind Traefik, and the next game (Cover Your
Assets) has private hands.

Decision: games live in `games/<id>/` as a descriptor (`index.js`), a pure
engine and their own static pages, registered in `server/games.js`. The
server keeps rooms keyed by a 4-letter code (`/r/<code>`, `/r/<code>/board`);
sockets name their room in the handshake (`auth.room`) and join a Socket.IO
room, so broadcasts never cross lobbies. After every action each socket gets
`game.view(playerId)` (the board gets `view(null)`), so an engine decides
what each seat may see. Lobby events (hello, join, leave, kick, start,
newGame) are common; any other event is looked up in the descriptor's
`actions`.

Why: per-player views are the minimum needed for hidden hands, and Flip 7
keeps its one public view by ignoring the argument. Rooms are in memory and
closed after ROOM_IDLE_HOURS without use, capped at MAX_ROOMS, which is
enough for family use; no accounts. Rejected: one process per game (more to
deploy), a base-path setting for hosting under a sub-path (pages use
absolute URLs, so host at the root of a subdomain instead).
