const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'Public')));

// SQLite Veritabanı
const db = new sqlite3.Database('./lumolive.db', (err) => {
    if (err) console.error('Veritabanı hatası:', err.message);
    else console.log('SQLite veritabanına bağlanıldı.');
});

db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
)`);

// Kayıt & Giriş API
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Kullanıcı adı ve şifre zorunludur.' });
    const hashedPassword = bcrypt.hashSync(password, 8);
    db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hashedPassword], function(err) {
        if (err) return res.status(400).json({ error: 'Bu kullanıcı adı zaten kullanımda.' });
        res.json({ success: true, message: 'Kayıt başarılı!' });
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Tüm alanları doldurun.' });
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err || !user || !bcrypt.compareSync(password, user.password)) {
            return res.status(400).json({ error: 'Kullanıcı bulunamadı veya şifre hatalı.' });
        }
        res.json({ success: true, username: user.username });
    });
});

// --- ODA & SESLİ SOHBET / YAYIN SİSTEMİ ---
const rooms = {
    "Lobi": { createdBy: "Sistem", isLive: false, hostSocketId: null, hostName: null, members: [] },
    "Oyun-Gecesi": { createdBy: "Sistem", isLive: false, hostSocketId: null, hostName: null, members: [] }
};

io.on('connection', (socket) => {
    socket.emit('room-list-update', getRoomsList());

    // Oda Oluşturma
    socket.on('create-channel', ({ roomName, username }) => {
        const formattedRoom = roomName.trim().replace(/\s+/g, '-').toLowerCase();
        if (!formattedRoom || rooms[formattedRoom]) {
            return socket.emit('error-msg', 'Geçersiz veya mevcut oda adı!');
        }

        rooms[formattedRoom] = {
            createdBy: username,
            isLive: false,
            hostSocketId: null,
            hostName: null,
            members: []
        };

        io.emit('room-list-update', getRoomsList());
        socket.emit('channel-created', { roomId: formattedRoom });
    });

    // Odaya Katılma (Sesli Sohbet Ağına Dahil Olma)
    socket.on('join-room', ({ roomId, username }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('error-msg', 'Oda bulunamadı.');

        socket.join(roomId);
        
        // Odadaki diğer kullanıcılara yeni birinin katıldığını haber ver (Sesli Sohbet Mesh Ağı için)
        socket.to(roomId).emit('user-joined-voice', { socketId: socket.id, username });

        if (!room.members.some(m => m.id === socket.id)) {
            room.members.push({ id: socket.id, username });
        }

        socket.emit('room-joined', {
            roomId,
            isLive: room.isLive,
            hostName: room.hostName,
            members: room.members
        });

        io.to(roomId).emit('update-room-members', room.members);
    });

    // Odada Ekran Yayını Başlatma
    socket.on('start-stream-in-room', ({ roomId, username }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('error-msg', 'Oda bulunamadı.');
        if (room.isLive) return socket.emit('error-msg', 'Bu odada zaten aktif bir yayın var!');

        room.isLive = true;
        room.hostSocketId = socket.id;
        room.hostName = username;

        io.emit('room-list-update', getRoomsList());
        io.to(roomId).emit('stream-started', { roomId, hostName: username, hostSocketId: socket.id });
    });

    // Odayı/Yayını Terk Etme
    socket.on('leave-room', ({ roomId }) => {
        handleUserLeave(socket, roomId);
    });

    // WebRTC Sinyalleşmesi (Sesli Sohbet ve Ekran Paylaşımı İçin Ortak)
    socket.on('signal', (data) => {
        io.to(data.target).emit('signal', {
            sender: socket.id,
            signal: data.signal,
            type: data.type // 'voice' veya 'stream'
        });
    });

    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            handleUserLeave(socket, roomId);
        }
    });
});

function handleUserLeave(socket, roomId) {
    const room = rooms[roomId];
    if (!room) return;

    // Kullanıcının ayrıldığını odadakilere bildir
    socket.to(roomId).emit('user-left-voice', socket.id);

    const index = room.members.findIndex(m => m.id === socket.id);
    if (index !== -1) room.members.splice(index, 1);

    if (room.hostSocketId === socket.id) {
        room.isLive = false;
        room.hostSocketId = null;
        room.hostName = null;
        io.to(roomId).emit('room-stream-ended');
    }

    io.to(roomId).emit('update-room-members', room.members);
    io.emit('room-list-update', getRoomsList());
}

function getRoomsList() {
    return Object.keys(rooms).map(id => ({
        id,
        isLive: rooms[id].isLive,
        hostName: rooms[id].hostName,
        memberCount: rooms[id].members.length
    }));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`LumoLive Sunucusu aktif: Port ${PORT}`);
});
