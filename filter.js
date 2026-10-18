// ============================================================================
//  LumoLive — Gelişmiş küfür / uygunsuz içerik algılama motoru
// ============================================================================
//  Amaç: "profesyonel" seviyede tespit. Aşağıdaki gizleme (obfuscation)
//  yöntemlerinin tamamını yakalar:
//    • büyük/küçük harf            → SİKTİR / SiKtIr
//    • Türkçe karakter katlama     → ş/ĝ/ı... (siktir ↔ şıktır)
//    • leetspeak                   → s1kt1r, $ik, @mk
//    • homoglif (benzer harf)      → Kiril "а", "о" vb. Latin karşılıkları
//    • ayraçla bölme               → s.i.k, s-i-k, s i k
//    • tekrar eden harf            → siiiktir, orooospu
//    • görünmez karakterler        → zero-width, soft hyphen
//    • kelime kökü + ekler         → siktiriyim, orospuluğu
//  Ayrıca tespit edilen kelimeleri önem derecesine (severity) göre sınıflar.
// ============================================================================

// --- leetspeak: rakam/sembol → harf ---
const LEET = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't',
    '8': 'b', '9': 'g', '@': 'a', '$': 's', '|': 'i', '€': 'e'
};

// --- Türkçe harfler → ASCII ---
const TR = {
    'ı': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c',
    'â': 'a', 'î': 'i', 'û': 'u', 'ê': 'e', 'ô': 'o', 'ä': 'a', 'ï': 'i'
};

// --- homoglif / benzer görünen harfler (Kiril, Yunan, tam-genişlik vb.) ---
const HOMOGLYPH = {
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y',
    'к': 'k', 'м': 'm', 'т': 't', 'н': 'h', 'в': 'b', 'ѕ': 's', 'і': 'i',
    'ї': 'i', 'ј': 'j', 'ɡ': 'g', 'ԁ': 'd', 'ᥙ': 'u', 'ⅰ': 'i', 'ⅼ': 'l',
    'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o',
    'ρ': 'p', 'σ': 'o', 'τ': 't', 'υ': 'u', 'ϲ': 'c', 'ո': 'n', 'ᴜ': 'u'
};

// --- temizleme yardımcıları ---------------------------------------------------
// Görünmez / sıfır-genişlik karakterleri at, birleşik karakterleri sadeleştir.
function strip(raw) {
    return String(raw || '')
        .normalize('NFKD')
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\u180E]/g, '')
        .replace(/[\u0300-\u036f]/g, ''); // aksan işaretleri
}
function mapChars(s) {
    s = s.replace(/[0-9@$|€]/g, c => LEET[c] || c);
    s = s.replace(/[ışğüöçâîûêôäï]/g, c => TR[c] || c);
    s = s.replace(/[^\x00-\x7F]/g, c => HOMOGLYPH[c] || c);
    return s;
}
// Ardışık 3+ aynı harfi teke indir (siıiktir → siktir). İkili tekrarlar korunur
// ki "book" gibi gerçek kelimeler "bok"a dönüşüp yanlış pozitif üretmesin.
const collapse = s => s.replace(/(.)\1{2,}/g, '$1');

// Tamamen bitişik biçim: "S.i.k 1.r" → "sikir"
function flatNorm(raw) {
    let s = strip(raw).toLocaleLowerCase('tr');
    s = mapChars(s).replace(/[^a-z0-9]/g, '');
    return collapse(s);
}
// Kelime sınırlarını koruyan biçim: "s.i.k" → "s i k"
function spacedNorm(raw) {
    let s = strip(raw).toLocaleLowerCase('tr');
    s = mapChars(s).replace(/[^a-z0-9]+/g, ' ').trim();
    return collapse(s);
}

