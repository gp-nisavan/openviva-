#!/usr/bin/env python3
"""
OpenViva Viva Question Bank & Rubric Generator (generate_rubric.py)
---------------------------------------------------------------------
Parses extracted textbook TOC markdown, filters by target chapters, and uses 
a local/remote vLLM endpoint (OpenAI API compatible) to generate a structured 
question bank JSON and an examiner system prompt.
"""

import os
import sys
import json
import re
import argparse
from pathlib import Path
from typing import List
import openai
from pydantic import BaseModel, Field

# Pydantic v2 Models
class QuestionBankItem(BaseModel):
    id: int = Field(description="Unique incremental ID for the question item")
    chapter: str = Field(description="Chapter title or number, e.g., 'Chapter 5'")
    topic_title: str = Field(description="Topic title from the textbook section")
    seed_question: str = Field(description="Broad, conceptual icebreaker question to initiate oral viva examination")
    key_concepts_to_probe: List[str] = Field(description="2 to 4 key terms, principles, or mechanisms to probe during viva")

class VivaQuestionBank(BaseModel):
    course_title: str = Field(description="Title of the course or subject area")
    selected_chapters: List[str] = Field(description="List of selected chapter numbers/titles")
    total_questions: int = Field(description="Total number of generated viva questions")
    questions: List[QuestionBankItem] = Field(description="List of structured question bank items")

def parse_args():
    parser = argparse.ArgumentParser(description="OpenViva Question Bank & Rubric Generator")
    parser.add_argument("--toc_path", type=str, default="storage/toc_output/extracted_toc.md", help="Path to extracted TOC markdown")
    parser.add_argument("--output_path", type=str, default="storage/toc_output/question_bank.json", help="Destination path for output JSON question bank")
    parser.add_argument("--chapters", type=str, default=None, help="Comma-separated list of chapters to include (e.g. '5,10')")
    parser.add_argument("--model_url", type=str, default="http://10.10.16.13:8000/v1", help="vLLM OpenAI API base URL")
    parser.add_argument("--model_name", type=str, default="thesven/Phi-3.5-mini-instruct-awq", help="vLLM model identifier")
    parser.add_argument("--count", type=int, default=30, help="Target number of viva questions to generate")
    return parser.parse_args()

