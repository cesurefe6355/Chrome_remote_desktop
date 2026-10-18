require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool, initDb } = require('./db');
const { containsProfanity, censor, isValidName } = require('./filter');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'Public')));
app.get('/', (req, res) => res.redirect('/index.html'));

// ---------- Kullanıcı veritabanı: PostgreSQL (Render) ----------
// Bağlantı ve "users" tablosunun oluşturulması db.js içindedir (initDb).

// ---------- Oturum token'ı (sunucu yeniden başlasa da geçerli kalması için SECRET env ayarla) ----------
const SECRET = process.env.SECRET || crypto.randomBytes(32).toString('hex');
const sign = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
// "Beni hatırla" işaretliyse 30 gün, işaretli değilse 1 saat geçerli olur.
const SESSION_MS = 3600e3, REMEMBER_MS = 30 * 864e5;
function makeToken(username, sid, remember) {
    const expiresAt = Date.now() + (remember ? REMEMBER_MS : SESSION_MS);
    const p = Buffer.from(JSON.stringify({ u: username, s: sid, e: expiresAt })).toString('base64url');
    return { token: p + '.' + sign(p), expiresAt };
}
function verifyToken(t) {
    if (typeof t !== 'string') return null;
    const [p, s] = t.split('.');
    if (!p || !s) return null;
    const good = sign(p);
    if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
    try { const d = JSON.parse(Buffer.from(p, 'base64url').toString()); return d.e > Date.now() ? { u: d.u, sid: d.s } : null; } catch { return null; }
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

// ---------- Robot doğrulaması (basit matematik CAPTCHA) ----------
// Sunucu tarafında tutulur; cevap istemciye asla gönderilmez.
const captchas = new Map();
setInterval(() => { const n = Date.now(); for (const [id, c] of captchas) if (c.exp < n) captchas.delete(id); }, 60000);

function newCaptcha() {
    const a = 1 + Math.floor(Math.random() * 9);
    const b = 1 + Math.floor(Math.random() * 9);
    const ops = [
        { q: `${a} + ${b}`, n: a + b },
        { q: `${Math.max(a, b)} − ${Math.min(a, b)}`, n: Math.abs(a - b) },
        { q: `${a} × ${b}`, n: a * b }
    ];
    const op = ops[Math.floor(Math.random() * ops.length)];
    const id = crypto.randomUUID();
    captchas.set(id, { answer: String(op.n), exp: Date.now() + 5 * 60000 });
    return { id, question: `${op.q} = ?` };
}

app.get('/api/captcha', (req, res) => {
    if (limited('cap:' + req.ip, 30, 60000)) return res.status(429).json({ error: 'Çok fazla istek.' });
    res.set('Cache-Control', 'no-store');
    res.json(newCaptcha());
});

app.post('/api/register', async (req, res) => {
    if (limited('reg:' + req.ip, 5, 60000)) return res.status(429).json({ error: 'Çok fazla deneme. Biraz bekleyin.' });
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!isValidName(username, 3, 20)) return res.status(400).json({ error: 'Kullanıcı adı 3-20 karakter olmalı (harf, rakam, _ . -) ve uygunsuz kelime içermemeli.' });
    if (password.length < 6 || password.length > 72) return res.status(400).json({ error: 'Şifre 6-72 karakter olmalı.' });

    if (req.body.acceptTerms !== true)
        return res.status(400).json({ error: 'Devam etmek için gizlilik sözleşmesini kabul etmelisin.' });

    const capId = String(req.body.captchaId || '');
    const cap = captchas.get(capId);
    if (!cap || cap.exp < Date.now() || String(req.body.captchaAnswer || '').trim() !== cap.answer) {
        captchas.delete(capId);
        return res.status(400).json({ error: 'Robot doğrulaması başarısız. Lütfen tekrar dene.' });
    }
    captchas.delete(capId); // tek kullanımlık

    try {
        const exists = await pool.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [username]);
        if (exists.rowCount > 0)
            return res.status(400).json({ error: 'Bu kullanıcı adı zaten kullanımda.' });

        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, password, accepted_terms_at) VALUES ($1, $2, NOW())', [username, hash]);
        res.json({ success: true });
    } catch (err) {
        if (err.code === '23505') // eşzamanlı kayıtta benzersizlik ihlali
            return res.status(400).json({ error: 'Bu kullanıcı adı zaten kullanımda.' });
        console.error('Kayıt hatası:', err.message);
        res.status(500).json({ error: 'Sunucu hatası, lütfen tekrar deneyin.' });
    }
});

