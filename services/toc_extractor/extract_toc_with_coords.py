#!/usr/bin/env python3
"""
OpenViva Coordinate-Preserving Raw Heading & TOC Extractor (extract_toc_with_coords.py)
---------------------------------------------------------------------------------------
Task 2.1a: Document Parsing & Raw Heading/TOC Extraction
- Ingests uploaded PDF documents (using local .venv_mineru).
- Stage 1: Fast PyMuPDF outline check for PDF bookmarks + spatial BBox calculation.
- Stage 2: Robust layout block scanner extracting raw headings, section markers,
           page numbers, and spatial [x0, y0, x1, y1] coordinates.
"""

import os
import sys
import json
import re
import argparse
from pathlib import Path
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
import fitz  # PyMuPDF

class TOCItemSchema(BaseModel):
    id: str = Field(description="Unique identifier for the TOC item")
    title: str = Field(description="Heading or section title")
    section_number: Optional[str] = Field(default="", description="Section number e.g. '5.1.2'")
    level: int = Field(description="Hierarchical level 1-5")
    page: int = Field(description="1-indexed page number")
    bbox: List[float] = Field(description="Bounding box [x0, y0, x1, y1] in points")

class DocumentTOCSchema(BaseModel):
    filename: str = Field(description="PDF filename")
    total_pages: int = Field(description="Total pages in document")
    extraction_mode: str = Field(description="Stage 1 Bookmarks or Stage 2 Layout Block Scan")
    total_items: int = Field(description="Total TOC items extracted")
    items: List[TOCItemSchema] = Field(description="Flat TOC items list with spatial coordinates")

def extract_layout_headings(doc: fitz.Document, sample_pages: Optional[int] = None) -> List[TOCItemSchema]:
    """Stage 2: Scans document layout blocks and text spans to extract raw headings with bounding boxes."""
    max_pages = min(len(doc), sample_pages) if sample_pages else len(doc)
    items: List[TOCItemSchema] = []
    idx = 1
    seen_titles = set()

    sec_num_pat = re.compile(r'^(\d+(?:\.\d+)+)$')
    chap_pat = re.compile(r'^(?:CHAPTER|Chapter)\s+(\d+)[:\s]*(.*)$', re.IGNORECASE)

    for p_idx in range(max_pages):
        page = doc[p_idx]
        page_num = p_idx + 1
        page_text = page.get_text()

        # Skip front-matter contents listing pages with dot leaders
        if "CONTENTS" in page_text[:300].upper() or page_text.count('. . .') > 3 or page_text.count('. . . .') > 2:
            continue

        blocks = page.get_text("dict")["blocks"]
        for b in blocks:
            if "lines" not in b:
                continue

            for l_idx, line in enumerate(b["lines"]):
                spans = line["spans"]
                if not spans:
                    continue

                line_text = "".join(s["text"] for s in spans).strip()
                if not line_text or len(line_text) < 2:
                    continue

                first_span = spans[0]
                flags = first_span["flags"]
                is_bold = (flags & 2 != 0) or (flags & 16 != 0) or ("bold" in first_span["font"].lower())

                # Check for Chapter heading
                m_chap = chap_pat.match(line_text)
                if m_chap:
                    chap_num = m_chap.group(1)
                    rest = m_chap.group(2).strip()
                    # If title continues on the next line
                    full_title = f"Chapter {chap_num}: {rest}" if rest else f"Chapter {chap_num}"
                    if not rest and l_idx + 1 < len(b["lines"]):
                        next_line_text = "".join(s["text"] for s in b["lines"][l_idx + 1]["spans"]).strip()
                        if next_line_text and not chap_pat.match(next_line_text) and not sec_num_pat.match(next_line_text):
                            full_title = f"Chapter {chap_num}: {next_line_text}"

                    bbox = [round(float(c), 2) for c in line["bbox"]]
                    items.append(TOCItemSchema(
                        id=f"raw-toc-{idx}",
                        title=full_title,
                        section_number=chap_num,
                        level=1,
                        page=page_num,
                        bbox=bbox
                    ))
                    idx += 1
                    continue

                # Check for Numbered Section heading: e.g. "1.2 Historical Trends" or standalone "1.2"
                m_sec_inline = re.match(r'^(\d+(?:\.\d+)+)\s+(.+)$', line_text)
                if m_sec_inline:
                    sec_num = m_sec_inline.group(1)
                    sec_title = line_text
                    depth = min(sec_num.count('.') + 1, 5)
                    bbox = [round(float(c), 2) for c in line["bbox"]]

                    items.append(TOCItemSchema(
                        id=f"raw-toc-{idx}",
                        title=sec_title,
                        section_number=sec_num,
                        level=depth,
                        page=page_num,
                        bbox=bbox
                    ))
                    idx += 1
                    continue

                # Check if this line is just section number "2.1" and next line is title "Scalars, Vectors..."
                m_sec_only = sec_num_pat.match(line_text)
                if m_sec_only and is_bold:
                    sec_num = m_sec_only.group(1)
                    title_part = ""
                    if l_idx + 1 < len(b["lines"]):
                        title_part = "".join(s["text"] for s in b["lines"][l_idx + 1]["spans"]).strip()
                    full_title = f"{sec_num} {title_part}" if title_part else sec_num
                    depth = min(sec_num.count('.') + 1, 5)
                    bbox = [round(float(c), 2) for c in line["bbox"]]

                    items.append(TOCItemSchema(
                        id=f"raw-toc-{idx}",
                        title=full_title,
                        section_number=sec_num,
                        level=depth,
                        page=page_num,
                        bbox=bbox
                    ))
                    idx += 1
                    continue

    print(f"[Stage 2 Layout Scan SUCCESS] Extracted {len(items)} raw headings with spatial coordinates.", file=sys.stderr)
    return items

