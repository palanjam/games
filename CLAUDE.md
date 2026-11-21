# Project notes

- Games live in `games/<id>/` and are registered in `server/games.js`; the engine contract is documented there. See `docs/decisions/2026-11-21-multi-game-rooms.md`.
- Every socket gets `game.view(playerId)`; a game with hidden information must leave other players' hands and deck order out of it.
- Pages use absolute paths (`/g/<id>/…`, `/lib/room.js`), so the app is served at the root of a host; don't add relative paths assuming a sub-path.
- The container's only network is Traefik's external `frontend` network; the `traefik.docker.network` label must match it. See `docs/decisions/2026-11-21-traefik-frontend-network.md`.
- This machine only builds and tests; Traefik and the `frontend` network are on the production Docker VM, where the container runs. See `docs/decisions/2026-11-21-build-host-vs-deploy-host.md`.
