const { app, BrowserWindow } = require('electron');

// Sunucumuzu doğrudan arka planda başlatıyoruz
require('./server.js');

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#313338', // Discord koyu tema arka plan rengi
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // Menü çubuğunu gizle (Daha profesyonel Discord görünümü için)
    mainWindow.setMenuBarVisibility(false);

    // Yerel sunucumuza bağlan
    mainWindow.loadURL('http://localhost:3000');
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});