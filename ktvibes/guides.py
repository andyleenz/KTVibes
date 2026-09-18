"""Hangul pronunciation guides for English and Chinese lyrics.

English words go through the CMU pronouncing dictionary, then simple Korean
loanword spelling rules (someone -> 섬원, crazy -> 크레이지). Words the
dictionary lacks get no guide. Chinese goes pinyin -> Hangul with the standard
Korean table for Chinese sounds (晴天 -> 칭톈, 周杰伦 -> 저우제룬).
"""
import re

CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"]
HAN = re.compile(r"[㐀-鿿豈-﫿]")

def compose(cho: str, jung: str, jong: str = "") -> str:
    return chr(0xAC00 + (CHO.index(cho) * 21 + JUNG.index(jung)) * 28 + JONG.index(jong))

def decompose(syllable: str) -> tuple[str, str, str]:
    code = ord(syllable) - 0xAC00
    return CHO[code // 588], JUNG[code % 588 // 28], JONG[code % 28]

# English: ARPAbet phonemes -> Hangul.
ONSET = {"B": "ㅂ", "CH": "ㅊ", "D": "ㄷ", "DH": "ㄷ", "F": "ㅍ", "G": "ㄱ", "HH": "ㅎ", "JH": "ㅈ", "K": "ㅋ", "L": "ㄹ", "M": "ㅁ",
         "N": "ㄴ", "NG": "ㅇ", "P": "ㅍ", "R": "ㄹ", "S": "ㅅ", "SH": "ㅅ", "T": "ㅌ", "TH": "ㅅ", "V": "ㅂ", "Z": "ㅈ", "ZH": "ㅈ"}
# Vowel -> first syllable's vowel, plus any trailing vowel syllables (diphthongs).
VOWEL = {"AA": ("ㅏ",), "AE": ("ㅐ",), "AH": ("ㅓ",), "AO": ("ㅗ",), "AW": ("ㅏ", "ㅜ"), "AY": ("ㅏ", "ㅣ"), "EH": ("ㅔ",), "ER": ("ㅓ",),
         "EY": ("ㅔ", "ㅣ"), "IH": ("ㅣ",), "IY": ("ㅣ",), "OW": ("ㅗ",), "OY": ("ㅗ", "ㅣ"), "UH": ("ㅜ",), "UW": ("ㅜ",)}
W_GLIDE = {"ㅏ": "ㅘ", "ㅐ": "ㅙ", "ㅓ": "ㅝ", "ㅔ": "ㅞ", "ㅣ": "ㅟ", "ㅗ": "ㅝ", "ㅜ": "ㅜ"}
Y_GLIDE = {"ㅏ": "ㅑ", "ㅐ": "ㅒ", "ㅓ": "ㅕ", "ㅔ": "ㅖ", "ㅗ": "ㅛ", "ㅜ": "ㅠ", "ㅣ": "ㅣ"}
CODA = {"M": "ㅁ", "N": "ㄴ", "NG": "ㅇ", "L": "ㄹ"}
STOP_CODA = {"K": "ㄱ", "P": "ㅂ", "T": "ㅅ"}  # only after a short vowel: lips -> 립스
SHORT = {"IH", "EH", "AE", "AH", "UH"}
_cmu = None

def _alone(consonant: str) -> str:
    """A consonant with no vowel of its own gets ㅡ (ㅣ after ch/j/sh sounds)."""
    if consonant in ("CH", "JH", "SH", "ZH"):
        return compose(ONSET[consonant], "ㅣ")
    return compose(ONSET[consonant], "ㅡ")

def arpabet_hangul(phones: list[str]) -> str:
    phones = [re.sub(r"\d", "", p) for p in phones]
    syllables = []  # [cho, jung, jong]
    pending = []  # consonants waiting for a vowel
    last_vowel = None
    for index, phone in enumerate(phones):
        if phone not in VOWEL:
            pending.append(phone)
            continue
        glide = None
        if pending and pending[-1] in ("W", "Y"):
            glide = pending.pop()
        onset = pending.pop() if pending else None
        if glide and onset in CODA and syllables and not syllables[-1][2] and not pending:
            syllables[-1][2], onset = CODA[onset], None  # someone -> 섬원, not 서뭔
        elif glide == "W" and onset and onset not in ("K", "G", "HH"):
            pending.append(onset)  # sweet -> 스위트; only k/g/h merge (queen -> 퀸)
            onset = None
        # Earlier consonants: the first may close the previous syllable; the rest stand alone.
        if syllables and pending and not syllables[-1][2]:
            first = pending[0]
            if first in CODA or (first in STOP_CODA and last_vowel in SHORT):
                syllables[-1][2] = CODA.get(first) or STOP_CODA[first]
                pending.pop(0)
        for consonant in pending:
            if consonant not in ("R", "W", "Y"):
                syllables.append(list(decompose(_alone(consonant))))
        pending = []
        vowels = VOWEL[phone]
        jung = vowels[0]
        if glide == "W" or onset == "W":
            jung = W_GLIDE[jung]
        if glide == "Y" or onset == "Y" or onset == "SH":
            jung = Y_GLIDE.get(jung, jung)
        cho = ONSET.get(onset, "ㅇ") if onset not in (None, "W", "Y") else "ㅇ"
        if onset == "L" and syllables and not syllables[-1][2]:
            syllables[-1][2] = "ㄹ"  # hello -> 헐로
        syllables.append([cho, jung, ""])
        for extra in vowels[1:]:
            syllables.append(["ㅇ", extra, ""])
        last_vowel = phone if len(vowels) == 1 else None
    if pending and syllables and not syllables[-1][2]:
        first = pending[0]
        if first in CODA or (first in STOP_CODA and last_vowel in SHORT):
            syllables[-1][2] = CODA.get(first) or STOP_CODA[first]
            pending.pop(0)
    for consonant in pending:
        if consonant not in ("R", "W", "Y"):
            syllables.append(list(decompose(_alone(consonant))))
    return "".join(compose(*s) for s in syllables)

def english_hangul(word: str) -> str:
    global _cmu
    if _cmu is None:
        import cmudict
        _cmu = cmudict.dict()
    key = re.sub(r"[^a-z']", "", word.lower().replace("’", "'")).strip("'")
    phones = _cmu.get(key)
    return arpabet_hangul(phones[0]) if phones else ""

# Chinese: pinyin -> Hangul (Korean standard table for Chinese).
PINYIN_INITIAL = {"b": "ㅂ", "p": "ㅍ", "m": "ㅁ", "f": "ㅍ", "d": "ㄷ", "t": "ㅌ", "n": "ㄴ", "l": "ㄹ", "g": "ㄱ", "k": "ㅋ", "h": "ㅎ",
                  "j": "ㅈ", "q": "ㅊ", "x": "ㅅ", "zh": "ㅈ", "ch": "ㅊ", "sh": "ㅅ", "r": "ㄹ", "z": "ㅉ", "c": "ㅊ", "s": "ㅆ"}
PINYIN_FINAL = {"a": "아", "o": "오", "e": "어", "ai": "아이", "ei": "에이", "ao": "아오", "ou": "어우", "an": "안", "en": "언",
                "ang": "앙", "eng": "엉", "er": "얼", "ong": "웅", "i": "이", "ia": "야", "ie": "예", "iao": "야오", "iu": "유",
                "ian": "옌", "in": "인", "iang": "양", "ing": "잉", "iong": "융", "u": "우", "ua": "와", "uo": "워", "uai": "와이",
                "ui": "웨이", "uan": "완", "un": "운", "uang": "왕", "ueng": "웡", "v": "위", "ve": "웨", "van": "위안", "vn": "윈"}
ZERO_INITIAL = {"yi": "i", "ya": "ia", "ye": "ie", "yao": "iao", "you": "iu", "yan": "ian", "yin": "in", "yang": "iang", "ying": "ing",
                "yong": "iong", "yu": "v", "yue": "ve", "yuan": "van", "yun": "vn", "wu": "u", "wa": "ua", "wo": "uo", "wai": "uai",
                "wei": "ui", "wan": "uan", "wen": "un", "wang": "uang", "weng": "ueng"}
PALATAL = {"j", "q", "x", "zh", "ch", "sh"}
UNGLIDE = {"ㅑ": "ㅏ", "ㅕ": "ㅓ", "ㅖ": "ㅔ", "ㅛ": "ㅗ", "ㅠ": "ㅜ"}

def pinyin_hangul(syllable: str) -> str:
    syllable = syllable.lower().replace("ü", "v")
    if syllable in ZERO_INITIAL:
        return PINYIN_FINAL.get(ZERO_INITIAL[syllable], "")
    match = re.match(r"(zh|ch|sh|[bpmfdtnlgkhjqxrzcs])?(\w+)", syllable)
    if not match:
        return ""
    initial, final = match[1], match[2]
    if initial in ("j", "q", "x") and final.startswith("u"):
        final = "v" + final[1:]
    if final == "i" and initial in ("zh", "ch", "sh", "r", "z", "c", "s"):
        return compose(PINYIN_INITIAL[initial], "ㅡ")  # zhi 즈, si 쓰
    hangul = PINYIN_FINAL.get(final)
    if not hangul:
        return ""
    if not initial:
        return hangul
    _, jung, jong = decompose(hangul[0])
    if initial in PALATAL:
        jung = UNGLIDE.get(jung, jung)
    return compose(PINYIN_INITIAL[initial], jung, jong) + hangul[1:]

def add_hangul(lines: list[dict]) -> list[dict]:
    """Store a Hangul guide as unit[4] for English words and Chinese characters."""
    from pypinyin import Style, lazy_pinyin
    for line in lines:
        units = line.get("units")
        if not units:
            continue
        text = "".join(u[0] for u in units)
        han = iter(lazy_pinyin("".join(HAN.findall(text)), style=Style.NORMAL))
        for unit in units:
            if HAN.search(unit[0]):
                reading = "".join(pinyin_hangul(next(han)) for _ in HAN.findall(unit[0]))
            elif re.search(r"[A-Za-z]", unit[0]):
                reading = english_hangul(unit[0])
            else:
                reading = ""
            while len(unit) < 4:
                unit.append("")
            unit[4:] = [reading]
    return lines
