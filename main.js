const { app, BrowserWindow, session, desktopCapturer, shell } = require('electron');

const SERVER_URL = process.env.LUMOLIVE_URL || 'https://chrome-remote-desktop-w9hm.onrender.com';
let win;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

const loadingPage = (msg) => 'data:text/html;charset=utf-8,' + encodeURIComponent(
    `<body style="background:#313338;color:#dbdee1;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><h2>${msg}</h2></body>`);

function load() {
    win.loadURL(SERVER_URL).catch(() => {});
}

function createWindow() {
    win = new BrowserWindow({
        width: 1280, height: 720, minWidth: 940, minHeight: 560,
        backgroundColor: '#313338', autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    });

    // Mikrofon ve ekran paylaşımı izinleri (Electron'da bunlar olmadan çalışmaz)
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
        cb(['media', 'display-capture', 'fullscreen'].includes(permission));
    });
    // Ekran paylaşımı: Electron'da tarayıcıdaki seçim penceresi yoktur, ana ekranı paylaşır
    session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
        desktopCapturer.getSources({ types: ['screen'] })
            .then(src => cb({ video: src[0], ...(process.platform === 'win32' ? { audio: 'loopback' } : {}) }))
            .catch(() => cb({}));
    });

    // Sunucu uyanana / internet gelene kadar tekrar dene (Render ücretsiz plan ilk açılışta yavaştır)
    win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
        if (!isMain || code === -3) return;
        win.loadURL(loadingPage('Sunucuya bağlanılıyor... Lütfen bekleyin.'));
        setTimeout(load, 5000);
    });
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

    load();
    win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
