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
```[cite: 1]

---

### 2. `index.html` (Arayüz Kodları - Ses ve Kare Izgara Düzenlemesi)[cite: 3]
```html
<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LumoLive</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:'gg sans','Noto Sans','Helvetica Neue',Helvetica,Arial,sans-serif}
body{background:#313338;color:#dbdee1;height:100vh;overflow:hidden}
::-webkit-scrollbar{width:8px}::-webkit-scrollbar-thumb{background:#1a1b1e;border-radius:4px}
svg{width:20px;height:20px;fill:currentColor;display:block}
.app{display:flex;height:100vh}
.rail{width:72px;background:#1e1f22;display:flex;flex-direction:column;align-items:center;padding-top:12px;gap:8px;flex-shrink:0}
.srv{width:48px;height:48px;border-radius:50%;background:#313338;display:flex;align-items:center;justify-content:center;color:#dbdee1;font-weight:700;cursor:pointer;position:relative;transition:.2s}
.srv:hover,.srv.on{border-radius:16px;background:#5865F2;color:#fff}
.srv.on::before{content:"";position:absolute;left:-12px;width:4px;height:40px;background:#fff;border-radius:0 4px 4px 0}
.side{width:240px;background:#2b2d31;display:flex;flex-direction:column;flex-shrink:0}
.sh{height:48px;padding:0 16px;display:flex;align-items:center;font-weight:700;color:#f2f3f5;box-shadow:0 1px 0 rgba(0,0,0,.25)}
.chs{flex:1;overflow-y:auto;padding:16px 8px}
.cat{display:flex;justify-content:space-between;align-items:center;padding:0 8px 4px;font-size:12px;font-weight:700;color:#949ba4;text-transform:uppercase}
.cat button{background:none;color:#949ba4;font-size:18px;padding:0 4px}.cat button:hover{color:#f2f3f5;background:none}
.ch{display:flex;align-items:center;gap:6px;padding:6px 8px;margin:1px 0;border-radius:4px;color:#949ba4;cursor:pointer;font-weight:500;font-size:15px}
.ch:hover{background:#35373c;color:#dbdee1}.ch.on{background:#404249;color:#fff}
.ch svg{width:18px;height:18px;flex-shrink:0}.ch .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.live{background:#ed4245;color:#fff;font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px}
.vu{display:flex;align-items:center;gap:8px;padding:3px 8px 3px 32px;color:#949ba4;font-size:14px}
.av{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:12px;flex-shrink:0}
.panel{background:#232428;height:52px;padding:0 8px;display:flex;align-items:center;justify-content:space-between}
.me{display:flex;align-items:center;gap:8px;min-width:0;padding:4px;border-radius:4px}
.me .av{width:32px;height:32px;font-size:14px;position:relative}
.me .av::after{content:"";position:absolute;right:-2px;bottom:-2px;width:10px;height:10px;background:#23a55a;border-radius:50%;border:2px solid #232428}
.me b{display:block;font-size:14px;color:#f2f3f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.me small{font-size:12px;color:#949ba4}
.ib{background:none;color:#b5bac1;padding:6px;border-radius:4px;position:relative}
.ib:hover{background:#35373c;color:#dbdee1}
.ib.off{color:#f2f3f2}.ib.off::after{content:"";position:absolute;left:5px;right:5px;top:50%;height:2px;background:#f23f42;transform:rotate(-45deg)}
.ib.act{color:#23a55a}
.main{flex:1;display:flex;flex-direction:column;min-width:0}
.hd{height:48px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 1px 0 rgba(0,0,0,.25);font-weight:700;color:#f2f3f5;flex-shrink:0}
.hd .t{display:flex;align-items:center;gap:8px}.hd .t svg{color:#80848e}
.body{flex:1;display:flex;min-height:0}
.center{flex:1;display:flex;flex-direction:column;min-width:0;position:relative}

/* Discord Tarzı Ses Kanalı Kare Izgara Alanı */
#voiceGrid {
    display: none;
    flex: 1;
    background: #313338;
    padding: 24px;
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-content: flex-start;
    justify-content: center;
    overflow-y: auto;
}
.voice-tile {
    width: 220px;
    height: 160px;
    background: #111214;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    position: relative;
    border: 2px solid transparent;
    transition: border-color 0.2s;
}
.voice-tile .av {
    width: 72px;
    height: 72px;
    font-size: 28px;
    margin-bottom: 12px;
}
.voice-tile span {
    color: #f2f3f5;
    font-weight: 600;
    font-size: 15px;
}

#stage{display:none;background:#000;position:relative;height:55%;min-height:200px;flex-shrink:0}
#stage video{width:100%;height:100%;object-fit:contain;background:#000}
.bar{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:linear-gradient(transparent,rgba(0,0,0,.8));opacity:0;transition:.2s}
#stage:hover .bar{opacity:1}
.msgs{flex:1;overflow-y:auto;padding:16px 0}
.empty{padding:16px;color:#949ba4}.empty h2{color:#f2f3f5;font-size:24px;margin-bottom:6px}
.msg{display:flex;gap:16px;padding:4px 16px;margin-top:12px}.msg:hover{background:#2e3035}
.msg .av{width:40px;height:40px;font-size:16px}
.msg b{color:#f2f3f5;font-size:15px}.msg time{color:#949ba4;font-size:12px;margin-left:8px}
.msg p{white-space:pre-wrap;word-break:break-word;line-height:1.35;font-size:15px}
.inp{padding:0 16px 24px}.inp input{width:100%;padding:11px 16px;border-radius:8px;border:0;background:#383a40;color:#dbdee1;font-size:15px;outline:0}
.members{width:240px;background:#2b2d31;padding:24px 8px;overflow-y:auto;flex-shrink:0}
.members h4{font-size:12px;color:#949ba4;text-transform:uppercase;padding:0 8px 8px}
.mi{display:flex;align-items:center;gap:12px;padding:6px 8px;border-radius:4px;color:#949ba4;font-weight:500}.mi:hover{background:#35373c;color:#dbdee1}
.mi .av{width:32px;height:32px;font-size:14px}
button{padding:8px 16px;border-radius:4px;border:0;background:#5865F2;color:#fff;font-size:14px;font-weight:500;cursor:pointer;transition:.15s}
button:hover{background:#4752c4}button.red{background:#da373c}button.red:hover{background:#a12828}
.ov{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:99;justify-content:center;align-items:center}
.box{background:#313338;border-radius:8px;padding:24px;width:100%;max-width:440px}
.box h3{color:#f2f3f5;font-size:20px;margin-bottom:12px}.box p{color:#b5bac1;font-size:14px;margin-bottom:16px}
.box label{display:block;font-size:12px;font-weight:700;color:#b5bac1;text-transform:uppercase;margin:12px 0 6px}
.box input,.box select{width:100%;padding:10px;border-radius:4px;border:0;background:#1e1f22;color:#dbdee1;font-size:15px;outline:0}
.acts{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.acts .g{background:none}.acts .g:hover{text-decoration:underline;background:none}
@keyframes slide{from{transform:translateX(30px);opacity:0}to{transform:none;opacity:1}}
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(237,66,69,.7)}50%{box-shadow:0 0 0 5px rgba(237,66,69,0)}}
@keyframes rise{from{transform:translateY(0) scale(.6);opacity:1}to{transform:translateY(-55vh) scale(1.6);opacity:0}}
@keyframes pop{50%{transform:scale(1.25)}}
.toasts{position:fixed;top:16px;right:16px;z-index:200;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.toast{background:#111214;color:#f2f3f5;padding:10px 14px;border-radius:6px;border-left:4px solid #5865F2;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,.5);animation:slide .25s;transition:opacity .3s}
.toast.join{border-color:#23a55a}.toast.leave{border-color:#ed4245}.toast.live{border-color:#a259ff}
.live{animation:pulse 1.6s infinite}
.msg{animation:fade .2s;position:relative}
.av{transition:box-shadow .15s}.av.speak{box-shadow:0 0 0 3px #23a55a}
.ib:active{animation:pop .25s}
.tb{display:none;position:absolute;right:16px;top:-14px;background:#313338;border:1px solid #232428;border-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,.4)}
.msg:hover .tb{display:flex}
.tb button{background:none;padding:4px 6px;font-size:16px}.tb button:hover{background:#3f4147}
.rxs{display:flex;flex-wrap:wrap}
.rx{background:#2b2d31;border:1px solid transparent;padding:2px 8px;border-radius:8px;font-size:14px;margin:4px 4px 0 0;color:#dbdee1;font-weight:500}
.rx:hover{background:#35373c}.rx.mine{background:#3b405a;border-color:#5865F2}
.fl{position:fixed;bottom:90px;font-size:28px;pointer-events:none;z-index:150;animation:rise 1.6s ease-out forwards}
@media(max-width:900px){.members{display:none}.rail{display:none}}
</style>
</head>
<body>
<div id="audioBox" style="display:none"></div>
<div class="toasts" id="toasts"></div>

<div class="ov" id="mCreate"><div class="box"><h3>Kanal Oluştur</h3>
<label>Kanal Adı</label><input id="newName" maxlength="24" placeholder="yeni-kanal">
<label>Kanal Türü</label><select id="newType"><option value="voice">Ses Kanalı</option><option value="text">Metin Kanalı</option></select>
<div class="acts"><button class="g" onclick="closeM('mCreate')">İptal</button><button id="btnCreate">Oluştur</button></div></div></div>

<div class="ov" id="mStream"><div class="box"><h3>Ekran Yayını</h3><p>Yayın kalitesini seç.</p>
<label>Çözünürlük</label><select id="resSel"><option value="720">720p</option><option value="1080" selected>1080p</option></select>
<label>Kare Hızı</label><select id="fpsSel"><option value="30">30 FPS</option><option value="60" selected>60 FPS</option></select>
<div class="acts"><button class="g" onclick="closeM('mStream')">İptal</button><button id="btnGo">Yayına Başla</button></div></div></div>

<div class="ov" id="mInfo"><div class="box"><h3 id="infoT"></h3><p id="infoD"></p><div class="acts"><button onclick="closeM('mInfo')">Tamam</button></div></div></div>

<div class="app">
<div class="rail"><div class="srv on">LL</div></div>
<div class="side">
  <div class="sh">LumoLive</div>
  <div class="chs"><div class="cat"><span>Kanallar</span><button onclick="openM('mCreate')" title="Kanal Oluştur">+</button></div><div id="chList"></div></div>
  <div class="panel">
    <div class="me"><div class="av" id="meAv"></div><div><b id="meName"></b><small id="meSt">Bağlanıyor...</small></div></div>
    <div style="display:flex">
      <button class="ib" id="btnMic" title="Mikrofon"><svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg></button>
      <button class="ib" id="btnDeaf" title="Sağırlaştır"><svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h2v-8H5v-1a7 7 0 0 1 14 0v1h-2v8h2a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9z"/></svg></button>
      <button class="ib" onclick="logout()" title="Çıkış Yap"><svg viewBox="0 0 24 24"><path d="M10 17l1.4-1.4-2.6-2.6H20v-2H8.8l2.6-2.6L10 7l-5 5 5 5zM4 5h8V3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8v-2H4V5z"/></svg></button>
    </div>
  </div>
</div>
<div class="main">
  <div class="hd"><div class="t"><svg viewBox="0 0 24 24"><path d="M5.9 21l.9-4H3l.4-2h3.8l1-4H4.4l.4-2h3.8l.9-4h2l-.9 4h4l.9-4h2l-.9 4H20l-.4 2h-3.8l-1 4h3.8l-.4 2h-3.8l-.9 4h-2l.9-4h-4l-.9 4h-2zm4.3-6h4l1-4h-4l-1 4z"/></svg><span id="title">kanal seçilmedi</span></div>
    <div style="display:flex"><button class="ib" id="btnSnd" title="Bildirim Sesleri"><svg viewBox="0 0 24 24"><path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg></button><button class="ib" id="btnShare" title="Ekran Paylaş" style="display:none"><svg viewBox="0 0 24 24"><path d="M21 3H3a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7v2H8v2h8v-2h-2v-2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 13H3V5h18v11z"/></svg></button></div></div>
  <div class="body">
    <div class="center">
      <!-- Ses Kanalı İçin Discord Tarzı Kare Izgara -->
      <div id="voiceGrid"></div>
      
      <div id="stage"><video id="vid" autoplay playsinline></video>
        <div class="bar"><span id="who"></span><span><button onclick="fsc()">Tam Ekran</button> <button class="red" id="btnStop" style="display:none" onclick="stopStream()">Yayını Durdur</button></span></div></div>
      <div class="msgs" id="msgs"></div>
      <div class="inp"><input id="chatIn" maxlength="500" autocomplete="off" placeholder="Mesaj gönder"></div>
    </div>
    <div class="members" id="membersPanel"><h4>Odada — <span id="cnt">0</span></h4><div id="mList"></div></div>
  </div>
</div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const user = localStorage.getItem('lumolive_user'), token = localStorage.getItem('lumolive_token');
if (!user || !token) location.replace('/login.html');
const $ = id => document.getElementById(id);
const openM = id => $(id).style.display = 'flex', closeM = id => $(id).style.display = 'none';
const info = (t, d) => { $('infoT').textContent = t; $('infoD').textContent = d; openM('mInfo'); };
const color = n => `hsl(${[...n].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360},55%,45%)`;
function avatar(n, cls) { const d = document.createElement('div'); d.className = 'av ' + (cls || ''); d.style.background = color(n); d.textContent = n[0].toUpperCase(); return d; }
const hhmm = t => new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
$('meName').textContent = user; $('meAv').style.background = color(user);$('meAv').textContent = user[0].toUpperCase();

let soundOn = localStorage.getItem('lumolive_sound') !== '0', ac = null, names = {};
const getAC = () => ac = ac || new (window.AudioContext || window.webkitAudioContext)();
document.addEventListener('click', () => { try { getAC().state === 'suspended' && ac.resume(); } catch {} });
const SND = { join: [[523, .1], [784, .16]], leave: [[784, .1], [494, .16]], mute: [[420, .08], [300, .12]], unmute: [[300, .08], [440, .12]],
  deaf: [[350, .08], [250, .08], [180, .14]], undeaf: [[180, .08], [250, .08], [350, .14]], msg: [[880, .06], [1040, .08]],
  live: [[523, .08], [659, .08], [784, .16]], end: [[784, .08], [587, .08], [392, .16]], err: [[220, .12], [180, .18]], react: [[1100, .05]] };
function play(k) {
  if (!soundOn) return;
  try {
    const c = getAC(); if (c.state === 'suspended') c.resume(); let t = c.currentTime;
    SND[k].forEach(([f, d]) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.12, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + d); t += d * .75; });
  } catch {}
}
function toast(t, k) { const d = document.createElement('div'); d.className = 'toast ' + (k || ''); d.textContent = t; $('toasts').appendChild(d);
  setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 300); }, 3000); }
const setNames = ms => { names = {}; ms.forEach(m => names[m.id] = m.username); };

const watchers = {};
function unwatch(k) { const w = watchers[k]; if (w) { try { w.src.disconnect(); } catch {} delete watchers[k]; } }
function watch(k, stream) {
  unwatch(k); if (!stream.getAudioTracks().length) return;
  try { const c = getAC(), an = c.createAnalyser(); an.fftSize = 512; const src = c.createMediaStreamSource(stream); src.connect(an);
    watchers[k] = { an, src, buf: new Uint8Array(an.fftSize) }; } catch {}
}
setInterval(() => {
  for (const k in watchers) {
    const w = watchers[k]; w.an.getByteTimeDomainData(w.buf); let m = 0; for (const v of w.buf) m = Math.max(m, Math.abs(v - 128));
    const on = m > 12 && (k !== 'me' || micOn), sid = k === 'me' ? socket.id : k;
    document.querySelectorAll(`[data-sid="${sid}"]`).forEach(e => e.classList.toggle('speak', on));
  }
}, 100);

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
function toolbar(id) { const t = document.createElement('div'); t.className = 'tb';
  EMOJIS.forEach(e => { const b = document.createElement('button'); b.textContent = e; b.onclick = () => socket.emit('react', { msgId: id, emoji: e }); t.appendChild(b); }); return t; }
function renderRx(box, rx) { box.innerHTML = '';
  for (const e in rx) { const u = rx[e]; if (!u.length) continue; const b = document.createElement('button'); b.className = 'rx' + (u.includes(user) ? ' mine' : '');
    b.title = u.join(', '); b.textContent = e + ' ' + u.length; b.onclick = () => socket.emit('react', { msgId: box.closest('.msg').dataset.id, emoji: e }); box.appendChild(b); } }
function floatEmoji(e) { const d = document.createElement('div'); d.className = 'fl'; d.textContent = e; d.style.left = (30 + Math.random() * 40) + 'vw'; document.body.appendChild(d); setTimeout(() => d.remove(), 1600); }

function logout() { localStorage.removeItem('lumolive_user'); localStorage.removeItem('lumolive_token'); location.href = '/login.html'; }

const socket = io({ auth: { token } });
$('btnSnd').classList.toggle('off', !soundOn);
$('btnSnd').onclick = () => { soundOn = !soundOn; localStorage.setItem('lumolive_sound', soundOn ? '1' : '0'); $('btnSnd').classList.toggle('off', !soundOn); play('unmute'); };
socket.on('connect_error', e => { if (e.message === 'unauthorized') logout(); else $('meSt').textContent = 'Bağlantı yok'; });
socket.on('disconnect', () => { $('meSt').textContent = 'Bağlantı koptu...'; cleanup(); });
socket.on('connect', () => { $('meSt').textContent = 'Bağlandı'; if (roomId) joinRoom(roomId); });

let roomId = '', currentType = 'voice', rooms = [], micStream = null, micOn = true, deaf = false, isHost = false, screen = null;
const voice = {}, hostPCs = {};
let viewPC = null;
const rtc = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

const micReady = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  .then(s => { micStream = s; watch('me', s); }).catch(() => { $('btnMic').classList.add('off'); });

$('btnMic').onclick = () => {
  if (!micStream) return info('Mikrofon yok', 'Mikrofon izni verilmedi.');
  micOn = !micOn; micStream.getAudioTracks().forEach(t => t.enabled = micOn);
  $('btnMic').classList.toggle('off', !micOn); play(micOn ? 'unmute' : 'mute');
};
$('btnDeaf').onclick = () => {
  deaf = !deaf; $('btnDeaf').classList.toggle('off', deaf); play(deaf ? 'deaf' : 'undeaf');
  document.querySelectorAll('#audioBox audio').forEach(a => a.muted = deaf);
  if (!isHost) $('vid').muted = deaf;
};

socket.on('room-list-update', list => { rooms = list; renderRooms(); if (!roomId && list.length) selectRoom(list[0].id); });
function renderRooms() {
  const c = $('chList'); c.innerHTML = '';
  rooms.forEach(r => {
    const row = document.createElement('div'); row.className = 'ch' + (r.id === roomId ? ' on' : ''); row.onclick = () => selectRoom(r.id);
    const icon = r.type === 'text' 
      ? '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16m-7 6h7"/></svg>' 
      : '<svg viewBox="0 0 24 24"><path d="M12 3a1 1 0 0 0-1 1v8.3a3 3 0 1 0 2 0V4a1 1 0 0 0-1-1z" opacity="0"/><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z"/></svg>';
    row.innerHTML = icon + '<span class="n"></span>';
    row.querySelector('.n').textContent = r.id;
    if (r.isLive) { const l = document.createElement('span'); l.className = 'live'; l.textContent = 'CANLI'; row.appendChild(l); }
    c.appendChild(row);
    if (r.type === 'voice') {
      r.members.forEach(m => { const v = document.createElement('div'); v.className = 'vu'; const av = avatar(m.username); av.dataset.sid = m.id; v.appendChild(av); const s = document.createElement('span'); s.textContent = m.username; v.appendChild(s); c.appendChild(v); });
    }
  });
}
socket.on('channel-created', ({ roomId: id }) => selectRoom(id));

$('btnCreate').onclick = () => { 
  const v = $('newName').value.trim(); 
  const type = $('newType').value;
  if (!v) return; 
  socket.emit('create-channel', { roomName: v, type }); 
  closeM('mCreate'); 
  $('newName').value = ''; 
};
$('newName').onkeydown = e => { if (e.key === 'Enter')$('btnCreate').click(); };

function cleanup() {
  Object.values(voice).forEach(p => p.close()); Object.keys(voice).forEach(k => delete voice[k]);
  Object.values(hostPCs).forEach(p => p.close()); Object.keys(hostPCs).forEach(k => delete hostPCs[k]);
  if (viewPC) { viewPC.close(); viewPC = null; }
  Object.keys(watchers).forEach(k => k !== 'me' && unwatch(k));
  $('audioBox').innerHTML = ''; if (!isHost)$('vid').srcObject = null;
}
function selectRoom(id) {
  if (id === roomId) return;
  if (isHost) stopStream();
  roomId = id; joinRoom(id);
}
async function joinRoom(id) {
  cleanup(); await micReady;
  const roomObj = rooms.find(r => r.id === id);
  currentType = roomObj ? roomObj.type : 'voice';

  $('title').textContent = (currentType === 'text' ? '# ' : '🔊 ') + id; 
  $('msgs').innerHTML = ''; 
  showStage(false);
  
  if (currentType === 'voice') {
    $('voiceGrid').style.display = 'flex';
    $('msgs').style.display = 'none';$('chatIn').parentElement.style.display = 'none';
  } else {
    $('voiceGrid').style.display = 'none';
    $('msgs').style.display = 'block';$('chatIn').parentElement.style.display = 'block';
  }

  $('btnShare').style.display = currentType === 'voice' ? 'block' : 'none';$('membersPanel').style.display = currentType === 'voice' ? 'block' : 'none';

  socket.emit('join-room', { roomId: id });
  renderRooms();
}
socket.on('room-joined', ({ type, isLive, hostName, messages, members }) => {
  currentType = type;
  setNames(members); play('join');
  messages.forEach(addMsg);
  if (!messages.length && currentType === 'text') {
    $('msgs').innerHTML = `<div class="empty"><h2>#${roomId} kanalına hoş geldin!</h2>Burası bu kanalın başlangıcı.</div>`;
  }
  updateVoiceGrid(members);
  if (isLive && currentType === 'voice') { showStage(true); $('who').textContent = `${hostName} yayında`; }
});
function showStage(on) { $('stage').style.display = on ? 'block' : 'none'; }

socket.on('update-room-members', ms => {
  setNames(ms); $('cnt').textContent = ms.length; 
  const l = $('mList'); l.innerHTML = '';
  ms.forEach(m => { 
    const d = document.createElement('div'); d.className = 'mi'; 
    const av = avatar(m.username); av.dataset.sid = m.id; 
    d.appendChild(av); 
    const s = document.createElement('span'); s.textContent = m.username; 
    d.appendChild(s); l.appendChild(d); 
  });
  updateVoiceGrid(ms);
});

// Ses Kanalı Ortası İçin Kare Izgara Güncelleyici
function updateVoiceGrid(ms) {
  const grid = $('voiceGrid');
  grid.innerHTML = '';
  if (currentType !== 'voice') return;

  // Kendimizi de ekleyelim
  const allMembers = [...ms];
  if (!allMembers.some(m => m.id === socket.id)) {
    allMembers.push({ id: socket.id, username: user });
  }

  allMembers.forEach(m => {
    const tile = document.createElement('div');
    tile.className = 'voice-tile';
    const av = avatar(m.username);
    av.dataset.sid = m.id; // Yeşil halka (speak) tetiklenmesi için data-sid şart
    const nameSpan = document.createElement('span');
    nameSpan.textContent = m.username;
    tile.append(av, nameSpan);
    grid.appendChild(tile);
  });
}

function addMsg(m) {
  if (currentType !== 'text') return;
  const e = $('msgs').querySelector('.empty'); if (e) e.remove();
  const d = document.createElement('div'); d.className = 'msg'; d.appendChild(avatar(m.username));
  const c = document.createElement('div'); const h = document.createElement('div');
  const b = document.createElement('b'); b.textContent = m.username; b.style.color = color(m.username).replace('45%', '70%');
  const t = document.createElement('time'); t.textContent = hhmm(m.time); h.append(b, t);
  const p = document.createElement('p'); p.textContent = m.text; c.append(h, p); d.dataset.id = m.id; const rx = document.createElement('div'); rx.className = 'rxs'; c.appendChild(rx); renderRx(rx, m.reactions || {}); d.appendChild(c); d.appendChild(toolbar(m.id));
  const box = $('msgs'), bottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.appendChild(d); if (bottom) box.scrollTop = box.scrollHeight;
}
socket.on('chat-message', m => { addMsg(m); if (m.username !== user) play('msg'); });
socket.on('reaction-update', ({ msgId, reactions, emoji, added }) => {
  const m = document.querySelector(`.msg[data-id="${msgId}"]`); if (m) renderRx(m.querySelector('.rxs'), reactions);
  if (added) { floatEmoji(emoji); play('react'); }
});
$('chatIn').onkeydown = e => { if (e.key === 'Enter' && e.target.value.trim()) { socket.emit('chat-message', { text: e.target.value }); e.target.value = ''; } };

function flush(pc) { (pc._q || []).forEach(c => pc.addIceCandidate(c).catch(() => {})); pc._q = []; }
function addCand(pc, c) { if (pc.remoteDescription) pc.addIceCandidate(c).catch(() => {}); else (pc._q = pc._q || []).push(c); }

// Sesin karşı tarafa gitmesini sağlayan async bağlantı fonksiyonu
async function voicePC(id) {
  await micReady; // Mikrofonun tamamen hazır olmasını bekle
  const pc = new RTCPeerConnection(rtc);
  pc.onicecandidate = e => e.candidate && socket.emit('signal', { target: id, signal: { candidate: e.candidate }, type: 'voice' });
  pc.ontrack = e => {
    let a = $('a-' + id);
    if (!a) { a = document.createElement('audio'); a.id = 'a-' + id; a.autoplay = true; $('audioBox').appendChild(a); }
    a.muted = deaf; a.srcObject = e.streams[0]; watch(id, e.streams[0]); a.play().catch(() => {});
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') pc.restartIce(); };
  if (micStream) {
    micStream.getTracks().forEach(t => pc.addTrack(t, micStream));
  } else {
    pc.addTransceiver('audio', { direction: 'recvonly' });
  }
  return pc;
}

socket.on('user-joined-voice', async ({ socketId, username }) => {
  if (currentType !== 'voice') return;
  play('join'); toast(`${username} odaya katıldı`, 'join');
  if (voice[socketId]) voice[socketId].close();
  const pc = voice[socketId] = await voicePC(socketId);
  await pc.setLocalDescription(await pc.createOffer());
  socket.emit('signal', { target: socketId, signal: { sdp: pc.localDescription }, type: 'voice' });
});

socket.on('user-left-voice', id => {
  if (names[id]) { play('leave'); toast(`${names[id]} odadan ayrıldı`, 'leave'); }
  unwatch(id);
  if (voice[id]) { voice[id].close(); delete voice[id]; }
  if (hostPCs[id]) { hostPCs[id].close(); delete hostPCs[id]; }
  const a = $('a-' + id); if (a) a.remove();
});

$('btnShare').onclick = () => isHost ? info('Yayındasın', 'Zaten ekran paylaşıyorsun.') : roomId ? openM('mStream') : 0;
const BITRATE = { 720: 4e6, 1080: 8e6 };
$('btnGo').onclick = async () => {
  const h = +$('resSel').value, fps = +$('fpsSel').value;
  try {
    screen = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: h * 16 / 9 }, height: { ideal: h }, frameRate: { ideal: fps, max: fps } }, audio: true });
  } catch { return info('İzin Hatası', 'Ekran paylaşımı başlatılamadı.'); }
  closeM('mStream'); isHost = true; screen._bitrate = BITRATE[h];
  const vt = screen.getVideoTracks()[0]; vt.contentHint = 'motion'; vt.onended = stopStream;
  $('vid').srcObject = screen; $('vid').muted = true; showStage(true);$('who').textContent = 'Yayıncı sensin'; $('btnStop').style.display = 'inline-block';$('btnShare').classList.add('act');
  play('live'); toast('Yayın başladı', 'live');
  socket.emit('start-stream-in-room');
};

socket.on('viewer-wants-stream', async ({ viewerId }) => {
  if (!isHost || !screen) return;
  if (hostPCs[viewerId]) hostPCs[viewerId].close();
  const pc = hostPCs[viewerId] = new RTCPeerConnection(rtc);
  pc.onicecandidate = e => e.candidate && socket.emit('signal', { target: viewerId, signal: { candidate: e.candidate }, type: 'stream' });
  screen.getTracks().forEach(t => pc.addTrack(t, screen));
  try {
    const s = pc.getSenders().find(s => s.track && s.track.kind === 'video'), p = s.getParameters();
    p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}];
    p.encodings[0].maxBitrate = screen._bitrate; await s.setParameters(p);
  } catch {}
  await pc.setLocalDescription(await pc.createOffer());
  socket.emit('signal', { target: viewerId, signal: { sdp: pc.localDescription }, type: 'stream' });
});

function stopStream() {
  if (!isHost) return;
  if (screen) { screen.getTracks().forEach(t => { t.onended = null; t.stop(); }); screen = null; }
  Object.values(hostPCs).forEach(p => p.close()); Object.keys(hostPCs).forEach(k => delete hostPCs[k]);
  isHost = false; $('vid').srcObject = null; $('btnStop').style.display = 'none';$('btnShare').classList.remove('act'); showStage(false);
  socket.emit('stop-stream');
}

socket.on('stream-started', ({ roomId: r, hostName }) => {
  if (r !== roomId || isHost) return;
  play('live'); toast(`${hostName} yayın başlattı`, 'live');
  if (viewPC) { viewPC.close(); viewPC = null; }
  showStage(true); $('who').textContent = `${hostName} yayında`;
});

socket.on('room-stream-ended', () => {
  play('end'); toast('Yayın sona erdi', 'leave');
  if (viewPC) { viewPC.close(); viewPC = null; }
  if (!isHost) { $('vid').srcObject = null; showStage(false); }
});

socket.on('signal', async ({ sender, signal, type }) => {
  try {
    if (type === 'voice') {
      let pc = voice[sender]; if (!pc) pc = voice[sender] = await voicePC(sender);
      if (signal.sdp) {
        await pc.setRemoteDescription(signal.sdp); flush(pc);
        if (signal.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); socket.emit('signal', { target: sender, signal: { sdp: pc.localDescription }, type: 'voice' }); }
      } else if (signal.candidate) addCand(pc, signal.candidate);
    } else if (type === 'stream') {
      if (isHost) {
        const pc = hostPCs[sender]; if (!pc) return;
        if (signal.sdp) { await pc.setRemoteDescription(signal.sdp); flush(pc); } else if (signal.candidate) addCand(pc, signal.candidate);
      } else {
        if (!viewPC) {
          viewPC = new RTCPeerConnection(rtc);
          viewPC.onicecandidate = e => e.candidate && socket.emit('signal', { target: sender, signal: { candidate: e.candidate }, type: 'stream' });
          viewPC.ontrack = e => {
            const v = $('vid'); v.srcObject = e.streams[0]; v.muted = deaf;
            v.onloadedmetadata = () => { v.play().catch(() => { v.muted = true; v.play(); }); };
          };
        }
        if (signal.sdp) {
          await viewPC.setRemoteDescription(signal.sdp); flush(viewPC);
          if (signal.sdp.type === 'offer') { await viewPC.setLocalDescription(await viewPC.createAnswer()); socket.emit('signal', { target: sender, signal: { sdp: viewPC.localDescription }, type: 'stream' }); }
        } else if (signal.candidate) addCand(viewPC, signal.candidate);
      }
    }
  } catch (e) { console.warn('signal hatası', e); }
});

socket.on('error-msg', m => { play('err'); info('Hata', m); });
$('vid').onclick = e => { if (!isHost) { e.target.muted = false; e.target.play(); } };
function fsc() { const s = $('stage'); document.fullscreenElement ? document.exitFullscreen() : s.requestFullscreen(); }
window.addEventListener('beforeunload', () => socket.emit('leave-room'));
</script>
</body>
</html>
```[cite: 3]
