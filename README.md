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
- **Ekran yayını:** Kanal içinde ekran paylaşımı, kalite seçenekleri (720p→4K, 30→144 FPS, bit hızı, kodek, sistem sesi).
- **Modern arayüz:** Discord tarzı mesaj gruplama, "en alta in" düğmesi + okunmamış sayacı,
  Enter ile gönder / Shift+Enter ile alt satır, `Ctrl+K` ile mesaj kutusuna gitme.
- **Ayarlar (⚙):** Şifre değiştirme, bildirim sesleri, vurgu rengi (4 renk), sıkışık mesaj görünümü,
  avatarları gizleme ve üye listesi açma/kapama. Tercihler tarayıcıda saklanır.
- **Mobil uyum:** Küçük ekranda kanallar çekmece olarak açılır; üye listesi düğmeyle gösterilir.

---

## 🛡️ Yönetici Paneli ("muhtar")

Tarayıcıdan `site-adresin/muhtar` yazarak girilir (örn. `https://chrome-remote-desktop-w9hm.onrender.com/muhtar`).
Şifre `.env` içindeki **`ADMIN_PASSWORD`** değeridir. (Ayarlanmazsa varsayılan `muhtar123` kullanılır —
**mutlaka değiştir!**)

Panelden yapılabilenler:

- **Kullanıcıları görme:** çevrimiçi/çevrimdışı durumu, küfür uyarı sayısı (`x/3`), ban durumu ve sebebi.
- **Ban atma:** süreli (1 saat → 30 gün) veya **kalıcı**; sebep yazılabilir. Banlanan kullanıcı anında atılır.
- **Ban kaldırma** ve **uyarı sayacını sıfırlama**.
- **Mesajları görme** (kanal kanal) ve **tek tek mesaj silme**, **kanalı tamamen temizleme**,
  **bir kullanıcının tüm mesajlarını silme**.
- **Şifre değiştirme:** bir kullanıcının şifresini panelden sıfırlayabilirsin; kullanıcı anında atılır ve
  yeni şifreyle giriş yapması gerekir.
- **Kullanıcı silme:** hesabı kalıcı olarak siler; mesajları ve açtığı kanallar da kaldırılır.
  Kazara silmeyi önlemek için kullanıcı adını yazarak onaylatır.
- **Oto yenilenme:** panel kendini varsayılan olarak 5 saniyede bir yeniler; üstteki menüden
  `3 sn / 5 sn / 10 sn / 30 sn / Kapalı` seçilebilir (tercih tarayıcıda saklanır).
- Canlı istatistikler: kullanıcı, çevrimiçi, uyarı, ban ve mesaj sayıları.

> Kullanıcılar ayrıca uygulama içinde **Ayarlar (⚙)** düğmesinden kendi şifresini değiştirebilir
> (mevcut şifresini girerek).

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
