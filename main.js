const { app, BrowserWindow, session, desktopCapturer, shell, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const isLocal = process.argv.includes('--local') || process.env.LUMOLIVE_LOCAL === '1';
const SERVER_URL = process.env.LUMOLIVE_URL || (isLocal ? 'http://localhost:3000' : 'https://chrome-remote-desktop-w9hm.onrender.com');
let win;

// ---------- Uzaktan Kontrol (Native Windows Input Driver) ----------
let remoteProc = null;

function getHelperPath() {
    return app.isPackaged
        ? path.join(process.resourcesPath, 'bin', 'remote-input.exe')
        : path.join(__dirname, 'bin', 'remote-input.exe');
}

function ensureRemoteProcess() {
    if (process.platform !== 'win32') return null;
    if (remoteProc && !remoteProc.killed) return remoteProc;
    try {
        const exePath = getHelperPath();
        remoteProc = spawn(exePath, [], {
            windowsHide: true,
            stdio: ['pipe', 'ignore', 'ignore']
        });
        remoteProc.on('error', (err) => {
            console.error('Remote input helper error:', err && err.message);
            remoteProc = null;
        });
        remoteProc.on('exit', () => {
            remoteProc = null;
        });
        return remoteProc;
    } catch (e) {
        console.error('Failed to spawn remote input process:', e);
        return null;
    }
}

ipcMain.handle('lumo:is-remote-supported', () => {
    return process.platform === 'win32';
});

ipcMain.handle('lumo:remote-input', (e, cmd) => {
    if (!cmd || typeof cmd !== 'object') return false;
    const p = ensureRemoteProcess();
    if (!p || !p.stdin || !p.stdin.writable) return false;

    let line = null;
    switch (cmd.action) {
        case 'move':
            if (typeof cmd.x === 'number' && typeof cmd.y === 'number') {
                line = `MOVE ${cmd.x.toFixed(4)} ${cmd.y.toFixed(4)}`;
            }
            break;
        case 'mousedown':
            line = `MOUSEDOWN ${cmd.button || 'left'}`;
            break;
        case 'mouseup':
            line = `MOUSEUP ${cmd.button || 'left'}`;
            break;
        case 'wheel':
            line = `WHEEL ${Math.round(cmd.delta || 0)}`;
            break;
        case 'keydown':
            if (cmd.vk) line = `KEYDOWN ${cmd.vk}`;
            break;
        case 'keyup':
            if (cmd.vk) line = `KEYUP ${cmd.vk}`;
            break;
        case 'char':
            if (cmd.charCode) line = `CHAR ${cmd.charCode}`;
            break;
        case 'text':
            if (cmd.text) line = `TEXT ${cmd.text.replace(/[\r\n]+/g, ' ')}`;
            break;
    }

    if (line) {
        try {
            p.stdin.write(line + '\n');
            return true;
        } catch (err) {
            console.error('Write error to remote helper:', err.message);
        }
    }
    return false;
});

// ---------- Özel ekran paylaşımı ----------
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
            nodeIntegration: false, contextIsolation: true, sandbox: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
        cb(['media', 'display-capture', 'fullscreen'].includes(permission));
    });

    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        const wanted = pendingSourceId;
        pendingSourceId = null;
        try {
            if (!wanted) { callback({}); return; }
            const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 1, height: 1 } });
            const src = sources.find(s => s.id === wanted);
            if (!src) { callback({}); return; }
            const opts = { video: src };
            if (process.platform === 'win32' && request.audioRequested) opts.audio = 'loopback';
            callback(opts);
        } catch (e) {
            console.error('Ekran kaynağı seçilemedi:', e.message);
            callback({});
        }
    });

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

app.on('before-quit', () => {
    if (remoteProc && !remoteProc.killed) {
        try {
            remoteProc.stdin.write('QUIT\n');
            remoteProc.kill();
        } catch {}
    }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
