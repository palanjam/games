---
type: decision
date: 2026-11-21
supersedes: 2026-11-21-hardened-container.md
---
# Join Traefik's existing `frontend` network instead of a private internal one

Context: the first compose file put the container on its own `internal: true`
network that Traefik had to join. The host's Traefik already serves its
apps on an external network named `frontend`, and that is the network to use.

Decision: the service's only network is the external `frontend` network
(`traefik.docker.network=frontend`). All other hardening stays: distroless
non-root image, read-only filesystem, `cap_drop: ALL`, `no-new-privileges`,
resource limits, no published ports, no volumes.

Trade-off: unless `frontend` is itself `internal`, the container now has
outbound internet access, and it can reach every other container on
`frontend` (and their unauthenticated ports). To get the stricter isolation
back without changing Traefik's setup, add a second, `internal: true`
network shared only by Traefik and this app and route through it.
