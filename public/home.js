const msg = document.getElementById('msg');
const say = (text) => {
  msg.textContent = text;
  msg.hidden = !text;
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const missing = new URLSearchParams(location.search).get('missing');
if (missing) say(`There's no game with code ${missing.toUpperCase()} any more. Start a new one below.`);

const games = await fetch('/api/games').then((r) => r.json());
document.getElementById('games').innerHTML = games.map((g) => `
  <article class="game ${esc(g.id)}">
    <h2>${esc(g.name)}</h2>
    <p>${esc(g.blurb)}</p>
    <div class="foot">
      <span class="muted">${g.minPlayers}–${g.maxPlayers} players</span>
      <button data-game="${esc(g.id)}">Start a lobby</button>
    </div>
  </article>`).join('');

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-game]');
  if (!btn) return;
  btn.disabled = true;
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId: btn.dataset.game }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return location.assign(`/r/${body.code}`);
  btn.disabled = false;
  say(body.error ?? 'Could not start a lobby.');
});

document.getElementById('join').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.getElementById('code').value.trim().toUpperCase();
  if (!code) return;
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
  if (res.ok) location.assign(`/r/${code}`);
  else say(`No game with code ${code}. Check the code on the host's screen.`);
});
