const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// GitHub'daki klasör adınıza uygun olarak 'Public' olarak ayarlandı
app.use(express.static(path.join(__dirname, 'Public')));

// Aktif odaları ve kullanıcıları hafızada tutuyoruz
const rooms = {}; // { roomId: { hostName: "...", hostSocketId: "...", viewers: [ { id, username } ] } }

io.on('connection', (socket) => {
    console.log('Kullanıcı bağlandı:', socket.id);

    // Aktif oda listesini yeni bağlanan kullanıcıya gönder
    socket.emit('room-list', getPublicRooms());

    // 1. Yeni Yayın Oluşturma (Host)
    socket.on('create-room', ({ roomId, username }) => {
        socket.join(roomId);
        rooms[roomId] = {
            hostName: username,
            hostSocketId: socket.id,
            viewers: []
        };

        socket.emit('room-created', { roomId });
        io.emit('room-list', getPublicRooms()); // Tüm kullanıcılara oda listesini güncelle
    });

    // 2. Yayına Katılma (Viewer)
    socket.on('join-room', ({ roomId, username }) => {
        const room = rooms[roomId];
        if (room) {
            socket.join(roomId);
            
            // İzleyiciyi odaya ekle
            const viewerInfo = { id: socket.id, username };
            room.viewers.push(viewerInfo);

            // Odadaki herkese (özellikle Host'a) güncel izleyici listesini gönder
            io.to(roomId).emit('update-viewers', room.viewers);
            
            // Host'a yeni bir izleyicinin bağlandığını bildir (WebRTC teklifi için)
            socket.to(room.hostSocketId).emit('user-connected', socket.id);
        } else {
            socket.emit('error-msg', 'Oda bulunamadı veya kapatılmış.');
        }
    });

    // WebRTC Sinyalleşmesi
    socket.on('signal', (data) => {
        io.to(data.target).emit('signal', {
            sender: socket.id,
            signal: data.signal
        });
    });

    // Uzaktan Kontrol Sinyalleri
    socket.on('remote-control', (data) => {
        socket.to(data.roomId).emit('remote-control', data);
    });

    // Bağlantı Kopması
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];

            // Eğer ayrılan kişi Host ise odayı kapat
            if (room.hostSocketId === socket.id) {
                delete rooms[roomId];
                io.to(roomId).emit('room-closed');
                io.emit('room-list', getPublicRooms());
                break;
            } else {
                // Eğer ayrılan kişi İzleyici ise listeden çıkar
                const index = room.viewers.findIndex(v => v.id === socket.id);
                if (index !== -1) {
                    room.viewers.splice(index, 1);
                    io.to(roomId).emit('update-viewers', room.viewers);
                    break;
                }
            }
        }
    });
});

function getPublicRooms() {
    return Object.keys(rooms).map(id => ({
        id,
        hostName: rooms[id].hostName,
        viewerCount: rooms[id].viewers.length
    }));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu aktif: Port ${PORT}`);
});
