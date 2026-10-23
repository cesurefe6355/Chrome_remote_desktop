require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool, initDb } = require('./db');
const { analyze, censor, isValidName } = require('./filter');

const app = express();
const server = http.createServer(app);

// Socket.IO sertleştirme: istek boyutu, zaman aşımı ve Origin kontrolü (CSWSH koruması)
const io = new Server(server, {
    maxHttpBufferSize: 256e3,
    pingTimeout: 25000,
    pingInterval: 25000,
    allowRequest: (req, callback) => {
        const origin = req.headers.origin;
        if (!origin) return callback(null, true); // tarayıcı dışı istemciler (yine token ile doğrulanır)
        try {
            const host = String(req.headers.host || '').toLowerCase();
            callback(null, new URL(origin).host.toLowerCase() === host);
        } catch { callback(null, false); }
    }
});

app.disable('x-powered-by');
// Render/Cloudflare arkasında gerçek istemci IP'si (hız sınırı tüm siteyi kilitlemesin)
app.set('trust proxy', 1);

const CANONICAL_HOST = process.env.PUBLIC_HOST || '';
const baseUrl = req => `${req.headers['x-forwarded-proto'] || req.protocol}://${CANONICAL_HOST || req.get('host')}`;

// ---------- Güvenlik başlıkları (tarama raporundaki eksikler kapatıldı) ----------
// WebSocket bağlantısı yalnızca aynı host'a izin verir (veri sızdırma yüzeyi daraltılır).
const cspFor = (req) => {
    const host = String(req.headers.host || '').toLowerCase().replace(/[^a-z0-9.:\-\[\]]/g, '');
    const connect = host ? `'self' ws://${host} wss://${host}` : "'self' ws: wss:";
    return [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'self'",
        "form-action 'self'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "font-src 'self' data:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-inline'",
        `connect-src ${connect}`,
        "worker-src 'self' blob:",
        "manifest-src 'self'"
    ].join('; ');
};

app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', cspFor(req));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self), display-capture=(self), autoplay=(self), fullscreen=(self), clipboard-write=(self)');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Origin-Agent-Cluster', '?1');
    // HSTS yalnızca HTTPS üzerinden gönderilir (yerel HTTP geliştirmeyi bozmaz)
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    next();
});

// API yanıtları önbelleğe alınmasın, arama motorlarına kapalı olsun
app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
});

// ---------- robots.txt & security.txt (RFC 9116) ----------
app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send([
        'User-agent: *',
        'Allow: /$',
        'Allow: /login.html',
        'Allow: /privacy.html',
        'Disallow: /api/',
        'Disallow: /muhtar',
        'Disallow: /muhtar.html',
        'Disallow: /index.html',
        ''
    ].join('\n'));
});
app.get('/.well-known/security.txt', (req, res) => {
    const contact = process.env.SECURITY_CONTACT || (baseUrl(req) + '/privacy.html');
    res.type('text/plain').send([
        `Contact: ${contact}`,
        `Expires: ${new Date(Date.now() + 365 * 864e5).toISOString()}`,
        'Preferred-Languages: tr, en',
        `Canonical: ${baseUrl(req)}/.well-known/security.txt`,
        `Policy: ${baseUrl(req)}/privacy.html`,
        ''
    ].join('\n'));
});
app.get('/security.txt', (req, res) => res.redirect(301, '/.well-known/security.txt'));

app.use(express.json({ limit: '10kb' }));
// Doğrudan /muhtar.html erişimini engelle (yalnızca /muhtar üzerinden sunulur)
app.get('/muhtar.html', (req, res) => res.redirect(302, '/muhtar'));
// index:false → "/" isteği aşağıdaki yönlendirmeye düşer (giriş sayfası + gizlilik bağlantısı)
app.use(express.static(path.join(__dirname, 'Public'), { index: false }));
// Kök adres giriş sayfasına gider: yeni ziyaretçi ve arama motorları gizlilik bağlantısını görür
app.get('/', (req, res) => res.redirect('/login.html'));

// ---------- Kullanıcı veritabanı: PostgreSQL (Render) ----------
// Bağlantı ve "users" tablosunun oluşturulması db.js içindedir (initDb).

// ---------- Oturum token'ı (sunucu yeniden başlasa da geçerli kalması için SECRET env ayarla) ----------
const SECRET = process.env.SECRET || crypto.randomBytes(32).toString('hex');
const sign = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
// "Beni hatırla" işaretliyse 30 gün, işaretli değilse 1 saat geçerli olur.
const SESSION_MS = 3600e3, REMEMBER_MS = 30 * 864e5;
function makeToken(username, sid, remember) {
    const expiresAt = Date.now() + (remember ? REMEMBER_MS : SESSION_MS);
    const p = Buffer.from(JSON.stringify({ u: username, s: sid, e: expiresAt })).toString('base64url');
    return { token: p + '.' + sign(p), expiresAt };
}
function verifyToken(t) {
    if (typeof t !== 'string') return null;
    const [p, s] = t.split('.');
    if (!p || !s) return null;
    const good = sign(p);
    // Bayt uzunluğu karşılaştırması: çok baytlı karakterler timingSafeEqual'ı patlatmasın
    const sb = Buffer.from(s), gb = Buffer.from(good);
    if (sb.length !== gb.length || !crypto.timingSafeEqual(sb, gb)) return null;
    try { const d = JSON.parse(Buffer.from(p, 'base64url').toString()); return d.e > Date.now() ? { u: d.u, sid: d.s } : null; } catch { return null; }
}

// ---------- Küfür ceza sistemi (uyarı → uyarı → ban) ----------
const MAX_STRIKES = 3;                                  // 3. ihlalde hesap banlanır
const STRIKE_WINDOW_MS = 24 * 3600e3;                   // 24 saat cezasız geçerse sayaç sıfırlanır

