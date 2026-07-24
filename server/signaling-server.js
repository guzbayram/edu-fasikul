import http from 'node:http';
import { Server } from 'socket.io';

const PORT = Number(process.env.PORT || 3001);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'edu-fasikul-voice-signaling' }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const io = new Server(httpServer, {
  cors: {
    origin(origin, cb) {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
      else cb(new Error(`Origin not allowed: ${origin}`));
    },
    methods: ['GET', 'POST']
  }
});

const rooms = new Map();

function roomState(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, { participants: new Map(), queue: [] });
  return rooms.get(roomId);
}

function publicUser(socket) {
  return {
    socketId: socket.id,
    uid: socket.data.uid,
    name: socket.data.name,
    role: socket.data.role,
    muted: !!socket.data.muted,
    speaking: !!socket.data.speaking
  };
}

function emitRoom(roomId) {
  const state = roomState(roomId);
  io.to(roomId).emit('voice:roster', Array.from(state.participants.values()));
  io.to(roomId).emit('voice:queue', state.queue);
}

function leaveRoom(socket) {
  const { roomId, uid } = socket.data;
  if (!roomId || !uid) return;
  const state = roomState(roomId);
  state.participants.delete(uid);
  state.queue = state.queue.filter(item => item.uid !== uid);
  socket.leave(roomId);
  socket.to(roomId).emit('voice:user-left', { uid, socketId: socket.id });
  emitRoom(roomId);
  if (!state.participants.size) rooms.delete(roomId);
  socket.data.roomId = '';
}

function findSocketByUid(roomId, uid) {
  const state = roomState(roomId);
  const participant = state.participants.get(uid);
  return participant?.socketId || null;
}

io.on('connection', socket => {
  socket.on('voice:join', ({ roomId, user } = {}) => {
    if (!roomId || !user?.uid) return;
    leaveRoom(socket);
    socket.data.roomId = String(roomId);
    socket.data.uid = String(user.uid);
    socket.data.name = String(user.name || user.email || 'Kullanıcı');
    socket.data.role = String(user.role || 'ogrenci');
    socket.data.muted = false;
    socket.data.speaking = false;
    socket.join(socket.data.roomId);
    roomState(socket.data.roomId).participants.set(socket.data.uid, publicUser(socket));
    emitRoom(socket.data.roomId);
  });

  socket.on('voice:leave', () => leaveRoom(socket));

  socket.on('voice:hand-raise', () => {
    const { roomId, uid, name } = socket.data;
    if (!roomId || !uid) return;
    const state = roomState(roomId);
    if (!state.queue.some(item => item.uid === uid)) {
      state.queue.push({ uid, name, ts: Date.now() });
    }
    socket.to(roomId).emit('voice:hand-raised', { uid, name, ts: Date.now() });
    emitRoom(roomId);
  });

  socket.on('voice:queue-remove', ({ uid } = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId || socket.data.role === 'ogrenci' || !uid) return;
    const state = roomState(roomId);
    state.queue = state.queue.filter(item => item.uid !== uid);
    emitRoom(roomId);
  });

  socket.on('voice:grant', ({ to } = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId || socket.data.role === 'ogrenci' || !to) return;
    const targetSocketId = findSocketByUid(roomId, to);
    if (!targetSocketId) return;
    roomState(roomId).queue = roomState(roomId).queue.filter(item => item.uid !== to);
    io.to(targetSocketId).emit('voice:granted', { from: socket.data.uid, name: socket.data.name });
    socket.emit('voice:grant-sent', { to });
    emitRoom(roomId);
  });

  socket.on('voice:signal', ({ to, type, payload } = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId || !to || !type) return;
    const targetSocketId = findSocketByUid(roomId, to);
    if (!targetSocketId) return;
    io.to(targetSocketId).emit('voice:signal', {
      from: socket.data.uid,
      name: socket.data.name,
      type,
      payload
    });
  });

  socket.on('voice:mute-user', ({ uid, muted = true } = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId || socket.data.role === 'ogrenci' || !uid) return;
    const targetSocketId = findSocketByUid(roomId, uid);
    if (targetSocketId) io.to(targetSocketId).emit('voice:set-muted', { muted: !!muted });
  });

  socket.on('voice:mute-all', () => {
    const roomId = socket.data.roomId;
    if (!roomId || socket.data.role === 'ogrenci') return;
    socket.to(roomId).emit('voice:set-muted', { muted: true });
  });

  socket.on('voice:status', ({ muted, speaking } = {}) => {
    const { roomId, uid } = socket.data;
    if (!roomId || !uid) return;
    socket.data.muted = !!muted;
    socket.data.speaking = !!speaking;
    roomState(roomId).participants.set(uid, publicUser(socket));
    emitRoom(roomId);
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

httpServer.listen(PORT, () => {
  console.log(`EduFasikül voice signaling listening on http://localhost:${PORT}`);
});
