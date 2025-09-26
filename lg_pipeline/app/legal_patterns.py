"""
Explicit spaCy EntityRuler patterns for Indian legal documents.

Labels used: CASE_CITATION, STATUTE_SECTION, STATUTE, COURT, CASE_NUMBER, DATE, PARTY, JUDGE, GPE

Pattern format follows spaCy v3 EntityRuler token patterns. Regex entries use
{"TEXT": {"REGEX": r"(?i)regex"}} to enable case-insensitive matching.
Each pattern includes a stable id so ent.ent_id_ can be inspected for provenance.
"""

from __future__ import annotations

patterns = [
    # -------------------- CITATION (bare) --------------------
    {"label": "CITATION", "pattern": [{"TEXT": {"REGEX": r"(?i)^\d{4}\s+(?:SCC|AIR|SCR|CriLJ|INSC|SCC\s+Online)\s+\d+"}}], "id": "CITATION:bare"},
    # -------------------- CASE_CITATION --------------------
    {"label": "CASE_CITATION", "pattern": [{"TEXT": {"REGEX": r"(?i)\(\s*\d{4}\s*\)\s*\d+\s*SCC(?:\s*\(Cri\))?\s*\d+"}}], "id": "CASE_CITATION:scc_cri_opt"},
    {"label": "CASE_CITATION", "pattern": [{"TEXT": {"REGEX": r"(?i)\d{4}\s+SCC\s+Online\s+[A-Za-z0-9\-_]+"}}], "id": "CASE_CITATION:scc_online"},
    {"label": "CASE_CITATION", "pattern": [{"TEXT": {"REGEX": r"(?i)AIR\s*\d{4}\s*(?:SC|HC|Bom|Del|Mad|Cal|Ker|All|Pat|AP|MP|Raj|Ori|Gau|P&H|PH|HP|J&K)\s*\d+"}}], "id": "CASE_CITATION:air_reporter"},
    {"label": "CASE_CITATION", "pattern": [{"TEXT": {"REGEX": r"(?i)\(\s*\d{4}\s*\)\s*\d+\s*SCR\s*\d+"}}], "id": "CASE_CITATION:scr"},
    {"label": "CASE_CITATION", "pattern": [{"TEXT": {"REGEX": r"(?i)\d{4}\s+CriLJ\s+\d+"}}], "id": "CASE_CITATION:crilj"},
    {"label": "CASE_CITATION", "pattern": [{"TEXT": {"REGEX": r"(?i)\d{4}\s+INSC\s+\d+"}}], "id": "CASE_CITATION:insc"},
    {"label": "CASE_CITATION", "pattern": [{"TEXT": {"REGEX": r"(?i)(?:\(\s*\d{4}\s*\)\s*\d+\s*SCC|\d{4}\s*SCC\s*\d+)"}}], "id": "CASE_CITATION:scc_redundant"},
    {"label": "CASE_CITATION", "pattern": [{"TEXT": {"REGEX": r"(?i)\bSCC\s*Online\s*[A-Za-z0-9]+\b"}}], "id": "CASE_CITATION:scc_online_simple"},
    # Example phrase (literal) pattern
    {"label": "CASE_CITATION", "pattern": "AIR 2005 SC 123", "id": "CASE_CITATION:air_example_phrase"},

    # Extra explicit forms
    {"label": "CASE_CITATION", "pattern": [{"TEXT": {"REGEX": r"(?i)\b\d{4}\s+SCC\s+Online\s+\w+\s+\d+\b"}}], "id": "CASE_CITATION:scc_online_variant"},
    {"label": "CASE_CITATION", "pattern": [{"TEXT": {"REGEX": r"(?i)\b(199[0-9]|20[0-9]{2})\s+CriLJ\s+\d+\b"}}], "id": "CASE_CITATION:crilj_variant"},
    {"label": "CASE_CITATION", "pattern": [{"TEXT": {"REGEX": r"(?i)\b(197[0-9]|198[0-9]|199[0-9]|200[0-9]|201[0-9]|202[0-5])\s+SCR\s+\d+\b"}}], "id": "CASE_CITATION:scr_year_range"},

    # -------------------- STATUTE_SECTION --------------------
    {"label": "STATUTE_SECTION", "pattern": [{"TEXT": {"REGEX": r"(?i)\bS\.?\s*\d+(?:\([0-9A-Za-z]+\))*\b"}}], "id": "STATUTE_SECTION:s_dot"},
    {"label": "STATUTE_SECTION", "pattern": [{"TEXT": {"REGEX": r"(?i)\bSec\.?\s*\d+(?:\([0-9A-Za-z]+\))*\b"}}], "id": "STATUTE_SECTION:sec_dot"},
    {"label": "STATUTE_SECTION", "pattern": [{"TEXT": {"REGEX": r"(?i)\bSection\s+[0-9]+(?:\([0-9A-Za-z]+\))*\b"}}], "id": "STATUTE_SECTION:section_num"},
    {"label": "STATUTE_SECTION", "pattern": [{"TEXT": {"REGEX": r"(?i)\bSection\s+[ivxlcdm]+\b"}}], "id": "STATUTE_SECTION:section_roman"},
    {"label": "STATUTE_SECTION", "pattern": [{"TEXT": {"REGEX": r"(?i)\bArticle\s+[0-9A-Za-z]+\b"}}], "id": "STATUTE_SECTION:article"},
    {"label": "STATUTE_SECTION", "pattern": [{"TEXT": {"REGEX": r"(?i)\bClause\s+[A-Za-z0-9()]+\b"}}], "id": "STATUTE_SECTION:clause"},

    # -------------------- STATUTE (acts and abbreviations) --------------------
    # IPC
    {"label": "STATUTE", "pattern": "Indian Penal Code", "id": "STATUTE:ipc_phrase"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bIPC\b\.?"}}], "id": "STATUTE:ipc_regex"},
    # CrPC
    {"label": "STATUTE", "pattern": "Code of Criminal Procedure", "id": "STATUTE:crpc_phrase"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bCrPC\b\.?"}}], "id": "STATUTE:crpc_regex"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bCr\.P\.C\.?\b"}}], "id": "STATUTE:crpc_regex_dotted"},
    # CPC
    {"label": "STATUTE", "pattern": "Code of Civil Procedure", "id": "STATUTE:cpc_phrase"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bCPC\b\.?"}}], "id": "STATUTE:cpc_regex"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bC\.P\.C\.?\b"}}], "id": "STATUTE:cpc_regex_dotted"},
    # Evidence Act
    {"label": "STATUTE", "pattern": "Evidence Act", "id": "STATUTE:evidence_phrase"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bEvidence\s+Act\b"}}], "id": "STATUTE:evidence_regex"},
    # Transfer of Property Act
    {"label": "STATUTE", "pattern": "Transfer of Property Act", "id": "STATUTE:topa_phrase"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bTransfer\s+of\s+Property\s+Act\b"}}], "id": "STATUTE:topa_regex"},
    # Registration Act
    {"label": "STATUTE", "pattern": "Registration Act", "id": "STATUTE:regact_phrase"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bRegistration\s+Act\b"}}], "id": "STATUTE:regact_regex"},
    # Indian Stamp Act
    {"label": "STATUTE", "pattern": "Indian Stamp Act", "id": "STATUTE:stamp_phrase"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bStamp\s+Act\b"}}], "id": "STATUTE:stamp_regex"},
    # Specific Relief Act
    {"label": "STATUTE", "pattern": "Specific Relief Act", "id": "STATUTE:sra_phrase"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bSpecific\s+Relief\s+Act\b"}}], "id": "STATUTE:sra_regex"},
    # Companies Act
    {"label": "STATUTE", "pattern": "Companies Act, 2013", "id": "STATUTE:companies_phrase"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bCompanies\s+Act\b"}}], "id": "STATUTE:companies_regex"},
    # Contract Act
    {"label": "STATUTE", "pattern": "Contract Act, 1872", "id": "STATUTE:contract_phrase"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bContract\s+Act\b"}}], "id": "STATUTE:contract_regex"},
    # Constitution of India
    {"label": "STATUTE", "pattern": "Constitution of India", "id": "STATUTE:constitution_phrase"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bConstitution\s+of\s+India\b"}}], "id": "STATUTE:constitution_regex"},
    # Information Technology Act
    {"label": "STATUTE", "pattern": "Information Technology Act, 2000", "id": "STATUTE:it_phrase"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bInformation\s+Technology\s+Act\b"}}], "id": "STATUTE:it_regex_long"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bIT\s+Act\b"}}], "id": "STATUTE:it_regex_short"},
    # GST Act
    {"label": "STATUTE", "pattern": "Central Goods and Services Tax Act, 2017", "id": "STATUTE:gst_phrase"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bGST\s+Act\b"}}], "id": "STATUTE:gst_regex"},
    # Motor Vehicles Act
    {"label": "STATUTE", "pattern": "Motor Vehicles Act, 1988", "id": "STATUTE:mv_phrase"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bMotor\s+Vehicles\s+Act\b"}}], "id": "STATUTE:mv_regex"},
    # Income Tax Act
    {"label": "STATUTE", "pattern": "Income Tax Act, 1961", "id": "STATUTE:itax_phrase"},
    {"label": "STATUTE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bIncome\s+Tax\s+Act\b"}}], "id": "STATUTE:itax_regex"},

    # -------------------- COURT --------------------
    # Phrase patterns
    {"label": "COURT", "pattern": "Supreme Court", "id": "COURT:supreme"},
    {"label": "COURT", "pattern": "Supreme Court of India", "id": "COURT:supreme_full"},
    {"label": "COURT", "pattern": "High Court", "id": "COURT:high_generic"},
    {"label": "COURT", "pattern": "High Court of Judicature at Madras", "id": "COURT:madras_full"},
    {"label": "COURT", "pattern": "Madras High Court", "id": "COURT:madras"},
    {"label": "COURT", "pattern": "Delhi High Court", "id": "COURT:delhi"},
    {"label": "COURT", "pattern": "Bombay High Court", "id": "COURT:bombay"},
    {"label": "COURT", "pattern": "Calcutta High Court", "id": "COURT:calcutta"},
    {"label": "COURT", "pattern": "Kerala High Court", "id": "COURT:kerala"},
    {"label": "COURT", "pattern": "Karnataka High Court", "id": "COURT:karnataka"},
    {"label": "COURT", "pattern": "Allahabad High Court", "id": "COURT:allahabad"},
    {"label": "COURT", "pattern": "Patna High Court", "id": "COURT:patna"},
    {"label": "COURT", "pattern": "Punjab and Haryana High Court", "id": "COURT:pnh"},
    {"label": "COURT", "pattern": "Gauhati High Court", "id": "COURT:gauhati"},
    {"label": "COURT", "pattern": "Rajasthan High Court", "id": "COURT:rajasthan"},
    {"label": "COURT", "pattern": "Orissa High Court", "id": "COURT:orissa"},
    {"label": "COURT", "pattern": "Andhra Pradesh High Court", "id": "COURT:ap"},
    {"label": "COURT", "pattern": "Madhya Pradesh High Court", "id": "COURT:mp"},
    {"label": "COURT", "pattern": "Himachal Pradesh High Court", "id": "COURT:hp"},
    {"label": "COURT", "pattern": "Jammu and Kashmir High Court", "id": "COURT:jk"},
    # Abbreviations
    {"label": "COURT", "pattern": [{"TEXT": {"REGEX": r"(?i)\b(DelHC|MadHC|BomHC|CalHC|KerHC|KarnHC|AllHC|PatHC|APHC|MPHC|RajHC|OriHC|GauHC|PnHHC|PHHC|J&KHC|HPHC)\b"}}], "id": "COURT:abbrev"},
    # Generic High Court names
    {"label": "COURT", "pattern": [{"TEXT": {"REGEX": r"(?i)\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+High\s+Court\b"}}], "id": "COURT:generic_hc"},

    # -------------------- CASE_NUMBER --------------------
    {"label": "CASE_NUMBER", "pattern": [{"TEXT": {"REGEX": r"(?i)\bC\.?A\.?\s*No\.?\s*\d+(?:\s*of\s*\d{4})?\b"}}], "id": "CASE_NUMBER:ca_no"},
    {"label": "CASE_NUMBER", "pattern": [{"TEXT": {"REGEX": r"(?i)\bS\.?L\.?P\.?\s*\(?C\)?\.?\s*No\.?\s*\d+(?:\s*of\s*\d{4})?\b"}}], "id": "CASE_NUMBER:slp_c_no"},
    {"label": "CASE_NUMBER", "pattern": [{"TEXT": {"REGEX": r"(?i)\bCRP(?:\.PD\.)?\.?\s*No\.?\s*\d+(?:\s*of\s*\d{4})?\b"}}], "id": "CASE_NUMBER:crp_pd_no"},
    {"label": "CASE_NUMBER", "pattern": [{"TEXT": {"REGEX": r"(?i)\bO\.?S\.?\s*No\.?\s*\d+(?:\s*of\s*\d{4})?\b"}}], "id": "CASE_NUMBER:os_no"},
    {"label": "CASE_NUMBER", "pattern": [{"TEXT": {"REGEX": r"(?i)\bI\.?A\.?\s*No\.?\s*\d+(?:\s*of\s*\d{4})?\b"}}], "id": "CASE_NUMBER:ia_no"},
    {"label": "CASE_NUMBER", "pattern": [{"TEXT": {"REGEX": r"(?i)\bW\.?P\.?\s*No\.?\s*\d+(?:\s*of\s*\d{4})?\b"}}], "id": "CASE_NUMBER:wp_no"},
    {"label": "CASE_NUMBER", "pattern": [{"TEXT": {"REGEX": r"(?i)\bO\.?A\.?\s*No\.?\s*\d+(?:\s*of\s*\d{4})?\b"}}], "id": "CASE_NUMBER:oa_no"},
    {"label": "CASE_NUMBER", "pattern": [{"TEXT": {"REGEX": r"(?i)\bSuit\s*No\.?\s*\d+(?:\s*of\s*\d{4})?\b"}}], "id": "CASE_NUMBER:suit_no"},
    {"label": "CASE_NUMBER", "pattern": [{"TEXT": {"REGEX": r"(?i)\bI\.?A\.?\s*No\.?\s*\d+\b"}}], "id": "CASE_NUMBER:ia_no_simple"},

    # -------------------- DATE --------------------
    {"label": "DATE", "pattern": [{"TEXT": {"REGEX": r"\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b"}}], "id": "DATE:dmy_numeric"},
    {"label": "DATE", "pattern": [{"TEXT": {"REGEX": r"(?i)\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b"}}], "id": "DATE:dd_month_yyyy"},
    {"label": "DATE", "pattern": [{"TEXT": {"REGEX": r"(?i)\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b"}}], "id": "DATE:month_dd_yyyy"},

    # -------------------- PARTY --------------------
    # Core role phrases
    {"label": "PARTY", "pattern": "Appellant", "id": "PARTY:appellant"},
    {"label": "PARTY", "pattern": "Respondent", "id": "PARTY:respondent"},
    {"label": "PARTY", "pattern": "Petitioner", "id": "PARTY:petitioner"},
    {"label": "PARTY", "pattern": "Defendant", "id": "PARTY:defendant"},
    {"label": "PARTY", "pattern": "Plaintiff", "id": "PARTY:plaintiff"},
    {"label": "PARTY", "pattern": "L.Rs.", "id": "PARTY:lrs"},
    {"label": "PARTY", "pattern": "Through LRs", "id": "PARTY:through_lrs"},
    {"label": "PARTY", "pattern": "Through LRs.", "id": "PARTY:through_lrs_dot"},
    {"label": "PARTY", "pattern": "Through LRS", "id": "PARTY:through_lrs_caps"},
    # Party line regex (case title parts)
    {"label": "PARTY", "pattern": [{"TEXT": {"REGEX": r"(?i)\b[A-Z][A-Za-z0-9\-\s&\.']{2,}\b(?:\s+\.\.\.)?\s+(?:APPELLANT|RESPONDENT|PETITIONER|DEFENDANT)\b"}}], "id": "PARTY:title_line"},

    # -------------------- JUDGE --------------------
    {"label": "JUDGE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bHon'?ble\s+Justice\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?\b"}}], "id": "JUDGE:honble_justice"},
    {"label": "JUDGE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bJustice\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?\b"}}], "id": "JUDGE:justice"},
    # Signatures / uppercase with trailing J.
    {"label": "JUDGE", "pattern": [{"TEXT": {"REGEX": r"(?i)\b(?:HON'?BLE\s+)?[A-Z][A-Z\s]+J\.\b"}}], "id": "JUDGE:signature_caps_j"},
    {"label": "JUDGE", "pattern": [{"TEXT": {"REGEX": r"(?i)\[?[A-Z][A-Za-z\s]+J\.\]?"}}], "id": "JUDGE:bracket_name_j"},
    {"label": "JUDGE", "pattern": "Chief Justice of India", "id": "JUDGE:cji"},
    {"label": "JUDGE", "pattern": "Hon'ble Judge", "id": "JUDGE:honble_judge"},
    {"label": "JUDGE", "pattern": "Honble", "id": "JUDGE:honble_plain"},

    # -------------------- GPE --------------------
    {"label": "GPE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bState\s+of\s+[A-Z][a-zA-Z ]+\b"}}], "id": "GPE:state_of"},
    {"label": "GPE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bUnion\s+of\s+India\b"}}], "id": "GPE:union_of_india"},
    {"label": "GPE", "pattern": [{"TEXT": {"REGEX": r"(?i)\bGovernment\s+of\s+[A-Z][a-zA-Z ]+\b"}}], "id": "GPE:govt_of"},
]