// ---------- Yönetici (admin / "muhtar") oturumu ----------
// Varsayılan şifre KALDIRILDI: ADMIN_PASSWORD yoksa panel devre dışı kalır (güvenli varsayılan).
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
const ADMIN_ENABLED = ADMIN_PASSWORD.length >= 6;
if (!ADMIN_ENABLED) {
    console.error('[GÜVENLİK] ADMIN_PASSWORD tanımlı değil veya 6 karakterden kısa — /muhtar paneli DEVRE DIŞI.');
    console.error('           Render > Environment bölümüne güçlü bir ADMIN_PASSWORD ekleyip yeniden deploy edin.');
} else {
    console.log('[BİLGİ] Yönetici paneli (/muhtar) aktif. Şifre uzunluğu: ' + ADMIN_PASSWORD.length);
    if (ADMIN_PASSWORD.length < 12) console.warn('[GÜVENLİK] ADMIN_PASSWORD kısa; en az 12 karakter önerilir.');
}
if (!process.env.SECRET) console.warn('[GÜVENLİK] SECRET tanımlı değil — oturumlar sunucu yeniden başlayınca geçersiz olur. Render > Environment üzerinden sabit ve uzun bir SECRET ayarlayın.');
const ADMIN_SESSION_MS = 12 * 3600e3;                   // 12 saat
function makeAdminToken() {
    const p = Buffer.from(JSON.stringify({ a: 1, e: Date.now() + ADMIN_SESSION_MS })).toString('base64url');
    return p + '.' + sign(p);
}
function verifyAdminToken(t) {
    if (typeof t !== 'string') return false;
    const [p, s] = t.split('.');
    if (!p || !s) return false;
    const good = sign(p);
    const sb = Buffer.from(s), gb = Buffer.from(good);
    if (sb.length !== gb.length || !crypto.timingSafeEqual(sb, gb)) return false;
    try { const d = JSON.parse(Buffer.from(p, 'base64url').toString()); return d.a === 1 && d.e > Date.now(); } catch { return false; }
}

// ---------- Ban yardımcıları ----------
function banInfo(row) {
    if (!row || !row.banned) return null;
    if (row.ban_until && new Date(row.ban_until).getTime() <= Date.now()) return null; // süresi geçmiş
    return { until: row.ban_until || null, reason: row.ban_reason || 'Kural ihlali', permanent: !row.ban_until };
}
function banText(b) {
    return b.permanent
        ? `Hesabın kalıcı olarak kapatıldı. Sebep: ${b.reason}`
        : `Hesabın kapatıldı. Sebep: ${b.reason} — Bitiş: ${new Date(b.until).toLocaleString('tr-TR')}`;
}
function onlineUsernames() {
    return [...new Set([...io.sockets.sockets.values()].filter(s => s.connected && s.data.username).map(s => s.data.username))];
}
function disconnectUser(username, event, message) {
    const low = String(username).toLowerCase();
    for (const s of io.sockets.sockets.values()) {
        if (s.data.username && s.data.username.toLowerCase() === low) {
            s.emit(event, message);
            setTimeout(() => { try { s.disconnect(true); } catch { /* yoksay */ } }, 400);
        }
    }
}
function kickUser(username, reason) { disconnectUser(username, 'banned', reason); }
// Küfür ihlalinde ceza uygula: 1-2. ihlal uyarı, 3. ihlal kalıcı ban.
async function applyStrike(socket, result) {
    const username = socket.data.username;
    const matches = (result && result.matches) || [];
    try {
        const { rows } = await pool.query('SELECT profanity_strikes, last_strike_at FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1', [username]);
        if (!rows[0]) return;
        let strikes = rows[0].profanity_strikes || 0;
        const last = rows[0].last_strike_at ? new Date(rows[0].last_strike_at).getTime() : 0;
        if (Date.now() - last > STRIKE_WINDOW_MS) strikes = 0; // süre dolduysa temiz sayfa
        strikes += 1;

        if (strikes >= MAX_STRIKES) {
            const reason = `Otomatik ban: küfür/içerik ihlali (${MAX_STRIKES}. ihlal)`;
            await pool.query('UPDATE users SET profanity_strikes=$1, last_strike_at=NOW(), banned=TRUE, ban_until=NULL, ban_reason=$2 WHERE LOWER(username)=LOWER($3)', [strikes, reason, username]);
            kickUser(username, `Küfür kuralını ${MAX_STRIKES} kez ihlal ettin. Hesabın kalıcı olarak kapatıldı.`);
            console.log(`[BAN] ${username} otomatik banlandı (küfür: ${(matches || []).join(', ')}).`);
        } else {
            await pool.query('UPDATE users SET profanity_strikes=$1, last_strike_at=NOW() WHERE LOWER(username)=LOWER($2)', [strikes, username]);
            socket.emit('profanity-warning', {
                strikes, max: MAX_STRIKES, remaining: MAX_STRIKES - strikes,
                words: matches, severity: result.severity || 0
            });
            console.log(`[UYARI] ${username} küfür uyarısı aldı (${strikes}/${MAX_STRIKES}): ${(matches || []).join(', ')}`);
        }
    } catch (e) { console.error('Strike uygulama hatası:', e.message); }
}

// ---------- Basit hız sınırı ----------
const hits = new Map();
function limited(key, max, ms) {
    const now = Date.now();
    const h = (hits.get(key) || []).filter(t => now - t < ms);
    h.push(now); hits.set(key, h);
    return h.length > max;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (!v.some(t => n - t < 60000)) hits.delete(k); }, 60000);

// ---------- Sohbet spam koruması ----------
// Amaç: hızlı ardışık mesaj, aynı mesajı tekrarlama ve anlamsız karakter yığınlarını engellemek.
// İhlaller kademeli kısa susturmalara dönüşür; 5 dakika temiz kalınca ihlal sayacı sıfırlanır.
const SPAM = {
    BURST_MS: 5000, BURST_MAX: 5,           // 5 sn içinde en fazla 5 mesaj
    WINDOW_MS: 60000, WINDOW_MAX: 20,       // 1 dk içinde en fazla 20 mesaj
    MIN_INTERVAL_MS: 500,                   // iki mesaj arasında en az 0,5 sn
    DUP_MS: 30000,                          // aynı mesajı 30 sn içinde tekrar etme
    RECENT_MAX: 8,                          // son 8 mesajı karşılaştır
    VIOLATION_WINDOW_MS: 5 * 60000,         // 5 dk temiz kalınca ihlaller sıfırlanır
    MUTE_STEPS: [0, 10000, 30000, 120000],  // 1. ihlal uyarı, 2. 10 sn, 3. 30 sn, 4+ 2 dk
    SHORT_COOLDOWN: 2000
};
const spamState = new Map();

