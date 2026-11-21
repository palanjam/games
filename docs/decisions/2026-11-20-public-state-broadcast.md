---
type: decision
date: 2026-11-20
---
# Broadcast one public game state to every client

Context: phones and the board all need to show the table, and the server must
stay authoritative.

Decision: the engine's `toJSON()` is the only view; the server emits it to all
sockets after every action. Clients learn their own seat from a separate `you`
event and render from the shared state.

Why: in Flip 7 every card is face up, so there is no hidden information to
filter per player. One view keeps the server trivial. If a variant ever adds
hidden information, this must become a per-player view.
