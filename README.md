<div align="center">
  <img src="assets/images/readme-hero.gif" alt="29 Ekim — Cumhuriyetin Işığında: hareketli, sinematik kırmızı ve siyah kapak" width="100%" />

  <br />

  <p><strong>Bir milletin ortak hikâyesi.</strong><br />
  Cumhuriyetin geçmişine saygı, geleceğine umutla bakan sinematik bir web deneyimi.</p>

  <p>
    <img src="https://img.shields.io/badge/HTML5-Yap%C4%B1-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5" />
    <img src="https://img.shields.io/badge/CSS3-Tasar%C4%B1m-1572B6?style=for-the-badge&logo=css3&logoColor=white" alt="CSS3" />
    <img src="https://img.shields.io/badge/JavaScript-Etkile%C5%9Fim-F7DF1E?style=for-the-badge&logo=javascript&logoColor=111111" alt="JavaScript" />
    <img src="https://img.shields.io/badge/Responsive-Mobil%20Uyumlu-8A2BE2?style=for-the-badge" alt="Responsive design" />
    <img src="https://img.shields.io/badge/Build%20Step-Gerekmez-2E8B57?style=for-the-badge" alt="Build step not required" />
  </p>

  <p>
    <a href="#kurulum">🚀 Hemen çalıştır</a> &nbsp;·&nbsp;
    <a href="#bolumler">🎞️ Bölümleri keşfet</a> &nbsp;·&nbsp;
    <a href="#github-pages">🌐 GitHub Pages ile yayınla</a>
  </p>
</div>

<img src="assets/images/readme-divider.gif" alt="Kırmızı ışık taraması şeklinde animasyonlu ayraç" width="100%" />

<a id="proje"></a>
## 🎬 Proje Hakkında

**29 Ekim — Cumhuriyetin Işığında**, Cumhuriyet Bayramı için hazırlanmış; klasik bir bilgi sayfasından çok, aşağı kaydırdıkça yeni sahneler açan görsel bir hikâye anlatımıdır.

Koyu tonlar, bayrak kırmızısı, güçlü tipografi, tarihî görseller ve yumuşak hareketler bir araya gelerek ziyaretçiye sinematik bir yolculuk sunar. Sayfa; masaüstü, tablet ve telefon ekranlarına uyum sağlayacak şekilde tasarlanmıştır.

> **Tasarım fikri:** Geçmişin mirasını, bugünün umudunu ve geleceğe duyulan inancı tek bir akışta buluşturmak.

<a id="ozellikler"></a>
## ✨ Öne Çıkan Özellikler

| Özellik | Deneyim |
|:--|:--|
| 🎥 **Sinematik açılış** | Büyük “29 EKİM” başlığı, karanlık arka plan, kırmızı ışıklar ve dekoratif bayrak motifi |
| 🪄 **Scroll reveal** | Başlıklar, metinler ve görseller ekrana girdikçe yumuşakça görünür |
| 🌊 **Paralaks derinliği** | Dekoratif katmanlar kaydırma sırasında farklı hızlarda hareket eder |
| 💡 **Işık taraması** | Yeni bir sahne görünürken ekrandan kırmızı-beyaz ışık geçişi ilerler |
| 🧭 **Zaman çizgisi** | Tarihî dönüm noktaları ve ilerledikçe dolan dikey zaman çizgisi |
| ✨ **Parçacık efektleri** | Açılış ve final bölümlerinde hafif, hareketli ışık parçacıkları |
| 📈 **Kaydırma göstergesi** | Sayfanın ne kadarının gezildiğini gösteren üst çizgi |
| 🖱️ **İnce etkileşimler** | Kart hover efektleri ve geniş ekranlarda fare hareketine tepki veren ışık |
| 📱 **Mobil menü** | Küçük ekranlarda açılıp kapanan, dokunmaya uygun menü |
| ♿ **Hareket hassasiyeti** | `prefers-reduced-motion` tercihini algılayarak animasyonları azaltır |
| 🧩 **Haricî JS kütüphanesi yok** | HTML, CSS ve Vanilla JavaScript ile çalışır; derleme adımı gerekmez |

<a id="animasyonlar"></a>
## 🌀 Animasyonlar Nasıl Çalışıyor?

