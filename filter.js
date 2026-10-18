// ---------- Gelişmiş küfür filtresi (Türkçe + yaygın İngilizce) ----------
// Amaç: büyük/küçük harf, nokta/boşluk ile bölme (s.i.k), yıldız (*), tekrar eden
// harfler (siiiktir) ve leetspeak (s1kt1r) gibi gizleme yöntemlerini yakalamak.

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '|': 'i', '€': 'e' };
const TR = { 'ı': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u' };

// Metni sadeleştir: küçük harf (TR), leet çevirisi, TR harflerini ASCII yap,
// harf-dışı her şeyi at, tekrar eden harfleri tek harfe indir.
function norm(w) {
    let s = String(w || '').toLocaleLowerCase('tr');
    s = s.replace(/[0-9@$!|€]/g, c => LEET[c] || c);
    s = s.replace(/[ışğüöçâîû]/g, c => TR[c] || c);
    s = s.replace(/[^a-z]/g, '');
    s = s.replace(/(.)\1+/g, '$1');
    return s;
}

// A) Uzun / ayırt edici kökler → metnin HERHANGİ bir yerinde geçerse yakalanır (obfuscation'ı da yakalar)
const ROOTS = [
    'siktir', 'sikeyim', 'sikerim', 'sikecem', 'sikecegim', 'sikiyim', 'sikim', 'sikik', 'sikmis',
    'amcik', 'amini', 'aminakoyim', 'orospu', 'oruspu', 'orospucocugu', 'kaltak', 'surtuk', 'fahise',
    'gotveren', 'gotlek', 'yarrak', 'gerizekali', 'serefsiz', 'namussuz', 'yavsak',
    'sirfinti', 'kahpe', 'kancik', 'aptal', 'salak', 'embesil', 'angut', 'ahmak', 'beyinsiz',
    'asshole', 'motherfucker', 'fucking', 'fucker', 'bastard', 'nigger', 'faggot',
    'pussy', 'bitch', 'whore', 'dickhead', 'retard'
];

// B) Kısa kökler → yalnızca TAM kelime olarak eşleşirse yakalanır (kesik, götür, program vb. yanlış pozitifi önler)
const WORDS = [
    'sik', 'sikti', 'bok', 'boktan', 'boklu', 'got', 'gotu', 'gotune', 'gotunu', 'gote',
    'pic', 'oc', 'aq', 'amq', 'amk', 'sic', 'sictim', 'sicarim',
    'fuck', 'fucked', 'shit', 'dick', 'slut', 'cunt', 'wtf'
];

// Kökleri de filtreyle aynı biçime getir (yarrak -> yarak, s1kt1r -> siktir, vb.)
const ROOT_SET = ROOTS.map(norm).filter(Boolean);
const WORD_SET = new Set(WORDS.map(norm).filter(Boolean));

// Bir metin parçası uygunsuz mu?
function isBad(raw) {
    const s = String(raw || '').trim();
    if (!s) return false;
    const collapsed = norm(s);
    if (collapsed && ROOT_SET.some(r => collapsed.includes(r))) return true;
    for (const t of s.split(/[^\p{L}\p{N}@$*]+/u)) {
        const n = norm(t);
        if (n && WORD_SET.has(n)) return true;
    }
    return false;
}

// Uygunsuz kelimeleri yıldızla gizler; gerisini aynen bırakır.
const WORD_RE = /[\p{L}\p{N}@$*._-]+/gu;
function censor(text) {
    return String(text || '').replace(WORD_RE, w => isBad(w) ? '*'.repeat(Math.max(3, Math.min(w.length, 10))) : w);
}

// Kullanıcı adı / kanal adı kuralları: 3-20 karakter, harf/rakam ve . _ -, küfür yok.
function isValidName(name, min = 3, max = 20) {
    const re = new RegExp(`^[\\p{L}\\p{N}_.-]{${min},${max}}$`, 'u');
    return re.test(String(name || '')) && !isBad(name);
}

module.exports = { containsProfanity: isBad, censor, isValidName };