def extract_with_mineru(pdf_path: str, sample_pages: Optional[int] = None) -> DocumentTOCSchema:
    """Runs full MinerU (magic-pdf) neural layout model with DocLayout-YOLO, MFD, and PaddleOCR."""
    import subprocess
    filename = Path(pdf_path).name
    stem = Path(pdf_path).stem
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    doc.close()

    mineru_out_dir = Path("storage/mineru_output")
    mineru_out_dir.mkdir(parents=True, exist_ok=True)

    # Clean previous output for this PDF to prevent any stale cached results
    pdf_out_dir = mineru_out_dir / stem
    if pdf_out_dir.exists():
        import shutil
        shutil.rmtree(pdf_out_dir, ignore_errors=True)

    py_exe = sys.executable
    cmd = [
        py_exe, "-m", "magic_pdf.tools.cli",
        "-p", str(pdf_path),
        "-o", str(mineru_out_dir),
        "-m", "txt"
    ]
    if sample_pages and sample_pages > 0:
        cmd.extend(["-s", "0", "-e", str(sample_pages - 1)])

    print(f"[Full MinerU Pipeline] Executing DocLayout-YOLO + MFD + PaddleOCR for {filename}...", file=sys.stderr)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"MinerU execution failed with exit code {proc.returncode}:\n{proc.stderr}")

    candidates = list(mineru_out_dir.glob(f"**/{stem}_middle.json"))
    if not candidates:
        raise FileNotFoundError(f"MinerU output middle.json not found for {stem}. Details: {proc.stderr}")

    middle_json_path = candidates[0]
    with open(middle_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    items: List[TOCItemSchema] = []
    idx = 1
    seen_titles = set()
    sec_num_pat = re.compile(r'^(\d+(?:\.\d+)*)\s*(.*)$')

    for p_idx, page in enumerate(data.get("pdf_info", [])):
        page_num = p_idx + 1
        for block in page.get("preproc_blocks", []):
            if block.get("type") == "title":
                lines = block.get("lines", [])
                title_parts = []
                for line in lines:
                    line_text = "".join(s.get("content", "") for s in line.get("spans", [])).strip()
                    if line_text:
                        title_parts.append(line_text)
                title = " ".join(title_parts).strip()
                if not title or len(title) < 2 or title in seen_titles:
                    continue
                seen_titles.add(title)

                raw_bbox = block.get("bbox", [0.0, 0.0, 0.0, 0.0])
                bbox = [round(float(c), 2) for c in raw_bbox]

                sec_num = ""
                level = 1
                m = sec_num_pat.match(title)
                if m and m.group(1):
                    sec_num = m.group(1)
                    level = min(sec_num.count('.') + 1, 5)

                items.append(TOCItemSchema(
                    id=f"mineru-toc-{idx}",
                    title=title,
                    section_number=sec_num,
                    level=level,
                    page=page_num,
                    bbox=bbox
                ))
                idx += 1

    print(f"[MinerU SUCCESS] Extracted {len(items)} neural title candidates with spatial bounding boxes.", file=sys.stderr)
    return DocumentTOCSchema(
        filename=filename,
        total_pages=total_pages,
        extraction_mode="Full MinerU (DocLayout-YOLO + MFD + PaddleOCR)",
        total_items=len(items),
        items=items
    )

def extract_toc_with_coordinates(pdf_path: str, force_layout_scan: bool = False, sample_pages: Optional[int] = None, use_mineru: bool = True) -> DocumentTOCSchema:
    if use_mineru:
        # Strictly run MinerU with zero fallback
        return extract_with_mineru(pdf_path, sample_pages)

    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    filename = Path(pdf_path).name

    print(f"\n[Stage 1 PyMuPDF] Checking outline bookmarks for file: {filename} ({total_pages} pages)...", file=sys.stderr)
    toc_raw = doc.get_toc() if not force_layout_scan else []
    items: List[TOCItemSchema] = []

    if toc_raw:
        print(f"[Stage 1 PyMuPDF SUCCESS] Found {len(toc_raw)} embedded outline bookmarks!", file=sys.stderr)
        mode = "Stage 1 (PyMuPDF Bookmark Extraction + Spatial BBox Search)"
        for idx, item in enumerate(toc_raw):
            level, title, page = item[:3]
            title_clean = title.strip()
            if sample_pages and page > sample_pages:
                continue

            sec_num = ""
            m_sec = re.match(r'^(\d+(?:\.\d+)*)\s+(.+)$', title_clean)
            if m_sec:
                sec_num = m_sec.group(1)

            bbox = [0.0, 0.0, 0.0, 0.0]
            if 1 <= page <= total_pages:
                page_obj = doc[page - 1]
                rects = page_obj.search_for(title_clean)
                if not rects and m_sec:
                    rects = page_obj.search_for(m_sec.group(2))
                if not rects:
                    words = title_clean.split()[:4]
                    if len(words) > 1:
                        rects = page_obj.search_for(" ".join(words))

                if rects:
                    r = rects[0]
                    bbox = [round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2)]

            items.append(TOCItemSchema(
                id=f"raw-toc-{idx+1}",
                title=title_clean,
                section_number=sec_num,
                level=min(max(level, 1), 5),
                page=page,
                bbox=bbox
            ))
    else:
        print(f"[Stage 1 PyMuPDF FAILED] No bookmarks found in {filename} metadata.", file=sys.stderr)
        print(f"[Escalating Pipeline] Executing Stage 2 Layout Block Scan with Spatial BBoxes...", file=sys.stderr)
        mode = "Stage 2 (Layout Block Scan with Spatial BBox Coordinates)"
        items = extract_layout_headings(doc, sample_pages)

    return DocumentTOCSchema(
        filename=filename,
        total_pages=total_pages,
        extraction_mode=mode,
        total_items=len(items),
        items=items
    )

