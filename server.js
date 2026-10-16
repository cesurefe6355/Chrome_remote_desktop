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

// SQLite Veritabanı Bağlantısı
const db = new sqlite3.Database('./lumolive.db', (err) => {
    if (err) console.error('Veritabanı hatası:', err.message);
    else console.log('SQLite veritabanına bağlanıldı.');
});

// Kullanıcılar Tablosunu Oluştur
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
)`);

// Kayıt Ol
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Kullanıcı adı ve şifre zorunludur.' });
    }

    const hashedPassword = bcrypt.hashSync(password, 8);

    db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hashedPassword], function(err) {
        if (err) {
            return res.status(400).json({ error: 'Bu kullanıcı adı zaten kullanımda.' });
        }
        res.json({ success: true, message: 'Kayıt başarılı!' });
    });
});

// Giriş Yap
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Tüm alanları doldurun.' });
    }

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err || !user) {
            return res.status(400).json({ error: 'Kullanıcı bulunamadı veya şifre hatalı.' });
        }

        const passwordIsValid = bcrypt.compareSync(password, user.password);
        if (!passwordIsValid) {
            return res.status(400).json({ error: 'Kullanıcı bulunamadı veya şifre hatalı.' });
        }

        res.json({ success: true, username: user.username });
    });
});

// --- CANLI YAYIN VE ODA SİSTEMİ (SOCKET.IO) ---
const rooms = {};

io.on('connection', (socket) => {
    socket.emit('room-list', getPublicRooms());

    socket.on('create-room', ({ roomId, username }) => {
        if (rooms[roomId]) {
            socket.emit('error-msg', 'Bu oda adı zaten kullanımda!');
            return;
        }

        socket.join(roomId);
        rooms[roomId] = {
            hostName: username,
            hostSocketId: socket.id,
            viewers: []
        };

        socket.emit('room-created', { roomId });
        io.emit('room-list', getPublicRooms());
    });

    socket.on('join-room', ({ roomId, username }) => {
        const room = rooms[roomId];
        if (room) {
            // EK GÜVENLİK: Eğer yayını açan kişi (Host) kendi odasına katılmaya çalışıyorsa engelle
            if (room.hostSocketId === socket.id) {
                socket.emit('error-msg', 'Kendi yayınınıza izleyici olarak katılamazsınız!');
                return;
            }

            socket.join(roomId);
            room.viewers.push({ id: socket.id, username });

            io.to(roomId).emit('update-viewers', room.viewers);
            socket.to(room.hostSocketId).emit('user-connected', socket.id);
            socket.emit('join-success', { roomId });
        } else {
            socket.emit('error-msg', 'Oda bulunamadı veya kapatılmış.');
        }
    });

    socket.on('leave-room', ({ roomId }) => {
        handleUserLeave(socket, roomId);
    });

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
        delete rooms[roomId];
        io.to(roomId).emit('room-closed');
        io.emit('room-list', getPublicRooms());
    } else {
        const index = room.viewers.findIndex(v => v.id === socket.id);
        if (index !== -1) {
            room.viewers.splice(index, 1);
            io.to(roomId).emit('update-viewers', room.viewers);
            io.to(room.hostSocketId).emit('viewer-disconnected', socket.id);
        }
    }
}

function getPublicRooms() {
    return Object.keys(rooms).map(id => ({
        id,
        hostName: rooms[id].hostName,
        viewerCount: rooms[id].viewers.length
    }));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`LumoLive Sunucusu aktif: Port ${PORT}`);
});
