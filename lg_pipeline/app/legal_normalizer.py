from __future__ import annotations
import re
import unicodedata
from typing import List

ZERO_WIDTH = [
    "\u200b", "\u200c", "\u200d", "\ufeff",
]
STOPWORDS = {
    # include plain and dotted forms
    "v", "v.", "vs", "vs.", "versus", "petitioner", "respondent", "appellant", "judgment", "order", "the",
}
HONORIFICS = {"sri", "smt", "shri", "dr", "justice", "hon'ble", "honble"}
ABBREV_MAP = {
    "sc": "supreme court",
    "hc": "high court",
}
# Allow optional hyphen-letter suffix like "IV-A" -> capture A as tail
# Require at least one whitespace after S./Sec to avoid matching tokens like "SLP"
SECTION_PAT = re.compile(r"\b(?:s\.?\s+|sec(?:tion)?\s+)([ivxlcdm]+|\d+)(?:-?([A-Za-z]\w*))?\b", re.IGNORECASE)
ROMAN_MAP = {
    'M': 1000, 'CM': 900, 'D': 500, 'CD': 400,
    'C': 100,  'XC': 90,  'L': 50,  'XL': 40,
    'X': 10,   'IX': 9,   'V': 5,   'IV': 4, 'I': 1
}


def normalize_unicode(text: str) -> str:
    if not text:
        return ""
    t = unicodedata.normalize("NFKC", text)
    for zw in ZERO_WIDTH:
        t = t.replace(zw, "")
    t = t.replace("\u2018", "'").replace("\u2019", "'")
    t = t.replace("\u201C", '"').replace("\u201D", '"')
    t = re.sub(r"\s+", " ", t).strip()
    return t


def strip_stopwords(text: str) -> str:
    if not text:
        return ""
    tokens = re.split(r"\s+", text)
    out: List[str] = []
    for tok in tokens:
        low = tok.lower().strip(".,:;()[]{}\"")
        if low in STOPWORDS:
            continue
        out.append(tok)
    return " ".join(out).strip()


def collapse_initials(text: str) -> str:
    if not text:
        return ""
    # Collapse sequences like "V.R." or "R.K." or "S. K." -> "vr", "rk", "sk" (lowercase)
    def repl(m: re.Match[str]) -> str:
        s = m.group(0)
        letters = re.findall(r"[A-Za-z]", s)
        # Preserve a single trailing space if the matched chunk ended with whitespace
        spacer = " " if s.endswith(" ") else ""
        return "".join(letters).lower() + spacer
    # Also consume optional trailing whitespace to preserve a single separator
    t = re.sub(r"\b(?:[A-Za-z]\.\s*){2,}\s*", repl, text)
    # Remove stray dots next to single initials (e.g., "S.")
    t = re.sub(r"\b([A-Za-z])\.", r"\1", t)
    return t


def expand_abbreviations(text: str) -> str:
    def repl(m: re.Match[str]) -> str:
        key = m.group(0).lower().rstrip('.')
        return ABBREV_MAP.get(key, m.group(0))
    return re.sub(r"\b(?:SC|HC)\b\.?", repl, text, flags=re.IGNORECASE)


def roman_to_int(roman: str) -> int:
    s = roman.upper()
    i = 0
    val = 0
    while i < len(s):
        if i+1 < len(s) and s[i:i+2] in ROMAN_MAP:
            val += ROMAN_MAP[s[i:i+2]]
            i += 2
        else:
            val += ROMAN_MAP.get(s[i], 0)
            i += 1
    return val


def normalize_sections(text: str) -> str:
    def repl(m: re.Match[str]) -> str:
        num = m.group(1)
        tail = m.group(2) or ""
        if re.fullmatch(r"[ivxlcdm]+", num, flags=re.IGNORECASE):
            num = str(roman_to_int(num))
        return f"section {num}{tail.lower()}"
    return SECTION_PAT.sub(repl, text)


def phonetic_key(text: str) -> str:
    # Simple Soundex variant (ASCII letters only)
    t = re.sub(r"[^A-Za-z]", "", text).upper()
    if not t:
        return ""
    first = t[0]
    tail = t[1:]
    trans = str.maketrans({
        'B':'1','F':'1','P':'1','V':'1',
        'C':'2','G':'2','J':'2','K':'2','Q':'2','S':'2','X':'2','Z':'2',
        'D':'3','T':'3',
        'L':'4',
        'M':'5','N':'5',
        'R':'6'
    })
    digits = tail.translate(trans)
    digits = re.sub(r"[AEIOUYHW]", "", digits)
    digits = re.sub(r"(\d)\1+", r"\1", digits)
    code = (first + digits + "000")[:4]
    return code


def normalize_legal_entity(text: str) -> str:
    t = normalize_unicode(text)
    # remove trailing bracketed or inline numeric footnote markers (e.g., Somasundaram4, Name[12])
    t = re.sub(r"(\b[A-Za-z][A-Za-z\s]*?)(?:\[\d+\]|(\d+))\b", r"\1", t)
    # remove a trailing judge marker 'J.' while preserving the name content
    t = re.sub(r"\bJ\.\]?\s*$", "", t.strip())
    # strip honorifics at token boundaries
    tokens = [tok for tok in re.split(r"\s+", t) if tok]
    kept = []
    for tok in tokens:
        low = tok.lower().strip(".,:;()[]{}\"")
        if low in HONORIFICS:
            continue
        kept.append(tok)
    t = " ".join(kept)
    # remove stopwords
    t = strip_stopwords(t)
    # collapse initials
    t = collapse_initials(t)
    # expand abbreviations
    t = expand_abbreviations(t)
    # normalize section references
    t = normalize_sections(t)
    # remove leftover punctuation noise and lowercase
    t = re.sub(r"[\u2013\u2014\-–—]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip().casefold()
    # collapse all whitespace for canonical matching
    t = re.sub(r"\s+", "", t)
    return t
