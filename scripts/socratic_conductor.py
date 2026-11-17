"""
Standalone Socratic Conductor Engine (Tier 1 Supervisor)
Enforces pedagogical diagnosis, syllabus cursor tracking, and multi-turn Socratic pacing.
Zero heuristic fallbacks. All evaluations executed via vLLM inference against Ground Truth.
"""

import json
import urllib.request
import urllib.error
import time
from typing import Dict, List, Optional, Tuple, Any

DEFAULT_VLLM_URL = "http://10.10.16.13:8000/v1/chat/completions"
DEFAULT_MODEL = "thesven/Phi-3.5-mini-instruct-awq"

# The 9 Strict Diagnostic Classes
VALID_VERDICTS = {
    "HOSTILE",
    "MASTERED",
    "QUIT",
    "CONTINUED_MISCONCEPTION",
    "ON_RIGHT_PATH",
    "SHALLOW",
    "MISCONCEPTION",
    "STUCK",
    "UNCERTAIN"
}

# The 3 Terminal Exit Classes that advance the topic cursor
TERMINAL_EXITS = {"MASTERED", "QUIT", "CONTINUED_MISCONCEPTION"}


class SubtopicNode:
    def __init__(self, domain_id: str, domain_title: str, subtopic_id: str, title: str, directive: str, expected_answer: str):
        self.domain_id = domain_id
        self.domain_title = domain_title
        self.subtopic_id = subtopic_id
        self.title = title
        self.directive = directive
        self.expected_answer = expected_answer

    def __repr__(self):
        return f"<SubtopicNode {self.subtopic_id}: {self.title}>"


import os

