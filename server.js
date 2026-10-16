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

// --- ODA & CANLI YAYIN SİSTEMİ ---
// Global Odalar Veri Yapısı: { "Oda Adı": { createdBy: "user", isLive: false, hostSocketId: null, viewers: [] } }
const rooms = {
    "Lobi": { createdBy: "Sistem", isLive: false, hostSocketId: null, viewers: [] },
    "Oyun-Gecesi": { createdBy: "Sistem", isLive: false, hostSocketId: null, viewers: [] }
};

io.on('connection', (socket) => {
    // Bağlanan kullanıcıya mevcut oda listesini gönder
    socket.emit('room-list-update', getRoomsList());

    // 1. Yeni Oda (Kanal) Oluşturma
    socket.on('create-channel', ({ roomName, username }) => {
        const formattedRoom = roomName.trim().replace(/\s+/g, '-').toLowerCase();
        if (!formattedRoom) {
            socket.emit('error-msg', 'Geçersiz oda adı.');
            return;
        }
        if (rooms[formattedRoom]) {
            socket.emit('error-msg', 'Bu oda adı zaten mevcut!');
            return;
        }

        rooms[formattedRoom] = {
            createdBy: username,
            isLive: false,
            hostSocketId: null,
            hostName: null,
            viewers: []
        };

        io.emit('room-list-update', getRoomsList());
        socket.emit('channel-created', { roomId: formattedRoom });
    });

    // 2. Odaya Katılma (İzleyici veya Oda Sakini)
    socket.on('join-room', ({ roomId, username }) => {
        const room = rooms[roomId];
        if (!room) {
            socket.emit('error-msg', 'Oda bulunamadı.');
            return;
        }

        socket.join(roomId);

        // Eğer odada aktif yayın varsa ve yayıncı değilse izleyici listesine ekle
        if (room.isLive && room.hostSocketId !== socket.id) {
            if (!room.viewers.some(v => v.id === socket.id)) {
                room.viewers.push({ id: socket.id, username });
            }
            io.to(roomId).emit('update-viewers', room.viewers);
            socket.to(room.hostSocketId).emit('user-connected', socket.id);
        }

        socket.emit('room-joined', { roomId, isLive: room.isLive, hostName: room.hostName });
    });

    // 3. Odada Yayın Başlatma
    socket.on('start-stream-in-room', ({ roomId, username }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('error-msg', 'Oda bulunamadı.');
        if (room.isLive) return socket.emit('error-msg', 'Bu odada zaten aktif bir yayın var!');

        room.isLive = true;
        room.hostSocketId = socket.id;
        room.hostName = username;

        socket.join(roomId);
        io.emit('room-list-update', getRoomsList());
        io.to(roomId).emit('stream-started', { roomId, hostName: username });
    });

    // 4. Odadaki Yayını/Odayı Terk Etme
    socket.on('leave-room', ({ roomId }) => {
        handleUserLeave(socket, roomId);
    });

    // WebRTC Sinyalleşme
    socket.on('signal', (data) => {
        io.to(data.target).emit('signal', {
            sender: socket.id,
            signal: data.signal
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

    if (room.hostSocketId === socket.id) {
        // Yayıncı ayrıldıysa yayını durdur
        room.isLive = false;
        room.hostSocketId = null;
        room.hostName = null;
        room.viewers = [];
        
        io.to(roomId).emit('room-stream-ended');
        io.emit('room-list-update', getRoomsList());
    } else {
        // İzleyici ayrıldıysa
        const index = room.viewers.findIndex(v => v.id === socket.id);
        if (index !== -1) {
            room.viewers.splice(index, 1);
            io.to(roomId).emit('update-viewers', room.viewers);
        }
    }
}

function getRoomsList() {
    return Object.keys(rooms).map(id => ({
        id,
        createdBy: rooms[id].createdBy,
        isLive: rooms[id].isLive,
        hostName: rooms[id].hostName,
        viewerCount: rooms[id].viewers.length
    }));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`LumoLive Sunucusu aktif: Port ${PORT}`);
});
