#!/usr/bin/env python3
"""
OpenViva TOC Extractor (extract_toc.py)
---------------------------------------
Extracts Table of Contents and structured headings from a textbook PDF.

Stage 1: Fast Outline Check via pypdf bookmarks (< 1s execution).
Stage 2: Fallback full layout extraction via MinerU (magic-pdf) if bookmarks are absent.
"""

import os
import sys
import json
import re
import argparse
import subprocess
from pathlib import Path
import pypdf
from pypdf.generic import Destination

def parse_args():
    parser = argparse.ArgumentParser(description="OpenViva Textbook TOC & Heading Extractor")
    parser.add_argument("--pdf_path", type=str, required=True, help="Path to input PDF file (e.g. data/textbook.pdf)")
    parser.add_argument("--output_path", type=str, default="storage/toc_output/extracted_toc.md", help="Destination path for output Markdown TOC")
    parser.add_argument("--sample-pages", type=int, default=None, help="Limit extraction to first N pages")
    return parser.parse_args()

def extract_bookmarks_pypdf(pdf_path: str, sample_pages: int = None):
    """
    Stage 1: Fast bookmark extraction using pypdf.
    Returns list of dicts: [{'level': int, 'title': str, 'page': int}] or [] if empty.
    """
    reader = pypdf.PdfReader(pdf_path)
    if not reader.outline:
        return []

    toc_items = []

    def parse_outline_list(outline_list, depth=1):
        for item in outline_list:
            if isinstance(item, list):
                parse_outline_list(item, depth=depth + 1)
            elif isinstance(item, Destination) or hasattr(item, "title"):
                title = getattr(item, "title", "Untitled Section").strip()
                try:
                    page_num = reader.get_destination_page_number(item) + 1
                except Exception:
                    page_num = 1
                
                if sample_pages is not None and page_num > sample_pages:
                    continue

                toc_items.append({
                    "level": min(depth, 5),
                    "title": title,
                    "page": page_num
                })

    try:
        parse_outline_list(reader.outline)
    except Exception as e:
        print(f"[Warning] Failed to parse embedded bookmarks: {e}", file=sys.stderr)
        return []

    return toc_items

def create_sample_pdf(pdf_path: str, sample_pages: int, output_sample_path: str):
    """Creates a temporary PDF containing only the first N pages."""
    reader = pypdf.PdfReader(pdf_path)
    writer = pypdf.PdfWriter()
    max_pages = min(len(reader.pages), sample_pages)
    for i in range(max_pages):
        writer.add_page(reader.pages[i])
    with open(output_sample_path, "wb") as f:
        writer.write(f)
    return output_sample_path

