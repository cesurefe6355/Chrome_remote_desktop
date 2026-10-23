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
- **Uzaktan Kontrol (AnyDesk / TeamViewer tarzı):** Masaüstü sürümünde ekranını paylaşan kullanıcının bilgisayarı, izin verdiği izleyiciler tarafından gerçek fare ve klavye girdileriyle uzaktan kontrol edilebilir.
  - **Güvenlik Onayı:** İzleyici istek gönderdiğinde yayıncıya izin penceresi açılır (`İzin Ver / Reddet`).
  - **Sıfır Gecikme:** WebRTC DataChannel (P2P) ile milisaniye seviyesinde fare/klavye iletimi.
  - **Anında İptal:** Yayıncı ekranın üstündeki butondan veya izleyici `Shift+Esc` ile kontrolü anında sonlandırabilir.
- **Modern arayüz:** Discord tarzı mesaj gruplama, "en alta in" düğmesi + okunmamış sayacı,
  Enter ile gönder / Shift+Enter ile alt satır, `Ctrl+K` ile mesaj kutusuna gitme.
- **Ayarlar (⚙):** Şifre değiştirme, bildirim sesleri, vurgu rengi (4 renk), sıkışık mesaj görünümü,
  avatarları gizleme ve üye listesi açma/kapama. Tercihler tarayıcıda saklanır.
- **Mobil uyum:** Küçük ekranda kanallar çekmece olarak açılır; üye listesi düğmeyle gösterilir.

---

## 🛡️ Yönetici Paneli ("muhtar")

Tarayıcıdan `site-adresin/muhtar` yazarak girilir (örn. `https://chrome-remote-desktop-w9hm.onrender.com/muhtar`).
Şifre, sunucudaki **`ADMIN_PASSWORD`** ortam değişkenidir. **Varsayılan şifre yoktur:** değişken tanımlı
değilse panel güvenlik gereği **tamamen kapalıdır** (503). Render'da `Environment` bölümüne en az
12 karakterlik güçlü bir şifre ekleyip yeniden deploy et.

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

## 🎮 Uzaktan kontrol nasıl çalıştırılır?

Uzaktan kontrol **iki taraf** gerektirir. Kontrol edilecek bilgisayarda **masaüstü (Electron) sürümü**
açık olmalıdır; kontrol eden kişi normal web tarayıcısını kullanabilir.

**Gereksinimler**

- Kontrol edilecek (yayın yapan) bilgisayar: **Windows 10/11**. `bin/remote-input.exe` bu makinede çalışır
  (.NET Framework 4.x; Windows'ta hazır gelir).
- En az iki kullanıcı hesabı (biri yayıncı, biri izleyici).
- Render adresine erişim (HTTPS). Yerel test için `npm run desktop:local` + `npm start`.

**Adım adım**

1. **Kontrol edilecek bilgisayarda** proje klasöründe terminal aç:
   ```bash
   npm run desktop
   ```
   (veya `npm run build` ile ürettiğin kurulum dosyasını kurup LumoLive'ı aç).
2. İki kullanıcı da aynı **sesli kanala** (`Genel Sesli Sohbet`) girsin.
3. Yayıncı, **Ekran Paylaş** → kaynağı seç → **Yayını Başlat** desin.
4. İzleyici yayını görünce ekranın altındaki yeşil **“🎮 Uzaktan Kontrol İste”** düğmesine bassın.
5. Yayıncının ekranında **“Uzaktan Kontrol İsteği”** penceresi açılır → **İzin Ver (Kabul)**.
6. İzleyici artık videoya tıklayıp fareyi hareket ettirebilir, tıklayabilir, tekerleği kullanabilir ve
   klavyeyle yazabilir. `Ctrl+C / Ctrl+V`, `Enter`, `Backspace`, oklar ve fonksiyon tuşları da iletilir.
7. Bitirmek için: izleyici **Shift+Esc** veya **“Kontrolden Çık”**; yayıncı üstteki
   **“Kontrolü Durdur”** düğmesi.

**Önemli notlar**

- Yayıncı web tarayıcısındaysa (Electron değilse) istek otomatik reddedilir; çünkü tarayıcı işletim sistemi
  fare/klavye kontrolüne izin vermez. Bu yüzden kontrol edilecek tarafta **masaüstü uygulaması şarttır**.
- Yayıncı **birincil monitörü** paylaşmalıdır; çoklu monitörde koordinatlar birincil ekrana göre eşlenir.
- Yönetici (Administrator) olarak açılmış pencereler, LumoLive yönetici değilse kontrol edilemez (Windows UIPI).
- Aynı anda yalnızca **bir izleyici** kontrol edebilir; yayıncı dilediği an kesebilir.
- Girdiler önce WebRTC DataChannel (P2P) ile, kanal açılamazsa Socket.IO üzerinden gider; sunucu tarafında
  saniyede 500 olay sınırı ve yalnızca aktif yayıncıya yönlendirme vardır.

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
