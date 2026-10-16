const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'Public')));
app.get('/', (req, res) => res.redirect('/index.html'));

const DATA_DIR = process.env.DATA_DIR || __dirname;
const USERS_FILE = path.join(DATA_DIR, 'users.json');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');

const getUsers = () => { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; } };
const saveUsers = (u) => {
    const tmp = USERS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(u, null, 2));
    fs.renameSync(tmp, USERS_FILE);
};

const SECRET = process.env.SECRET || crypto.randomBytes(32).toString('hex');
const sign = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
function makeToken(username) {
    const p = Buffer.from(JSON.stringify({ u: username, e: Date.now() + 30 * 864e5 })).toString('base64url');
    return p + '.' + sign(p);
}
function verifyToken(t) {
    if (typeof t !== 'string') return null;
    const [p, s] = t.split('.');
    if (!p || !s) return null;
    const good = sign(p);
    if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
    try { const d = JSON.parse(Buffer.from(p, 'base64url').toString()); return d.e > Date.now() ? d.u : null; } catch { return null; }
}

const hits = new Map();
function limited(key, max, ms) {
    const now = Date.now();
    const h = (hits.get(key) || []).filter(t => now - t < ms);
    h.push(now); hits.set(key, h);
    return h.length > max;
}

const USER_RE = /^[\p{L}\p{N}_.-]{3,20}$/u;

app.post('/api/register', async (req, res) => {
    if (limited('reg:' + req.ip, 5, 60000)) return res.status(429).json({ error: 'Çok fazla deneme. Biraz bekleyin.' });
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!USER_RE.test(username)) return res.status(400).json({ error: 'Kullanıcı adı 3-20 karakter olmalı.' });
    if (password.length < 6 || password.length > 72) return res.status(400).json({ error: 'Şifre 6-72 karakter olmalı.' });

    const users = getUsers();
    if (users.some(u => u.username.toLowerCase() === username.toLowerCase()))
        return res.status(400).json({ error: 'Bu kullanıcı adı zaten kullanımda.' });

    users.push({ username, password: await bcrypt.hash(password, 10) });
    saveUsers(users);
    res.json({ success: true });
});

app.post('/api/login', async (req, res) => {
    if (limited('login:' + req.ip, 10, 60000)) return res.status(429).json({ error: 'Çok fazla deneme. Biraz bekleyin.' });
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const user = getUsers().find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.password)))
        return res.status(400).json({ error: 'Kullanıcı bulunamadı veya şifre hatalı.' });
    res.json({ success: true, username: user.username, token: makeToken(user.username) });
});

// Oda tipleri eklendi: lobi (voice), oyun-gecesi (text)
const mkRoom = (createdBy, system = false, type = 'voice') => ({ createdBy, system, type, isLive: false, hostSocketId: null, hostName: null, members: [], messages: [] });
const rooms = { 
    'lobi': mkRoom('Sistem', true, 'voice'), 
    'oyun-gecesi': mkRoom('Sistem', true, 'text') 
};

const roomsList = () => Object.entries(rooms).map(([id, r]) => ({
    id, type: r.type, isLive: r.isLive, hostName: r.hostName, members: r.members.map(m => ({ id: m.id, username: m.username }))
}));
const broadcastRooms = () => io.emit('room-list-update', roomsList());

io.use((socket, next) => {
    const u = verifyToken(socket.handshake.auth && socket.handshake.auth.token);
    if (!u) return next(new Error('unauthorized'));
    socket.data.username = u;
    next();
});

function leaveRoom(socket) {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    socket.leave(roomId);
    socket.data.roomId = null;
    if (room.type === 'voice') {
        socket.to(roomId).emit('user-left-voice', socket.id);
    }
    room.members = room.members.filter(m => m.id !== socket.id);

    if (room.hostSocketId === socket.id) endStream(roomId);
    io.to(roomId).emit('update-room-members', room.members);
    if (!room.system && room.members.length === 0) delete rooms[roomId];
    broadcastRooms();
}
function endStream(roomId) {
    const room = rooms[roomId];
    if (!room || !room.isLive) return;
    room.isLive = false; room.hostSocketId = null; room.hostName = null;
    io.to(roomId).emit('room-stream-ended');
}

