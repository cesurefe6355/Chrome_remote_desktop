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

// ---------- Kullanıcı veritabanı (JSON) ----------
// NOT: Render ücretsiz planda disk silinir. Kalıcı olması için Render Disk veya gerçek DB kullan.
const DATA_DIR = process.env.DATA_DIR || __dirname;
const USERS_FILE = path.join(DATA_DIR, 'users.json');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');

const getUsers = () => { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; } };
const saveUsers = (u) => { // atomik yazım: dosya yarım kalıp bozulmasın
    const tmp = USERS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(u, null, 2));
    fs.renameSync(tmp, USERS_FILE);
};

// ---------- Oturum token'ı (sunucu yeniden başlasa da geçerli kalması için SECRET env ayarla) ----------
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

// ---------- Basit hız sınırı ----------
const hits = new Map();
function limited(key, max, ms) {
    const now = Date.now();
    const h = (hits.get(key) || []).filter(t => now - t < ms);
    h.push(now); hits.set(key, h);
    return h.length > max;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (!v.some(t => n - t < 60000)) hits.delete(k); }, 60000);

const USER_RE = /^[\p{L}\p{N}_.-]{3,20}$/u;

app.post('/api/register', async (req, res) => {
    if (limited('reg:' + req.ip, 5, 60000)) return res.status(429).json({ error: 'Çok fazla deneme. Biraz bekleyin.' });
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!USER_RE.test(username)) return res.status(400).json({ error: 'Kullanıcı adı 3-20 karakter olmalı (harf, rakam, _ . -).' });
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

// ---------- WebRTC ICE (STUN/TURN) ----------
// Farklı ağlardaki kullanıcıların yayını izleyebilmesi için TURN şart. Render ortam değişkenleri:
//   METERED_DOMAIN + METERED_API_KEY  (metered.ca hesabı)  veya  TURN_URL + TURN_USER + TURN_PASS
// Öncelik: 1) METERED_DOMAIN + METERED_API_KEY (REST)  2) TURN_URL/TURN_USER/TURN_PASS  3) aşağıdaki Metered bilgileri
const METERED_STATIC = {
    username: process.env.TURN_USER || '5cbcf67c633ed0ffaf5f19c6',
    credential: process.env.TURN_PASS || 'yDaqLITZGsxTT2x3'
};
let iceCache = { t: 0, v: null };
app.get('/api/ice', async (req, res) => {
    if (!verifyToken((req.headers.authorization || '').replace('Bearer ', ''))) return res.status(401).json({ error: 'unauthorized' });
    if (iceCache.v && Date.now() - iceCache.t < 10 * 60000) return res.json(iceCache.v);
    const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    const { METERED_DOMAIN, METERED_API_KEY, TURN_URL } = process.env;
    try {
        if (METERED_DOMAIN && METERED_API_KEY) {
            const j = await (await fetch(`https://${METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`)).json();
            if (Array.isArray(j)) servers.push(...j);
        }
    } catch (e) { console.warn('Metered REST alınamadı:', e.message); }
    if (servers.length === 1 && TURN_URL) {
        servers.push({ urls: TURN_URL.split(',').map(x => x.trim()), username: process.env.TURN_USER, credential: process.env.TURN_PASS });
    }
    if (servers.length === 1) { // Varsayılan: Metered TURN (80/443, UDP + TCP + TLS)
        servers.push(
            { urls: 'stun:stun.relay.metered.ca:80' },
            { urls: 'turn:global.relay.metered.ca:80', ...METERED_STATIC },
            { urls: 'turn:global.relay.metered.ca:80?transport=tcp', ...METERED_STATIC },
            { urls: 'turn:global.relay.metered.ca:443', ...METERED_STATIC },
            { urls: 'turns:global.relay.metered.ca:443?transport=tcp', ...METERED_STATIC }
        );
    }
    iceCache = { t: Date.now(), v: servers };
    res.json(servers);
});

// ---------- Odalar ----------
const mkRoom = (createdBy, system = false) => ({ createdBy, system, isLive: false, hostSocketId: null, hostName: null, members: [], messages: [] });
const rooms = { 'lobi': mkRoom('Sistem', true), 'oyun-gecesi': mkRoom('Sistem', true) };

const mkText = (createdBy, system = false) => ({ createdBy, system, messages: [] });
const texts = { 'genel': mkText('Sistem', true), 'sohbet': mkText('Sistem', true) };

const roomsList = () => Object.entries(rooms).map(([id, r]) => ({
    id, isLive: r.isLive, hostName: r.hostName, members: r.members.map(m => ({ id: m.id, username: m.username, muted: m.muted, deaf: m.deaf }))
}));
const snapshot = () => ({ text: Object.keys(texts), voice: roomsList() });
const broadcastRooms = () => io.emit('room-list-update', snapshot());
const broadcastOnline = () => io.emit('online-list', [...new Set([...io.sockets.sockets.values()].filter(x => x.connected && x.data.username).map(x => x.data.username))]);

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
    socket.to(roomId).emit('user-left-voice', socket.id);
    room.members = room.members.filter(m => m.id !== socket.id);

    if (room.hostSocketId === socket.id) endStream(roomId);
    io.to(roomId).emit('update-room-members', room.members);
    if (!room.system && room.members.length === 0) delete rooms[roomId]; // boş kullanıcı odalarını temizle
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
    socket.emit('room-list-update', snapshot());
    broadcastOnline();

    socket.on('create-channel', ({ roomName, type } = {}) => {
        if (limited('room:' + socket.id, 5, 60000)) return socket.emit('error-msg', 'Çok hızlı kanal oluşturuyorsun.');
        const id = String(roomName || '').trim().replace(/\s+/g, '-').toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 24);
        if (!id) return socket.emit('error-msg', 'Geçersiz kanal adı!');
        const isText = type === 'text';
        const pool = isText ? texts : rooms;
        if (pool[id]) return socket.emit('error-msg', 'Bu kanal zaten var!');
        if (Object.keys(pool).length >= 50) return socket.emit('error-msg', 'Kanal limiti doldu.');
        pool[id] = isText ? mkText(username) : mkRoom(username);
        broadcastRooms();
        socket.emit('channel-created', { type: isText ? 'text' : 'voice', id });
    });

    socket.on('join-text', ({ channelId } = {}) => {
        const t = texts[channelId];
        if (!t) return socket.emit('error-msg', 'Kanal bulunamadı.');
        if (socket.data.textId) socket.leave('t:' + socket.data.textId);
        socket.data.textId = channelId;
        socket.join('t:' + channelId);
        socket.emit('text-joined', { channelId, messages: t.messages });
    });

    socket.on('voice-state', ({ muted, deaf } = {}) => {
        const room = rooms[socket.data.roomId];
        const m = room && room.members.find(x => x.id === socket.id);
        if (!m) return;
        m.muted = !!muted; m.deaf = !!deaf;
        io.to(socket.data.roomId).emit('update-room-members', room.members);
        broadcastRooms();
    });

    socket.on('join-room', ({ roomId } = {}) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('error-msg', 'Oda bulunamadı.');
        if (socket.data.roomId) leaveRoom(socket); // aynı anda tek odada ol

        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.to(roomId).emit('user-joined-voice', { socketId: socket.id, username });
        room.members.push({ id: socket.id, username, muted: false, deaf: false });

        socket.emit('room-joined', {
            roomId, isLive: room.isLive, hostName: room.hostName,
            hostSocketId: room.hostSocketId, members: room.members
        });
        if (room.isLive) io.to(room.hostSocketId).emit('viewer-wants-stream', { viewerId: socket.id });
        io.to(roomId).emit('update-room-members', room.members);
        broadcastRooms();
    });

    socket.on('chat-message', ({ text } = {}) => {
        const tid = socket.data.textId, t = texts[tid];
        text = String(text || '').trim().slice(0, 500);
        if (!t || !text || limited('chat:' + socket.id, 8, 5000)) return;
        const msg = { id: crypto.randomUUID(), username, text, time: Date.now(), reactions: {} };
        t.messages.push(msg);
        if (t.messages.length > 100) t.messages.shift();
        io.to('t:' + tid).emit('chat-message', msg);
    });

    const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
    socket.on('react', ({ msgId, emoji } = {}) => {
        const tid = socket.data.textId, t = texts[tid];
        if (!t || !EMOJIS.includes(emoji) || limited('react:' + socket.id, 15, 5000)) return;
        const msg = t.messages.find(m => m.id === msgId);
        if (!msg) return;
        const list = msg.reactions[emoji] = msg.reactions[emoji] || [];
        const i = list.indexOf(username), added = i === -1;
        if (added) list.push(username); else list.splice(i, 1);
        if (!list.length) delete msg.reactions[emoji];
        io.to('t:' + tid).emit('reaction-update', { msgId, reactions: msg.reactions, emoji, by: username, added });
    });

    socket.on('start-stream-in-room', () => {
        const roomId = socket.data.roomId, room = rooms[roomId];
        if (!room) return socket.emit('error-msg', 'Önce bir odaya katıl.');
        if (room.isLive) return socket.emit('error-msg', 'Bu odada zaten aktif bir yayın var!');
        room.isLive = true; room.hostSocketId = socket.id; room.hostName = username;
        broadcastRooms();
        io.to(roomId).emit('stream-started', { roomId, hostName: username, hostSocketId: socket.id });
        room.members.forEach(m => m.id !== socket.id && socket.emit('viewer-wants-stream', { viewerId: m.id }));
    });

    // İzleyici bağlantı kuramazsa yayıncıdan yeniden teklif ister
    socket.on('want-stream', () => {
        const room = rooms[socket.data.roomId];
        if (!room || !room.isLive || room.hostSocketId === socket.id || limited('ws:' + socket.id, 6, 60000)) return;
        io.to(room.hostSocketId).emit('viewer-wants-stream', { viewerId: socket.id });
    });

    socket.on('stop-stream', () => {
        const roomId = socket.data.roomId, room = rooms[roomId];
        if (room && room.hostSocketId === socket.id) { endStream(roomId); broadcastRooms(); }
    });

    socket.on('leave-room', () => leaveRoom(socket));

    socket.on('signal', (data = {}) => {
        const target = io.sockets.sockets.get(data.target);
        // sadece aynı odadaki kişilere sinyal gönderilebilir
        if (!target || !socket.data.roomId || target.data.roomId !== socket.data.roomId) return;
        target.emit('signal', { sender: socket.id, signal: data.signal, type: data.type });
    });

    socket.on('disconnect', () => { leaveRoom(socket); broadcastOnline(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`LumoLive Sunucusu aktif: Port ${PORT}`));