def extract_fitz_headings(pdf_path: str, sample_pages: int = None):
    """
    Stage 2 (Option B - Full Document Body Scan):
    Scans page-by-page across all pages of the document body to extract 
    inline headings (H1 to H5) with exact navigable page numbers (p. X).
    """
    import fitz
    doc = fitz.open(pdf_path)
    max_pages = min(len(doc), sample_pages) if sample_pages else len(doc)
    
    sec_num_pat = re.compile(r'^(\d+(?:\.\d+)+)$')
    chap_num_pat = re.compile(r'^(?:CHAPTER|Chapter)\s+(\d+)\.?', re.IGNORECASE)

    toc_items = []
    seen = set()

    print(f"[Stage 2 Full Body Scan] Scanning {max_pages} pages for inline headings (H1 to H5)...")

    for p in range(max_pages):
        page = doc[p]
        text = page.get_text()
        
        # Skip front-matter printed TOC pages
        if "CONTENTS" in text[:300].upper() or text.count('. . .') > 3 or text.count('. . . .') > 2:
            continue

        blocks = page.get_text("dict")["blocks"]
        for b in blocks:
            if "lines" not in b:
                continue
            for l_idx, l in enumerate(b["lines"]):
                spans = l["spans"]
                if not spans:
                    continue
                
                line_text = "".join(s["text"] for s in spans).strip()
                if not line_text:
                    continue

                first_span = spans[0]
                font_size = first_span["size"]
                flags = first_span["flags"]
                is_bold = (flags & 2 != 0) or (flags & 16 != 0) or ("bold" in first_span["font"].lower())

                # Section number matching (e.g. "2.1" or "14.2.1")
                m_sec = sec_num_pat.match(line_text)
                if m_sec:
                    sec_num = m_sec.group(1)
                    title = ""
                    if len(spans) > 1:
                        title = "".join(s["text"] for s in spans[1:]).strip()
                    elif l_idx + 1 < len(b["lines"]):
                        next_spans = b["lines"][l_idx + 1]["spans"]
                        title = "".join(s["text"] for s in next_spans).strip()

                    if title and len(title) > 2 and re.match(r'^[A-Z]', title):
                        if font_size >= 11.5 or is_bold:
                            depth = min(sec_num.count('.') + 1, 5)
                            key = f"{sec_num}_{title.lower()}"
                            if key not in seen:
                                seen.add(key)
                                toc_items.append({
                                    "level": depth,
                                    "title": f"{sec_num} {title}",
                                    "page": p + 1
                                })

                # Chapter heading matching
                m_chap = chap_num_pat.match(line_text)
                if m_chap:
                    chap_num = m_chap.group(1)
                    title = ""
                    if len(spans) > 1:
                        title = "".join(s["text"] for s in spans[1:]).strip()
                    elif l_idx + 1 < len(b["lines"]):
                        next_spans = b["lines"][l_idx + 1]["spans"]
                        title = "".join(s["text"] for s in next_spans).strip()
                    
                    if not title and l_idx + 1 < len(b["lines"]):
                        title = "".join(s["text"] for s in b["lines"][l_idx + 1]["spans"]).strip()

                    if title and len(title) > 2:
                        key = f"chap_{chap_num}_{title.lower()}"
                        if key not in seen:
                            seen.add(key)
                            toc_items.append({
                                "level": 1,
                                "title": f"Chapter {chap_num}: {title}",
                                "page": p + 1
                            })

    return toc_items

def main():
    args = parse_args()

    pdf_path = Path(args.pdf_path)
    output_path = Path(args.output_path)

    if not pdf_path.exists():
        print(f"Error: Input PDF file '{pdf_path}' not found.", file=sys.stderr)
        sys.exit(1)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"[*] Starting TOC Extraction for: {pdf_path}")
    if args.sample_pages:
        print(f"[*] Limiting parsing to first {args.sample_pages} pages")

    # Stage 1: Fast Bookmark Check
    print("[*] Stage 1: Checking for embedded PDF bookmarks (pypdf)...")
    toc_items = extract_bookmarks_pypdf(str(pdf_path), sample_pages=args.sample_pages)
    extraction_method = "Fast Embedded Outline (pypdf)"

    # Stage 2: Option B (Full Document Body Scan across all pages)
    if not toc_items:
        print("[*] No embedded bookmarks found. Executing Stage 2: Full Document Body Scan (PyMuPDF)...")
        toc_items = extract_fitz_headings(str(pdf_path), sample_pages=args.sample_pages)
        extraction_method = "Full Document Body Scan (PyMuPDF)"

    if not toc_items:
        print("[Error] Failed to extract any Table of Contents items.", file=sys.stderr)
        sys.exit(1)

    # Format Markdown Output
    md_lines = ["# Table of Contents\n"]
    top_level_count = 0
    sub_section_count = 0

    for item in toc_items:
        level = item["level"]
        title = item["title"]
        page = item["page"]

        prefix = "#" * level
        page_str = f" (p. {page})" if page else ""
        md_lines.append(f"{prefix} {title}{page_str}")

        if level == 1:
            top_level_count += 1
        else:
            sub_section_count += 1

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines) + "\n")

    # Summary Report
    print("\n" + "=" * 50)
    print("      OpenViva TOC Extraction Summary")
    print("=" * 50)
    print(f" Extraction Method : {extraction_method}")
    print(f" Top-Level Chapters: {top_level_count}")
    print(f" Sub-sections      : {sub_section_count}")
    print(f" Total Headings    : {top_level_count + sub_section_count}")
    print(f" Output File       : {output_path.resolve()}")
    print("=" * 50 + "\n")

if __name__ == "__main__":
    main()