app.post('/api/login', async (req, res) => {
    if (limited('login:' + req.ip, 10, 60000)) return res.status(429).json({ error: 'Çok fazla deneme. Biraz bekleyin.' });
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    try {
        const { rows } = await pool.query('SELECT id, username, password FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [username]);
        const user = rows[0];
        if (!user || !(await bcrypt.compare(password, user.password)))
            return res.status(400).json({ error: 'Kullanıcı bulunamadı veya şifre hatalı.' });

        // ---- Tek cihaz kuralı: yeni oturum açılınca eski oturum geçersiz olur ----
        const sid = crypto.randomUUID();
        await pool.query('UPDATE users SET active_session = $1 WHERE id = $2', [sid, user.id]);
        for (const s of io.sockets.sockets.values()) {
            if (s.data.username && s.data.username.toLowerCase() === user.username.toLowerCase() && s.data.sid !== sid) {
                s.emit('session-replaced', 'Hesabına başka bir cihazdan giriş yapıldı.');
                s.disconnect(true);
            }
        }
        const remember = req.body.remember === true;
        const { token, expiresAt } = makeToken(user.username, sid, remember);
        res.json({ success: true, username: user.username, token, remember, expiresAt });
    } catch (err) {
        console.error('Giriş hatası:', err.message);
        res.status(500).json({ error: 'Sunucu hatası, lütfen tekrar deneyin.' });
    }
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
const mkRoom = (createdBy, system = false, owner = null, name = null) => ({
    createdBy, system, owner, name: name || createdBy,
    isLive: false, hostSocketId: null, hostName: null, members: [], messages: []
});
const mkText = (createdBy, system = false, owner = null, name = null) => ({
    createdBy, system, owner, name: name || createdBy, messages: []
});

// Sitede yalnızca 2 ana yer vardır: bir metin + bir sesli kanal.
const rooms = { 'genel-sesli-sohbet': mkRoom('Sistem', true, null, 'Genel Sesli Sohbet') };
const texts = { 'genel-sohbet': mkText('Sistem', true, null, 'Genel Sohbet') };

const MAX_CHANNELS_PER_USER = 2; // her kullanıcı en fazla 2 kanal açabilir
const userChannelCount = (u) => [...Object.values(texts), ...Object.values(rooms)]
    .filter(c => c.owner && c.owner.toLowerCase() === String(u).toLowerCase()).length;

const roomsList = () => Object.entries(rooms).map(([id, r]) => ({
    id, name: r.name, isLive: r.isLive, hostName: r.hostName,
    members: r.members.map(m => ({ id: m.id, username: m.username, muted: m.muted, deaf: m.deaf }))
}));
const snapshot = () => ({ text: Object.entries(texts).map(([id, t]) => ({ id, name: t.name })), voice: roomsList() });
const broadcastRooms = () => io.emit('room-list-update', snapshot());
const broadcastOnline = () => io.emit('online-list', [...new Set([...io.sockets.sockets.values()].filter(x => x.connected && x.data.username).map(x => x.data.username))]);

io.use(async (socket, next) => {
    const auth = verifyToken(socket.handshake.auth && socket.handshake.auth.token);
    if (!auth) return next(new Error('unauthorized'));
    try {
        // Tek cihaz kuralı: token'daki oturum, veritabanındaki güncel oturumla eşleşmeli
        const { rows } = await pool.query('SELECT active_session FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [auth.u]);
        if (!rows[0] || rows[0].active_session !== auth.sid) return next(new Error('session-replaced'));
    } catch (err) {
        console.error('Oturum doğrulama hatası:', err.message);
        return next(new Error('db-error'));
    }
    socket.data.username = auth.u;
    socket.data.sid = auth.sid;
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

    // Sunucu gecikmesi (ping) ölçümü için basit yankı
    socket.on('latency', (start, cb) => { if (typeof cb === 'function') cb(start); });

    socket.on('create-channel', ({ roomName, type } = {}) => {
        if (limited('room:' + socket.id, 5, 60000)) return socket.emit('error-msg', 'Çok hızlı kanal oluşturuyorsun.');
        const raw = String(roomName || '').trim();
        if (!isValidName(raw, 3, 20)) return socket.emit('error-msg', 'Kanal adı 3-20 karakter olmalı (harf, rakam, _ . -) ve uygunsuz kelime içermemeli.');
        if (userChannelCount(username) >= MAX_CHANNELS_PER_USER) return socket.emit('error-msg', `En fazla ${MAX_CHANNELS_PER_USER} kanal açabilirsin.`);
        const id = raw.replace(/\s+/g, '-').toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 24);
        if (!id) return socket.emit('error-msg', 'Geçersiz kanal adı!');
        const isText = type === 'text';
        const bucket = isText ? texts : rooms;
        if (bucket[id]) return socket.emit('error-msg', 'Bu kanal zaten var!');
        if (Object.keys(bucket).length >= 50) return socket.emit('error-msg', 'Kanal limiti doldu.');
        bucket[id] = isText ? mkText(username, false, username, raw) : mkRoom(username, false, username, raw);
        broadcastRooms();
        socket.emit('channel-created', { type: isText ? 'text' : 'voice', id });
    });

    socket.on('join-text', ({ channelId } = {}) => {
        const t = texts[channelId];
        if (!t) return socket.emit('error-msg', 'Kanal bulunamadı.');
        if (socket.data.textId) socket.leave('t:' + socket.data.textId);
        socket.data.textId = channelId;
        socket.join('t:' + channelId);
        // Dosya (kod) içeriklerini şimdi göndermeyiz; indirilirken 'get-code' ile istenir.
        const messages = t.messages.map(m => m.kind === 'file' ? { ...m, code: undefined } : m);
        socket.emit('text-joined', { channelId, messages });
    });

    // Kod/dosya içeriğini indirme anında gönder
    socket.on('get-code', ({ msgId } = {}, cb) => {
        const t = texts[socket.data.textId];
        const m = t && t.messages.find(x => x.id === msgId && x.kind === 'file');
        if (typeof cb === 'function') cb(m ? { code: m.code, name: m.name } : null);
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
        const clean = censor(text);
        if (clean !== text) socket.emit('error-msg', 'Mesajındaki uygunsuz kelimeler gizlendi.');
        const msg = { id: crypto.randomUUID(), username, kind: 'text', text: clean, time: Date.now(), reactions: {} };
        t.messages.push(msg);
        if (t.messages.length > 100) t.messages.shift();
        io.to('t:' + tid).emit('chat-message', msg);
    });

    // Kod paylaşımı: girilen kod, "kod-<kullanıcıadı>.txt" dosyası olarak sohbete gönderilir.
    socket.on('code-message', ({ code } = {}) => {
        const tid = socket.data.textId, t = texts[tid];
        if (!t) return socket.emit('error-msg', 'Önce bir metin kanalı seç.');
        if (limited('code:' + socket.id, 5, 60000)) return socket.emit('error-msg', 'Çok sık kod paylaşıyorsun, biraz bekle.');
        code = String(code || '');
        if (!code.trim()) return;
        if (code.length > 100000) return socket.emit('error-msg', 'Kod çok büyük (en fazla ~100 KB).');
        const msg = {
            id: crypto.randomUUID(), username, kind: 'file',
            name: `kod-${username}.txt`, size: Buffer.byteLength(code, 'utf8'),
            code, time: Date.now(), reactions: {}
        };
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

// Önce veritabanını hazırla ("users" tablosunu oluştur), sonra sunucuyu dinlemeye başlat
initDb()
    .then(() => server.listen(PORT, () => console.log(`LumoLive Sunucusu aktif: Port ${PORT}`)))
    .catch((err) => {
        console.error('Veritabanı başlatılamadı, sunucu durduruluyor:', err.message);
        process.exit(1);
    });