function spamGet(username) {
    const key = String(username || '').toLowerCase();
    let s = spamState.get(key);
    if (!s) {
        s = { times: [], recent: [], violations: 0, lastViolationAt: 0, muteUntil: 0 };
        spamState.set(key, s);
    }
    return s;
}
function spamIsMuted(username) {
    const s = spamState.get(String(username || '').toLowerCase());
    return s && s.muteUntil > Date.now() ? s : null;
}
function spamViolation(s, now, reason) {
    if (now - s.lastViolationAt > SPAM.VIOLATION_WINDOW_MS) s.violations = 0;
    s.violations += 1;
    s.lastViolationAt = now;
    const step = Math.min(s.violations - 1, SPAM.MUTE_STEPS.length - 1);
    const muteMs = SPAM.MUTE_STEPS[step];
    if (muteMs > 0) s.muteUntil = Math.max(s.muteUntil, now + muteMs);
    const muted = s.muteUntil > now;
    return {
        ok: false, reason,
        violations: s.violations,
        mutedUntil: muted ? s.muteUntil : 0,
        retryAfter: muted ? s.muteUntil - now : SPAM.SHORT_COOLDOWN
    };
}
function spamCheck(username, text) {
    const s = spamGet(username), now = Date.now();
    s.times = s.times.filter(t => now - t < SPAM.WINDOW_MS);
    if (s.muteUntil > now) {
        return {
            ok: false, reason: 'Spam koruması nedeniyle kısa süre mesaj gönderemezsin.',
            violations: s.violations, mutedUntil: s.muteUntil, retryAfter: s.muteUntil - now
        };
    }
    const norm = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    // Aynı mesajı tekrar tekrar gönderme (kısa mesajlarda 3. tekrar engellenir)
    s.recent = s.recent.filter(x => now - x.at < SPAM.DUP_MS);
    const dup = norm ? s.recent.filter(x => x.text === norm).length : 0;
    if (norm.length >= 12 && dup >= 1) return spamViolation(s, now, 'Aynı mesajı tekrar gönderme.');
    if (norm.length < 12 && dup >= 2) return spamViolation(s, now, 'Aynı mesajı tekrar tekrar gönderme.');
    // Anlamsız karakter yığını (örn. 200 karakterin yalnızca 5'i farklı)
    if (norm.length >= 120 && new Set(norm).size <= 8) return spamViolation(s, now, 'Anlamsız karakter yığını gönderme.');
    // Hız sınırları
    const lastAt = s.times.length ? s.times[s.times.length - 1] : 0;
    if (now - lastAt < SPAM.MIN_INTERVAL_MS) return spamViolation(s, now, 'Çok hızlı mesaj gönderiyorsun.');
    if (s.times.filter(t => now - t < SPAM.BURST_MS).length >= SPAM.BURST_MAX)
        return spamViolation(s, now, 'Çok hızlı mesaj gönderiyorsun.');
    if (s.times.length >= SPAM.WINDOW_MAX)
        return spamViolation(s, now, 'Çok fazla mesaj gönderdin, biraz bekle.');

    s.times.push(now);
    if (norm) { s.recent.push({ text: norm, at: now }); if (s.recent.length > SPAM.RECENT_MAX) s.recent.shift(); }
    return { ok: true };
}
function emitSpamBlock(socket, r) {
    socket.emit('spam-blocked', {
        reason: r.reason || 'Çok hızlı mesaj gönderiyorsun.',
        retryAfter: Math.max(500, r.retryAfter || 0),
        mutedUntil: r.mutedUntil || 0,
        violations: r.violations || 0
    });
}
// 30 dakika boyunca mesaj atmayan ve susturması biten kullanıcıların kaydını temizle
setInterval(() => {
    const now = Date.now();
    for (const [k, s] of spamState) {
        const last = Math.max(s.times.length ? s.times[s.times.length - 1] : 0, s.lastViolationAt || 0);
        if (s.muteUntil <= now && now - last > 30 * 60000) spamState.delete(k);
    }
}, 5 * 60000);

// ---------- Robot doğrulaması (basit matematik CAPTCHA) ----------
// Sunucu tarafında tutulur; cevap istemciye asla gönderilmez.
const captchas = new Map();
setInterval(() => { const n = Date.now(); for (const [id, c] of captchas) if (c.exp < n) captchas.delete(id); }, 60000);

function newCaptcha() {
    const a = 1 + Math.floor(Math.random() * 9);
    const b = 1 + Math.floor(Math.random() * 9);
    const ops = [
        { q: `${a} + ${b}`, n: a + b },
        { q: `${Math.max(a, b)} − ${Math.min(a, b)}`, n: Math.abs(a - b) },
        { q: `${a} × ${b}`, n: a * b }
    ];
    const op = ops[Math.floor(Math.random() * ops.length)];
    const id = crypto.randomUUID();
    captchas.set(id, { answer: String(op.n), exp: Date.now() + 5 * 60000 });
    return { id, question: `${op.q} = ?` };
}

app.get('/api/captcha', (req, res) => {
    if (limited('cap:' + req.ip, 30, 60000)) return res.status(429).json({ error: 'Çok fazla istek.' });
    res.set('Cache-Control', 'no-store');
    res.json(newCaptcha());
});

app.post('/api/register', async (req, res) => {
    if (limited('reg:' + req.ip, 5, 60000)) return res.status(429).json({ error: 'Çok fazla deneme. Biraz bekleyin.' });
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!isValidName(username, 3, 20)) return res.status(400).json({ error: 'Kullanıcı adı 3-20 karakter olmalı (harf, rakam, _ . -) ve uygunsuz kelime içermemeli.' });
    if (password.length < 6 || password.length > 72) return res.status(400).json({ error: 'Şifre 6-72 karakter olmalı.' });

    if (req.body.acceptTerms !== true)
        return res.status(400).json({ error: 'Devam etmek için gizlilik sözleşmesini kabul etmelisin.' });

    const capId = String(req.body.captchaId || '');
    const cap = captchas.get(capId);
    if (!cap || cap.exp < Date.now() || String(req.body.captchaAnswer || '').trim() !== cap.answer) {
        captchas.delete(capId);
        return res.status(400).json({ error: 'Robot doğrulaması başarısız. Lütfen tekrar dene.' });
    }
    captchas.delete(capId); // tek kullanımlık

    try {
        const exists = await pool.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [username]);
        if (exists.rowCount > 0)
            return res.status(400).json({ error: 'Bu kullanıcı adı zaten kullanımda.' });

        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, password, accepted_terms_at) VALUES ($1, $2, NOW())', [username, hash]);
        res.json({ success: true });
    } catch (err) {
        if (err.code === '23505') // eşzamanlı kayıtta benzersizlik ihlali
            return res.status(400).json({ error: 'Bu kullanıcı adı zaten kullanımda.' });
        console.error('Kayıt hatası:', err.message);
        res.status(500).json({ error: 'Sunucu hatası, lütfen tekrar deneyin.' });
    }
});