def main():
    parser = argparse.ArgumentParser(description="Extract Raw TOC with Spatial Coordinates [x0, y0, x1, y1]")
    parser.add_argument("--pdf_path", type=str, required=True, help="Path to input PDF file")
    parser.add_argument("--output_path", type=str, default=None, help="Optional output path for JSON")
    parser.add_argument("--force_layout_scan", action="store_true", help="Force Stage 2 layout scan")
    parser.add_argument("--sample_pages", type=int, default=None, help="Sample N pages max")
    parser.add_argument("--use_mineru", action="store_true", default=True, help="Use full MinerU neural engine")
    parser.add_argument("--no_mineru", action="store_false", dest="use_mineru", help="Disable MinerU, use PyMuPDF")
    args = parser.parse_args()

    result = extract_toc_with_coordinates(args.pdf_path, args.force_layout_scan, args.sample_pages, args.use_mineru)

    json_str = result.model_dump_json(indent=2)
    if args.output_path:
        out_p = Path(args.output_path)
        out_p.parent.mkdir(parents=True, exist_ok=True)
        with open(out_p, "w", encoding="utf-8") as f:
            f.write(json_str)
        print(f"[+] Saved raw coordinate-preserving TOC to: {out_p.resolve()}", file=sys.stderr)
    print(json_str)

if __name__ == "__main__":
    main()
