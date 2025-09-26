from __future__ import annotations
from dataclasses import dataclass
from typing import List, Dict, Any


@dataclass
class SplitterConfig:
    chunk_size: int = 1200
    chunk_overlap: int = 200
    separators: List[str] | None = None


@dataclass
class Chunk:
    text: str
    metadata: Dict[str, Any]


@dataclass
class PipelineInput:
    input_path: str
    output_path: str | None
    config: SplitterConfig


@dataclass
class PipelineOutput:
    output_path: str
    chunks: List[Chunk]