app.post('/api/login', async (req, res) => {
    if (limited('login:' + req.ip, 10, 60000)) return res.status(429).json({ error: 'Çok fazla deneme. Biraz bekleyin.' });
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    try {
        const { rows } = await pool.query('SELECT id, username, password, banned, ban_until, ban_reason FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [username]);
        const user = rows[0];
        if (!user || !(await bcrypt.compare(password, user.password)))
            return res.status(400).json({ error: 'Kullanıcı bulunamadı veya şifre hatalı.' });

        // ---- Ban kontrolü ----
        const ban = banInfo(user);
        if (ban) return res.status(403).json({ error: banText(ban), banned: true, until: ban.until, reason: ban.reason });
        if (user.banned) await pool.query('UPDATE users SET banned=FALSE, ban_until=NULL, ban_reason=NULL WHERE id=$1', [user.id]).catch(() => {});

        // ---- Tek cihaz kuralı: yeni oturum açılınca eski oturum geçersiz olur ----
        const sid = crypto.randomUUID();
        await pool.query('UPDATE users SET active_session = $1 WHERE id = $2', [sid, user.id]);
        for (const s of io.sockets.sockets.values()) {
            if (s.data.username && s.data.username.toLowerCase() === user.username.toLowerCase() && s.data.sid !== sid) {
                s.emit('session-replaced', 'Hesabına başka bir cihazdan giriş yapıldı.');
                s.disconnect(true);
            }
        }
        const remember = req.body.remember === true;
        const { token, expiresAt } = makeToken(user.username, sid, remember);
        res.json({ success: true, username: user.username, token, remember, expiresAt });
    } catch (err) {
        console.error('Giriş hatası:', err.message);
        res.status(500).json({ error: 'Sunucu hatası, lütfen tekrar deneyin.' });
    }
});

// ---------- Kullanıcının KENDİ şifresini değiştirmesi ----------
app.post('/api/account/change-password', async (req, res) => {
    const auth = verifyToken((req.headers.authorization || '').replace('Bearer ', ''));
    if (!auth) return res.status(401).json({ error: 'Yetkisiz.' });
    if (limited('pw:' + req.ip, 6, 60000)) return res.status(429).json({ error: 'Çok fazla deneme. Biraz bekleyin.' });
    const current = String(req.body.currentPassword || '');
    const next = String(req.body.newPassword || '');
    if (next.length < 6 || next.length > 72) return res.status(400).json({ error: 'Yeni şifre 6-72 karakter olmalı.' });
    try {
        const { rows } = await pool.query('SELECT id, password, active_session FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1', [auth.u]);
        const user = rows[0];
        if (!user || user.active_session !== auth.sid) return res.status(401).json({ error: 'Oturum geçersiz. Lütfen tekrar giriş yap.' });
        if (!(await bcrypt.compare(current, user.password))) return res.status(400).json({ error: 'Mevcut şifre hatalı.' });
        const hash = await bcrypt.hash(next, 10);
        await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hash, user.id]);
        res.json({ success: true });
    } catch (e) { console.error('Şifre değiştirme hatası:', e.message); res.status(500).json({ error: 'Sunucu hatası.' }); }
});

// ============================================================================
//  YÖNETİCİ PANELİ ("muhtar") — /muhtar adresinden erişilir
// ============================================================================
const requireAdmin = (req, res, next) => {
    if (!ADMIN_ENABLED) return res.status(503).json({ error: 'Yönetici paneli devre dışı.' });
    verifyAdminToken(req.headers['x-admin-token']) ? next() : res.status(401).json({ error: 'Yetkisiz. Lütfen tekrar giriş yap.' });
};

app.get(['/muhtar', '/muhtar/'], (req, res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'no-store');
    if (!ADMIN_ENABLED) return res.status(503).type('text/plain')
        .send('Yönetici paneli devre dışı. Sunucu yöneticisi ADMIN_PASSWORD ortam değişkenini ayarlamalı.');
    res.sendFile(path.join(__dirname, 'Public', 'muhtar.html'));
});

app.post('/api/admin/login', (req, res) => {
    if (!ADMIN_ENABLED) return res.status(503).json({ error: 'Yönetici paneli devre dışı.' });
    if (limited('admin:' + req.ip, 5, 5 * 60000)) return res.status(429).json({ error: 'Çok fazla deneme. 5 dakika sonra tekrar deneyin.' });
    const given = String(req.body.password || '').trim();
    // Sabit uzunlukta özet + timingSafeEqual → zamanlama saldırısına karşı
    const a = crypto.createHash('sha256').update(given).digest();
    const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
    if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Şifre hatalı.' });
    res.json({ token: makeAdminToken() });
});

// Tüm veriler: kullanıcılar, kanallar, mesajlar, istatistikler
app.get('/api/admin/data', requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT username, created_at, profanity_strikes, last_strike_at, banned, ban_until, ban_reason FROM users ORDER BY created_at DESC');
        const online = onlineUsernames().map(u => u.toLowerCase());
        const users = rows.map(r => ({
            username: r.username,
            createdAt: r.created_at,
            strikes: r.profanity_strikes || 0,
            lastStrikeAt: r.last_strike_at,
            online: online.includes(r.username.toLowerCase()),
            ban: banInfo(r) ? { until: r.ban_until || null, reason: r.ban_reason || 'Kural ihlali', permanent: !r.ban_until } : null
        }));
        const channels = Object.entries(texts).map(([id, t]) => ({
            id, name: t.name, owner: t.owner || null,
            messages: t.messages.map(m => ({
                id: m.id, username: m.username, kind: m.kind || 'text',
                text: m.kind === 'file' ? `[kod dosyası] ${m.name}` : m.text,
                file: m.kind === 'file' ? m.name : null, size: m.size || 0, time: m.time
            }))
        }));
        res.json({
            users, channels,
            stats: {
                users: users.length,
                online: online.length,
                messages: channels.reduce((a, c) => a + c.messages.length, 0),
                banned: users.filter(u => u.ban).length,
                warnings: users.reduce((a, u) => a + u.strikes, 0)
            }
        });
    } catch (e) { console.error('admin/data:', e.message); res.status(500).json({ error: 'Sunucu hatası.' }); }
});

// Ban (süreli veya kalıcı). minutes > 0 → süreli, aksi hâlde kalıcı.
app.post('/api/admin/ban', requireAdmin, async (req, res) => {
    const username = String(req.body.username || '').trim();
    const minutes = Number(req.body.minutes);
    const reason = String(req.body.reason || '').trim().slice(0, 200) || 'Kural ihlali';
    if (!username) return res.status(400).json({ error: 'Kullanıcı adı gerekli.' });
    const permanent = !(minutes > 0);
    const until = permanent ? null : new Date(Date.now() + minutes * 60000);
    try {
        const { rowCount } = await pool.query('UPDATE users SET banned=TRUE, ban_until=$1, ban_reason=$2 WHERE LOWER(username)=LOWER($3)', [until, reason, username]);
        if (!rowCount) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
        kickUser(username, `Hesabın yönetici tarafından kapatıldı. Sebep: ${reason}` + (permanent ? ' (Kalıcı ban)' : ` (Bitiş: ${until.toLocaleString('tr-TR')})`));
        res.json({ success: true });
    } catch (e) { console.error('admin/ban:', e.message); res.status(500).json({ error: 'Sunucu hatası.' }); }
});

