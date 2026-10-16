const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Statik dosyaları sunmak için public klasörü veya ana dizin kullanılır
app.use(express.static(path.join(__dirname)));

// WebSocket bağlantı yönetimi
wss.on('connection', (ws) => {
    console.log('Yeni bir istemci bağlandı.');

    ws.on('message', (message) => {
        // İstemciden gelen verileri (klavye/fare hareketleri vb.) burada işleyebilirsiniz
        // Örneğin diğer bağlı hedeflere iletebilirsiniz.
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    ws.on('close', () => {
        console.log('İstemci bağlantısı kesildi.');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
