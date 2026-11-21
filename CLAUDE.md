# Project notes

- Games live in `games/<id>/` and are registered in `server/games.js`; the engine contract is documented there. See `docs/decisions/2026-11-21-multi-game-rooms.md`.
- Every socket gets `game.view(playerId)`; a game with hidden information must leave other players' hands and deck order out of it.
- Pages use absolute paths (`/g/<id>/…`, `/lib/room.js`), so the app is served at the root of a host; don't add relative paths assuming a sub-path.
- The container's only network is internal; Traefik must join `games-proxy` or requests 502/504. See `docs/decisions/2026-11-21-hardened-container.md`.