app.post('/api/admin/unban', requireAdmin, async (req, res) => {
    const username = String(req.body.username || '').trim();
    if (!username) return res.status(400).json({ error: 'Kullanıcı adı gerekli.' });
    try {
        const { rowCount } = await pool.query('UPDATE users SET banned=FALSE, ban_until=NULL, ban_reason=NULL WHERE LOWER(username)=LOWER($1)', [username]);
        if (!rowCount) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Sunucu hatası.' }); }
});

app.post('/api/admin/reset-strikes', requireAdmin, async (req, res) => {
    const username = String(req.body.username || '').trim();
    if (!username) return res.status(400).json({ error: 'Kullanıcı adı gerekli.' });
    try {
        const { rowCount } = await pool.query('UPDATE users SET profanity_strikes=0, last_strike_at=NULL WHERE LOWER(username)=LOWER($1)', [username]);
        if (!rowCount) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Sunucu hatası.' }); }
});

// Tek mesaj sil
app.post('/api/admin/delete-message', requireAdmin, (req, res) => {
    const { channelId, msgId } = req.body || {};
    const t = texts[channelId];
    if (!t) return res.status(404).json({ error: 'Kanal bulunamadı.' });
    const i = t.messages.findIndex(m => m.id === msgId);
    if (i === -1) return res.status(404).json({ error: 'Mesaj bulunamadı.' });
    t.messages.splice(i, 1);
    io.to('t:' + channelId).emit('message-deleted', { msgId });
    res.json({ success: true });
});

// Bir kullanıcının TÜM mesajlarını sil
app.post('/api/admin/delete-user-messages', requireAdmin, (req, res) => {
    const username = String(req.body.username || '').trim().toLowerCase();
    if (!username) return res.status(400).json({ error: 'Kullanıcı adı gerekli.' });
    let removed = 0;
    for (const [id, t] of Object.entries(texts)) {
        const gone = t.messages.filter(m => (m.username || '').toLowerCase() === username).map(m => m.id);
        if (!gone.length) continue;
        t.messages = t.messages.filter(m => (m.username || '').toLowerCase() !== username);
        removed += gone.length;
        gone.forEach(msgId => io.to('t:' + id).emit('message-deleted', { msgId }));
    }
    res.json({ success: true, removed });
});

// Bir kanaldaki tüm mesajları sil
app.post('/api/admin/clear-messages', requireAdmin, (req, res) => {
    const t = texts[req.body && req.body.channelId];
    if (!t) return res.status(404).json({ error: 'Kanal bulunamadı.' });
    const gone = t.messages.map(m => m.id);
    t.messages = [];
    gone.forEach(msgId => io.to('t:' + req.body.channelId).emit('message-deleted', { msgId }));
    res.json({ success: true, removed: gone.length });
});

// Kullanıcının şifresini değiştir (yönetici). Oturum geçersiz kılınır.
app.post('/api/admin/set-password', requireAdmin, async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!username) return res.status(400).json({ error: 'Kullanıcı adı gerekli.' });
    if (password.length < 6 || password.length > 72) return res.status(400).json({ error: 'Şifre 6-72 karakter olmalı.' });
    try {
        const hash = await bcrypt.hash(password, 10);
        const { rowCount } = await pool.query('UPDATE users SET password=$1, active_session=NULL WHERE LOWER(username)=LOWER($2)', [hash, username]);
        if (!rowCount) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
        disconnectUser(username, 'session-replaced', 'Yönetici şifreni değiştirdi. Lütfen yeni şifrenle tekrar giriş yap.');
        res.json({ success: true });
    } catch (e) { console.error('admin/set-password:', e.message); res.status(500).json({ error: 'Sunucu hatası.' }); }
});

// Kullanıcıyı sil (mesajları ve açtığı kanallar da silinir)
app.post('/api/admin/delete-user', requireAdmin, async (req, res) => {
    const username = String(req.body.username || '').trim();
    if (!username) return res.status(400).json({ error: 'Kullanıcı adı gerekli.' });
    try {
        const { rowCount } = await pool.query('DELETE FROM users WHERE LOWER(username)=LOWER($1)', [username]);
        if (!rowCount) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
        const low = username.toLowerCase();

        // Kullanıcının tüm mesajlarını sil
        for (const [id, t] of Object.entries(texts)) {
            const gone = t.messages.filter(m => (m.username || '').toLowerCase() === low).map(m => m.id);
            if (!gone.length) continue;
            t.messages = t.messages.filter(m => (m.username || '').toLowerCase() !== low);
            gone.forEach(msgId => io.to('t:' + id).emit('message-deleted', { msgId }));
        }
        // Kullanıcının açtığı kanalları kaldır
        let removedChannels = 0;
        for (const [id, t] of Object.entries(texts)) {
            if (!t.system && t.owner && t.owner.toLowerCase() === low) { delete texts[id]; removedChannels++; }
        }
        for (const [id, r] of Object.entries(rooms)) {
            if (!r.system && r.owner && r.owner.toLowerCase() === low) { delete rooms[id]; removedChannels++; }
        }
        if (removedChannels) broadcastRooms();

        disconnectUser(username, 'account-deleted', 'Hesabın yönetici tarafından silindi.');
        console.log(`[SİL] ${username} kalıcı olarak silindi (${removedChannels} kanal kaldırıldı).`);
        res.json({ success: true });
    } catch (e) { console.error('admin/delete-user:', e.message); res.status(500).json({ error: 'Sunucu hatası.' }); }
});

