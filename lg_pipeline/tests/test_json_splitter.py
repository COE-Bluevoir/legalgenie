import json
import os
from app.graph import build_json_graph


def test_json_splitter(tmp_path):
    data = {
        "results": [
            {"id": "a", "doc": "hello " * 500},
            {"id": "b", "doc": "world " * 300},
            {"id": "c", "doc": ""},
        ]
    }

    p = tmp_path / "raw_cases.json"
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f)

    app = build_json_graph()
    result = app.invoke({
        "input_path": str(p),
        "output_path": str(tmp_path / "chunks.jsonl"),
        "config": {
            "chunk_size": 1000,
            "chunk_overlap": 200,
            "separators": None,
        },
    })

    out = result["output_path"]
    assert os.path.exists(out)
    # Read JSONL lines
    chunks = []
    with open(out, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                chunks.append(json.loads(line))

    assert isinstance(chunks, list)
    assert any(c["case_id"] == "a" for c in chunks)
    assert any(c["case_id"] == "b" for c in chunks)
    # ensure no entry for empty doc
    assert not any(c.get("case_id") == "c" for c in chunks)
