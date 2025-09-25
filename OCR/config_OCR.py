import os
import cv2
import fitz  # PyMuPDF
import json
import tempfile
import configparser
from PIL import Image
import pytesseract
from google.cloud import vision
import numpy as np

# ----------------- 1. Load config -----------------
config = configparser.ConfigParser()
config.read("config.cfg")

BLUR_SHARPNESS_THRESHOLD = float(config["OCR"].get("BLUR_SHARPNESS_THRESHOLD", 150.0))
SAVE_ENHANCED_IMAGES = config["OCR"].getboolean("SAVE_ENHANCED_IMAGES", False)
ENHANCED_DIR = config["OCR"].get("ENHANCED_DIR", "enhanced_pages")
USE_VISION_FOR_BLUR = config["OCR"].getboolean("USE_VISION_FOR_BLUR", True)
USE_VISION_FOR_INDIC = config["OCR"].getboolean("USE_VISION_FOR_INDIC", True)
DEFAULT_ENGINE_PDF = config["OCR"].get("DEFAULT_ENGINE_PDF", "auto").lower()
DEFAULT_ENGINE_IMAGE = config["OCR"].get("DEFAULT_ENGINE_IMAGE", "auto").lower()
LANG_HINT_HINDI = config["OCR"].get("LANG_HINT_HINDI", "hi")
LANG_HINT_TELUGU = config["OCR"].get("LANG_HINT_TELUGU", "te")
WEIGHT_LENGTH = float(config["OCR"].get("WEIGHT_LENGTH", 0.5))
WEIGHT_ALPHA = float(config["OCR"].get("WEIGHT_ALPHA", 0.3))
WEIGHT_WORDLEN = float(config["OCR"].get("WEIGHT_WORDLEN", 0.2))

# ----------------- 2. Init engines -----------------
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
vision_client = vision.ImageAnnotatorClient()

# ----------------- Utility funcs -----------------
def detect_indic_language(image):
    """Detect if page likely contains Telugu or Hindi (Devanagari)."""
    sample = pytesseract.image_to_string(image, lang="eng")
    if any("\u0C00" <= c <= "\u0C7F" for c in sample):  # Telugu block
        return "telugu"
    if any("\u0900" <= c <= "\u097F" for c in sample):  # Devanagari block
        return "hindi"
    return "none"


def is_blurry(image, threshold=150.0):
    """Check if image is blurry using Laplacian variance."""
    gray = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
    sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()
    return sharpness < threshold, sharpness


# ----------------- OCR Engines -----------------
def ocr_tesseract(image):
    return pytesseract.image_to_string(image, lang="eng")


def ocr_google_vision(image, lang_hint=None):
    """Run OCR with Google Vision API, Windows-safe temp file handling."""
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp:
        temp_path = temp.name
        image.save(temp_path, format="PNG")

    with open(temp_path, "rb") as img_file:
        content = img_file.read()

    try:
        os.remove(temp_path)
    except PermissionError:
        print(f"[WARN] Could not delete temp file (still in use): {temp_path}")

    image_obj = vision.Image(content=content)
    response = vision_client.document_text_detection(
        image=image_obj,
        image_context={"language_hints": [lang_hint]} if lang_hint else None,
    )

    if response.error.message:
        raise RuntimeError(f"Vision API Error: {response.error.message}")

    return response.full_text_annotation.text


# ----------------- Confidence Scoring -----------------
def compute_confidence(text):
    words = text.split()
    length = len(text)
    alpha_ratio = sum(c.isalpha() for c in text) / max(1, len(text))
    avg_wordlen = sum(len(w) for w in words) / max(1, len(words))
    score = (WEIGHT_LENGTH * (length / 1000.0) +
             WEIGHT_ALPHA * alpha_ratio +
             WEIGHT_WORDLEN * avg_wordlen)
    return {
        "confidence_score": round(score, 4),
        "length": length,
        "alpha_ratio": round(alpha_ratio, 4),
        "avg_wordlen": round(avg_wordlen, 4),
    }