// --- sözlük -------------------------------------------------------------------
// [kelime, severity, sadeceTamKelime?]
// severity: 3 = ağır küfür, 2 = hakaret, 1 = hafif/argo
// "sadeceTamKelime" = true → kök, başka bir kelimenin içinde geçse bile YAKALANMAZ
// (örn. "götür" ≠ "göt", "kaminin" ≠ "amin"). Kelime Türkçede ek alıyorsa
// çekimli hâllerini ayrıca listeleriz.
const DICT = [
    // ---- Türkçe: ağır küfür (3) ----
    ['siktir', 3], ['sikeyim', 3], ['sikerim', 3], ['sikecem', 3], ['sikecegim', 3],
    ['sikiyim', 3], ['sik', 3, true], ['sikim', 3, true], ['sikik', 3, true], ['sikmis', 3, true],
    ['sikti', 3, true], ['amcik', 3], ['aminakoyim', 3], ['amindan', 3],
    ['amina', 3, true], ['amini', 3, true],
    ['orospu', 3], ['oruspu', 3], ['orospucocugu', 3],
    ['kaltak', 3], ['surtuk', 3], ['fahise', 3], ['gotveren', 3], ['gotlek', 3],
    ['yarrak', 3], ['yarak', 3], ['serefsiz', 3], ['namussuz', 3], ['yavsak', 3],
    ['sirfinti', 3], ['kahpe', 3], ['kancik', 3], ['ibne', 3], ['ibine', 3],
    ['pezevenk', 3], ['pezewenk', 3], ['gavat', 3], ['tassak', 3], ['tasak', 3],
    ['götlek', 3], ['sikici', 3], ['skici', 3],
    // ---- Türkçe: hakaret (2) ----
    ['salak', 2], ['aptal', 2], ['gerizekali', 2], ['gerzek', 2], ['embesil', 2],
    ['angut', 2], ['ahmak', 2], ['beyinsiz', 2], ['sersem', 2], ['ezik', 2],
    ['bok', 2, true], ['boktan', 2], ['boklu', 2],
    ['got', 2, true], ['gotu', 2, true], ['gotune', 2, true], ['gotunu', 2, true], ['gote', 2, true],
    ['pic', 2, true], ['oc', 2, true], ['amk', 2, true], ['amq', 2, true], ['aq', 2, true],
    ['sic', 2, true], ['sictim', 2], ['sicarim', 2],
    ['hain', 2, true], ['sinsi', 2], ['sapik', 2], ['hiyarto', 2],
    ['kiro', 2, true], ['gundi', 2], ['dangalak', 2],
    // ---- İngilizce ----
    ['fuck', 3], ['fucked', 3], ['fucker', 3], ['fucking', 3], ['motherfucker', 3],
    ['asshole', 3], ['bastard', 3], ['bitch', 3], ['whore', 3], ['slut', 3],
    ['cunt', 3], ['dickhead', 3], ['pussy', 3], ['retard', 3], ['nigga', 3],
    ['nigger', 3], ['faggot', 3], ['shit', 2], ['dick', 2], ['crap', 1, true], ['wtf', 1, true]
];

// Uzun kökler (≥4) → metnin HERHANGİ bir yerinde geçerse yakalanır (kök + ek).
const LONG = [];
// Kısa kökler (≤3) ve "sadeceTamKelime" işaretliler → tam kelime ya da
// tamamen bölünmüş ("s.i.k") hâlde yakalanır.
const SHORT = [];
for (const [w, sev, exact] of DICT) {
    const r = flatNorm(w);
    if (!r) continue;
    if (exact || r.length < 4) SHORT.push({ r, sev, w });
    else LONG.push({ r, sev, w });
}

// --- ana analiz ---------------------------------------------------------------
function scan(src, found) {
    const flat = flatNorm(src);
    const spaced = spacedNorm(src);
    const tokens = spaced ? spaced.split(' ') : [];
    if (flat) {
        for (const e of LONG) if (flat.includes(e.r)) found.set(e.w, Math.max(found.get(e.w) || 0, e.sev));
    }
    for (const e of SHORT) {
        if (tokens.includes(e.r)) found.set(e.w, Math.max(found.get(e.w) || 0, e.sev));
        else if (flat === e.r) found.set(e.w, Math.max(found.get(e.w) || 0, e.sev)); // "s.i.k"
    }
}

function analyze(raw) {
    const out = { profane: false, matches: [], severity: 0 };
    const s = String(raw || '').trim();
    if (!s) return out;

    const found = new Map();
    scan(s, found);
    // "!" işareti hem ünlem hem gizleme aracı olabilir; iki yorumu da dene
    // (örn. "sik!" ve "sikt!r" ikisi de yakalanır).
    if (s.includes('!')) scan(s.replace(/!/g, 'i'), found);

    if (found.size) {
        out.profane = true;
        out.matches = [...found.keys()];
        out.severity = Math.max(...found.values());
    }
    return out;
}

// Geriye dönük uyumluluk: basit doğrulama
const containsProfanity = raw => analyze(raw).profane;

// Uygunsuz kelimeleri yıldızla gizle (boşlukla ayrılmış her parça ayrı incelenir).
function censor(text) {
    return String(text || '').split(/(\s+)/).map(part => {
        if (!part.trim()) return part;
        return analyze(part).profane ? '*'.repeat(part.length) : part;
    }).join('');
}

// Kullanıcı adı / kanal adı kuralları: min-max karakter, harf/rakam ve . _ -, küfür yok.
function isValidName(name, min = 3, max = 20) {
    const re = new RegExp(`^[\\p{L}\\p{N}_.-]{${min},${max}}$`, 'u');
    return re.test(String(name || '')) && !containsProfanity(name);
}

module.exports = { analyze, containsProfanity, censor, isValidName };
