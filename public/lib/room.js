// Client side of a room: the socket, the stored seat token and the room info.
// Pages live at /r/<code> (phone) and /r/<code>/board (table screen).

export const code = location.pathname.split('/')[2]?.toUpperCase() ?? '';
export const socket = window.io({ auth: { room: code } });

// The room was closed (or never existed): back to the home page.
socket.on('gone', () => location.replace(`/?missing=${encodeURIComponent(code)}`));

export const roomInfo = fetch(`/api/rooms/${code}`).then((r) => (r.ok ? r.json() : null));

// `?seat=2` gives a separate identity, handy for testing several players in one browser.
const KEY = `token:${code}${new URLSearchParams(location.search).get('seat') ?? ''}`;
export const token = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} },
};

// Phone pages: rejoin our seat on every (re)connect. `onYou` gets our player
// id, or null when we still need to join.
export function claimSeat(onYou) {
  socket.on('connect', () => socket.emit('hello', { token: token.get() }));
  socket.on('you', ({ playerId, token: t }) => {
    token.set(t ?? null);
    onYou(playerId);
  });
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

let toastTimer;
export function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

socket.on('problem', toast);

// Share the room link from a phone (native share sheet, else copy).
export async function shareRoom() {
  const info = await roomInfo;
  if (!info) return;
  try {
    if (navigator.share) await navigator.share({ title: info.gameName, url: info.joinUrl });
    else { await navigator.clipboard.writeText(info.joinUrl); toast('Link copied'); }
  } catch {}
}

// Delegated click handling: <button data-emit="event" data-arg='{"k":"v"}'>
// and <button data-share> for the room link.
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-share]')) return shareRoom();
  const btn = e.target.closest('[data-emit]');
  if (!btn) return;
  const arg = btn.dataset.arg ? JSON.parse(btn.dataset.arg) : {};
  if (btn.dataset.confirm && !confirm(btn.dataset.confirm)) return;
  socket.emit(btn.dataset.emit, arg);
});
