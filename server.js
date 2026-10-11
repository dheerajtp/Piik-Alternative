'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT, 10) || 8787;
const HOST_ID = 'host';

const QUALITIES = new Set(['source', '1080', '720', '480']);
const REACTIONS = new Set(['\u{1F44D}', '\u2764\uFE0F', '\u{1F602}', '\u{1F389}', '\u{1F62E}', '\u{1F44F}']);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/r/:roomId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

app.get('/qr', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 512);
  if (!text) {
    res.status(400).send('missing text');
    return;
  }
  try {
    const svg = await QRCode.toString(text, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#100f12', light: '#ffffff' },
    });
    res.type('image/svg+xml').send(svg);
  } catch {
    res.status(500).send('qr error');
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// rooms: roomId -> { host: ws|null, viewers: Map<id, ws>, password, quality, paused, recording, banned/muted: Set<lowercase name> }
const rooms = new Map();

function token(bytes = 8) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function newRoomId() {
  let id;
  do {
    id = token(6);
  } while (rooms.has(id));
  return id;
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function rateLimited(ws, key, minInterval) {
  ws._rate = ws._rate || {};
  const now = Date.now();
  if (ws._rate[key] && now - ws._rate[key] < minInterval) return true;
  ws._rate[key] = now;
  return false;
}

function roomMembers(room) {
  const members = [];
  if (room.host) members.push({ id: HOST_ID, name: 'Host' });
  for (const [id, viewer] of room.viewers) members.push({ id, name: viewer.meta.name });
  return members;
}

function broadcast(room, msg) {
  if (room.host) send(room.host, msg);
  for (const viewer of room.viewers.values()) send(viewer, msg);
}

const MAX_PENDING = 10;

function admit(room, ws, roomId, name) {
  const key = name.toLowerCase();
  const id = token(5);
  const rejoinToken = token(16);
  room.tokens.add(rejoinToken);
  ws._pending = null;
  ws.meta = { role: 'viewer', roomId, name, id, muted: room.muted.has(key) };
  room.viewers.set(id, ws);
  send(ws, {
    type: 'joined',
    id,
    roomId,
    members: roomMembers(room),
    quality: room.quality,
    paused: room.paused,
    recording: room.recording,
    rejoinToken,
  });
  send(room.host, { type: 'viewer-joined', id, name });
  for (const [vid, viewer] of room.viewers) {
    if (vid !== id) send(viewer, { type: 'viewer-joined', id, name });
  }
}

function closeRoom(roomId, reason) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const viewer of room.viewers.values()) send(viewer, { type: 'room-closed', reason });
  for (const p of room.pending.values()) {
    send(p, { type: 'room-closed', reason });
    p.close();
  }
  rooms.delete(roomId);
}

wss.on('connection', (ws) => {
  ws.meta = { role: null, roomId: null, name: null, id: null };
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handle(ws, msg);
  });

  ws.on('close', () => onClose(ws));
  ws.on('error', () => {});
});

