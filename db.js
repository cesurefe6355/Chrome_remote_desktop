// ---------- PostgreSQL bağlantı havuzu (Render) ----------
const { Pool } = require('pg');

// Render "Internal" hostname'leri nokta içermez (örn: dpg-xxxx-a).
// İç bağlantılarda SSL gerekmez; dış (external) bağlantılarda SSL şart.
function needsSSL(host) {
    if (!host) return false;
    return host.includes('.');
}

function buildConfig() {
    // 1) Tercih edilen: tek satırlık bağlantı adresi (Render DATABASE_URL verir)
    if (process.env.DATABASE_URL) {
        let host = '';
        try { host = new URL(process.env.DATABASE_URL).hostname; } catch { /* yoksay */ }
        return {
            connectionString: process.env.DATABASE_URL,
            ssl: needsSSL(host) ? { rejectUnauthorized: false } : false
        };
    }
    // 2) Alternatif: ayrı ayrı PG* değişkenleri
    return {
        host: process.env.PGHOST || process.env.DB_HOST,
        port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
        database: process.env.PGDATABASE || process.env.DB_NAME,
        user: process.env.PGUSER || process.env.DB_USER,
        password: process.env.PGPASSWORD || process.env.DB_PASSWORD,
        ssl: needsSSL(process.env.PGHOST || process.env.DB_HOST) ? { rejectUnauthorized: false } : false
    };
}

const pool = new Pool({
    ...buildConfig(),
    max: 10,                       // eş zamanlı maksimum bağlantı
    idleTimeoutMillis: 30000,      // boş bağlantı 30 sn sonra kapatılır
    connectionTimeoutMillis: 10000  // bağlanamazsa 10 sn sonra hata ver
});

// Havuzda beklenmeyen bir bağlantı hatası olursa uygulama çökmesin
pool.on('error', (err) => console.error('PostgreSQL havuz hatası:', err.message));

// ---------- Başlangıçta "users" tablosunu otomatik oluştur ----------
async function initDb() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id                SERIAL PRIMARY KEY,
            username          VARCHAR(20)  NOT NULL,
            password          TEXT         NOT NULL,
            created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            accepted_terms_at TIMESTAMPTZ,
            active_session    TEXT
        );
    `);
    // Mevcut tablolara sonradan eklenen kolonlar (geriye dönük uyumluluk)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_terms_at TIMESTAMPTZ;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS active_session TEXT;`);
    // Kullanıcı adı büyük/küçük harf duyarsız benzersiz olsun (eski JSON mantığıyla aynı)
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx
        ON users (LOWER(username));
    `);
    console.log('Veritabanı hazır: "users" tablosu mevcut.');
}

module.exports = { pool, initDb };