// ---------- WebRTC ICE (STUN/TURN) ----------
// Farklı ağlardaki kullanıcıların yayını izleyebilmesi için TURN şart. Render ortam değişkenleri:
//   METERED_DOMAIN + METERED_API_KEY  (metered.ca hesabı)  veya  TURN_URL + TURN_USER + TURN_PASS
// Öncelik: 1) METERED_DOMAIN + METERED_API_KEY (REST)  2) TURN_URL/TURN_USER/TURN_PASS  3) aşağıdaki Metered bilgileri
const METERED_STATIC = {
    username: process.env.TURN_USER || '5cbcf67c633ed0ffaf5f19c6',
    credential: process.env.TURN_PASS || 'yDaqLITZGsxTT2x3'
};
let iceCache = { t: 0, v: null };
app.get('/api/ice', async (req, res) => {
    if (!verifyToken((req.headers.authorization || '').replace('Bearer ', ''))) return res.status(401).json({ error: 'unauthorized' });
    if (iceCache.v && Date.now() - iceCache.t < 10 * 60000) return res.json(iceCache.v);
    const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    const { METERED_DOMAIN, METERED_API_KEY, TURN_URL } = process.env;
    try {
        if (METERED_DOMAIN && METERED_API_KEY) {
            const j = await (await fetch(`https://${METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`)).json();
            if (Array.isArray(j)) servers.push(...j);
        }
    } catch (e) { console.warn('Metered REST alınamadı:', e.message); }
    if (servers.length === 1 && TURN_URL) {
        servers.push({ urls: TURN_URL.split(',').map(x => x.trim()), username: process.env.TURN_USER, credential: process.env.TURN_PASS });
    }
    if (servers.length === 1) { // Varsayılan: Metered TURN (80/443, UDP + TCP + TLS)
        servers.push(
            { urls: 'stun:stun.relay.metered.ca:80' },
            { urls: 'turn:global.relay.metered.ca:80', ...METERED_STATIC },
            { urls: 'turn:global.relay.metered.ca:80?transport=tcp', ...METERED_STATIC },
            { urls: 'turn:global.relay.metered.ca:443', ...METERED_STATIC },
            { urls: 'turns:global.relay.metered.ca:443?transport=tcp', ...METERED_STATIC }
        );
    }
    iceCache = { t: Date.now(), v: servers };
    res.json(servers);
});

// ---------- Odalar ----------
const mkRoom = (createdBy, system = false, owner = null, name = null) => ({
    createdBy, system, owner, name: name || createdBy,
    isLive: false, hostSocketId: null, hostName: null, members: [], messages: []
});
const mkText = (createdBy, system = false, owner = null, name = null) => ({
    createdBy, system, owner, name: name || createdBy, messages: []
});

// Sitede yalnızca 2 ana yer vardır: bir metin + bir sesli kanal.
// Object.create(null): "__proto__", "constructor" gibi özel anahtarlarla arama yapılamaz (DoS koruması).
const rooms = Object.create(null);
rooms['genel-sesli-sohbet'] = mkRoom('Sistem', true, null, 'Genel Sesli Sohbet');
const texts = Object.create(null);
texts['genel-sohbet'] = mkText('Sistem', true, null, 'Genel Sohbet');

const MAX_CHANNELS_PER_USER = 2; // her kullanıcı en fazla 2 kanal açabilir
const userChannelCount = (u) => [...Object.values(texts), ...Object.values(rooms)]
    .filter(c => c.owner && c.owner.toLowerCase() === String(u).toLowerCase()).length;

const roomsList = () => Object.entries(rooms).map(([id, r]) => ({
    id, name: r.name, isLive: r.isLive, hostName: r.hostName,
    members: r.members.map(m => ({ id: m.id, username: m.username, muted: m.muted, deaf: m.deaf }))
}));
const snapshot = () => ({ text: Object.entries(texts).map(([id, t]) => ({ id, name: t.name })), voice: roomsList() });
const broadcastRooms = () => io.emit('room-list-update', snapshot());
const broadcastOnline = () => io.emit('online-list', [...new Set([...io.sockets.sockets.values()].filter(x => x.connected && x.data.username).map(x => x.data.username))]);

