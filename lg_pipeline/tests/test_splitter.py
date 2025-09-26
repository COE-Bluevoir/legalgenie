import os
import sys
import json
from pathlib import Path
from docx import Document

# Ensure project root is on PYTHONPATH when running pytest
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.graph import build_graph


def test_docx_splitter(tmp_path):
    # Create a sample docx
    p = tmp_path / "sample.docx"
    doc = Document()
    for i in range(10):
        doc.add_paragraph(f"Paragraph {i} - " + ("hello " * 100))
    doc.save(p)

    app = build_graph()
    result = app.invoke({
        "input_path": str(p),
        "output_path": str(tmp_path / "chunks.jsonl"),
        "config": {
            "chunk_size": 200,
            "chunk_overlap": 50,
            "separators": None,
        }
    })

    out = result["output_path"]
    assert os.path.exists(out)

    # Read JSONL lines
    data = []
    with open(out, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                data.append(json.loads(line))

    assert isinstance(data, list) and len(data) > 0
    sample = data[0]
    assert "text" in sample and "metadata" in sample
    assert "source_path" in sample["metadata"]
    assert "chunk_id" in sample["metadata"]
    assert "chunk_id" in sample["metadata"]
