from __future__ import annotations
import spacy
from spacy.pipeline import EntityRuler
from app.legal_patterns import patterns as LEGAL_PATTERNS
from app.legal_normalizer import normalize_legal_entity


def make_nlp():
    # lightweight blank English with just EntityRuler
    nlp = spacy.blank("en")
    ruler = nlp.add_pipe("entity_ruler")
    ruler.add_patterns(LEGAL_PATTERNS)
    return nlp


def extract(nlp, text):
    doc = nlp(text)
    return [(ent.text, ent.label_) for ent in doc.ents]


def test_case_citation_patterns():
    nlp = make_nlp()
    assert ("(2005) 2 SCC 123", "CASE_CITATION") in extract(nlp, "As held in (2005) 2 SCC 123 ...")
    assert ("AIR 1999 SC 456", "CASE_CITATION") in extract(nlp, "Cited AIR 1999 SC 456")


def test_statute_and_section_patterns():
    nlp = make_nlp()
    txt = "S. 49 of the IPC and Section XLIX of the Evidence Act"
    ents = extract(nlp, txt)
    assert ("S. 49", "STATUTE_SECTION") in ents or ("S. 49 of the", "STATUTE_SECTION") in ents
    assert any(lbl == "STATUTE" for _, lbl in ents)


def test_court_and_case_number_dates():
    nlp = make_nlp()
    txt = "Supreme Court of India in CRP.PD. No. 2828 of 2015 on 01.01.2000"
    ents = extract(nlp, txt)
    assert ("Supreme Court of India", "COURT") in ents
    assert any(lbl == "CASE_NUMBER" for _, lbl in ents)
    assert any(lbl == "DATE" for _, lbl in ents)


def test_judge_pattern_and_normalization():
    nlp = make_nlp()
    txt = "Hon'ble Justice Pamidighantam Sri Narasimha"
    ents = extract(nlp, txt)
    assert any(lbl == "JUDGE" for _, lbl in ents)
    # normalization check
    assert normalize_legal_entity("Hon'ble Justice Pamidighantam Sri Narasimha") != ""
