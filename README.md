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
- **Gelişmiş küfür filtresi:** Sohbet, kullanıcı adı ve kanal adlarında; büyük/küçük harf, `s.i.k` gibi bölme, `*`, tekrar eden harf ve leetspeak (`s1kt1r`) varyasyonlarını yakalar. Sohbette uygunsuz kelimeler `***` ile gizlenir.
- **Kod paylaşımı:** Sohbetteki **+** butonuna bas → kodu yapıştır → sohbete **`kod-<kullanıcıadı>.txt`** dosyası olarak gönderilir (indirilebilir).
- **Ekran yayını:** Kanal içinde ekran paylaşımı, kalite seçenekleri (720p→4K, 30→144 FPS, bit hızı, kodek, sistem sesi).

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