io.on('connection', (socket) => {
    const username = socket.data.username;
    socket.emit('room-list-update', roomsList());

    socket.on('create-channel', ({ roomName, type } = {}) => {
        if (limited('room:' + socket.id, 5, 60000)) return socket.emit('error-msg', 'Çok hızlı oda oluşturuyorsun.');
        const id = String(roomName || '').trim().replace(/\s+/g, '-').toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 24);
        if (!id) return socket.emit('error-msg', 'Geçersiz oda adı!');
        if (rooms[id]) return socket.emit('error-msg', 'Bu oda zaten var!');
        rooms[id] = mkRoom(username, false, type === 'text' ? 'text' : 'voice');
        broadcastRooms();
        socket.emit('channel-created', { roomId: id });
    });

    socket.on('join-room', ({ roomId } = {}) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('error-msg', 'Oda bulunamadı.');
        if (socket.data.roomId) leaveRoom(socket);

        socket.join(roomId);
        socket.data.roomId = roomId;
        if (room.type === 'voice') {
            socket.to(roomId).emit('user-joined-voice', { socketId: socket.id, username });
        }
        room.members.push({ id: socket.id, username });

        socket.emit('room-joined', {
            roomId, type: room.type, isLive: room.isLive, hostName: room.hostName,
            hostSocketId: room.hostSocketId, members: room.members, messages: room.messages
        });
        if (room.isLive && room.type === 'voice') io.to(room.hostSocketId).emit('viewer-wants-stream', { viewerId: socket.id });
        io.to(roomId).emit('update-room-members', room.members);
        broadcastRooms();
    });

    socket.on('chat-message', ({ text } = {}) => {
        const room = rooms[socket.data.roomId];
        text = String(text || '').trim().slice(0, 500);
        if (!room || !text || limited('chat:' + socket.id, 8, 5000)) return;
        const msg = { id: crypto.randomUUID(), username, text, time: Date.now(), reactions: {} };
        room.messages.push(msg);
        if (room.messages.length > 50) room.messages.shift();
        io.to(socket.data.roomId).emit('chat-message', msg);
    });

    const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
    socket.on('react', ({ msgId, emoji } = {}) => {
        const roomId = socket.data.roomId, room = rooms[roomId];
        if (!room || !EMOJIS.includes(emoji) || limited('react:' + socket.id, 15, 5000)) return;
        const msg = room.messages.find(m => m.id === msgId);
        if (!msg) return;
        const list = msg.reactions[emoji] = msg.reactions[emoji] || [];
        const i = list.indexOf(username);
        const added = i === -1;
        if (added) list.push(username); else list.splice(i, 1);
        if (!list.length) delete msg.reactions[emoji];
        io.to(roomId).emit('reaction-update', { msgId, reactions: msg.reactions, emoji, by: username, added });
    });

    socket.on('start-stream-in-room', () => {
        const roomId = socket.data.roomId, room = rooms[roomId];
        if (!room || room.type !== 'voice') return socket.emit('error-msg', 'Bu kanalda yayın yapılamaz.');
        if (room.isLive) return socket.emit('error-msg', 'Bu odada zaten aktif bir yayın var!');
        room.isLive = true; room.hostSocketId = socket.id; room.hostName = username;
        broadcastRooms();
        io.to(roomId).emit('stream-started', { roomId, hostName: username, hostSocketId: socket.id });
        room.members.forEach(m => m.id !== socket.id && socket.emit('viewer-wants-stream', { viewerId: m.id }));
    });

    socket.on('stop-stream', () => {
        const roomId = socket.data.roomId, room = rooms[roomId];
        if (room && room.hostSocketId === socket.id) { endStream(roomId); broadcastRooms(); }
    });

    socket.on('leave-room', () => leaveRoom(socket));

    socket.on('signal', (data = {}) => {
        const target = io.sockets.sockets.get(data.target);
        if (!target || !socket.data.roomId || target.data.roomId !== socket.data.roomId) return;
        target.emit('signal', { sender: socket.id, signal: data.signal, type: data.type });
    });

    socket.on('disconnect', () => leaveRoom(socket));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`LumoLive Sunucusu aktif: Port ${PORT}`));
