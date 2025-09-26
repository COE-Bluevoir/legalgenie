import pytest

from app.legal_normalizer import (
    normalize_unicode,
    strip_stopwords,
    collapse_initials,
    expand_abbreviations,
    normalize_sections,
    phonetic_key,
    normalize_legal_entity,
)


def test_normalize_unicode_basic():
    # Zero width removed and curly apostrophe normalized
    assert normalize_unicode("A\u200bB\u2019C") == "AB'C"


def test_strip_stopwords():
    assert strip_stopwords("Petitioner v. Respondent versus Court") == ""


def test_collapse_initials():
    assert collapse_initials("V.R. Krishna Iyer") == "vr Krishna Iyer"


def test_expand_abbreviations():
    assert expand_abbreviations("SC judgment; HC order") == "supreme court judgment; high court order"


def test_normalize_sections_roman_and_numeric():
    s = "S. IV-A of IPC and Section 304B"
    out = normalize_sections(s)
    assert "section 4a" in out.lower()
    assert "section 304b" in out.lower()


def test_phonetic_key_stability():
    assert phonetic_key("Kaladevi") == phonetic_key("Kala Devi")


def test_normalize_legal_entity_pipeline():
    case1 = "Smt. Kala Devi v. State of Karnataka"
    case2 = "SMT KALADEVI vs STATE OF KARNATAKA"
    n1 = normalize_legal_entity(case1)
    n2 = normalize_legal_entity(case2)
    assert n1 == n2
    assert "supreme court" not in n1  # ensure no spurious abbrev expansion

    # Honorifics removed, stopwords removed, initials collapsed, etc.
    assert "smt" not in n1
    assert "vs" not in n1
    assert "v." not in n1