Bu projede amaç yalnızca sayfayı hareketli yapmak değil, **hareketi hikâyenin parçası hâline getirmek**:

- **Görünürlük tabanlı girişler:** `IntersectionObserver`, içeriğin görüntü alanına girdiğini algılar. Öğeler saydamlıktan görünür hâle gelir; yumuşak yükselme, bulanıklıktan netliğe geçiş ve sıralı gecikmeler kullanılır.
- **Sahne geçişleri:** Her ana bölüm görünür olduğunda JavaScript geçici bir ışık katmanı oluşturur. Animasyon bitince katman kaldırılır.
- **Kaydırmayla ilişkili derinlik:** `requestAnimationFrame` ile sınırlandırılan kaydırma güncellemesi, dekoratif arka plan öğelerine hafif paralaks hareketi verir.
- **Canvas parçacıkları:** Açılış ve finaldeki küçük ışıklar canvas üzerinde çizilir. İlgili alan görünür değilken animasyon döngüsü durdurulur.
- **Performans ve erişilebilirlik:** Animasyonlar azaltılmış hareket tercihi etkinse sadeleşir veya kapanır; küçük ekranlardaki hareket mesafeleri de azaltılır.

GitHub, güvenlik nedeniyle README dosyası içinde sitenin JavaScript'ini çalıştırmaz. Bu nedenle README'nin kendi görsel hareketi yerel **animasyonlu GIF** kapak ve ayraçlarla sağlanır; web sitesindeki etkileşimli animasyonlar ise `index.html` tarayıcıda açıldığında çalışır.

<a id="bolumler"></a>
## 🎞️ Sayfa Bölümleri

| Sahne | İçerik |
|:--:|:--|
| **01** | **Açılış — 29 Ekim:** Büyük başlık, yıl vurgusu ve aşağı kaydırma daveti |
| **02** | **Bir milletin yolculuğu:** Cumhuriyet fikrine uzanan hikâyeye giriş |
| **03** | **Tarihî zaman çizgisi:** 1919, 1920, 1922 ve 1923 dönüm noktaları |
| **04** | **Cumhuriyetin ilanı:** 29 Ekim 1923 ve arşiv görseli |
| **05** | **Cumhuriyetin değerleri:** Özgürlük, eğitim ve gelişim |
| **06** | **Geleceğe inanmak:** Atatürk portresi ve gelecek vurgusu |
| **07** | **Final:** Cumhuriyet Bayramı mesajı ve başa dönüş bağlantısı |

<a id="teknolojiler"></a>
## 🛠️ Kullanılan Teknolojiler

- **HTML5** — erişilebilir ve anlamlı sayfa yapısı
- **CSS3** — responsive düzen, görsel tema, geçişler ve keyframe animasyonları
- **Vanilla JavaScript** — görünürlük gözlemleme, kaydırma takibi, canvas parçacıkları ve mobil menü
- **Intersection Observer API** — sahne ve içerik girişlerini gözlemleme
- **Canvas API** — parçacık efektleri

Framework, paket yöneticisi veya derleme aracı zorunlu değildir. Google Fonts ve tarihî görseller internet üzerinden yüklendiği için bunların görünmesi için bağlantı gerekir.

<img src="assets/images/readme-divider.gif" alt="Kırmızı ışık taraması şeklinde animasyonlu ayraç" width="100%" />

<a id="kurulum"></a>
## 🚀 Kurulum

### 1. Projeyi indir

```bash
git clone https://github.com/KULLANICI-ADI/cumhuriyetin-isiginda.git
cd cumhuriyetin-isiginda
```

`KULLANICI-ADI` bölümünü GitHub kullanıcı adınla değiştir. Git kullanmıyorsan depodaki **Code → Download ZIP** seçeneğini kullanıp arşivi çıkarabilirsin.

### 2. Yerel sunucuyu başlat

Python yüklüyse proje kök klasöründe şu komutu çalıştır:

```bash
# Windows
py -m http.server 8000

# py komutu yoksa
python -m http.server 8000
```

### 3. Tarayıcıda aç

Şu adrese git: **http://localhost:8000**

Değişiklik yaptıktan sonra animasyon veya stil güncellemesi görünmüyorsa tarayıcıda `Ctrl + F5` ile önbelleği yenile.

