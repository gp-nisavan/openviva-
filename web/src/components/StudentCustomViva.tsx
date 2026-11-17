"use client";

import React, { useState, useEffect } from "react";
import { DocumentTOCResponse, TOCItem, RigorTier } from "@/types/toc";
import { RIGOR_OPTIONS, DURATION_OPTIONS } from "./TAPortal";

interface TreeNode {
  id: string;
  title: string;
  level: number;
  accepted: boolean;
  children: TreeNode[];
  candidateChildren: { id: string; title: string }[];
  chosenFromBatch?: string[];
  rejectedFromBatch?: string[];
  isExpanding?: boolean;
  showContextInput?: boolean;
  comment?: string;
  showCommentInput?: boolean;
}

// Deterministic AST parser for Markdown / Indented / Numbered syllabus or notes (0ms, offline)
function parseDeterministicMarkdown(rawText: string): TreeNode[] {
  const lines = rawText.split("\n").filter((l) => l.trim().length > 0);
  const rootNodes: TreeNode[] = [];
  const stack: { node: TreeNode; indent: number }[] = [];

  const genId = () => `node-${Math.random().toString(36).substring(2, 9)}`;

  for (const line of lines) {
    const leadingSpaces = line.search(/\S|$/);
    const trimmed = line.trim();

    let title = trimmed;
    let level = 1;

    if (trimmed.startsWith("###")) {
      level = 3;
      title = trimmed.replace(/^###\s*/, "");
    } else if (trimmed.startsWith("##")) {
      level = 2;
      title = trimmed.replace(/^##\s*/, "");
    } else if (trimmed.startsWith("#")) {
      level = 1;
      title = trimmed.replace(/^#\s*/, "");
    } else {
      const cleanLine = trimmed.replace(/^[-*+•]\s*/, "");
      const numberMatch = cleanLine.match(/^(\d+(?:\.\d+)*)\.?\s*(.*)/);
      if (numberMatch) {
        const dots = (numberMatch[1].match(/\./g) || []).length;
        level = dots + 1;
        title = numberMatch[2] || numberMatch[1];
      } else {
        level = Math.floor(leadingSpaces / 2) + 1;
        title = cleanLine;
      }
    }

    if (!title.trim()) continue;

    const newNode: TreeNode = {
      id: genId(),
      title: title.trim(),
      level,
      accepted: true,
      children: [],
      candidateChildren: [],
    };

    if (level === 1) {
      rootNodes.push(newNode);
      stack.length = 0;
      stack.push({ node: newNode, indent: level });
    } else {
      while (stack.length > 0 && stack[stack.length - 1].indent >= level) {
        stack.pop();
      }
      if (stack.length > 0) {
        const parent = stack[stack.length - 1].node;
        newNode.level = parent.level + 1;
        parent.children.push(newNode);
        stack.push({ node: newNode, indent: level });
      } else {
        newNode.level = 1;
        rootNodes.push(newNode);
        stack.push({ node: newNode, indent: 1 });
      }
    }
  }

  return rootNodes;
}

interface StudentCustomVivaProps {
  onBackToModes: () => void;
  onLaunchExamRoom: (
    toc: DocumentTOCResponse,
    prompt?: string,
    duration?: number,
    candidateId?: string
  ) => void;
  defaultStudentId?: string;
}

export function StudentCustomViva({
  onBackToModes,
  onLaunchExamRoom,
  defaultStudentId = "student_01",
}: StudentCustomVivaProps) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Sync currentStep with browser history
  useEffect(() => {
    const parseUrlState = () => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const urlStep = Number(params.get("step"));
      if (urlStep === 1 || urlStep === 2 || urlStep === 3) {
        setCurrentStep(urlStep as 1 | 2 | 3);
      } else {
        setCurrentStep(1);
      }
    };

    parseUrlState();
    window.addEventListener("popstate", parseUrlState);
    return () => window.removeEventListener("popstate", parseUrlState);
  }, []);

  const navigateToStep = (step: 1 | 2 | 3) => {
    setCurrentStep(step);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("view", "student");
      url.searchParams.set("mode", "custom");
      url.searchParams.set("step", String(step));
      window.history.pushState({ step }, "", url.toString());
    }
  };

  const handleStepBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      if (currentStep > 1) {
        navigateToStep((currentStep - 1) as 1 | 2 | 3);
      } else {
        onBackToModes();
      }
    }
  };

  // Student Practice Metadata
  const [subjectTitle, setSubjectTitle] = useState<string>("");
  const [candidateId, setCandidateId] = useState<string>(defaultStudentId);
  const [difficultyTier, setDifficultyTier] = useState<RigorTier>("undergrad_3");
  const [durationMinutes, setDurationMinutes] = useState<number>(10);
  const [deepDiveFocus, setDeepDiveFocus] = useState<boolean>(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Step 1: Core Topics State
  const [topicBubbles, setTopicBubbles] = useState<string[]>([]);
  const [bubbleInput, setBubbleInput] = useState<string>("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [draggedBubbleIndex, setDraggedBubbleIndex] = useState<number | null>(null);
  const [dynamicSuggestions, setDynamicSuggestions] = useState<string[]>([]);
  const [isSuggesting, setIsSuggesting] = useState<boolean>(false);
  const [suggestionNotice, setSuggestionNotice] = useState<string | null>(null);
  const [coreTopicsComment, setCoreTopicsComment] = useState<string>("");
  const [isGeneratingCoreTopics, setIsGeneratingCoreTopics] = useState<boolean>(false);
  const [coreTopicsError, setCoreTopicsError] = useState<string | null>(null);

  // Import Modal State
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importRawText, setImportRawText] = useState<string>("");
  const [isImportNormalizing, setIsImportNormalizing] = useState<boolean>(false);
  const [parsedImportPreview, setParsedImportPreview] = useState<TreeNode[] | null>(null);

  // Step 2: Hierarchical Tree State
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [rootCandidates, setRootCandidates] = useState<{ id: string; title: string }[]>([]);
  const [rootChosenFromBatch, setRootChosenFromBatch] = useState<string[]>([]);
  const [rootRejectedFromBatch, setRootRejectedFromBatch] = useState<string[]>([]);
  const [isRootExpanding, setIsRootExpanding] = useState<boolean>(false);
  const [isRootCandidatesExpanded, setIsRootCandidatesExpanded] = useState<boolean>(false);
  const [showRootContextInput, setShowRootContextInput] = useState<boolean>(false);
  const [rootSteeringPrompt, setRootSteeringPrompt] = useState<string>("");
  const [globalDirective, setGlobalDirective] = useState<string>("");
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);

  // Step 3: Review & Launch State
  const [sampleQuestions, setSampleQuestions] = useState<
    { topic: string; starter: string; followUp: string }[]
  >([]);
  const [sampleQuestionsLoading, setSampleQuestionsLoading] = useState<boolean>(false);
  const [generatedPrompt, setGeneratedPrompt] = useState<string>("");
  const [promptLoading, setPromptLoading] = useState<boolean>(false);
  const [showPromptDetails, setShowPromptDetails] = useState<boolean>(false);

  const genId = () => `node-${Math.random().toString(36).substring(2, 9)}`;

  // Bubble Helpers
  const handleAddBubble = (rawText?: string) => {
    const textToAdd = rawText !== undefined ? rawText : bubbleInput;
    if (!textToAdd.trim()) return;

    const parts = textToAdd
      .split(/[\n,]+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    setTopicBubbles((prev) => {
      const next = [...prev];
      parts.forEach((p) => {
        if (!next.includes(p)) next.push(p);
      });
      return next;
    });

    if (rawText === undefined) {
      setBubbleInput("");
    }
  };

  const handleRemoveBubble = (index: number) => {
    setTopicBubbles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveEditBubble = (idx: number) => {
    if (editingValue.trim()) {
      setTopicBubbles((prev) => {
        const next = [...prev];
        next[idx] = editingValue.trim();
        return next;
      });
    }
    setEditingIndex(null);
  };

  // Generate Core Topics via AI from Course Name + Focus Directives
  const handleGenerateCoreTopicsFromAI = async () => {
    if (!subjectTitle.trim()) {
      setValidationError("Please enter a Target practice subject first.");
      return;
    }
    setIsGeneratingCoreTopics(true);
    setCoreTopicsError(null);
    try {
      const res = await fetch("/api/generate-topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "root_topics",
          course_title: subjectTitle.trim(),
          comment: coreTopicsComment.trim(),
          difficulty: difficultyTier,
          existing_topics: topicBubbles,
        }),
      });
      const data = await res.json();
      if (data?.topics && Array.isArray(data.topics) && data.topics.length > 0) {
        const fresh = data.topics
          .map((t: string) => t.trim())
          .filter((t: string) => t && !topicBubbles.some((existing) => existing.toLowerCase() === t.toLowerCase()));
        setDynamicSuggestions(fresh);
        setSuggestionNotice(null);
        setCoreTopicsError(null);
      } else {
        setCoreTopicsError(data?.error || "Could not generate suggestions. Please try again.");
      }
    } catch (err: any) {
      console.error("AI topic generation error:", err);
      setCoreTopicsError("Failed to reach LLM topic generator. Please try again.");
    } finally {
      setIsGeneratingCoreTopics(false);
    }
  };

  // Dynamic Suggestion Generation
  useEffect(() => {
    if (topicBubbles.length === 0) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsSuggesting(true);
      setSuggestionNotice(null);
      try {
        const res = await fetch("/api/generate-topics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            context_type: "candidate_suggestions",
            course_title: subjectTitle || "Practice Defense",
            difficulty: difficultyTier,
            existing_topics: topicBubbles,
          }),
        });
        const data = await res.json();
        if (data?.topics && Array.isArray(data.topics) && data.topics.length > 0) {
          const fresh = data.topics.filter((t: string) => !topicBubbles.includes(t));
          setDynamicSuggestions(fresh.slice(0, 4));
          setSuggestionNotice(null);
        } else {
          setDynamicSuggestions([]);
          setSuggestionNotice(data?.error || "Can't do it now, please create it on your own.");
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("Dynamic suggestions error:", err);
          setDynamicSuggestions([]);
          setSuggestionNotice("Can't do it now, please create it on your own.");
        }
      } finally {
        setIsSuggesting(false);
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [topicBubbles, subjectTitle, difficultyTier]);

  // Import / Paste Handler
  const handleNormalizeImportAI = async () => {
    if (!importRawText.trim()) return;
    setIsImportNormalizing(true);
    try {
      const parsed = parseDeterministicMarkdown(importRawText);
      setParsedImportPreview(parsed);
    } catch (err) {
      console.error("Normalization error:", err);
    } finally {
      setIsImportNormalizing(false);
    }
  };

  const handleApplyImportedSyllabus = () => {
    if (!parsedImportPreview || parsedImportPreview.length === 0) return;
    setTree(parsedImportPreview);
    setTopicBubbles(parsedImportPreview.map((n) => n.title));
    setShowImportModal(false);
    navigateToStep(2);
  };

  // Transition Step 1 -> Step 2
  const handleProceedToBuilder = () => {
    if (!subjectTitle.trim()) {
      setValidationError("Practice subject is required.");
      return;
    }
    if (!candidateId.trim()) {
      setValidationError("Candidate ID is required.");
      return;
    }
    setValidationError(null);

    if (topicBubbles.length === 0) return;

    const structured: TreeNode[] = topicBubbles.map((title) => ({
      id: genId(),
      title,
      level: 1,
      accepted: true,
      children: [],
      candidateChildren: [],
    }));

    setTree(structured);
    navigateToStep(2);
  };

  // Flatten accepted tree for Step 3 and TOC Schema
  const flattenTree = (nodes: TreeNode[], parentSec = ""): TOCItem[] => {
    let items: TOCItem[] = [];
    nodes.forEach((n, idx) => {
      const secNum = parentSec ? `${parentSec}.${idx + 1}` : `${idx + 1}`;
      items.push({
        id: n.id,
        title: n.title,
        section_number: secNum,
        level: n.level,
        page: 1,
        bbox: [0, 0, 0, 0],
        comment: n.comment,
      });
      if (n.children.length > 0) {
        items = items.concat(flattenTree(n.children, secNum));
      }
    });
    return items;
  };

  // Generate Examiner Prompt
  const refreshGeneratedPrompt = async () => {
    const flatItems = flattenTree(tree);
    setPromptLoading(true);

    try {
      const res = await fetch("/api/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_title: subjectTitle,
          selected_chapters: tree.map((i) => i.title),
          items: flatItems,
          tree: tree,
          global_directive:
            globalDirective || "Provide a rigorous academic drill for candidate self-study.",
          student_decides_weightage: !deepDiveFocus,
          difficulty: difficultyTier,
          duration_minutes: durationMinutes,
        }),
      });
      const data = await res.json();
      if (data?.system_prompt) {
        setGeneratedPrompt(data.system_prompt);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setPromptLoading(false);
    }
  };

  // Transition Step 2 -> Step 3
  const handleProceedToReview = async () => {
    navigateToStep(3);
    await refreshGeneratedPrompt();
  };

  // Sample probe generator
  const handlePreviewQuestions = async () => {
    const flatItems = flattenTree(tree);
    if (flatItems.length === 0) return;

    setSampleQuestionsLoading(true);
    setSampleQuestions([]);

    try {
      const res = await fetch("/api/preview-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topics: flatItems.slice(0, 4).map((item) => ({
            title: item.title,
            directive: item.comment,
          })),
          difficulty: difficultyTier,
          global_directive: globalDirective,
        }),
      });
      const data = await res.json();
      if (data?.questions && Array.isArray(data.questions)) {
        setSampleQuestions(data.questions);
      }
    } catch (err) {
      console.error("Preview questions error:", err);
    } finally {
      setSampleQuestionsLoading(false);
    }
  };

  // Launch Live Practice Room
  const handleLaunchPracticeRoom = () => {
    if (!subjectTitle.trim() || !candidateId.trim()) {
      setValidationError("Practice subject and candidate ID are required.");
      return;
    }
    setValidationError(null);

    const flatItems = flattenTree(tree);
    const tocResponse: DocumentTOCResponse = {
      filename: `${subjectTitle}.practice.syllabus`,
      total_pages: 1,
      extraction_mode: "Student Custom Practice Defense",
      total_items: flatItems.length,
      items: flatItems,
    };
    onLaunchExamRoom(tocResponse, generatedPrompt, durationMinutes, candidateId.trim());
  };

  // Global Root AI Expansion
  const handleGenerateRootTopics = async () => {
    setIsRootExpanding(true);
    try {
      const existingTitles = tree.map((t) => t.title);
      const res = await fetch("/api/generate-topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context_type: "root_complementary",
          course_title: subjectTitle,
          difficulty: difficultyTier,
          existing_topics: existingTitles,
          steering_prompt: rootSteeringPrompt,
          chosen_topics: rootChosenFromBatch,
          rejected_topics: rootRejectedFromBatch,
        }),
      });
      const data = await res.json();
      if (data?.topics && Array.isArray(data.topics)) {
        const fresh = data.topics.map((t: string) => ({
          id: genId(),
          title: t,
        }));
        setRootCandidates((prev) => [...prev, ...fresh]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsRootExpanding(false);
    }
  };

  const handleAcceptRootCandidate = (candId: string) => {
    const cand = rootCandidates.find((c) => c.id === candId);
    if (!cand) return;

    setRootChosenFromBatch((prev) => [...prev, cand.title]);
    setRootCandidates((prev) => prev.filter((c) => c.id !== candId));

    const newNode: TreeNode = {
      id: cand.id,
      title: cand.title,
      level: 1,
      accepted: true,
      children: [],
      candidateChildren: [],
    };
    setTree((prev) => [...prev, newNode]);
  };

  const handleRejectRootCandidate = (candId: string) => {
    const cand = rootCandidates.find((c) => c.id === candId);
    if (cand) {
      setRootRejectedFromBatch((prev) => [...prev, cand.title]);
    }
    setRootCandidates((prev) => prev.filter((c) => c.id !== candId));
  };

  // Subtopic Generation within a Node
  const handleGenerateSubtopics = async (parentId: string, promptText: string) => {
    const findAndExpand = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
      return Promise.all(
        nodes.map(async (n) => {
          if (n.id === parentId) {
            const existingChildren = n.children.map((c) => c.title);
            try {
              const res = await fetch("/api/generate-topics", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  context_type: "subtopics",
                  course_title: subjectTitle,
                  parent_topic: n.title,
                  difficulty: difficultyTier,
                  existing_subtopics: existingChildren,
                  steering_prompt: promptText,
                  chosen_topics: n.chosenFromBatch || [],
                  rejected_topics: n.rejectedFromBatch || [],
                }),
              });
              const data = await res.json();
              if (data?.topics && Array.isArray(data.topics)) {
                const fresh = data.topics.map((t: string) => ({
                  id: genId(),
                  title: t,
                }));
                return {
                  ...n,
                  candidateChildren: [...n.candidateChildren, ...fresh],
                  isExpanding: false,
                  showContextInput: false,
                };
              }
            } catch (err) {
              console.error(err);
            }
            return { ...n, isExpanding: false };
          }
          if (n.children.length > 0) {
            return { ...n, children: await findAndExpand(n.children) };
          }
          return n;
        })
      );
    };

    setTree((prev) => {
      const setExpanding = (nodes: TreeNode[]): TreeNode[] =>
        nodes.map((n) =>
          n.id === parentId
            ? { ...n, isExpanding: true }
            : { ...n, children: setExpanding(n.children) }
        );
      return setExpanding(prev);
    });

    const updated = await findAndExpand(tree);
    setTree(updated);
  };

  const handleAcceptChild = (parentId: string, candId: string) => {
    const updateNode = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) => {
        if (n.id === parentId) {
          const cand = n.candidateChildren.find((c) => c.id === candId);
          if (!cand) return n;
          const newChild: TreeNode = {
            id: cand.id,
            title: cand.title,
            level: n.level + 1,
            accepted: true,
            children: [],
            candidateChildren: [],
          };
          return {
            ...n,
            chosenFromBatch: [...(n.chosenFromBatch || []), cand.title],
            candidateChildren: n.candidateChildren.filter((c) => c.id !== candId),
            children: [...n.children, newChild],
          };
        }
        return { ...n, children: updateNode(n.children) };
      });
    setTree(updateNode(tree));
  };

  const handleRejectChild = (parentId: string, candId: string) => {
    const updateNode = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) => {
        if (n.id === parentId) {
          const cand = n.candidateChildren.find((c) => c.id === candId);
          return {
            ...n,
            rejectedFromBatch: cand
              ? [...(n.rejectedFromBatch || []), cand.title]
              : n.rejectedFromBatch,
            candidateChildren: n.candidateChildren.filter((c) => c.id !== candId),
          };
        }
        return { ...n, children: updateNode(n.children) };
      });
    setTree(updateNode(tree));
  };

  const handleEditTitle = (nodeId: string, newTitle: string) => {
    const updateNode = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) =>
        n.id === nodeId
          ? { ...n, title: newTitle }
          : { ...n, children: updateNode(n.children) }
      );
    setTree(updateNode(tree));
  };

  const handleSetComment = (id: string, comment: string) => {
    const updateNode = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) =>
        n.id === id
          ? { ...n, comment, showCommentInput: false }
          : { ...n, children: updateNode(n.children) }
      );
    setTree(updateNode(tree));
  };

  const handleDeleteNode = (nodeId: string) => {
    const deleteRecursive = (nodes: TreeNode[]): TreeNode[] =>
      nodes
        .filter((n) => n.id !== nodeId)
        .map((n) => ({ ...n, children: deleteRecursive(n.children) }));
    setTree(deleteRecursive(tree));
  };

  return (
    <div className="min-h-[85vh] flex flex-col justify-between py-6 px-2 sm:px-4 font-sans text-white max-w-5xl mx-auto space-y-8">
      <div className="space-y-6">
        {/* Minimal Header Nav */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-900 text-xs">
          <button
            onClick={handleStepBack}
            className="text-zinc-500 hover:text-white transition flex items-center gap-2 cursor-pointer"
          >
            <span>←</span>
            <span>{currentStep === 1 ? "Candidate Modes" : "Back"}</span>
          </button>
          <div className="flex items-center gap-3 font-mono text-zinc-600">
            <span>Practice Step {currentStep} of 3</span>
            <span className="text-zinc-800">•</span>
            <button
              onClick={onBackToModes}
              className="text-zinc-600 hover:text-zinc-400 transition cursor-pointer"
            >
              Exit
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* PERSISTENT TOP CONTROLS FOR CUSTOM VIVA */}
        {/* ========================================================================= */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Subject Entry */}
            <div className="md:col-span-2">
              <input
                type="text"
                placeholder="Target practice subject (e.g. Distributed Consensus & Raft)"
                value={subjectTitle}
                onChange={(e) => {
                  setSubjectTitle(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                className={`w-full bg-zinc-950/80 border rounded-xl px-4 py-3 text-lg font-medium text-white placeholder-zinc-600 focus:outline-none transition ${
                  validationError && !subjectTitle.trim()
                    ? "border-red-500/80 focus:border-red-400"
                    : "border-zinc-800 focus:border-zinc-500"
                }`}
              />
            </div>
            {/* Candidate ID */}
            <div>
              <input
                type="text"
                placeholder="Candidate ID (e.g. 2024CS042)"
                value={candidateId}
                onChange={(e) => {
                  setCandidateId(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                className={`w-full bg-zinc-950/80 border rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none transition ${
                  validationError && !candidateId.trim()
                    ? "border-red-500/80 focus:border-red-400"
                    : "border-zinc-800 focus:border-zinc-500"
                }`}
              />
            </div>
          </div>

          {validationError && (
            <div className="text-xs font-mono text-red-400/90 flex items-center gap-1.5 py-1">
              <span>•</span>
              <span>{validationError}</span>
            </div>
          )}

          {/* Row 2: Defense Rigor & Examination Duration Dropdowns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-1">
                Target Rigor
              </label>
              <select
                value={difficultyTier}
                onChange={(e) => setDifficultyTier(e.target.value as RigorTier)}
                className="w-full bg-zinc-950/80 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500 cursor-pointer appearance-none transition"
              >
                {RIGOR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-zinc-950 text-zinc-200">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-1">
                Practice Duration
              </label>
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="w-full bg-zinc-950/80 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500 cursor-pointer appearance-none transition"
              >
                {DURATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-zinc-950 text-zinc-200">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-1">
                Examiner Style
              </label>
              <button
                type="button"
                onClick={() => setDeepDiveFocus(!deepDiveFocus)}
                className="w-full bg-zinc-950/80 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-left text-zinc-300 hover:border-zinc-600 transition cursor-pointer flex items-center justify-between"
              >
                <span>{deepDiveFocus ? "Deep-Dive Probes" : "Broad Survey"}</span>
                <span className="text-[10px] text-zinc-500 font-mono">Toggle</span>
              </button>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* WORKHORSE CARD FOR CUSTOM VIVA */}
        {/* ========================================================================= */}
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-6 sm:p-10 shadow-sm transition-all">
          {/* STEP 1: CORE STUDY TOPICS */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-medium text-white tracking-tight">
                    Custom study topics.
                  </h2>
                  <p className="text-sm text-zinc-500 mt-1">
                    Enter the specific concepts you want the AI examiner to grill you on.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowImportModal(true)}
                  className="text-xs text-zinc-400 hover:text-white transition flex items-center gap-1.5 py-2 px-3.5 rounded-xl border border-zinc-800 hover:border-zinc-600 bg-zinc-900/40 cursor-pointer"
                >
                  <span>Import notes</span>
                  <span>→</span>
                </button>
              </div>

              {/* AI Topic Generator Bar (Course Name + Focus Directive / Comment) */}
              <div className="p-4 rounded-xl border border-emerald-900/50 bg-emerald-950/20 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400 text-sm">✨</span>
                    <span className="text-xs font-semibold text-emerald-300">
                      AI Topic Suggestions
                    </span>
                    <span className="text-[11px] text-zinc-500 font-mono hidden sm:inline">
                      (Generates 5-7 topic suggestions from Subject & Comment)
                    </span>
                  </div>
                  {isGeneratingCoreTopics && (
                    <span className="text-xs text-emerald-400 font-mono animate-pulse">
                      Synthesizing suggestions...
                    </span>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    placeholder="Focus directives / comment (e.g. Focus on backprop, pooling, ResNet, and loss functions)..."
                    value={coreTopicsComment}
                    onChange={(e) => setCoreTopicsComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !isGeneratingCoreTopics) {
                        e.preventDefault();
                        handleGenerateCoreTopicsFromAI();
                      }
                    }}
                    className="flex-1 bg-zinc-900/90 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition"
                  />
                  <button
                    type="button"
                    onClick={handleGenerateCoreTopicsFromAI}
                    disabled={isGeneratingCoreTopics || !subjectTitle.trim()}
                    className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:hover:bg-emerald-700 text-white font-medium text-xs transition flex items-center justify-center gap-1.5 cursor-pointer shrink-0 shadow-sm"
                  >
                    <span>⚡</span>
                    <span>{isGeneratingCoreTopics ? "Suggesting..." : "Suggest Topics"}</span>
                  </button>
                </div>

                {coreTopicsError && (
                  <div className="text-xs text-amber-400 font-mono flex items-center justify-between pt-1">
                    <span>⚠️ {coreTopicsError}</span>
                    <button
                      type="button"
                      onClick={() => setCoreTopicsError(null)}
                      className="text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              {/* Topic Input */}
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider">Or Add Single Topic Manually:</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Add concept to practice (e.g. Leader Election Invariant, Press Enter)..."
                  value={bubbleInput}
                  onChange={(e) => setBubbleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddBubble();
                    }
                  }}
                  className="flex-1 bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
                />
                <button
                  type="button"
                  onClick={() => handleAddBubble()}
                  disabled={!bubbleInput.trim()}
                  className="px-4 py-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-850 hover:border-zinc-700 text-xs font-medium text-zinc-200 transition disabled:opacity-40 cursor-pointer"
                >
                  Add
                </button>
              </div>

              {/* Topic Stack */}
              <div className="min-h-24 p-4 rounded-xl border border-zinc-800/60 bg-zinc-900/20 flex flex-wrap gap-2 items-start content-start">
                {topicBubbles.length === 0 ? (
                  <span className="text-xs text-zinc-600 font-mono">
                    No practice topics added yet. Type a concept above, import study notes, or select an AI suggestion.
                  </span>
                ) : (
                  topicBubbles.map((bubble, idx) => {
                    const isEditing = editingIndex === idx;
                    return isEditing ? (
                      <div
                        key={idx}
                        className="flex items-center gap-1.5 bg-black border border-zinc-500 rounded-lg px-3 py-1"
                      >
                        <input
                          type="text"
                          autoFocus
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveEditBubble(idx);
                            if (e.key === "Escape") setEditingIndex(null);
                          }}
                          onBlur={() => handleSaveEditBubble(idx)}
                          className="bg-transparent text-white text-xs focus:outline-none w-36 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveEditBubble(idx)}
                          className="text-zinc-400 hover:text-white text-xs cursor-pointer"
                        >
                          ✓
                        </button>
                      </div>
                    ) : (
                      <div
                        key={idx}
                        draggable
                        onDragStart={() => setDraggedBubbleIndex(idx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (draggedBubbleIndex !== null && draggedBubbleIndex !== idx) {
                            setTopicBubbles((prev) => {
                              const next = [...prev];
                              const [removed] = next.splice(draggedBubbleIndex, 1);
                              next.splice(idx, 0, removed);
                              return next;
                            });
                          }
                          setDraggedBubbleIndex(null);
                        }}
                        className="group flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/70 text-xs text-zinc-200 hover:border-zinc-600 transition cursor-grab"
                      >
                        <span
                          onClick={() => {
                            setEditingIndex(idx);
                            setEditingValue(bubble);
                          }}
                          className="cursor-pointer"
                          title="Click to rename"
                        >
                          {bubble}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveBubble(idx)}
                          className="text-zinc-500 hover:text-white transition ml-0.5 cursor-pointer"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Dynamic Suggestions */}
              {isSuggesting && (
                <div className="text-xs text-zinc-500 font-mono animate-pulse">
                  Proposing modules...
                </div>
              )}
              {!isSuggesting && suggestionNotice && (
                <div className="p-3 rounded-xl border border-amber-800/60 bg-amber-950/20 text-xs text-amber-300 font-mono flex items-center justify-between">
                  <span>⚠️ {suggestionNotice}</span>
                  <button
                    type="button"
                    onClick={() => setSuggestionNotice(null)}
                    className="text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer ml-2"
                  >
                    ✕
                  </button>
                </div>
              )}
              {dynamicSuggestions.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs p-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40">
                  <span className="text-zinc-400 font-medium">Topic Suggestions ({dynamicSuggestions.length}):</span>
                  {dynamicSuggestions.map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      onClick={() => {
                        handleAddBubble(sug);
                        setDynamicSuggestions((prev) => prev.filter((s) => s !== sug));
                      }}
                      className="px-2.5 py-1 rounded-full border border-emerald-800/80 bg-emerald-950/40 text-emerald-300 hover:text-white hover:border-emerald-500 transition cursor-pointer"
                      title="Click to add topic"
                    >
                      + {sug}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      dynamicSuggestions.forEach((sug) => handleAddBubble(sug));
                      setDynamicSuggestions([]);
                    }}
                    className="text-emerald-400 hover:text-emerald-300 text-xs px-2 py-1 rounded border border-emerald-800/50 hover:border-emerald-600 transition cursor-pointer ml-auto font-mono"
                  >
                    + Add All
                  </button>
                  <button
                    type="button"
                    onClick={() => setDynamicSuggestions([])}
                    className="text-zinc-500 hover:text-zinc-300 text-xs px-1.5 transition cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Transition to Hierarchy */}
              <div className="pt-6 border-t border-zinc-900 flex items-center justify-between">
                <span className="text-xs font-mono text-zinc-600">
                  {topicBubbles.length} topic{topicBubbles.length === 1 ? "" : "s"} selected
                </span>
                <button
                  type="button"
                  onClick={handleProceedToBuilder}
                  disabled={topicBubbles.length === 0}
                  className={`group flex items-center gap-2 text-sm font-medium transition cursor-pointer ${
                    topicBubbles.length > 0
                      ? "text-zinc-200 hover:text-white"
                      : "text-zinc-700 cursor-not-allowed"
                  }`}
                >
                  <span>Build practice hierarchy</span>
                  <span className="text-base group-hover:translate-x-1.5 transition-transform duration-200">
                    →
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: PRACTICE HIERARCHY TREE BUILDER */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-medium text-white tracking-tight">
                    Practice hierarchy.
                  </h2>
                  <p className="text-sm text-zinc-500 mt-1">
                    Expand subtopics or add steering notes on specific areas where you need practice.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleGenerateRootTopics}
                  disabled={isRootExpanding}
                  className="px-3.5 py-2 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 text-xs font-medium text-zinc-300 transition cursor-pointer disabled:opacity-40"
                >
                  {isRootExpanding ? "Expanding..." : "+ Propose modules"}
                </button>
              </div>

              {/* Global Study Directive Bar */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 font-mono text-[11px] uppercase tracking-wider">
                    Personal Practice Focus (Directive)
                  </span>
                  {globalDirective && (
                    <button
                      type="button"
                      onClick={() => setGlobalDirective("")}
                      className="text-zinc-600 hover:text-zinc-400 transition text-[11px] cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="Tell the examiner how to test you (e.g. Drill edge cases, demand proofs, or challenge trade-offs)..."
                  value={globalDirective}
                  onChange={(e) => setGlobalDirective(e.target.value)}
                  className="w-full bg-zinc-900/40 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
                />
              </div>

              {/* Root AI Candidates */}
              {rootCandidates.length > 0 && (
                <div className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/30 space-y-2">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 block">
                    Suggested Additional Chapters
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {rootCandidates.map((cand) => (
                      <div
                        key={cand.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950/80 text-xs text-zinc-300"
                      >
                        <span>{cand.title}</span>
                        <button
                          type="button"
                          onClick={() => handleAcceptRootCandidate(cand.id)}
                          className="text-emerald-400 hover:text-emerald-300 text-sm ml-1 cursor-pointer"
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRejectRootCandidate(cand.id)}
                          className="text-zinc-500 hover:text-white text-sm ml-1 cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tree Nodes List */}
              <div className="space-y-2.5">
                {tree.map((node, idx) => (
                  <div
                    key={node.id}
                    className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/30 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-1">
                        <span className="text-xs font-mono text-zinc-500">{idx + 1}.</span>
                        <span className="text-sm font-medium text-white">{node.title}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleGenerateSubtopics(node.id, "")}
                          disabled={node.isExpanding}
                          className="px-2.5 py-1 rounded-lg border border-zinc-800 hover:border-zinc-700 bg-zinc-900/60 text-xs text-zinc-400 hover:text-white transition cursor-pointer"
                        >
                          {node.isExpanding ? "Expanding..." : "+ Subtopics"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteNode(node.id)}
                          className="text-zinc-600 hover:text-zinc-400 text-xs cursor-pointer p-1"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* Subtopic Candidates */}
                    {node.candidateChildren.length > 0 && (
                      <div className="pl-4 pt-1 flex flex-wrap gap-2">
                        {node.candidateChildren.map((cand) => (
                          <div
                            key={cand.id}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-zinc-800 bg-zinc-950 text-xs text-zinc-300"
                          >
                            <span>{cand.title}</span>
                            <button
                              type="button"
                              onClick={() => handleAcceptChild(node.id, cand.id)}
                              className="text-emerald-400 hover:text-emerald-300 ml-1 cursor-pointer"
                            >
                              ✓
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRejectChild(node.id, cand.id)}
                              className="text-zinc-500 hover:text-white ml-1 cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Accepted Children */}
                    {node.children.length > 0 && (
                      <div className="pl-4 space-y-1.5 border-l border-zinc-800/60 ml-2">
                        {node.children.map((child, cIdx) => (
                          <div
                            key={child.id}
                            className="flex items-center justify-between text-xs text-zinc-300 py-1"
                          >
                            <span className="font-mono text-zinc-500">
                              {idx + 1}.{cIdx + 1} {child.title}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteNode(child.id)}
                              className="text-zinc-600 hover:text-zinc-400 cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Bottom Nav Bar */}
              <div className="flex items-center justify-between pt-6 border-t border-zinc-900">
                <button
                  type="button"
                  onClick={handleStepBack}
                  className="text-xs text-zinc-500 hover:text-white transition flex items-center gap-1.5 cursor-pointer"
                >
                  <span>←</span>
                  <span>Topics</span>
                </button>
                <button
                  type="button"
                  onClick={handleProceedToReview}
                  className="group flex items-center gap-2 text-sm font-medium text-zinc-200 hover:text-white transition cursor-pointer"
                >
                  <span>Review practice scope</span>
                  <span className="text-base group-hover:translate-x-1.5 transition-transform duration-200">
                    →
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: REVIEW & ENTER PRACTICE ROOM */}
          {currentStep === 3 && (
            <div className="space-y-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-medium text-white tracking-tight">
                    Review practice viva.
                  </h2>
                  <p className="text-sm text-zinc-500 mt-1">
                    Final scope inspection before entering the live oral defense chamber.
                  </p>
                </div>
              </div>

              {/* Locked Curriculum Tree Summary */}
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-5 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                    Locked Practice Scope ({flattenTree(tree).length} nodes)
                  </span>
                  <button
                    type="button"
                    onClick={handleStepBack}
                    className="text-xs text-zinc-400 hover:text-white transition cursor-pointer"
                  >
                    Edit hierarchy
                  </button>
                </div>

                <div className="max-h-56 overflow-y-auto space-y-1.5 font-mono text-xs text-zinc-300 pr-2">
                  {flattenTree(tree).map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col py-0.5"
                      style={{ paddingLeft: `${(item.level - 1) * 16}px` }}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-zinc-500 text-[11px] font-medium w-8 shrink-0">
                          {item.section_number}
                        </span>
                        <span className="text-zinc-200">{item.title}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Probe Dry-Run */}
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 block">
                      Practice Probe Preview
                    </span>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Preview what kinds of questions the AI examiner will ask you.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handlePreviewQuestions}
                    disabled={sampleQuestionsLoading}
                    className="px-3.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-200 transition disabled:opacity-40 cursor-pointer"
                  >
                    {sampleQuestionsLoading ? "Synthesizing..." : "Preview questions"}
                  </button>
                </div>

                {sampleQuestionsLoading && (
                  <div className="text-xs text-zinc-400 font-mono py-2 animate-pulse">
                    Generating practice probes via local model...
                  </div>
                )}

                {!sampleQuestionsLoading && sampleQuestions.length > 0 && (
                  <div className="space-y-3 pt-2">
                    {sampleQuestions.map((q, idx) => (
                      <div
                        key={idx}
                        className="p-3.5 rounded-lg border border-zinc-800/60 bg-zinc-950/60 space-y-2 text-xs"
                      >
                        <div className="font-mono text-zinc-400 text-[11px]">
                          {q.topic}
                        </div>
                        <div className="text-zinc-300">
                          <span className="text-zinc-500 font-mono text-[10px] uppercase mr-2">
                            Opening
                          </span>
                          {q.starter}
                        </div>
                        <div className="text-zinc-400">
                          <span className="text-zinc-500 font-mono text-[10px] uppercase mr-2">
                            Deep Probe
                          </span>
                          {q.followUp}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Examiner System Prompt Disclosure */}
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 block">
                      Examiner Persona & Prompt
                    </span>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {promptLoading ? "Synthesizing..." : "Configured for your study session."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPromptDetails(!showPromptDetails)}
                    className="text-xs text-zinc-400 hover:text-white transition cursor-pointer"
                  >
                    {showPromptDetails ? "Hide prompt" : "View prompt"}
                  </button>
                </div>

                {showPromptDetails && (
                  <pre className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-[11px] text-zinc-400 font-mono overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed mt-2">
                    {generatedPrompt || "Generating examiner prompt..."}
                  </pre>
                )}
              </div>

              {/* Launch Action Bar */}
              <div className="flex items-center justify-between pt-4 border-t border-zinc-800/60">
                <button
                  type="button"
                  onClick={handleStepBack}
                  className="text-xs text-zinc-500 hover:text-white transition flex items-center gap-1.5 cursor-pointer"
                >
                  <span>←</span>
                  <span>Hierarchy</span>
                </button>

                <button
                  type="button"
                  onClick={handleLaunchPracticeRoom}
                  className="group flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-medium transition cursor-pointer shadow"
                >
                  <span>Enter practice chamber</span>
                  <span className="text-sm group-hover:translate-x-1 transition-transform duration-200">
                    →
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Import / Paste Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-xl w-full p-6 sm:p-7 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between pb-3 border-b border-zinc-800/80">
              <div>
                <h3 className="text-xl font-medium text-white tracking-tight">
                  Import study notes or syllabus.
                </h3>
                <p className="text-xs text-zinc-500 mt-1">
                  Paste course outlines, lecture notes, or textbook chapter headings.
                </p>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-zinc-500 hover:text-white transition text-sm p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <textarea
              rows={8}
              placeholder={`Paste any syllabus, outline, or study notes, e.g.:\n\n1. Foundational Architecture\n   - Microkernel and Monolithic Design\n   - Context Switching Latency\n2. Memory Virtualization\n   - Page Replacement Algorithms`}
              value={importRawText}
              onChange={(e) => {
                setImportRawText(e.target.value);
                setParsedImportPreview(null);
              }}
              className="w-full bg-zinc-900/40 border border-zinc-800 rounded-xl p-3.5 text-zinc-200 font-mono text-xs focus:outline-none focus:border-zinc-500 placeholder-zinc-600 resize-none"
            />

            {parsedImportPreview && (
              <div className="p-3.5 bg-zinc-900/30 border border-zinc-800 rounded-xl space-y-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 block">
                  Hierarchy Preview ({parsedImportPreview.length} modules)
                </span>
                <div className="max-h-32 overflow-y-auto space-y-1 font-mono text-xs text-zinc-300">
                  {parsedImportPreview.map((item) => (
                    <div key={item.id} className="truncate">
                      • {item.title}{" "}
                      {item.children.length > 0 && `(${item.children.length} subtopics)`}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80">
              <button
                type="button"
                onClick={handleNormalizeImportAI}
                disabled={!importRawText.trim() || isImportNormalizing}
                className="px-4 py-2 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 text-xs font-medium text-zinc-200 transition disabled:opacity-40 cursor-pointer"
              >
                {isImportNormalizing ? "Parsing..." : "Parse outline"}
              </button>

              {parsedImportPreview && (
                <button
                  type="button"
                  onClick={handleApplyImportedSyllabus}
                  className="px-4 py-2 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-medium transition cursor-pointer"
                >
                  Load into practice builder →
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Status Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-zinc-600 font-mono pt-6 border-t border-zinc-900 gap-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>Student Custom Practice Console</span>
        </div>
        <button onClick={onBackToModes} className="hover:text-zinc-400 transition cursor-pointer">
          ← Back to candidate modes
        </button>
      </div>
    </div>
  );
}
