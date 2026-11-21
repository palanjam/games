---
type: decision
date: 2026-11-21
---
# Run in a locked-down container on an internal network shared only with Traefik

Context: the server will be reachable from the internet behind Traefik on a
home server. A future CVE in Node, Express or Socket.IO must not let an
attacker move laterally into the host or the LAN.

Decision: distroless `nodejs22-debian12:nonroot` image (no shell, no package
manager, uid 65532, root-owned code). Compose runs it `read_only`, with
`cap_drop: ALL`, `no-new-privileges`, memory/pid/CPU limits, no published
ports and no volumes. Its only network, `games-proxy`, is `internal: true`:
Docker gives it no route out, so the container can reach Traefik and nothing
else (verified: outbound DNS fails with EAI_AGAIN).

Gotcha: Traefik must be attached to `games-proxy` (as an external network in
Traefik's compose file, or `docker network connect games-proxy traefik`), or
it routes to an unreachable IP and returns 502/504. Anything else attached to
that network, including Traefik's own API/dashboard port, is reachable from
the game container, so keep the network dedicated to this app.

Why: the app needs no outbound access, no disk and no privileges; everything
is in memory. Rejected: an alpine image with npm removed (still has a shell
and more packages to patch).