<a id="dosya-yapisi"></a>
## 📁 Dosya Yapısı

```text
cumhuriyetin-isiginda/
├── index.html                     # Sayfa yapısı ve içerik
├── README.md                      # Proje tanıtımı ve kurulum rehberi
├── css/
│   └── style.css                  # Tema, responsive tasarım ve animasyonlar
├── js/
│   └── main.js                    # Kaydırma efektleri ve etkileşimler
└── assets/
    └── images/
        ├── README.txt              # Görsel kaynakları hakkında not
        ├── readme-hero.gif         # README için animasyonlu kapak
        └── readme-divider.gif      # Animasyonlu bölüm ayracı
```

<a id="github-pages"></a>
## 🌐 GitHub Pages ile Yayınlama

Site statik dosyalardan oluştuğu için GitHub Pages ile yayımlanabilir.

1. GitHub'da `cumhuriyetin-isiginda` adlı bir depo oluştur.
2. **`index.html`, `css/`, `js/`, `assets/` ve `README.md` dosyalarını depo köküne** yükle. `index.html` bir alt klasörün içinde kalmamalı.
3. Depoda **Settings → Pages** bölümünü aç.
4. **Build and deployment** altında kaynağı **Deploy from a branch** olarak seç.
5. Branch olarak `main`, klasör olarak `/(root)` seçip kaydet.
6. Pages bölümünde gösterilen yayımlanmış adresi aç.

İlk dağıtımın hazırlanması kısa bir süre alabilir. Görseller ve Google Fonts haricî kaynaklardan geldiğinden, bu kaynakları yüklemek için siteyi açan kişinin internet bağlantısı olması gerekir.

<a id="gorsel-kaynaklari"></a>
## 🖼️ Görsel Kaynakları

Sitedeki tarihî görseller Wikimedia Commons üzerinden yüklenir:

- [Atatürk portresi — Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Atat%C3%BCrk_portre.png)
- [Resimli Gazete, 3 Kasım 1923 — Wikimedia Commons](https://commons.wikimedia.org/wiki/File:1923_11_03_Resimli_Gazete_Cumhuriyetin_Ilani.jpg)

Bu görsellerin kullanım koşulları her bir kaynak sayfasında ayrıca belirtilir. Görselleri yeniden dağıtmadan veya farklı bir projede kullanmadan önce ilgili lisans ve atıf koşullarını kontrol et. README kapak GIF'i ise bu proje için oluşturulmuş yerel bir görseldir.

<a id="katki"></a>
## 🤝 Katkı ve Geliştirme

Geliştirme önerileri ve hata bildirimleri memnuniyetle karşılanır. Katkı yapmadan önce mevcut dosya yapısını korumak ve animasyonların masaüstü ile mobil ekranlarda davranışını kontrol etmek iyi bir başlangıçtır.

Önerilen kontrol listesi:

- [ ] Açılış ve final bölümlerini masaüstü/telefon boyutlarında kontrol et.
- [ ] Aşağı ve yukarı kaydırırken içerik girişlerinin tekrar çalıştığını doğrula.
- [ ] Mobil menünün açılma, kapanma ve bağlantı davranışını dene.
- [ ] Hareketi azaltma ayarı açıkken sayfanın okunabilir kaldığını kontrol et.
- [ ] Dış görsellerin lisans ve kaynak bilgilerini koru.

<a id="lisans"></a>
## 📄 Lisans

Bu depoda şu anda ayrı bir `LICENSE` dosyası bulunmuyor. Projeyi yeniden dağıtmayı veya başkalarının kullanımına açmayı düşünüyorsan tercih ettiğin lisansı seçip depo köküne `LICENSE` dosyası ekle. Wikimedia Commons görsellerinin lisansları, projenin kod lisansından ayrı değerlendirilmelidir.

---

<div align="center">
  <img src="assets/images/readme-divider.gif" alt="Animasyonlu kırmızı ışık çizgisi" width="100%" />
  <h3>🇹🇷 Cumhuriyetimizin 103. yılı kutlu olsun!</h3>
  <p><em>Geçmişin mirası, geleceğin umudu.</em></p>
  <sub>29 Ekim — Cumhuriyetin Işığında</sub>
</div>
