const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'Public')));

const rooms = {}; // { roomId: { hostName, hostSocketId, viewers: [] } }

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
    console.log(`Sunucu aktif: Port ${PORT}`);
});
