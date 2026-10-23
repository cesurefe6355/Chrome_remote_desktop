# LumoLive (Chrome_remote_desktop)

Sesli sohbet + canlı ekran yayını uygulaması. İki şekilde çalışır:

- **Web** (`node server.js` → tarayıcıda açılır)
- **Masaüstü / Electron** (`electron .` → kendi penceresi, özel tasarım)

---

## Özellikler

- **2 ana yer:** `Genel Sohbet` (metin) ve `Genel Sesli Sohbet` (ses). Başka varsayılan kanal yok.
- **Kanal açma:** Her kullanıcı en fazla **2 kanal** açabilir. Kanal adı 3-20 karakter, harf/rakam ve `. _ -` içerebilir, küfür içeremez.
- **Kullanıcı adı:** En az 3 karakter, harf/rakam ve `. _ -`, küfür yasak.
- **Şifre:** En az 6 karakter.
- **Beni hatırla:** İşaretliyse oturum 30 gün açık kalır; işaretli değilse **1 saat sonra otomatik çıkış** yapılır.
- **Tek cihaz kuralı:** Aynı hesaba yeni giriş yapılınca eski oturum kapanır.
- **Gelişmiş küfür filtresi:** Sohbet, kullanıcı adı ve kanal adlarında çalışır. Büyük/küçük harf, Türkçe karakter (`ş ı ğ ü ö ç`), leetspeak (`s1kt1r`, `$ik`), homoglif harfler (Kiril `а о е`…), ayraçla bölme (`s.i.k`, `a.m.k`), tekrar eden harfler (`siiiktir`) ve görünmez karakterler yakalanır. Sohbette uygunsuz kelimeler `***` ile gizlenir.
- **Kademeli ceza sistemi (otomatik):** Küfür tespit edildiğinde
  **1. ve 2. ihlal → uyarı**, **3. ihlal → hesap kalıcı olarak banlanır** ve kullanıcı oturumdan atılır.
  (24 saat cezasız geçerse uyarı sayacı sıfırlanır.)
- **Kod paylaşımı:** Sohbetteki **+** butonuna bas → kodu yapıştır → sohbete **`kod-<kullanıcıadı>.txt`** dosyası olarak gönderilir (indirilebilir).
- **Spam koruması (otomatik):** 5 saniyede 5'ten fazla mesaj, dakikada 20'den fazla mesaj, aynı mesajı tekrar tekrar gönderme
  ve anlamsız karakter yığınları engellenir. Tekrarlayan ihlallerde kademeli kısa susturma uygulanır
  (10 sn → 30 sn → 2 dk); sayaç 5 dakika temiz kalınca sıfırlanır. Reddedilen mesaj kutuda kalır, kaybolmaz.
- **Masaüstü bildirimleri:** Chrome arka plandayken yeni mesajlar işletim sistemi bildirimi olarak görünür;
  bildirime tıklayınca ilgili kanal açılır. Sekme başlığında okunmamış mesaj sayısı `(3) LumoLive` şeklinde gösterilir.
  Bildirim izni Ayarlar → Bildirimler veya üst çubuktaki 🔔 düğmesinden verilir.
- **Ekran yayını:** Kanal içinde ekran paylaşımı, kalite seçenekleri (720p→4K, 30→144 FPS, bit hızı, kodek, sistem sesi).
- **Modern arayüz:** Discord tarzı mesaj gruplama, "en alta in" düğmesi + okunmamış sayacı,
  Enter ile gönder / Shift+Enter ile alt satır, `Ctrl+K` ile mesaj kutusuna gitme.
- **Ayarlar (⚙):** Şifre değiştirme, bildirim sesleri, vurgu rengi (4 renk), sıkışık mesaj görünümü,
  avatarları gizleme ve üye listesi açma/kapama. Tercihler tarayıcıda saklanır.
- **Mobil uyum:** Küçük ekranda kanallar çekmece olarak açılır; üye listesi düğmeyle gösterilir.


---