def parse_and_filter_toc(toc_path: Path, requested_chapters: List[str]) -> str:
    """Parses extracted_toc.md and filters content for the requested chapters."""
    if not toc_path.exists():
        raise FileNotFoundError(f"TOC file not found: {toc_path}")

    with open(toc_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    if not requested_chapters:
        return "".join(lines)

    req_set = set(c.strip() for c in requested_chapters if c.strip())
    filtered_lines = []
    current_chap_active = False

    chap_header_pat = re.compile(r"^#\s+Chapter\s+(\d+)[:\s]", re.IGNORECASE)

    for line in lines:
        m = chap_header_pat.match(line.strip())
        if m:
            chap_num = m.group(1)
            if chap_num in req_set:
                current_chap_active = True
                filtered_lines.append(line)
            else:
                current_chap_active = False
        elif current_chap_active:
            filtered_lines.append(line)

    if not filtered_lines:
        print(f"[Warning] No section content found matching chapters: {requested_chapters}. Using full TOC as fallback.")
        return "".join(lines)

    return "".join(filtered_lines)

def generate_viva_system_prompt(question_bank: VivaQuestionBank, prompt_output_path: Path):
    """Generates the viva examiner system prompt file."""
    chaps_str = ", ".join(question_bank.selected_chapters)
    
    prompt_text = f"""# OpenViva Socratic Examiner Agent System Prompt

You are an expert, Socratic academic examiner conducting an oral viva examination for a university course.
Course/Subject: {question_bank.course_title}
Selected Examination Coverage: Chapters {chaps_str}

## Examination Guidelines:
1. **Initiation**: Select 1 question from the target chapter in the Question Bank (`storage/toc_output/question_bank.json`) as your opening icebreaker question.
2. **Socratic Probing**: Listen carefully to the student's explanation. Evaluate whether they hit the required `key_concepts_to_probe`.
3. **Follow-Up**:
   - If the student hits the core concepts, ask a deeper follow-up question connecting to practical applications or edge cases.
   - If the student misses key concepts, guide them with targeted, step-by-step Socratic hints without directly revealing the answer.
4. **Tone**: Professional, encouraging, rigorous, and academic. Do not lecture; keep questions focused and conversational.
5. **Session Duration**: Conduct a 3 to 5 turn interactive dialog per topic before transitioning or evaluating final mastery.
"""

    prompt_output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(prompt_output_path, "w", encoding="utf-8") as f:
        f.write(prompt_text)

    print(f"[*] Generated Viva System Prompt saved to: {prompt_output_path.resolve()}")

def main():
    args = parse_args()
    toc_path = Path(args.toc_path)
    output_path = Path(args.output_path)
    prompt_output_path = output_path.parent / "viva_system_prompt.txt"

    requested_chaps = [c.strip() for c in args.chapters.split(",")] if args.chapters else []

    print(f"[*] Reading TOC from: {toc_path}")
    filtered_toc = parse_and_filter_toc(toc_path, requested_chaps)
    print(f"[*] Filtered TOC content length: {len(filtered_toc)} characters")

    # Construct LLM prompt
    json_schema = VivaQuestionBank.model_json_schema()

    system_prompt = (
        "You are an expert curriculum designer and oral exam rubric creator. "
        "Your task is to convert textbook Table of Contents sections into a structured Viva Question Bank. "
        "For each major topic, generate broad conceptual seed questions suitable for an oral exam icebreaker, "
        "along with 2-4 key concepts that an examiner should probe."
    )

    user_prompt = f"""Generate exactly {args.count} viva exam questions based on the following textbook outline:

--- TEXTBOOK OUTLINE ---
{filtered_toc}
--- END OUTLINE ---

Selected Chapters: {args.chapters if args.chapters else 'All Chapters'}
Target Total Questions: {args.count}

Respond STRICTLY with valid JSON conforming to the following JSON Schema:
{json.dumps(json_schema, indent=2)}
"""

    print(f"[*] Connecting to vLLM endpoint: {args.model_url}")
    print(f"[*] Using model: {args.model_name}")

    client = openai.OpenAI(base_url=args.model_url, api_key="vllm")

    try:
        response = client.chat.completions.create(
            model=args.model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.3,
            max_tokens=4096,
            extra_body={"guided_json": json_schema}
        )

        content = response.choices[0].message.content.strip()

        # Clean JSON markdown fences if present
        if content.startswith("```"):
            content = re.sub(r"^```(?:json)?\n?", "", content)
            content = re.sub(r"\n?```$", "", content)

        # Validate with Pydantic v2
        bank_data = VivaQuestionBank.model_validate_json(content)

    except Exception as e:
        print(f"[Warning] Failed to generate/parse live completion from vLLM ({e}).")
        print("[*] Generating fallback structured Question Bank from extracted TOC...")

        # Fallback question bank generator if vLLM endpoint is unavailable
        items = []
        heading_pat = re.compile(r"^(#{1,5})\s+(?:(\d+(?:\.\d+)*)\s+)?(.+?)(?:\s+\(p\.\s+\d+\))?$", re.MULTILINE)
        matches = heading_pat.findall(filtered_toc)

        item_id = 1
        current_chap = "Chapter 1"
        for match in matches:
            level_hashes, sec_num, title = match
            title = title.strip()
            if title.lower().startswith("chapter"):
                current_chap = title
                continue

            seed_q = f"Can you explain the core intuition and fundamental principles behind {title}?"
            key_terms = [t.strip() for t in title.split() if len(t) > 3][:3]
            if len(key_terms) < 2:
                key_terms = [title, "Mathematical Formulation", "Practical Applications"]

            items.append(QuestionBankItem(
                id=item_id,
                chapter=current_chap,
                topic_title=f"{sec_num + ' ' if sec_num else ''}{title}",
                seed_question=seed_q,
                key_concepts_to_probe=key_terms
            ))
            item_id += 1
            if len(items) >= args.count:
                break

        bank_data = VivaQuestionBank(
            course_title="Deep Learning Viva Defense",
            selected_chapters=requested_chaps if requested_chaps else ["All"],
            total_questions=len(items),
            questions=items
        )

    # Save output JSON
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(bank_data.model_dump_json(indent=2))

    print(f"\n[+] Viva Question Bank successfully saved to: {output_path.resolve()}")
    print(f"[+] Total Questions: {bank_data.total_questions}")

    # Generate Viva System Prompt
    generate_viva_system_prompt(bank_data, prompt_output_path)

if __name__ == "__main__":
    main()
