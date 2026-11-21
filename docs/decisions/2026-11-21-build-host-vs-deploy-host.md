---
type: gotcha
date: 2026-11-21
---
# The dev machine only builds; the app runs on the production Docker VM

Context: a handoff said to deploy "on this server" behind Traefik, but the
dev machine (hostname `claude`) has no Traefik, no `frontend` network and
nothing on ports 80/443, so `docker compose up` there fails with "network
frontend not found".

Gotcha: Traefik and its `frontend` network live on the production Docker VM,
a different host. Develop, test and build here; run `docker compose up` on
the production VM.

Workaround: don't try to deploy from the dev machine. Check `.env` values
(entrypoint, cert resolver) against the Traefik config on the production VM.
