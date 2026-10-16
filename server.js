const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 'public' klasörünü statik dosya sunucusu yapıyoruz
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı:', socket.id);

    // Bir odaya katılma (Host ve Viewer eşleşmesi için)
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        console.log(`Kullanıcı ${socket.id}, ${roomId} odasına katıldı.`);
        
        // Odadaki diğer kullanıcılara haber ver
        socket.to(roomId).emit('user-connected', socket.id);
    });

    // WebRTC Sinyalleşme mesajları (offer, answer, candidate)
    socket.on('signal', (data) => {
        io.to(data.target).emit('signal', {
            sender: socket.id,
            signal: data.signal
        });
    });

    // İzleyiciden gelen fare/klavye komutlarını hedef bilgisayara (Host) ilet
    socket.on('remote-control', (data) => {
        // data: { roomId, type, x, y, key, etc. }
        socket.to(data.roomId).emit('remote-control', data);
    });

    socket.on('disconnect', () => {
        console.log('Kullanıcı ayrıldı:', socket.id);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});