function handle(ws, msg) {
  switch (msg.type) {
    case 'create-room': {
      const roomId = newRoomId();
      rooms.set(roomId, { host: ws, viewers: new Map(), password: null, quality: 'source', paused: false, recording: false, banned: new Set(), muted: new Set(), approval: false, pending: new Map(), tokens: new Set() });
      ws.meta = { role: 'host', roomId, name: 'Host', id: HOST_ID };
      send(ws, { type: 'room-created', roomId });
      break;
    }

    case 'set-password': {
      const room = rooms.get(ws.meta.roomId);
      if (!room || ws.meta.role !== 'host') return;
      const pw = String(msg.password || '').slice(0, 128);
      room.password = pw || null;
      send(ws, { type: 'password-set', on: !!room.password });
      break;
    }

    case 'join': {
      const room = rooms.get(msg.roomId);
      if (!room || !room.host) {
        send(ws, { type: 'error', code: 'notfound', message: 'Room not found or closed.' });
        return;
      }
      if (room.password && !safeEqual(msg.password || '', room.password)) {
        send(ws, { type: 'error', code: 'password', message: 'This room needs a password.' });
        return;
      }
      const name = String(msg.name || 'Guest').slice(0, 32);
      const key = name.toLowerCase();
      if (room.banned.has(key)) {
        send(ws, { type: 'error', code: 'banned', message: 'You were removed from this room.' });
        return;
      }
      if (ws.meta.role) return; // already joined, pending or hosting
      if (room.approval && !room.tokens.has(msg.rejoinToken)) {
        if (room.pending.size >= MAX_PENDING) {
          send(ws, { type: 'error', code: 'busy', message: 'Too many people are waiting. Try again soon.' });
          return;
        }
        const pid = token(5);
        // no roomId: a pending socket is ignored by every other handler
        ws.meta = { role: 'pending', roomId: null, name, id: pid };
        ws._pending = { roomId: msg.roomId, pid };
        room.pending.set(pid, ws);
        send(ws, { type: 'waiting' });
        send(room.host, { type: 'join-request', id: pid, name });
        break;
      }
      admit(room, ws, msg.roomId, name);
      break;
    }

    case 'set-approval': {
      const room = rooms.get(ws.meta.roomId);
      if (!room || ws.meta.role !== 'host') return;
      room.approval = !!msg.on;
      send(ws, { type: 'approval-set', on: room.approval });
      break;
    }

    case 'decide': {
      const room = rooms.get(ws.meta.roomId);
      if (!room || ws.meta.role !== 'host') return;
      const target = room.pending.get(msg.id);
      if (!target) return;
      room.pending.delete(msg.id);
      if (!msg.allow) {
        send(target, { type: 'denied' });
        target.close();
        break;
      }
      admit(room, target, target._pending.roomId, target.meta.name);
      break;
    }

    case 'offer':
    case 'answer':
    case 'ice': {
      const room = rooms.get(ws.meta.roomId);
      if (!room) return;
      const target = msg.to === HOST_ID ? room.host : room.viewers.get(msg.to);
      if (!target) return;
      const out = { type: msg.type, from: ws.meta.id };
      if (msg.sdp) out.sdp = msg.sdp;
      if (msg.candidate) out.candidate = msg.candidate;
      send(target, out);
      break;
    }

    case 'chat': {
      const room = rooms.get(ws.meta.roomId);
      if (!room || ws.meta.muted) return;
      if (rateLimited(ws, 'chat', 500)) return;
      const text = String(msg.text || '').slice(0, 1000).trim();
      if (!text) return;
      broadcast(room, { type: 'chat', name: ws.meta.name, text, ts: Date.now() });
      break;
    }

    case 'reaction': {
      const room = rooms.get(ws.meta.roomId);
      if (!room || ws.meta.muted) return;
      const emoji = String(msg.emoji || '');
      if (!REACTIONS.has(emoji)) return;
      if (rateLimited(ws, 'reaction', 250)) return;
      broadcast(room, { type: 'reaction', name: ws.meta.name, emoji, ts: Date.now() });
      break;
    }

    case 'quality': {
      const room = rooms.get(ws.meta.roomId);
      if (!room || ws.meta.role !== 'host') return;
      room.quality = QUALITIES.has(msg.value) ? msg.value : 'source';
      for (const viewer of room.viewers.values()) {
        send(viewer, { type: 'quality', value: room.quality });
      }
      break;
    }

    case 'presentation': {
      const room = rooms.get(ws.meta.roomId);
      if (!room || ws.meta.role !== 'host') return;
      room.paused = !!msg.paused;
      for (const viewer of room.viewers.values()) {
        send(viewer, { type: 'presentation', paused: room.paused });
      }
      break;
    }

    case 'kick': {
      const room = rooms.get(ws.meta.roomId);
      if (!room || ws.meta.role !== 'host') return;
      const target = room.viewers.get(msg.id);
      if (!target) return;
      room.banned.add(target.meta.name.toLowerCase());
      send(target, { type: 'kicked' });
      target.close();
      break;
    }

    case 'mute': {
      const room = rooms.get(ws.meta.roomId);
      if (!room || ws.meta.role !== 'host') return;
      const target = room.viewers.get(msg.id);
      if (!target) return;
      const key = target.meta.name.toLowerCase();
      target.meta.muted = !!msg.on;
      if (msg.on) room.muted.add(key);
      else room.muted.delete(key);
      send(target, { type: 'muted', on: target.meta.muted });
      break;
    }

    case 'recording': {
      const room = rooms.get(ws.meta.roomId);
      if (!room || ws.meta.role !== 'host') return;
      room.recording = !!msg.on;
      for (const viewer of room.viewers.values()) {
        send(viewer, { type: 'recording', on: room.recording });
      }
      break;
    }

    case 'mic-state': {
      const room = rooms.get(ws.meta.roomId);
      if (!room || ws.meta.role !== 'host') return;
      for (const viewer of room.viewers.values()) {
        send(viewer, { type: 'mic-state', on: !!msg.on });
      }
      break;
    }

    default:
      break;
  }
}

function onClose(ws) {
  if (ws._pending) {
    const room = rooms.get(ws._pending.roomId);
    if (room && room.pending.delete(ws._pending.pid)) {
      send(room.host, { type: 'join-cancelled', id: ws._pending.pid });
    }
    return;
  }
  const { roomId, role, id } = ws.meta;
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) return;

  if (role === 'host') {
    closeRoom(roomId, 'Host closed the room.');
    return;
  }

  if (role === 'viewer') {
    room.viewers.delete(id);
    if (room.host) send(room.host, { type: 'viewer-left', id });
    for (const viewer of room.viewers.values()) send(viewer, { type: 'viewer-left', id });
  }
}

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`Piik-lite listening on http://localhost:${PORT}`);
});