io.use(async (socket, next) => {
    const auth = verifyToken(socket.handshake.auth && socket.handshake.auth.token);
    if (!auth) return next(new Error('unauthorized'));
    try {
        // Tek cihaz kuralı: token'daki oturum, veritabanındaki güncel oturumla eşleşmeli
        const { rows } = await pool.query('SELECT active_session, banned, ban_until, ban_reason FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [auth.u]);
        if (!rows[0] || rows[0].active_session !== auth.sid) return next(new Error('session-replaced'));
        const ban = banInfo(rows[0]);
        if (ban) { const err = new Error('banned'); err.data = { until: ban.until, reason: ban.reason, permanent: ban.permanent, message: banText(ban) }; return next(err); }
    } catch (err) {
        console.error('Oturum doğrulama hatası:', err.message);
        return next(new Error('db-error'));
    }
    socket.data.username = auth.u;
    socket.data.sid = auth.sid;
    next();
});

function leaveRoom(socket) {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    socket.leave(roomId);
    socket.data.roomId = null;
    socket.to(roomId).emit('user-left-voice', socket.id);
    room.members = room.members.filter(m => m.id !== socket.id);

    if (room.hostSocketId === socket.id) endStream(roomId);
    io.to(roomId).emit('update-room-members', room.members);
    if (!room.system && room.members.length === 0) delete rooms[roomId]; // boş kullanıcı odalarını temizle
    broadcastRooms();
}
function endStream(roomId) {
    const room = rooms[roomId];
    if (!room || !room.isLive) return;
    room.isLive = false; room.hostSocketId = null; room.hostName = null;
    io.to(roomId).emit('room-stream-ended');
}

// Bozuk/eksik istemci verisi (örn. null yük) sunucuyu çökertmesin:
// her socket olayını try/catch + async hata yakalama ile sarmala.
function safeOn(socket, event, fn) {
    socket.on(event, (...args) => {
        try {
            const r = fn(...args);
            if (r && typeof r.catch === 'function') r.catch(e => console.error(`[socket:${event}]`, e && e.message));
        } catch (e) {
            console.error(`[socket:${event}]`, e && e.message);
        }
    });
}

io.on('connection', (socket) => {
    const username = socket.data.username;
    socket.emit('room-list-update', snapshot());
    broadcastOnline();
    // Devam eden spam cezası varsa istemciye bildir (sayfa yenilense bile sayaç devam eder)
    const muted = spamIsMuted(username);
    if (muted) socket.emit('spam-blocked', {
        reason: 'Devam eden spam cezası.', retryAfter: muted.muteUntil - Date.now(),
        mutedUntil: muted.muteUntil, violations: muted.violations
    });

    // Sunucu gecikmesi (ping) ölçümü için basit yankı
    safeOn(socket, 'latency', (start, cb) => { if (typeof cb === 'function') cb(start); });

    safeOn(socket, 'create-channel', ({ roomName, type } = {}) => {
        if (limited('room:' + socket.id, 5, 60000)) return socket.emit('error-msg', 'Çok hızlı kanal oluşturuyorsun.');
        const raw = String(roomName || '').trim();
        if (!isValidName(raw, 3, 20)) return socket.emit('error-msg', 'Kanal adı 3-20 karakter olmalı (harf, rakam, _ . -) ve uygunsuz kelime içermemeli.');
        if (userChannelCount(username) >= MAX_CHANNELS_PER_USER) return socket.emit('error-msg', `En fazla ${MAX_CHANNELS_PER_USER} kanal açabilirsin.`);
        const id = raw.replace(/\s+/g, '-').toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 24);
        if (!id) return socket.emit('error-msg', 'Geçersiz kanal adı!');
        const isText = type === 'text';
        const bucket = isText ? texts : rooms;
        if (bucket[id]) return socket.emit('error-msg', 'Bu kanal zaten var!');
        if (Object.keys(bucket).length >= 50) return socket.emit('error-msg', 'Kanal limiti doldu.');
        bucket[id] = isText ? mkText(username, false, username, raw) : mkRoom(username, false, username, raw);
        broadcastRooms();
        socket.emit('channel-created', { type: isText ? 'text' : 'voice', id });
    });

    safeOn(socket, 'join-text', ({ channelId } = {}) => {
        const t = texts[channelId];
        if (!t) return socket.emit('error-msg', 'Kanal bulunamadı.');
        if (socket.data.textId) socket.leave('t:' + socket.data.textId);
        socket.data.textId = channelId;
        socket.join('t:' + channelId);
        // Dosya (kod) içeriklerini şimdi göndermeyiz; indirilirken 'get-code' ile istenir.
        const messages = t.messages.map(m => m.kind === 'file' ? { ...m, code: undefined } : m);
        socket.emit('text-joined', { channelId, messages });
    });

    // Kod/dosya içeriğini indirme anında gönder
    safeOn(socket, 'get-code', ({ msgId } = {}, cb) => {
        const t = texts[socket.data.textId];
        const m = t && t.messages.find(x => x.id === msgId && x.kind === 'file');
        if (typeof cb === 'function') cb(m ? { code: m.code, name: m.name } : null);
    });

    safeOn(socket, 'voice-state', ({ muted, deaf } = {}) => {
        const room = rooms[socket.data.roomId];
        const m = room && room.members.find(x => x.id === socket.id);
        if (!m) return;
        m.muted = !!muted; m.deaf = !!deaf;
        io.to(socket.data.roomId).emit('update-room-members', room.members);
        broadcastRooms();
    });

    safeOn(socket, 'join-room', ({ roomId } = {}) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('error-msg', 'Oda bulunamadı.');
        if (socket.data.roomId) leaveRoom(socket); // aynı anda tek odada ol

        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.to(roomId).emit('user-joined-voice', { socketId: socket.id, username });
        room.members.push({ id: socket.id, username, muted: false, deaf: false });

        socket.emit('room-joined', {
            roomId, isLive: room.isLive, hostName: room.hostName,
            hostSocketId: room.hostSocketId, members: room.members
        });
        if (room.isLive) io.to(room.hostSocketId).emit('viewer-wants-stream', { viewerId: socket.id });
        io.to(roomId).emit('update-room-members', room.members);
        broadcastRooms();
    });

    safeOn(socket, 'chat-message', async ({ text } = {}, ack) => {
        const reply = res => { if (typeof ack === 'function') { try { ack(res); } catch { /* yoksay */ } } };
        const tid = socket.data.textId, t = texts[tid];
        text = String(text || '').trim().slice(0, 500);
        if (!t || !text) return reply({ ok: false, error: 'empty' });
        // Spam koruması: hız, tekrar ve karakter yığını kontrolü
        const spam = spamCheck(username, text);
        if (!spam.ok) { emitSpamBlock(socket, spam); return reply({ ok: false, spam: true }); }
        const result = analyze(text);
        const clean = censor(text);
        const msg = { id: crypto.randomUUID(), username, kind: 'text', text: clean, time: Date.now(), reactions: {} };
        t.messages.push(msg);
        if (t.messages.length > 100) t.messages.shift();
        io.to('t:' + tid).emit('chat-message', msg);
        reply({ ok: true });
        // Arka plan bildirimi: yalnızca aynı metin kanalındakilere hafif özet (gönderen hariç)
        socket.to('t:' + tid).emit('notify-message', {
            channelId: tid, channelName: t.name, username, kind: 'text',
            preview: clean.replace(/\s+/g, ' ').slice(0, 140), time: msg.time
        });
        // Yalnızca gönderen görebilsin: uyarı/ban akışı
        if (result.profane) await applyStrike(socket, result);
    });

    // Kod paylaşımı: girilen kod, "kod-<kullanıcıadı>.txt" dosyası olarak sohbete gönderilir.
    safeOn(socket, 'code-message', ({ code } = {}, ack) => {
        const reply = res => { if (typeof ack === 'function') { try { ack(res); } catch { /* yoksay */ } } };
        const tid = socket.data.textId, t = texts[tid];
        if (!t) { socket.emit('error-msg', 'Önce bir metin kanalı seç.'); return reply({ ok: false }); }
        const sm = spamIsMuted(username);
        if (sm) {
            emitSpamBlock(socket, {
                reason: 'Spam koruması nedeniyle kısa süre kod paylaşamazsın.',
                mutedUntil: sm.muteUntil, retryAfter: sm.muteUntil - Date.now(), violations: sm.violations
            });
            return reply({ ok: false });
        }
        if (limited('code:' + socket.id, 5, 60000)) {
            emitSpamBlock(socket, { reason: 'Çok sık kod paylaşıyorsun, biraz bekle.', retryAfter: 60000 });
            return reply({ ok: false });
        }
        code = String(code || '');
        if (!code.trim()) return reply({ ok: false });
        if (code.length > 100000) { socket.emit('error-msg', 'Kod çok büyük (en fazla ~100 KB).'); return reply({ ok: false }); }
        const msg = {
            id: crypto.randomUUID(), username, kind: 'file',
            name: `kod-${username}.txt`, size: Buffer.byteLength(code, 'utf8'),
            code, time: Date.now(), reactions: {}
        };
        t.messages.push(msg);
        if (t.messages.length > 100) t.messages.shift();
        io.to('t:' + tid).emit('chat-message', msg);
        reply({ ok: true });
        socket.to('t:' + tid).emit('notify-message', {
            channelId: tid, channelName: t.name, username, kind: 'file',
            preview: '📄 ' + msg.name, time: msg.time
        });
    });

    const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
    safeOn(socket, 'react', ({ msgId, emoji } = {}) => {
        const tid = socket.data.textId, t = texts[tid];
        if (!t || !EMOJIS.includes(emoji) || limited('react:' + socket.id, 15, 5000)) return;
        const msg = t.messages.find(m => m.id === msgId);
        if (!msg) return;
        const list = msg.reactions[emoji] = msg.reactions[emoji] || [];
        const i = list.indexOf(username), added = i === -1;
        if (added) list.push(username); else list.splice(i, 1);
        if (!list.length) delete msg.reactions[emoji];
        io.to('t:' + tid).emit('reaction-update', { msgId, reactions: msg.reactions, emoji, by: username, added });
    });

    safeOn(socket, 'start-stream-in-room', (cb) => {
        const roomId = socket.data.roomId, room = rooms[roomId];
        if (!room) return cb && cb({ ok: false, error: 'Önce bir odaya katıl.' });
        if (room.isLive) return cb && cb({ ok: false, error: 'Bu odada zaten aktif bir yayın var!' });
        room.isLive = true; room.hostSocketId = socket.id; room.hostName = username;
        broadcastRooms();
        io.to(roomId).emit('stream-started', { roomId, hostName: username, hostSocketId: socket.id });
        room.members.forEach(m => m.id !== socket.id && socket.emit('viewer-wants-stream', { viewerId: m.id }));
        cb && cb({ ok: true });
    });

    // İzleyici bağlantı kuramazsa yayıncıdan yeniden teklif ister
    safeOn(socket, 'want-stream', () => {
        const room = rooms[socket.data.roomId];
        if (!room || !room.isLive || room.hostSocketId === socket.id || limited('ws:' + socket.id, 6, 60000)) return;
        io.to(room.hostSocketId).emit('viewer-wants-stream', { viewerId: socket.id });
    });

    safeOn(socket, 'stop-stream', () => {
        const roomId = socket.data.roomId, room = rooms[roomId];
        if (room && room.hostSocketId === socket.id) { endStream(roomId); broadcastRooms(); }
    });

    safeOn(socket, 'leave-room', () => leaveRoom(socket));

    // ---------- Uzaktan Kontrol (Remote Control) ----------
    safeOn(socket, 'remote-control-request', ({ target } = {}) => {
<<<<<<< HEAD
        const room = rooms[socket.data.roomId];
        // Yalnızca odanın yayıncısına istek gönderilebilir
        if (!room || room.hostSocketId !== target) {
            return socket.emit('error-msg', 'Uzaktan kontrol için aktif bir yayıncı bulunamadı.');
        }
        if (limited('rcr:' + socket.id, 5, 60000)) {
            return socket.emit('error-msg', 'Çok sık uzaktan kontrol isteği gönderdin, biraz bekle.');
        }
        const t = io.sockets.sockets.get(target);
        if (t) t.emit('remote-control-request', { viewerId: socket.id, viewerName: username });
    });

    safeOn(socket, 'remote-control-response', ({ target, granted } = {}) => {
        const room = rooms[socket.data.roomId];
        if (!room || room.hostSocketId !== socket.id) return; // yalnızca yayıncı izin verebilir
        const t = io.sockets.sockets.get(target);
        if (!t || t.data.roomId !== socket.data.roomId) return;
=======
        const t = io.sockets.sockets.get(target);
        if (!t || !socket.data.roomId || t.data.roomId !== socket.data.roomId) {
            return socket.emit('error-msg', 'Hedef kullanıcı odada bulunamadı.');
        }
        t.emit('remote-control-request', { viewerId: socket.id, viewerName: username });
    });

    safeOn(socket, 'remote-control-response', ({ target, granted } = {}) => {
        const t = io.sockets.sockets.get(target);
        if (!t || !socket.data.roomId || t.data.roomId !== socket.data.roomId) return;
>>>>>>> 99fbee43b22a816ce2e0c9eea021d83d26a509c0
        t.emit('remote-control-response', { hostId: socket.id, hostName: username, granted: !!granted });
    });

    safeOn(socket, 'remote-control-stop', ({ target } = {}) => {
<<<<<<< HEAD
        const room = rooms[socket.data.roomId];
        if (!room) return;
        // Yalnızca yayıncı ile izleyici arasında sonlandırma yapılabilir
        if (room.hostSocketId !== socket.id && room.hostSocketId !== target) return;
        const t = io.sockets.sockets.get(target);
        if (t && t.data.roomId === socket.data.roomId) t.emit('remote-control-stopped', { by: username });
    });

    safeOn(socket, 'remote-control-input', ({ target, action, data } = {}) => {
        const room = rooms[socket.data.roomId];
        // Girdiler yalnızca o anki yayıncıya gider; hız sınırı ile flood engellenir
        if (!room || room.hostSocketId !== target) return;
        if (typeof action !== 'string' || !action) return;
        if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
        if (limited('rci:' + socket.id, 500, 1000)) return;
        const t = io.sockets.sockets.get(target);
        if (t) t.emit('remote-control-input', { from: socket.id, action, data });
=======
        const t = io.sockets.sockets.get(target);
        if (t) t.emit('remote-control-stopped', { by: username });
    });

    safeOn(socket, 'remote-control-input', ({ target, action, data } = {}) => {
        const t = io.sockets.sockets.get(target);
        if (!t || !socket.data.roomId || t.data.roomId !== socket.data.roomId) return;
        t.emit('remote-control-input', { from: socket.id, action, data });
>>>>>>> 99fbee43b22a816ce2e0c9eea021d83d26a509c0
    });

    safeOn(socket, 'signal', (data = {}) => {
        const target = io.sockets.sockets.get(data.target);
        // sadece aynı odadaki kişilere sinyal gönderilebilir
        if (!target || !socket.data.roomId || target.data.roomId !== socket.data.roomId) return;
        target.emit('signal', { sender: socket.id, signal: data.signal, type: data.type });
    });

    safeOn(socket, 'disconnect', () => { leaveRoom(socket); broadcastOnline(); });
});

// ---------- Hata yakalama: yığın izi / sunucu bilgisi sızdırma ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Bulunamadı.' }));
app.use((req, res) => res.status(404).type('text/plain').send('Sayfa bulunamadı.'));
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && (err.type === 'entity.too.large' || err.status === 413)) return res.status(413).json({ error: 'İstek çok büyük.' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Geçersiz istek gövdesi.' });
    console.error('İstek hatası:', err && err.message);
    res.status(400).json({ error: 'Geçersiz istek.' });
});

const PORT = process.env.PORT || 3000;

// Önce veritabanını hazırla ("users" tablosunu oluştur), sonra sunucuyu dinlemeye başlat
initDb()
    .then(() => server.listen(PORT, () => console.log(`LumoLive Sunucusu aktif: Port ${PORT}`)))
    .catch((err) => {
        console.error('Veritabanı başlatılamadı, sunucu durduruluyor:', err.message);
        process.exit(1);
    });
