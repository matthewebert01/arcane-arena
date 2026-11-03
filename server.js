// Arcane Arena multiplayer server.
//
// Serves the game (index.html) and runs private lobbies over WebSockets:
//   • A host creates a lobby and gets a short invite code (and link: /?join=CODE).
//   • Friends join with the code. The host picks the mode and starts the match.
//   • During a match the host's browser runs the game. This server relays messages:
//     guests' inputs and spells go to the host, and the host's game state goes to every guest.
//   • If a guest leaves, the host is told (an AI takes over their wizard). If the host leaves, the match ends.
//
// Run locally:   npm install   then   npm start   (then open http://localhost:8080)
// The port comes from the PORT environment variable when hosted (Fly.io, Railway, Render...).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const GAME_FILE = path.join(__dirname, 'index.html');
const MAX_SEATS = 3;
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no look-alikes (0/O, 1/I/L)

// ---------- Static page ----------
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/health') { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('ok'); return; }
  if (url.pathname !== '/' && url.pathname !== '/index.html') { response.writeHead(404); response.end('Not found'); return; }
  fs.readFile(GAME_FILE, (error, page) => {
    if (error) { response.writeHead(500); response.end('Game file missing'); return; }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    response.end(page);
  });
});

// ---------- Lobbies ----------
const rooms = new Map(); // code -> { code, host, players: Map(seat -> client), settings, started }

function newCode() {
  for (;;) {
    let code = '';
    for (let index = 0; index < 4; index++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
}
const send = (client, message) => { if (client.socket.readyState === 1) client.socket.send(JSON.stringify(message)); };
const lobbyView = room => ({
  t: 'lobby', code: room.code, settings: room.settings, started: room.started,
  players: [...room.players.values()].sort((a, b) => a.seat - b.seat).map(({ seat, profile }) => ({ seat, ...profile }))
});
const broadcastLobby = room => room.players.forEach(client => send(client, lobbyView(room)));
// Keep only the profile fields the game needs, with sensible limits.
function cleanProfile(profile = {}) {
  const text = (value, max) => String(value ?? '').slice(0, max);
  return {
    name: text(profile.name, 18) || 'Wizard', model: text(profile.model, 20), title: text(profile.title, 40), level: Number(profile.level) || 1,
    rating: Number(profile.rating) || 1050, cosmetics: typeof profile.cosmetics === 'object' && profile.cosmetics ? profile.cosmetics : {},
    color: text(profile.color, 9)
  };
}

function leaveRoom(client) {
  const room = rooms.get(client.room);
  if (!room) return;
  room.players.delete(client.seat);
  client.room = null;
  if (client === room.host) {
    // The host runs the match, so without them the lobby or match is over.
    room.players.forEach(other => { send(other, { t: 'closed', reason: room.started ? 'The host left the match.' : 'The host closed the lobby.' }); other.room = null; });
    rooms.delete(room.code);
    return;
  }
  room.players.forEach(other => send(other, { t: 'left', seat: client.seat, name: client.profile.name }));
  if (!room.started) broadcastLobby(room);
}

function handle(client, message) {
  const room = rooms.get(client.room);
  switch (message.t) {
    case 'create': {
      if (room) leaveRoom(client);
      // Tests may ask for a fixed code; otherwise a random one.
      const wanted = typeof message.code === 'string' && /^[A-Z0-9]{4}$/.test(message.code) && !rooms.has(message.code) ? message.code : newCode();
      const created = { code: wanted, host: client, players: new Map(), settings: { mode: '1v1', fillAI: true }, started: false };
      rooms.set(wanted, created);
      Object.assign(client, { room: wanted, seat: 0, profile: cleanProfile(message.profile) });
      created.players.set(0, client);
      send(client, { t: 'joined', code: wanted, seat: 0, host: true });
      broadcastLobby(created);
      break;
    }
    case 'join': {
      const code = String(message.code || '').toUpperCase().trim();
      const target = rooms.get(code);
      if (!target) { send(client, { t: 'error', message: `No lobby found with code ${code || '—'}.` }); return; }
      if (target.started) { send(client, { t: 'error', message: 'That match has already started.' }); return; }
      const seat = [0, 1, 2].find(index => !target.players.has(index));
      if (seat === undefined || target.players.size >= MAX_SEATS) { send(client, { t: 'error', message: 'That lobby is full.' }); return; }
      if (room) leaveRoom(client);
      Object.assign(client, { room: code, seat, profile: cleanProfile(message.profile) });
      target.players.set(seat, client);
      send(client, { t: 'joined', code, seat, host: false });
      broadcastLobby(target);
      break;
    }
    case 'profile': {
      if (!room) return;
      client.profile = cleanProfile(message.profile);
      if (!room.started) broadcastLobby(room);
      break;
    }
    case 'settings': {
      if (!room || client !== room.host || room.started) return;
      room.settings = { mode: message.mode === '1v1v1' ? '1v1v1' : '1v1', fillAI: !!message.fillAI };
      broadcastLobby(room);
      break;
    }
    case 'start': {
      // The host sends the full match setup (seats and map seed); everyone starts from the same setup.
      if (!room || client !== room.host || room.started) return;
      room.started = true;
      room.players.forEach(other => send(other, { t: 'start', setup: message.setup }));
      break;
    }
    case 'g': {
      // In-match messages. Guests talk to the host; the host talks to everyone (or one seat).
      if (!room || !room.started) return;
      if (client === room.host) {
        room.players.forEach(other => { if (other !== client && (message.to === undefined || message.to === other.seat)) send(other, { t: 'g', m: message.m }); });
      } else {
        send(room.host, { t: 'g', from: client.seat, m: message.m });
      }
      break;
    }
    case 'leave': leaveRoom(client); break;
    case 'ping': send(client, { t: 'pong', at: message.at }); break;
  }
}

const sockets = new WebSocketServer({ server, path: '/ws' });
sockets.on('connection', socket => {
  const client = { socket, room: null, seat: -1, profile: cleanProfile() };
  socket.on('message', data => {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message && typeof message.t === 'string') handle(client, message);
  });
  socket.on('close', () => leaveRoom(client));
});
// Drop connections that silently died.
setInterval(() => sockets.clients.forEach(socket => { if (socket.readyState === 1) socket.ping(); }), 20000);

server.listen(PORT, () => console.log(`Arcane Arena running at http://localhost:${PORT}`));
