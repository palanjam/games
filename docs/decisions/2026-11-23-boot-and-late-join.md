---
type: decision
date: 2026-11-23
---
# Players can be booted mid-round and can join a game in progress

Context: the user wanted to boot players who leave and to add players
mid-session. Engines only accepted joins in the lobby and removals between
rounds.

Decision: a boot (table screen ×, or a phone's Leave) removes the player at
once, mid-round included; their hidden cards leave play and the round goes
on. A late joiner waits in the engine's `waiting` list and is seated when
the next round starts, with last place's score (the highest score in Five
Crowns, where low wins) and `null` round entries for rounds missed. Under 2
players left abandons the round. Full contract: specs/manage-players.md.

Why: the user picked these over "leave at the end of the round" (server
plays their turns until then) and over starting late joiners at 0 or at the
average. Waiting lives in each engine, not the server, because only the
engine knows when a round starts and how seating affects dealer, deck and
hand size.
