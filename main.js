const { app, BrowserWindow, session, desktopCapturer, shell, ipcMain } = require('electron');
const path = require('path');

const SERVER_URL = process.env.LUMOLIVE_URL || 'https://chrome-remote-desktop-w9hm.onrender.com';
let win;

// ---------- Özel ekran paylaşımı (tarayıcı seçim penceresi yerine kendi arayüzümüz) ----------
// Kullanıcının seçtiği kaynak burada tutulur; getDisplayMedia çağrıldığında kullanılır.
let pendingSourceId = null;

ipcMain.handle('lumo:get-sources', async () => {
    const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 380, height: 238 },
        fetchWindowIcons: true
    });
    return sources.map(s => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '',
        appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : ''
    }));
});

ipcMain.handle('lumo:pick-source', async (e, id) => { pendingSourceId = String(id); return true; });

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
        webPreferences: {
            nodeIntegration: false, contextIsolation: true, sandbox: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Mikrofon ve ekran paylaşımı izinleri (Electron'da bunlar olmadan çalışmaz)
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
        cb(['media', 'display-capture', 'fullscreen'].includes(permission));
    });

    // Ekran paylaşımı: Chrome'un seçim penceresini tamamen devre dışı bırakır.
    // Kullanıcı kendi arayüzümüzden seçtiği kaynağı (pendingSourceId) callback ile döndürürüz.
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        try {
            // Sadece kaynağı bulmak için; önizleme üretmeden hızlıca listele
            const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 1, height: 1 } });
            let src = sources.find(s => s.id === pendingSourceId);
            if (!src) src = sources.find(s => s.id.startsWith('screen')) || sources[0];
            pendingSourceId = null;
            if (!src) return callback({});
            const opts = { video: src };
            if (process.platform === 'win32' && request.audioRequested) opts.audio = 'loopback'; // sistem sesi
            callback(opts);
        } catch (e) {
            console.error('Ekran kaynağı seçilemedi:', e.message);
            callback({});
        }
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