# ----------------- PDF to images -----------------
def pdf_to_images(pdf_path):
    doc = fitz.open(pdf_path)
    for i, page in enumerate(doc, start=1):
        pix = page.get_pixmap(dpi=300)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        yield i, img


# ----------------- Page Processor -----------------
def process_page(img, page_id, results, filetype="image"):
    lang_detected = detect_indic_language(img)
    lang_hint = None
    if lang_detected == "hindi":
        lang_hint = LANG_HINT_HINDI
    elif lang_detected == "telugu":
        lang_hint = LANG_HINT_TELUGU

    print(f"[INFO] Page {page_id}: Detected {lang_detected}")

    # 🔍 Blur detection
    if USE_VISION_FOR_BLUR:
        blurry, sharpness = is_blurry(img, BLUR_SHARPNESS_THRESHOLD)
        print(f"[INFO] Page {page_id}: Sharpness={sharpness:.2f} → {'BLURRY' if blurry else 'CLEAR'}")
        if blurry:
            text = ocr_google_vision(img, lang_hint)
            metrics = compute_confidence(text)
            results.append({
                "page": page_id,
                "language_detected": lang_detected,
                "engine": "vision (blur-forced)",
                "sharpness": sharpness,
                "text": text,
                "metrics": metrics,
            })
            return text

    # Indic rerouting
    if USE_VISION_FOR_INDIC and lang_detected in ("hindi", "telugu"):
        text = ocr_google_vision(img, lang_hint)
        metrics = compute_confidence(text)
        results.append({
            "page": page_id,
            "language_detected": lang_detected,
            "engine": "vision (indic-forced)",
            "text": text,
            "metrics": metrics,
        })
        return text

    # Engine routing by config
    engine_choice = DEFAULT_ENGINE_PDF if filetype == "pdf" else DEFAULT_ENGINE_IMAGE
    if engine_choice in ("tesseract", "vision"):
        if engine_choice == "tesseract":
            text = ocr_tesseract(img)
        else:
            text = ocr_google_vision(img, lang_hint)
        metrics = compute_confidence(text)
        results.append({
            "page": page_id,
            "language_detected": lang_detected,
            "engine": engine_choice,
            "text": text,
            "metrics": metrics,
        })
        return text

    # Auto mode → run both
    text_tess = ocr_tesseract(img)
    text_vision = ocr_google_vision(img, lang_hint)

    metrics_tess = compute_confidence(text_tess)
    metrics_vision = compute_confidence(text_vision)

    chosen, final_text, final_metrics = (
        ("tesseract", text_tess, metrics_tess)
        if metrics_tess["confidence_score"] >= metrics_vision["confidence_score"]
        else ("vision", text_vision, metrics_vision)
    )

    results.append({
        "page": page_id,
        "language_detected": lang_detected,
        "tesseract": {"text": text_tess, "metrics": metrics_tess},
        "vision": {"text": text_vision, "metrics": metrics_vision},
        "chosen_engine": chosen,
        "final_text": final_text,
        "final_confidence": final_metrics["confidence_score"],
    })
    return final_text


# ----------------- Adapter -----------------
def ocr_adapter(file_path):
    results, all_text = [], []

    if file_path.lower().endswith(".pdf"):
        for page_num, img in pdf_to_images(file_path):
            page_text = process_page(img, page_num, results, filetype="pdf")
            all_text.append(page_text)
    else:
        img = Image.open(file_path)
        page_text = process_page(img, "image", results, filetype="image")
        all_text.append(page_text)

    output = {
        "file": os.path.basename(file_path),
        "results": results
    }
    with open("ocr_results.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print("[INFO] Saved structured OCR output → ocr_results.json")
    return "\n".join(all_text)


# ----------------- Main -----------------
if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python ocr_adapter_blur.py <file>")
        sys.exit(1)

    file_path = sys.argv[1]
    print(f"[INFO] Processing {file_path}...")
    text = ocr_adapter(file_path)
    print("===== FINAL OCR TEXT =====")
    print(text)
