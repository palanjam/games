# Flip 7 — Digital Table

## Goal

A digital version of the Flip 7 card game for playing in the same room. A
local server hosts the game; players join from their phones' browsers; a
shared screen (TV or monitor) shows the whole table so everyone can see what
is in play.

## Requirements

- Runs as a single local server on the home network. No accounts, no internet.
- **Phone client**: join with a name, see your own cards and score, act on
  your turn (hit / stay), and make choices the rules demand (Freeze / Flip
  Three targets, giving away a spare Second Chance).
- **Board page**: shows every player's cards, round score, total score and
  status, whose turn it is, and recent events. Shows a QR code / URL so
  players can join.
- Full Flip 7 rules: 94-card deck, busts on duplicates, Second Chance, Freeze,
  Flip Three (with held actions), x2 and +modifiers, Flip 7 bonus of 15,
  rotating dealer, first to 200 wins.
- Players who reload or lose connection rejoin their seat automatically.

## Out of scope (initially)

- Internet play, accounts, persistence across server restarts.
- Joining mid-game (players join in the lobby).

## Initial approach

Node.js server with Express for static pages and Socket.IO for real-time
updates. The server holds the authoritative game state in a pure rules engine
and broadcasts it to all clients after every action. Clients are plain
HTML/CSS/JS with no build step.