## Kurulum

```bash
npm install
```

`.env` dosyasına veritabanı bilgilerini gir (bkz. `.env.example`).

## Çalıştırma

### Web sürümü
```bash
npm start          # http://localhost:3000
```

### Masaüstü (Electron) sürümü
```bash
npm run desktop
```

Derleme (kurulum dosyası):
```bash
npm run build      # dist/ klasörüne NSIS kurulum dosyası üretir
```

---

## Ekran paylaşımı seçicisi hakkında

Ekran paylaşmaya basınca çıkan "neyi paylaşacaksın?" penceresi **tamamen LumoLive'ın kendi tasarımıdır**
(sekmeler: **Ekranlar / Pencereler**, küçük önizlemeler, kalite ayarları). Bu seçici:

- **Masaüstü sürümünde**: Chrome/Chromium'un kendi seçim penceresi **hiç açılmaz**. Kaynak seçimi
  `main.js` içindeki `setDisplayMediaRequestHandler` ile tamamen bize ait arayüzden yapılır.
- **Web sürümünde**: Tarayıcı güvenlik kuralı gereği Google Chrome kendi seçim penceresini zorunlu
  gösterir. Bu pencere site koduyla değiştirilemez/silinemez.

Yani "hiç Chrome tasarımı olmasın" isteği için uygulamayı **masaüstü sürümünde** kullanmak gerekir.

---

## Yayın kalitesi

Çözünürlük (720p → 4K), kare hızı (30 → 144 FPS), bit hızı, kodek (AV1 / VP9 / H.264),
içerik türü ve sistem sesi paylaşımı seçiciden ayarlanır. Nakliye WebRTC (P2P) üzerindendir;
farklı ağlardaki izleyiciler için `.env` içinde TURN ayarları kullanılabilir.

---

## 🔐 Güvenlik

Tarama raporundaki (DiagnoSEO) bulgular kapatıldı; sunucu her yanıtta şu başlıkları gönderir:

| Başlık | Değer / amaç |
| --- | --- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` (yalnızca HTTPS'te) |
| `Content-Security-Policy` | Dış kaynak yasağı; `frame-ancestors 'self'`; WebSocket yalnızca aynı host |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` (clickjacking) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | Kamera/konum/ödeme kapalı; mikrofon ve ekran paylaşımı yalnızca site içi |
| `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy` | `same-origin` |

Ek olarak:

- `/.well-known/security.txt` (RFC 9116) ve `/robots.txt` yayınlanır; `/muhtar` ve `/api/` arama motorlarına kapalıdır.
- **`ADMIN_PASSWORD` tanımlı değilse yönetici paneli çalışmaz** (bilinen varsayılan şifre açığı kapatıldı).
- Yönetici girişi **5 deneme / 5 dakika** ile sınırlıdır; şifre karşılaştırması zamanlama saldırısına dayanıklıdır.
- `trust proxy` etkinleştirildi → Render/Cloudflare arkasında hız sınırları gerçek istemci IP'sine uygulanır.
- Socket.IO: Origin doğrulaması (CSWSH), 256 KB istek sınırı ve bozuk payload'lara karşı güvenli olay sarmalayıcı.
- Bilinmeyen `/api/*` yolları JSON 404 döner; hata yanıtlarında yığın izi sızmaz.
- Gövde limiti 10 KB, mesaj limiti 500 karakter, kod paylaşımı limiti ~100 KB'dir.

### Sunucu tarafında yapılması gerekenler

1. Render → **Environment**: `ADMIN_PASSWORD` (12+ karakter) ve `SECRET` (sabit, rastgele) mutlaka tanımlı olmalı.
2. İsteğe bağlı: `SECURITY_CONTACT=mailto:...` ve özel alan adı için `PUBLIC_HOST=ornek.com`.
3. DNS tarafı (kodla çözülemez): **SPF** kaydı ekle, **DMARC** politikasını `p=none` → `quarantine` yap, **DNSSEC** etkinleştir.