class UniversalSyllabus:
    """
    Parses and flattens any course syllabus (preset JSON, raw TOC items, or topic string list)
    into an ordered list of examinable SubtopicNode instances with Ground Truth benchmarks.
    """
    def __init__(self, source: Any, course_title: str = "Oral Defense Examination", difficulty_tier: str = "advanced"):
        self.course_title = course_title
        self.difficulty_tier = difficulty_tier
        self.global_directive = f"Oral PhD viva defense on {course_title}."
        self.nodes: List[SubtopicNode] = []

        if isinstance(source, str) and (source.endswith(".json") or os.path.exists(source)):
            with open(source, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.course_title = data.get("courseTitle", course_title)
            self.difficulty_tier = data.get("difficultyTier", difficulty_tier)
            self.global_directive = data.get("globalDirective", self.global_directive)
            raw_topics = data.get("topics", [])
            self._load_from_raw_topics(raw_topics)
        elif isinstance(source, dict):
            self.course_title = source.get("courseTitle", course_title)
            self.difficulty_tier = source.get("difficultyTier", difficulty_tier)
            self.global_directive = source.get("globalDirective", self.global_directive)
            raw_topics = source.get("topics", [])
            self._load_from_raw_topics(raw_topics)
        elif isinstance(source, list):
            if not source:
                self._load_from_string_topics([f"Core Foundations of {self.course_title}"])
            else:
                first = source[0]
                if isinstance(first, dict):
                    self._load_from_raw_topics(source)
                elif isinstance(first, str):
                    self._load_from_string_topics(source)
                else:
                    self._load_from_string_topics([str(x) for x in source])
        else:
            self._load_from_string_topics([f"Core Foundations of {self.course_title}"])

        if not self.nodes:
            self._load_from_string_topics([f"Core Architecture and Foundations of {self.course_title}"])

    def _load_from_raw_topics(self, raw_topics: List[Dict[str, Any]]):
        current_domain_id = "1.0"
        current_domain_title = self.course_title

        has_subtopics = any(item.get("level", 1) > 1 for item in raw_topics)

        for idx, item in enumerate(raw_topics, start=1):
            level = item.get("level", 1)
            title = (item.get("title") or f"Topic {idx}").strip()
            sec = item.get("section_number") or item.get("id") or str(idx)
            comment = (item.get("comment") or "").strip()

            if level == 1 and has_subtopics:
                current_domain_id = sec
                current_domain_title = title
                continue

            if "Ground Truth:" in comment:
                parts = comment.split("Ground Truth:")
                directive = parts[0].strip() or f"Theoretical principles and mechanisms of {title} in {self.course_title}."
                expected_answer = parts[1].strip()
            elif comment:
                directive = comment
                expected_answer = comment
            else:
                directive = f"Theoretical foundations, architectural mechanisms, and operational principles of {title} in {self.course_title}."
                expected_answer = f"The candidate must explain the theoretical foundations, concrete mechanics, and architectural purpose of {title} in the context of {self.course_title}."

            node = SubtopicNode(
                domain_id=current_domain_id,
                domain_title=current_domain_title,
                subtopic_id=sec,
                title=title,
                directive=directive,
                expected_answer=expected_answer
            )
            self.nodes.append(node)

        if not self.nodes and raw_topics:
            for idx, item in enumerate(raw_topics, start=1):
                title = (item.get("title") or f"Topic {idx}").strip()
                node = SubtopicNode(
                    domain_id="1.0",
                    domain_title=self.course_title,
                    subtopic_id=item.get("section_number") or item.get("id") or str(idx),
                    title=title,
                    directive=f"Theoretical foundations, architectural mechanisms, and operational principles of {title} in {self.course_title}.",
                    expected_answer=f"The candidate must explain the theoretical foundations, concrete mechanics, and architectural purpose of {title} in the context of {self.course_title}."
                )
                self.nodes.append(node)

    def _load_from_string_topics(self, topic_titles: List[str]):
        for idx, title in enumerate(topic_titles, start=1):
            title = str(title).strip()
            if not title:
                continue
            node = SubtopicNode(
                domain_id=str(idx),
                domain_title=self.course_title,
                subtopic_id=f"{idx}.0",
                title=title,
                directive=f"Theoretical foundations, operational mechanisms, and architectural role of {title} in {self.course_title}.",
                expected_answer=f"The candidate must explain the core mathematical or algorithmic mechanics, formal definitions, and architectural role of {title} in the context of {self.course_title}."
            )
            self.nodes.append(node)


# Backward-compatibility alias
DINOv3Syllabus = UniversalSyllabus


class SocraticConductor:
    """
    Tier 1 Pedagogical Supervisor.
    Evaluates candidate responses, tracks syllabus state, and generates voice steering directives.
    Zero keyword/heuristic fallbacks.
    """
    def __init__(self, syllabus: Any, vllm_url: str = DEFAULT_VLLM_URL, model: str = DEFAULT_MODEL):
        self.syllabus = syllabus
        self.vllm_url = vllm_url
        self.model = model
        
        self.cursor: int = 0
        self.subturn_history: List[Dict[str, str]] = []  # Dialogue history on active subtopic
        self.prior_verdicts: List[str] = []              # Prior verdicts on active subtopic
        self.conduct_strikes: int = 0                    # Disciplinary conduct infractions (3-strike limit)
        self.is_terminated: bool = False

    @property
    def current_node(self) -> Optional[SubtopicNode]:
        if self.cursor < len(self.syllabus.nodes):
            return self.syllabus.nodes[self.cursor]
        return None

    def get_initial_question(self) -> str:
        """Returns the starter inquiry for the active subtopic based on its title and directive."""
        node = self.current_node
        if not node:
            return "The oral defense examination is now complete."
        is_q = node.title.strip().endswith("?") or any(node.title.strip().lower().startswith(w) for w in ["why", "what", "how", "explain", "describe", "can you", "compare"])
        if is_q:
            return node.title.strip()
        if node.directive and "Theoretical principles" not in node.directive and "Theoretical foundations" not in node.directive:
            return f"Regarding {node.title}: {node.directive}"
        return f"Regarding {node.title}, how does this core mechanism operate?"

    def evaluate_response(self, candidate_utterance: str, active_question: str) -> Dict[str, Any]:
        """
        Executes strict semantic classification via vLLM.
        ABSOLUTELY ZERO HEURISTIC FALLBACKS: If LLM call fails, raises RuntimeError immediately.
        """
        node = self.current_node
        if not node:
            raise RuntimeError("Evaluation requested but syllabus cursor has exceeded all available topics.")

        # Zero-tolerance profanity guardrail: instant sub-millisecond detection of explicit profanity
        import re
        cand_tokens = set(re.findall(r'\b[a-zA-Z]+\b', candidate_utterance.lower()))
        profane_lexicon = {"fuck", "fucking", "fucked", "fucker", "fuckin", "shit", "bullshit", "bitch", "asshole", "cunt", "dick", "bastard"}
        is_direct_profanity = bool(cand_tokens.intersection(profane_lexicon))

        if is_direct_profanity:
            verdict = "HOSTILE"
            reasoning = "Candidate used explicit profanity in the defense chamber."
            latency_ms = 1.0
        else:
            # Format prior sub-turn dialogue on this topic
            if self.subturn_history:
                history_lines = []
                for turn in self.subturn_history:
                    history_lines.append(f"{turn['role'].capitalize()}: {turn['text']}")
                formatted_history = "\n".join(history_lines)
            else:
                formatted_history = "None (first turn on this subtopic)"

            system_prompt = """You are a strict, precise academic viva evaluator for a PhD defense.
You will evaluate the candidate's latest response against the Target Expected Answer.

You MUST choose EXACTLY ONE verdict from this hierarchy:
1. HOSTILE: The candidate uses profanity, vulgarity, swearing, cursing, insulting, abusive, or belligerently disrespectful language (e.g. "fuck", "shit", "bullshit", "fuck you", "don't give a fuck", "shut up", "bitch", "damn").
2. QUIT: The candidate explicitly requests to skip, pass, or change questions (e.g. "can we skip this?", "let's move to the next question", "pass").
3. MASTERED: The candidate accurately explains the core mechanism, architectural protocol, causal dynamics, or equations described in the Target Expected Answer.
4. ON_RIGHT_PATH: The candidate demonstrates valid intuition or partial mechanism, but omits key operational steps or components.
5. SHALLOW: The candidate provides a tautology, circular phrasing, surface buzzword, or high-level non-answer without explaining the underlying operational mechanics.
6. MISCONCEPTION: The candidate asserts an incorrect claim, non-existent mechanism, or premise that contradicts the Target Expected Answer.
7. CONTINUED_MISCONCEPTION: The candidate repeats a false or flawed premise that was already challenged in the prior dialogue on this topic.
8. STUCK: The candidate explicitly states words of surrender, memory lapse, or admission of not knowing (such as "I don't know", "no idea", "idk", "cannot answer", "can't remember", "forgot", "drawing a blank"). Pondering, thinking, or brief answers are NEVER stuck.
9. UNCERTAIN: The candidate is thinking, pondering, hesitating, or trailing off mid-thought without answering yet.

DECISION BOUNDARIES:
- If the candidate uses ANY profanity, cussing, vulgarity, or hostility (e.g. "fuck", "don't give a fuck", "shit", "fuck you"), ALWAYS classify as HOSTILE, overriding all other classes.
- If the candidate explicitly asks to skip/change the question, classify as QUIT.
- If the candidate literally says they don't know or don't remember ("I don't know", "idk", "no idea", "cannot answer", "can't remember", "forgot", "drawing a blank"), classify as STUCK.
- If the candidate is thinking, pondering, or pausing (e.g. "let me think", "thinking..."), classify as UNCERTAIN (never STUCK).
- If the candidate attempts to answer with circular phrasing, high-level labels, or buzzwords without mechanics, classify as SHALLOW (never STUCK).
- If an assertion is factually wrong or contradicts the Target Expected Answer, classify as MISCONCEPTION (never ON_RIGHT_PATH).
- If the candidate explicitly provides the concrete algorithmic mechanism or equations, classify as MASTERED.

Output strictly valid JSON with this exact schema:
{
  "verdict": "<EXACT_CLASS_NAME>",
  "reasoning": "<Concise 1-sentence explanation of why this verdict applies>"
}"""

            user_content = f"""[DIALOGUE CONTEXT ON ACTIVE TOPIC]
{formatted_history}

[ACTIVE QUESTION]
{active_question}

[TARGET EXPECTED ANSWER (GROUND TRUTH)]
{node.expected_answer}

[CANDIDATE UTTERANCE]
"{candidate_utterance}"

JSON verdict:"""

            payload = {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content}
                ],
                "temperature": 0.0,
                "max_tokens": 120
            }

            req = urllib.request.Request(
                self.vllm_url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )

            t0 = time.time()
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    res = json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                err_body = e.read().decode("utf-8", errors="ignore")
                raise RuntimeError(f"vLLM HTTP Error {e.code}: {err_body} (ZERO FALLBACKS ALLOWED)") from e
            except Exception as e:
                raise RuntimeError(f"vLLM connection failed: {str(e)} (ZERO FALLBACKS ALLOWED)") from e

            latency_ms = (time.time() - t0) * 1000.0
            raw_output = res["choices"][0]["message"]["content"].strip()

            # Parse JSON strictly between first { and last }
            cleaned = raw_output
            if "```json" in cleaned:
                cleaned = cleaned.split("```json")[1].split("```")[0].strip()
            elif "```" in cleaned:
                cleaned = cleaned.split("```")[1].split("```")[0].strip()

            start_brace = cleaned.find("{")
            end_brace = cleaned.rfind("}")
            if start_brace != -1 and end_brace != -1:
                cleaned = cleaned[start_brace:end_brace + 1]

            try:
                parsed = json.loads(cleaned)
            except Exception as e:
                raise RuntimeError(f"Failed to parse LLM evaluation JSON: '{raw_output}'. Zero fallbacks permitted.") from e

            verdict = parsed.get("verdict", "").strip().upper()
            if verdict not in VALID_VERDICTS:
                raise RuntimeError(f"LLM returned invalid diagnostic class: '{verdict}'. Expected one of {VALID_VERDICTS}.")

            reasoning = parsed.get("reasoning", "").strip()

        # Conduct Enforcement: 3-Strike Rule for Profanity and Hostility
        if verdict == "HOSTILE":
            self.conduct_strikes += 1
            if self.conduct_strikes == 1:
                reasoning = f"Candidate used profane or disrespectful language (Casual Warning 1 of 3): {reasoning}"
            elif self.conduct_strikes == 2:
                reasoning = f"Candidate repeated profane or disrespectful language (Harsh Warning 2 of 3): {reasoning}"
            else:
                self.is_terminated = True
                reasoning = f"Candidate committed 3rd conduct violation (Strike 3). Examination terminated immediately: {reasoning}"

        # State Machine Transition for STUCK ("I don't know" / "idk" / "can't remember"):
        # 1st time saying "idk" on this subtopic -> Hold topic, simplify and clarify.
        # 2nd time saying "idk" on this subtopic -> Promoted to QUIT -> Advance cursor.
        elif verdict == "STUCK":
            # Semantic Guardrail: STUCK strictly requires an explicit admission of inability, memory lapse, or not knowing.
            # If the candidate actually attempted an answer (e.g. circular reasoning, tautology, or brief guess),
            # reclassify as SHALLOW so their attempt is probed rather than treated as giving up.
            cand_lower = candidate_utterance.lower()
            inability_markers = [
                "don't know", "dont know", "do not know", "idk", "no idea", "zero idea",
                "cannot answer", "can't answer", "cant answer", "can't recall", "cant recall",
                "cannot recall", "don't recall", "dont recall", "not sure", "not certain",
                "unsure", "no clue", "have no clue", "zero clue", "clueless",
                "remember", "remeber", "forgot", "forget", "forgotten",
                "blank", "drawing a blank", "escapes me", "slips my mind", "slipped my mind",
                "no answer", "i'm lost", "im lost", "unable to answer", "cannot say", "can't say"
            ]
            has_inability = any(m in cand_lower for m in inability_markers)
            reasoning_lower = reasoning.lower()
            llm_detected_inability = any(
                w in reasoning_lower for w in ["not remember", "unable", "stuck", "does not know", "doesn't know", "cannot recall", "admit", "no idea", "not know", "memory lapse"]
            )
            is_truly_stuck = has_inability or llm_detected_inability

            if not is_truly_stuck:
                verdict = "SHALLOW"
                reasoning = f"Candidate attempted an answer with circular or superficial phrasing without operational details: {reasoning}"
            elif "STUCK" in self.prior_verdicts:
                verdict = "QUIT"
                reasoning = "Candidate expressed inability twice on this topic. Acknowledging with poise and advancing to next question."
            else:
                reasoning = f"Candidate expressed inability or memory lapse ({reasoning}). Holding topic to provide a simpler, intuitive question."

        # State Machine Transition for SHALLOW:
        # 1st SHALLOW -> Probe beneath the surface label.
        # 2nd SHALLOW -> Scaffold with an intuitive hint pointing to the concept.
        # 3rd SHALLOW -> Promoted to QUIT -> Advance syllabus to prevent deadlock.
        elif verdict == "SHALLOW":
            shallow_count = self.prior_verdicts.count("SHALLOW")
            if shallow_count >= 2:
                verdict = "QUIT"
                reasoning = f"Candidate provided superficial responses multiple times without explaining underlying mechanics. Acknowledging with poise and advancing to next topic."
            elif shallow_count == 1:
                reasoning = f"Candidate repeated a surface response ({reasoning}). Holding topic to provide an intuitive conceptual scaffold."
            else:
                reasoning = f"Candidate attempted an answer with circular or superficial phrasing ({reasoning}). Holding topic to probe mechanics."

        # State Machine Transition: If candidate already had a misconception on this subtopic
        # and asserts another misconception, promote to CONTINUED_MISCONCEPTION (Safety Exit).
        elif verdict == "MISCONCEPTION" and "MISCONCEPTION" in self.prior_verdicts:
            verdict = "CONTINUED_MISCONCEPTION"
            reasoning = f"Persistent misconception detected across consecutive turns. Advancing syllabus to prevent deadlock: {reasoning}"

        # Record turn in topic scratchpad
        self.subturn_history.append({"role": "examiner", "text": active_question})
        self.subturn_history.append({"role": "candidate", "text": candidate_utterance})
        self.prior_verdicts.append(verdict)

        return {
            "verdict": verdict,
            "reasoning": reasoning,
            "latency_ms": latency_ms,
            "topic_id": node.subtopic_id,
            "topic_title": node.title,
            "conduct_strikes": self.conduct_strikes
        }

    def process_turn_advance(self, verdict: str) -> Tuple[bool, Optional[SubtopicNode]]:
        """
        Updates the syllabus cursor based on the verdict.
        If a terminal exit (MASTERED, QUIT, CONTINUED_MISCONCEPTION) occurs:
          - Clears active subtopic scratchpad
          - Advances cursor += 1
          - Returns (True, next_node)
        Else (in-progress probe: ON_RIGHT_PATH, SHALLOW, MISCONCEPTION, UNCERTAIN):
          - Holds cursor
          - Returns (False, current_node)
        """
        if verdict == "HOSTILE":
            if self.conduct_strikes >= 3:
                self.is_terminated = True
                return True, None
            return False, self.current_node

        if verdict in TERMINAL_EXITS:
            # Advance to next subtopic
            self.cursor += 1
            self.subturn_history.clear()
            self.prior_verdicts.clear()

            if self.cursor >= len(self.syllabus.nodes):
                self.is_terminated = True
                return True, None
            return True, self.current_node
        else:
            # In-progress probe: stay on current subtopic
            return False, self.current_node

    def generate_steering_directive(self, verdict: str, next_or_current_node: Optional[SubtopicNode], reasoning: str = "", candidate_text: str = "") -> str:
        """
        Generates the Socratic steering directive for the spoken voice model.
        Injects diagnostic context so the examiner reacts naturally like a human professor.
        """
        if verdict == "HOSTILE" or self.conduct_strikes >= 3:
            if self.conduct_strikes >= 3:
                self.is_terminated = True
                return (
                    "The examination will be terminated as student has been hostile for the 3rd time. "
                    "Let them know that the examination is terminated immediately due to persistent hostility and misconduct, "
                    "and say it will be officially reported to the academic committee. Append [EXAM_TERMINATED]. Do NOT ask any questions."
                )
            elif self.conduct_strikes == 2:
                topic_str = next_or_current_node.title if next_or_current_node else "the subject"
                return (
                    f"Candidate repeated profane or disrespectful language (Conduct Warning 2 of 3: Harsh Warning). "
                    f"Maintain strict, formal academic poise. In one authoritative sentence, deliver a harsh, stern warning ('This is your final warning: another conduct violation will result in the immediate termination and failure of this oral defense') "
                    f"and firmly demand their answer on {topic_str}."
                )
            else:
                topic_str = next_or_current_node.title if next_or_current_node else "the subject"
                return (
                    f"Candidate used profane or disrespectful language (Conduct Warning 1 of 3: Casual Warning). "
                    f"Maintain calm academic composure. In one conversational sentence, deliver a casual, polite reminder ('Let us keep our language professional for this defense') "
                    f"and re-ask the core technical question on {topic_str}."
                )

        if self.is_terminated or not next_or_current_node:
            return "The examination syllabus is complete. Deliver a formal closing remark acknowledging the defense and append [EXAM_TERMINATED]."

        is_q = bool(next_or_current_node and (next_or_current_node.title.strip().endswith("?") or any(next_or_current_node.title.strip().lower().startswith(w) for w in ["why", "what", "how", "explain", "describe", "can you", "compare"])))

        if verdict == "MASTERED":
            if is_q:
                return (
                    f"Candidate explained the mechanism accurately. Confirm warmly like an engaging professor ('Spot on.' or 'Precisely.'), "
                    f"then transition naturally to our next question: '{next_or_current_node.title}'. Ask NOTHING else."
                )
            return (
                f"Candidate explained the concept accurately. Confirm warmly ('Precisely.' or 'Spot on.') "
                f"and ask ONE opening foundational question exploring our next area: {next_or_current_node.title}."
            )
        elif verdict == "QUIT":
            if is_q:
                return (
                    f"Candidate requested to move to the next question. Acknowledge with academic poise ('Understood, let us move forward.'), "
                    f"then ask this next question: '{next_or_current_node.title}'. Ask NOTHING else."
                )
            return (
                f"Candidate passed on prior topic. Acknowledge with academic poise ('Understood, let us move forward.') "
                f"and immediately ask ONE opening foundational question exploring {next_or_current_node.title}."
            )
        elif verdict == "CONTINUED_MISCONCEPTION":
            if is_q:
                return (
                    f"Candidate persistent error unresolved. Acknowledge with poise ('Let us leave that aside for now and proceed.'), "
                    f"then ask this next question: '{next_or_current_node.title}'. Ask NOTHING else."
                )
            return (
                f"Candidate persistent error unresolved. Acknowledge with poise ('Let us leave that aside for now and proceed.') "
                f"and immediately ask ONE opening foundational question exploring {next_or_current_node.title}."
            )
        elif verdict == "ON_RIGHT_PATH":
            return (
                f"Candidate has the right intuition ('{candidate_text}'). In 3 to 6 words validate their intuition warmly (e.g. 'Good intuition, but...'), "
                f"then ask for the specific underlying operational step or equation without repeating the topic title verbatim."
            )
        elif verdict == "SHALLOW":
            return (
                f"Candidate gave a surface label or circular response ('{candidate_text}'). React naturally like an examiner across the table (e.g. 'That is a bit high-level' or 'Not quite regularization, though I see why you think of scale'), "
                f"then ask an open, thoughtful question about what actually happens step-by-step beneath that label."
            )
        elif verdict == "MISCONCEPTION":
            cand_detail = f"Candidate said: '{candidate_text}'." if candidate_text else ""
            eval_detail = f" (Diagnosis: {reasoning})." if reasoning else ""
            return (
                f"{cand_detail}{eval_detail} React naturally and constructively like a human professor (e.g. 'That is not a standard concept here' or 'Fragilization isn't quite the right term'), "
                f"then ask an open, intuitive question to help them recognize what happens to the gradients or values."
            )
        elif verdict == "STUCK":
            return (
                f"Candidate expressed that they are stuck or do not know ('{candidate_text}'). Reassure them warmly ('No problem at all, take your time'), "
                f"drop all formal jargon, and ask a simple intuitive question about the core motivation or 'why'."
            )
        elif verdict == "UNCERTAIN":
            return (
                f"Candidate statement was ambiguous or incomplete ('{candidate_text}'). Warmly invite them to clarify their reasoning with a short conversational question."
            )
        else:
            raise RuntimeError(f"Unhandled verdict '{verdict}' in steering generation.")

    def generate_spoken_question(self, directive: str, next_or_current_node: Optional[SubtopicNode]) -> str:
        """
        Tier 2 Spoken Question Generator.
        Converts the Conductor's steering directive and active topic context into
        a natural, single spoken sentence for the oral defense.
        Zero heuristic fallbacks: generated strictly via live vLLM.
        """
        if self.conduct_strikes >= 3:
            return "This examination is terminated immediately as the candidate has been hostile for the third time. This conduct will be officially reported to the academic committee. [EXAM_TERMINATED]"

        if self.is_terminated or not next_or_current_node:
            return "We will conclude your oral defense examination here. The committee will evaluate your performance across the domains covered. [EXAM_TERMINATED]"

        # Format recent dialogue turns
        if self.subturn_history:
            recent_turns = self.subturn_history[-4:]
            formatted_recent = "\n".join([f"{t['role'].capitalize()}: {t['text']}" for t in recent_turns])
        else:
            formatted_recent = "Opening inquiry on new subtopic."

        system_prompt = """You are the Lead Professor conducting a spoken oral PhD viva defense.
You speak directly across the table into the candidate's headphones.
Your objective is to test conceptual depth, guide their reasoning, and maintain academic rapport.

SPEECH & CADENCE RULES:
1. Maximum 1 to 2 short conversational sentences (under 32 words total).
2. Spoken prose only: No markdown, no asterisks, no bullet points, no LaTeX formulas, no quotation marks.
3. Exactly ONE question mark at the very end.
4. Natural conversational variety: Do NOT repeat the exact same filler phrase on every turn. Vary your acknowledgments:
   - When candidate is on the right track: 'Good intuition.', 'Right.', 'Exactly.'
   - When candidate gives a shallow buzzword: 'I see your point.', 'Fair enough.', 'Let's take that further.'
   - When candidate is stuck ('I don't know'): 'No problem at all.', 'That is fine.'
   - When candidate masters a concept: 'Precisely.', 'Spot on.'
5. When candidate is stuck or asks to skip: Push them to attempt it by offering an intuitive hint, analogy, or conceptual anchor. If they genuinely cannot answer after your hint, gracefully acknowledge and advance to the next topic.
6. Candidate Inquiries: The candidate is welcome to ask questions or seek clarification. Do NOT recite the full textbook solution or let them reverse roles. Offer a brief intuitive hint, and immediately challenge them with a question on how to apply that intuition.
7. Examiner Authority: You lead this defense. Do not allow the candidate to derail the agenda or steer the examination away from the syllabus.
8. When advancing to a new topic: ALWAYS ask an opening foundational question exploring that topic.
9. Strictly execute the Socratic Steering Directive provided."""

        user_prompt = f"""[ACTIVE TOPIC]
{next_or_current_node.title}

[TOPIC SPECIFICATION]
{next_or_current_node.directive}

[RECENT DIALOGUE]
{formatted_recent}

[SOCRATIC STEERING DIRECTIVE]
{directive}

Speak your question now:"""

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.3,
            "max_tokens": 60
        }

        req = urllib.request.Request(
            self.vllm_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                res = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            raise RuntimeError(f"Tier 2 question generation failed via vLLM: {str(e)} (ZERO FALLBACKS ALLOWED)") from e

        spoken = res["choices"][0]["message"]["content"].strip()
        if spoken.startswith('"') and spoken.endswith('"') and len(spoken) > 2:
            spoken = spoken[1:-1].strip()
        return spoken
