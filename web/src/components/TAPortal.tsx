"use client";

import "@/lib/api";
import React, { useState, useRef, useEffect } from "react";
import { DocumentTOCResponse, TOCItem, RigorTier } from "@/types/toc";
import { AllowedStudent, AccessControl, ExamPreset, ExamSessionRecord, InstructorAccount, InstructorRole } from "@/types/database";
import { EvaluationScorecard } from "@/components/EvaluationScorecard";

export const RIGOR_OPTIONS: { value: RigorTier; label: string; shortLabel: string; desc: string }[] = [
  {
    value: "undergrad_1",
    label: "Year 1 (Introductory)",
    shortLabel: "Year 1",
    desc: "Core definitions, terminology, and foundational concepts",
  },
  {
    value: "undergrad_2",
    label: "Year 2 (Foundational)",
    shortLabel: "Year 2",
    desc: "Standard principles, direct application, and core methods",
  },
  {
    value: "undergrad_3",
    label: "Year 3 (Intermediate)",
    shortLabel: "Year 3",
    desc: "Critical analysis, comparative evaluation, and problem solving",
  },
  {
    value: "undergrad_4",
    label: "Year 4 (Advanced)",
    shortLabel: "Year 4",
    desc: "In-depth synthesis, complex problem solving, and capstone depth",
  },
  {
    value: "grad",
    label: "Graduate / Masters",
    shortLabel: "Masters",
    desc: "Scholarly depth, research methodology, and advanced theory",
  },
  {
    value: "advanced",
    label: "Doctorate / PhD",
    shortLabel: "Doctorate",
    desc: "Frontier research, theoretical limits, and doctoral defense",
  },
];

export const DURATION_OPTIONS = [
  { value: 5, label: "5 Minutes (Brief)", shortLabel: "5 Min" },
  { value: 10, label: "10 Minutes (Standard)", shortLabel: "10 Min" },
  { value: 15, label: "15 Minutes (Comprehensive)", shortLabel: "15 Min" },
  { value: 20, label: "20 Minutes (In-Depth)", shortLabel: "20 Min" },
];

interface TreeNode {
  id: string;
  title: string;
  level: number;
  accepted: boolean;
  children: TreeNode[];
  candidateChildren: { id: string; title: string; comment?: string }[];
  chosenFromBatch?: string[];
  rejectedFromBatch?: string[];
  isExpanding?: boolean;
  showContextInput?: boolean;
  comment?: string;
  showCommentInput?: boolean;
  error?: string | null;
}

// Reconstruct hierarchical TreeNode[] from flat or level-tagged TOCItem[] stored in SQLite
function reconstructTreeFromTOC(items: TOCItem[]): TreeNode[] {
  if (!items || items.length === 0) return [];
  const rootNodes: TreeNode[] = [];
  const stack: { node: TreeNode; level: number }[] = [];

  for (const item of items) {
    const level = item.level || 1;
    const node: TreeNode = {
      id: item.id || `node-${Math.random().toString(36).substring(2, 9)}`,
      title: item.title,
      level: level,
      accepted: true,
      children: [],
      candidateChildren: [],
      comment: item.comment,
    };

    if (level === 1) {
      rootNodes.push(node);
      stack.length = 0;
      stack.push({ node, level: 1 });
    } else {
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      if (stack.length > 0) {
        const parent = stack[stack.length - 1].node;
        parent.children.push(node);
        stack.push({ node, level });
      } else {
        node.level = 1;
        rootNodes.push(node);
        stack.push({ node, level: 1 });
      }
    }
  }

  return rootNodes;
}

// Deterministic AST parser for Markdown / Indented / Numbered syllabus text (0ms, offline)
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

// Robust CSV Parser for Student Roster (supports Name, Registration Number headers or raw data)
function parseStudentRosterCsv(text: string): { name: string; regNo: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  let startIndex = 0;
  let nameCol = 0;
  let regCol = 1;

  // Check if first line contains header titles
  const firstRowCols = lines[0].split(/[,\t;]/).map((c) => c.trim().replace(/^["']|["']$/g, ""));
  const isHeader = firstRowCols.some((col) =>
    /^(name|student|student_name|reg|reg_no|regno|registration|registration_number|id|roll|roll_no)$/i.test(col)
  );

  if (isHeader) {
    startIndex = 1;
    firstRowCols.forEach((col, idx) => {
      const lower = col.toLowerCase();
      if (/reg|id|roll/i.test(lower)) {
        regCol = idx;
      } else if (/name|student/i.test(lower)) {
        nameCol = idx;
      }
    });
  }

  const results: { name: string; regNo: string }[] = [];
  const seenRegs = new Set<string>();

  for (let i = startIndex; i < lines.length; i++) {
    const rawLine = lines[i];
    const cols = rawLine.split(/[,\t;]/).map((c) => c.trim().replace(/^["']|["']$/g, ""));
    if (cols.length === 0 || (cols.length === 1 && !cols[0])) continue;

    let name = "";
    let regNo = "";

    if (cols.length === 1) {
      regNo = cols[0];
      name = "Candidate";
    } else if (isHeader) {
      name = cols[nameCol] || cols[0] || "";
      regNo = cols[regCol] || cols[1] || "";
    } else {
      // If no explicit header, inspect if col 0 looks like an alphanumeric registration code
      if (/^\d|^[A-Z0-9_-]{4,}$/i.test(cols[0]) && !/^\d/.test(cols[1])) {
        regNo = cols[0];
        name = cols[1];
      } else {
        name = cols[0];
        regNo = cols[1];
      }
    }

    if (regNo.trim()) {
      const cleanReg = regNo.trim();
      const lower = cleanReg.toLowerCase();
      if (!seenRegs.has(lower)) {
        seenRegs.add(lower);
        results.push({
          name: name.trim() || cleanReg,
          regNo: cleanReg,
        });
      }
    }
  }

  return results;
}

interface TAPortalProps {
  onBackToGateway: () => void;
  onLaunchExamRoom: (tocData: DocumentTOCResponse, systemPrompt?: string, durationMinutes?: number) => void;
}

export function TAPortal({ onBackToGateway, onLaunchExamRoom }: TAPortalProps) {
  // Wizard Step: 1 = Seed Input, 2 = Interactive Tree Builder, 3 = Candidate Access Control, 4 = Review & Finalize
  const [taViewMode, setTaViewMode] = useState<"choice" | "wizard">("choice");
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  // Instructor Cockpit State (SQLite Sync)
  const [cockpitTab, setCockpitTab] = useState<"presets" | "sessions" | "roster" | "staff">("presets");
  const [allStudents, setAllStudents] = useState<any[]>([]);
  const [studentsLoading, setStudentsLoading] = useState<boolean>(false);
  const [resettingRegNo, setResettingRegNo] = useState<string | null>(null);
  const [resetNotice, setResetNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [presets, setPresets] = useState<ExamPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState<boolean>(true);
  const [sessions, setSessions] = useState<ExamSessionRecord[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sessionFilterStatus, setSessionFilterStatus] = useState<string>("ALL");
  const [selectedTaFilter, setSelectedTaFilter] = useState<string>("ALL");
  const [selectedVivaFilter, setSelectedVivaFilter] = useState<string>("ALL");
  const [defenseViewMode, setDefenseViewMode] = useState<"flat" | "grouped">("flat");
  const [collapsedVivas, setCollapsedVivas] = useState<Record<string, boolean>>({});
  const [expandedDialogueSessionId, setExpandedDialogueSessionId] = useState<string | null>(null);
  const [selectedSessionForModal, setSelectedSessionForModal] = useState<ExamSessionRecord | null>(null);
  const [sessionModalTab, setSessionModalTab] = useState<"scorecard" | "transcript">("scorecard");
  const [retryingSessionId, setRetryingSessionId] = useState<string | null>(null);
  const [editingExamId, setEditingExamId] = useState<string | null>(null);

  // Dual-Role Audit Fields & Active Session State
  const [courseTitle, setCourseTitle] = useState<string>("");
  const [instructorId, setInstructorId] = useState<string>("");
  const [leadProfessor, setLeadProfessor] = useState<string>("");
  const [supervisingTaId, setSupervisingTaId] = useState<string>("inst_ta1");
  const [supervisingTaName, setSupervisingTaName] = useState<string>("TA 1 (Teaching Assistant)");

  // Instructor Authentication State (Offline SQLite)
  const [currentInstructor, setCurrentInstructor] = useState<InstructorAccount | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [registeredInstructors, setRegisteredInstructors] = useState<InstructorAccount[]>([]);
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const [authDisplayName, setAuthDisplayName] = useState<string>("");
  const [authRole, setAuthRole] = useState<InstructorRole>("TA");
  const [authAdminKey, setAuthAdminKey] = useState<string>("");
  const [authDepartment, setAuthDepartment] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);

  // Task 3.2: Provision TA & Professor Modal State & Helpers
  const [showAddTaModal, setShowAddTaModal] = useState<boolean>(false);
  const [newStaffRole, setNewStaffRole] = useState<"TA" | "PROFESSOR">("TA");
  const [newStaffAdminKey, setNewStaffAdminKey] = useState<string>("");
  const [newTaName, setNewTaName] = useState<string>("");
  const [newTaUsername, setNewTaUsername] = useState<string>("");
  const [newTaPassword, setNewTaPassword] = useState<string>("");
  const [newTaDepartment, setNewTaDepartment] = useState<string>("");
  const [newTaLoading, setNewTaLoading] = useState<boolean>(false);
  const [newTaError, setNewTaError] = useState<string | null>(null);
  const [provisionedCredentials, setProvisionedCredentials] = useState<{
    username: string;
    displayName: string;
    password: string;
    department?: string;
    role: string;
  } | null>(null);
  const [copiedCredentials, setCopiedCredentials] = useState<boolean>(false);

  // Task 3.3: Staff Revocation State & Handler
  const [revokingInstructorId, setRevokingInstructorId] = useState<string | null>(null);
  const [staffNotice, setStaffNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; username: string; displayName: string } | null>(null);

  // Syllabus Deletion Confirmation & Notice State
  const [deletePresetTarget, setDeletePresetTarget] = useState<{ id: string; title: string } | null>(null);
  const [isDeletingPreset, setIsDeletingPreset] = useState<boolean>(false);
  const [presetNotice, setPresetNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const handleRevokeInstructor = async (instructorId: string, username: string, displayName: string) => {
    setRevokingInstructorId(instructorId);
    setStaffNotice(null);

    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("openviva_instructor_token") : null;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(`/api/instructors/${encodeURIComponent(instructorId)}`, {
        method: "DELETE",
        headers,
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to revoke staff credentials.");
      }

      setStaffNotice({
        type: "success",
        message: `Teaching Assistant @${username} has been revoked and all active sessions purged.`,
      });

      // Instantly refresh staff directory
      await fetchInstructorsList();
    } catch (err: any) {
      setStaffNotice({
        type: "error",
        message: err.message || "Failed to revoke staff credentials.",
      });
    } finally {
      setRevokingInstructorId(null);
    }
  };

  const generateSecureTempPassword = () => {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let pwd = "TA-";
    for (let i = 0; i < 6; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pwd + "!";
  };

  const [staffViewMode, setStaffViewMode] = useState<"nested" | "flat">("nested");
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());

  const toggleDeptCollapse = (dept: string) => {
    setCollapsedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  };

  const handleOpenAddTaModal = (defaultDept?: string | React.MouseEvent) => {
    const dept = typeof defaultDept === "string" ? defaultDept : (currentInstructor?.department || "");
    setNewTaName("");
    setNewTaUsername("");
    setNewTaPassword(generateSecureTempPassword());
    setNewTaDepartment(dept);
    setNewStaffRole("TA");
    setNewStaffAdminKey("");
    setNewTaError(null);
    setProvisionedCredentials(null);
    setCopiedCredentials(false);
    setShowAddTaModal(true);
  };

  const handleProvisionTa = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewTaError(null);

    const cleanUser = newTaUsername.trim().toLowerCase();
    const cleanName = newTaName.trim();
    const cleanPass = newTaPassword.trim();
    const cleanDept = newTaDepartment.trim();

    if (!cleanName) {
      setNewTaError("Display Name is required.");
      return;
    }
    if (!cleanUser || cleanUser.length < 3) {
      setNewTaError("Username must be at least 3 characters.");
      return;
    }
    if (!/^[a-z0-9_.-]+$/.test(cleanUser)) {
      setNewTaError("Username can only contain lowercase letters, numbers, hyphens, and underscores.");
      return;
    }
    if (!cleanPass || cleanPass.length < 4) {
      setNewTaError("Password must be at least 4 characters.");
      return;
    }
    if (newStaffRole === "PROFESSOR" && !newStaffAdminKey.trim()) {
      setNewTaError("Institutional Bootstrap Key is strictly required to provision a Professor / Co-Instructor.");
      return;
    }

    setNewTaLoading(true);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("openviva_instructor_token") : null;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          username: cleanUser,
          displayName: cleanName,
          password: cleanPass,
          role: newStaffRole,
          department: cleanDept || undefined,
          adminKey: newStaffRole === "PROFESSOR" ? newStaffAdminKey.trim() : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to provision ${newStaffRole === "PROFESSOR" ? "Professor" : "Teaching Assistant"}.`);
      }

      // Success: Save provisioned credentials for one-time confirmation view
      setProvisionedCredentials({
        username: cleanUser,
        displayName: cleanName,
        password: cleanPass,
        department: cleanDept || undefined,
        role: newStaffRole,
      });

      // Instantly refresh staff list in Cockpit roster
      await fetchInstructorsList();
    } catch (err: any) {
      setNewTaError(err.message || `Failed to provision ${newStaffRole === "PROFESSOR" ? "Professor" : "Teaching Assistant"}.`);
    } finally {
      setNewTaLoading(false);
    }
  };

  const handleCopyCredentials = () => {
    if (!provisionedCredentials) return;
    const portalUrl = typeof window !== "undefined"
      ? `${window.location.origin}/openviva/?view=ta`
      : "https://iiitviva.online/openviva/?view=ta";

    const textToCopy = `OpenViva Teaching Assistant Credentials
------------------------------------------
Name: ${provisionedCredentials.displayName}
Role: Teaching Assistant (TA)
Username: ${provisionedCredentials.username}
Temporary Password: ${provisionedCredentials.password}
${provisionedCredentials.department ? `Department / Lab: ${provisionedCredentials.department}\n` : ""}Login Portal: ${portalUrl}
------------------------------------------
Please login and update your password upon initial sign-in.`;

    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(textToCopy);
      setCopiedCredentials(true);
      setTimeout(() => setCopiedCredentials(false), 3000);
    }
  };

  const applyInstructor = (instructor: InstructorAccount) => {
    setCurrentInstructor(instructor);
    setSelectedTaFilter("ALL");
    setSelectedVivaFilter("ALL");
    setDefenseViewMode("flat");
    setSupervisingTaId(instructor.id);
    setSupervisingTaName(`${instructor.displayName} (${instructor.username})`);
    fetchPresets(instructor.id, instructor);
    fetchSessions(instructor.id, instructor);
    fetchInstructorsList();
    setShowAuthModal(false);
  };

  const checkSession = async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.instructor) {
          if (data.token && typeof window !== "undefined") {
        localStorage.setItem("openviva_instructor_token", data.token);
      }
      applyInstructor(data.instructor);
        } else {
          setCurrentInstructor(null);
        }
      } else {
        setCurrentInstructor(null);
      }
    } catch (err) {
      console.error("Auth check failed:", err);
      setCurrentInstructor(null);
    } finally {
      setAuthChecking(false);
    }
  };

  const fetchInstructorsList = async () => {
    try {
      const res = await fetch("/api/instructors");
      if (res.ok) {
        const data = await res.json();
        setRegisteredInstructors(data.instructors || []);
      }
    } catch (err) {
      console.error("Fetch instructors failed:", err);
    }
  };

  const handleLogin = async (overrideUser?: string, overridePass?: string) => {
    const u = overrideUser !== undefined ? overrideUser : authUsername;
    const p = overridePass !== undefined ? overridePass : authPassword;
    if (!u || !p) {
      setAuthError("Username and password are required.");
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || "Login failed.");
        return;
      }
      if (data.token && typeof window !== "undefined") {
        localStorage.setItem("openviva_instructor_token", data.token);
      }
      applyInstructor(data.instructor);
      setShowAuthModal(false);
      setAuthUsername("");
      setAuthPassword("");
      fetchInstructorsList();
    } catch (err: any) {
      setAuthError(err.message || "Network error.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!authUsername.trim() || !authPassword || !authDisplayName.trim()) {
      setAuthError("Username, display name, and password are required.");
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: authUsername.trim(),
          displayName: authDisplayName.trim(),
          password: authPassword,
          role: authRole,
          department: authDepartment.trim() || undefined,
          adminKey: authAdminKey.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || "Registration failed.");
        return;
      }
      if (data.token && typeof window !== "undefined") {
        localStorage.setItem("openviva_instructor_token", data.token);
      }
      applyInstructor(data.instructor);
      setShowAuthModal(false);
      setAuthUsername("");
      setAuthPassword("");
      setAuthDisplayName("");
      setAuthDepartment("");
      setAuthAdminKey("");
      fetchInstructorsList();
    } catch (err: any) {
      setAuthError(err.message || "Network error.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      setCurrentInstructor(null);
      setAuthTab("login");
      setAuthError(null);
    }
  };

  // Fetch SQLite Presets and Historical Sessions (Filtered to active TA)
  const fetchPresets = async (targetTaId?: string, overrideInstructor?: InstructorAccount) => {
    setPresetsLoading(true);
    try {
      const activeInst = overrideInstructor || currentInstructor;
      const isRoleAdmin = activeInst?.role === "ADMIN" || activeInst?.role === "PROFESSOR";
      const activeId = targetTaId !== undefined ? targetTaId : (activeInst?.id || supervisingTaId);
      const taParam = !isRoleAdmin && activeId ? `?taId=${encodeURIComponent(activeId)}` : "";
      const token = typeof window !== "undefined" ? localStorage.getItem("openviva_instructor_token") : null;
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/presets${taParam}`, {
        headers,
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setPresets(data.exams || []);
      }
    } catch (err) {
      console.error("Failed to fetch exam presets from SQLite:", err);
    } finally {
      setPresetsLoading(false);
    }
  };

  const fetchSessions = async (targetTaId?: string, overrideInstructor?: InstructorAccount) => {
    setSessionsLoading(true);
    try {
      const activeInst = overrideInstructor || currentInstructor;
      const isRoleAdmin = activeInst?.role === "ADMIN" || activeInst?.role === "PROFESSOR";
      const activeId = targetTaId !== undefined ? targetTaId : (activeInst?.id || supervisingTaId);
      const taParam = !isRoleAdmin && activeId ? `?supervisingTaId=${encodeURIComponent(activeId)}` : "";
      const res = await fetch(`/api/defense/records${taParam}`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data.records || []);
      }
    } catch (err) {
      console.error("Failed to fetch defense records from SQLite:", err);
    } finally {
      setSessionsLoading(false);
    }
  };

  const fetchStudents = async () => {
    setStudentsLoading(true);
    try {
      const res = await fetch("/api/instructors/students");
      if (res.ok) {
        const data = await res.json();
        setAllStudents(data.students || []);
      }
    } catch (err) {
      console.error("Failed to fetch students roster from SQLite:", err);
    } finally {
      setStudentsLoading(false);
    }
  };

  const handleResetStudentPassword = async (regNo: string, studentName: string) => {
    if (!window.confirm(`Reset password for ${studentName} (${regNo}) back to default (${regNo})?\n\nThis will re-hash their registration number with a fresh cryptographic salt, revoke any active sessions, and mandate a new password change on their next login.`)) {
      return;
    }
    setResettingRegNo(regNo);
    setResetNotice(null);
    try {
      const res = await fetch("/api/instructors/reset-student-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regNo }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResetNotice({
          type: "success",
          message: data.message || `Password for ${studentName} (${regNo}) has been successfully reset to default registration number.`,
        });
        await fetchStudents();
      } else {
        setResetNotice({
          type: "error",
          message: data.error || "Failed to reset student password.",
        });
      }
    } catch (err: any) {
      setResetNotice({
        type: "error",
        message: err.message || "Network error while attempting password reset.",
      });
    } finally {
      setResettingRegNo(null);
    }
  };

  useEffect(() => {
    checkSession();
    fetchInstructorsList();
    fetchPresets();
    fetchSessions();
    fetchStudents();
  }, []);

  // Sync with browser history for native back/forward button support
  React.useEffect(() => {
    const parseUrlState = () => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const urlMode = params.get("mode");
      const urlStep = Number(params.get("step"));

      if (urlMode === "wizard") {
        setTaViewMode("wizard");
        if (urlStep >= 1 && urlStep <= 4) {
          setCurrentStep(urlStep as 1 | 2 | 3 | 4);
        } else {
          setCurrentStep(1);
        }
      } else {
        setTaViewMode("choice");
      }
    };

    parseUrlState();
    window.addEventListener("popstate", parseUrlState);
    return () => window.removeEventListener("popstate", parseUrlState);
  }, []);

  const navigateToStep = (step: 1 | 2 | 3 | 4) => {
    setCurrentStep(step);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("view", "ta");
      url.searchParams.set("mode", "wizard");
      url.searchParams.set("step", String(step));
      window.history.pushState({ taViewMode: "wizard", currentStep: step }, "", url.toString());
    }
  };

  const navigateToWizardMode = (step: 1 | 2 | 3 | 4 = 1, showImport = false) => {
    setTaViewMode("wizard");
    setCurrentStep(step);
    setShowImportModal(showImport);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("view", "ta");
      url.searchParams.set("mode", "wizard");
      url.searchParams.set("step", String(step));
      window.history.pushState({ taViewMode: "wizard", currentStep: step }, "", url.toString());
    }
  };

  const handleStepBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      if (currentStep > 1) {
        navigateToStep((currentStep - 1) as 1 | 2 | 3 | 4);
      } else {
        setTaViewMode("choice");
      }
    }
  };

  // Step 3: Candidate Access Control State
  const [accessControlType, setAccessControlType] = useState<"OPEN" | "RESTRICTED">("OPEN");
  const [allowedStudents, setAllowedStudents] = useState<AllowedStudent[]>([]);
  const [newStudentName, setNewStudentName] = useState<string>("");
  const [newStudentRegNo, setNewStudentRegNo] = useState<string>("");
  const [rosterSearch, setRosterSearch] = useState<string>("");
  const [csvUploadError, setCsvUploadError] = useState<string | null>(null);
  const [csvSuccessNotice, setCsvSuccessNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Candidate Access: CSV Upload Handler
  const handleCsvFileUpload = (file: File) => {
    setCsvUploadError(null);
    setCsvSuccessNotice(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text) {
          setCsvUploadError("Uploaded file is empty.");
          return;
        }

        const parsed = parseStudentRosterCsv(text);
        if (parsed.length === 0) {
          setCsvUploadError("Could not find valid candidate records in CSV. Ensure rows contain Name and Registration Number.");
          return;
        }

        setAllowedStudents((prev) => {
          const map = new Map<string, AllowedStudent>();
          // Keep existing students
          prev.forEach((s) => map.set(s.regNo.toLowerCase(), s));
          // Add newly uploaded students
          parsed.forEach((s) => map.set(s.regNo.toLowerCase(), s));
          return Array.from(map.values());
        });

        setCsvSuccessNotice(`Imported ${parsed.length} candidate${parsed.length === 1 ? "" : "s"} from ${file.name}`);
      } catch (err: any) {
        console.error("CSV parse error:", err);
        setCsvUploadError(err.message || "Failed to parse CSV file.");
      }
    };
    reader.onerror = () => {
      setCsvUploadError("Failed to read file.");
    };
    reader.readAsText(file);
  };

  const handleManualAddStudent = () => {
    if (!newStudentRegNo.trim()) return;
    const cleanReg = newStudentRegNo.trim();
    const cleanName = newStudentName.trim() || cleanReg;

    if (allowedStudents.some((s) => s.regNo.toLowerCase() === cleanReg.toLowerCase())) {
      setCsvUploadError(`Student with registration number "${cleanReg}" already exists on roster.`);
      return;
    }

    setAllowedStudents((prev) => [...prev, { name: cleanName, regNo: cleanReg }]);
    setNewStudentName("");
    setNewStudentRegNo("");
    setCsvUploadError(null);
  };

  const handleRemoveStudent = (regNo: string) => {
    setAllowedStudents((prev) => prev.filter((s) => s.regNo !== regNo));
  };

  const handleClearRoster = () => {
    setAllowedStudents([]);
    setCsvSuccessNotice(null);
    setCsvUploadError(null);
  };

  // Step 1: Clean Seed State with Zero Hardcodes & Dual-Role (Prof + TA) Audit Tracking
  const [difficultyTier, setDifficultyTier] = useState<RigorTier>("undergrad_3");
  const [durationMinutes, setDurationMinutes] = useState<number>(10);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSavingPreset, setIsSavingPreset] = useState<boolean>(false);
  const [topicBubbles, setTopicBubbles] = useState<string[]>([]);
  const [bubbleInput, setBubbleInput] = useState<string>("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [dynamicSuggestions, setDynamicSuggestions] = useState<string[]>([]);
  const [isSuggesting, setIsSuggesting] = useState<boolean>(false);
  const [suggestionNotice, setSuggestionNotice] = useState<string | null>(null);
  const [coreTopicsComment, setCoreTopicsComment] = useState<string>("");
  const [isGeneratingCoreTopics, setIsGeneratingCoreTopics] = useState<boolean>(false);
  const [coreTopicsError, setCoreTopicsError] = useState<string | null>(null);

  // Plan 1: Student-Driven Weightage & Rigor Toggle
  const [studentDecidesWeightage, setStudentDecidesWeightage] = useState<boolean>(false);

  // Step 2: Hierarchical Tree State with Preference Learning
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [rootCandidates, setRootCandidates] = useState<{ id: string; title: string }[]>([]);
  const [rootChosenFromBatch, setRootChosenFromBatch] = useState<string[]>([]);
  const [rootRejectedFromBatch, setRootRejectedFromBatch] = useState<string[]>([]);
  const [isRootExpanding, setIsRootExpanding] = useState<boolean>(false);
  const [isRootCandidatesExpanded, setIsRootCandidatesExpanded] = useState<boolean>(false);
  const [showRootContextInput, setShowRootContextInput] = useState<boolean>(false);
  const [rootSteeringPrompt, setRootSteeringPrompt] = useState<string>("");
  const [rootError, setRootError] = useState<string | null>(null);

  // Plan 2: Global Directive for AI Examiner
  const [globalDirective, setGlobalDirective] = useState<string>("");

  // Plan 3: Dry-Run Sample Questions Preview State
  const [sampleQuestions, setSampleQuestions] = useState<{ topic: string; starter: string; followUp: string; pinned?: boolean }[]>([]);
  const [sampleQuestionsLoading, setSampleQuestionsLoading] = useState<boolean>(false);
  const [editingProbeIdx, setEditingProbeIdx] = useState<number | null>(null);
  const [probeEditStarter, setProbeEditStarter] = useState<string>("");
  const [probeEditFollowUp, setProbeEditFollowUp] = useState<string>("");

  // Plan 4: Two-Tier Syllabus Import State
  const [curriculumMode, setCurriculumMode] = useState<"topics" | "questions">("questions");
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importMode, setImportMode] = useState<"syllabus" | "qa">("qa");
  const [importRawText, setImportRawText] = useState<string>("");
  const [isImportNormalizing, setIsImportNormalizing] = useState<boolean>(false);
  const [parsedImportPreview, setParsedImportPreview] = useState<TreeNode[] | null>(null);

  // Drag and drop state
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [draggedBubbleIndex, setDraggedBubbleIndex] = useState<number | null>(null);

  // Step 3: Review & Prompt State
  const [generatedPrompt, setGeneratedPrompt] = useState<string>("");
  const [promptLoading, setPromptLoading] = useState<boolean>(false);
  const [savedPresetNotice, setSavedPresetNotice] = useState<string | null>(null);
  const [showPromptDetails, setShowPromptDetails] = useState<boolean>(false);

  // Helper to generate IDs
  const genId = () => `node-${Math.random().toString(36).substring(2, 9)}`;

  // Bubble Helpers
  const handleAddBubble = (rawText?: string) => {
    const textToAdd = rawText !== undefined ? rawText : bubbleInput;
    if (!textToAdd.trim()) return;

    // Support splitting by comma or newline if pasted
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
    setBubbleInput("");
  };

  const handleRemoveBubble = (index: number) => {
    setTopicBubbles((prev) => prev.filter((_, i) => i !== index));
    if (editingIndex === index) setEditingIndex(null);
  };

  const handleStartEditBubble = (index: number) => {
    setEditingIndex(index);
    setEditingValue(topicBubbles[index]);
  };

  const handleSaveEditBubble = (index: number) => {
    if (!editingValue.trim()) {
      handleRemoveBubble(index);
    } else {
      setTopicBubbles((prev) => prev.map((item, i) => (i === index ? editingValue.trim() : item)));
    }
    setEditingIndex(null);
  };

  // Generate Core Topics via AI from Course Name + Focus Directives
  const handleGenerateCoreTopicsFromAI = async () => {
    if (!courseTitle.trim()) {
      setValidationError("Please enter a Course Title first.");
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
          courseTitle: courseTitle.trim(),
          comment: coreTopicsComment.trim(),
          difficulty: difficultyTier,
          existingTopics: topicBubbles,
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

  // Dynamically Suggest Complementary Topics when User Enters Bubbles
  React.useEffect(() => {
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
          body: JSON.stringify({
            mode: "root_topics",
            courseTitle: courseTitle || "Oral Defense Examination",
            existingTopics: topicBubbles,
            difficulty: difficultyTier,
          }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (data?.topics && Array.isArray(data.topics) && data.topics.length > 0) {
          // Exclude any already in user bubbles
          const filtered = data.topics.filter(
            (t: string) => !topicBubbles.some((b) => b.toLowerCase() === t.toLowerCase())
          );
          setDynamicSuggestions(filtered);
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
  }, [topicBubbles, courseTitle, difficultyTier]);

  // Transition Step 1 -> Step 2
  const handleProceedToBuilder = () => {
    if (!courseTitle.trim()) {
      setValidationError("Course title is mandatory.");
      return;
    }
    const effectiveProf = leadProfessor.trim() || instructorId.trim();
    if (!effectiveProf) {
      setValidationError("Lead Professor / Course In-Charge name is mandatory.");
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

  // Global Root: Suggest Complementary Main Topics (Appends 4 new candidates, learns from chosen/rejected)
  const handleGenerateRootTopics = async () => {
    setIsRootExpanding(true);
    setRootError(null);
    try {
      const existingTitles = tree.map((t) => t.title);
      const res = await fetch("/api/generate-topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "root_topics",
          courseTitle: courseTitle || "Oral Defense Examination",
          existingTopics: existingTitles,
          steeringPrompt: rootSteeringPrompt,
          difficulty: difficultyTier,
          chosenFromBatch: rootChosenFromBatch,
          rejectedFromBatch: [
            ...rootRejectedFromBatch,
            ...rootCandidates.map((c) => c.title),
          ],
        }),
      });
      const data = await res.json();
      if (data?.topics && Array.isArray(data.topics) && data.topics.length > 0) {
        const existingCandTitles = rootCandidates.map((c) => c.title.toLowerCase());
        const newCandidates = data.topics
          .filter(
            (t: string) =>
              !existingTitles.some((e) => e.toLowerCase() === t.toLowerCase()) &&
              !existingCandTitles.includes(t.toLowerCase())
          )
          .map((t: string) => ({ id: genId(), title: t }));

        // Append to existing candidates so user can keep previous unselected ones
        setRootCandidates((prev) => [...prev, ...newCandidates]);
        setShowRootContextInput(false);
        setRootSteeringPrompt("");
        setRootError(null);
      } else {
        setRootError(data?.error || "Can't do it now, please create it on your own.");
      }
    } catch (err) {
      console.error(err);
      setRootError("Can't do it now, please create it on your own.");
    } finally {
      setIsRootExpanding(false);
    }
  };

  // Accept a Root Candidate (Learns positive signal)
  const acceptRootCandidate = (candId: string) => {
    const cand = rootCandidates.find((c) => c.id === candId);
    if (!cand) return;
    setRootChosenFromBatch((prev) => [...prev, cand.title]);
    setTree((prev) => [
      ...prev,
      {
        id: cand.id,
        title: cand.title,
        level: 1,
        accepted: true,
        children: [],
        candidateChildren: [],
        chosenFromBatch: [],
        rejectedFromBatch: [],
      },
    ]);
    setRootCandidates((prev) => prev.filter((c) => c.id !== candId));
  };

  // Reject a Root Candidate (Learns negative signal)
  const rejectRootCandidate = (candId: string) => {
    const cand = rootCandidates.find((c) => c.id === candId);
    if (cand) {
      setRootRejectedFromBatch((prev) => [...prev, cand.title]);
    }
    setRootCandidates((prev) => prev.filter((c) => c.id !== candId));
  };

  // Clear all Root Candidates (Learns negative signals from remaining candidates and clears stack)
  const clearAllRootCandidates = () => {
    if (rootCandidates.length === 0) return;
    setRootRejectedFromBatch((prev) => [...prev, ...rootCandidates.map((c) => c.title)]);
    setRootCandidates([]);
    setIsRootCandidatesExpanded(false);
  };

  // Manually add a root chapter
  const handleAddManualRootTopic = (title: string) => {
    if (!title.trim()) return;
    const cleanTitle = title.trim();
    setTree((prev) => [
      ...prev,
      {
        id: genId(),
        title: cleanTitle,
        level: 1,
        accepted: true,
        children: [],
        candidateChildren: [],
        chosenFromBatch: [],
        rejectedFromBatch: [],
      },
    ]);
    setRootSteeringPrompt("");
    setShowRootContextInput(false);
  };

  // Node Level: Suggest Subtopics or Questions under a specific node (Appends 4 new, learns from node chosen/rejected)
  const handleGenerateSubtopics = async (
    targetNodeId: string,
    steeringPrompt: string,
    expandMode: "subtopics" | "questions" = curriculumMode === "questions" ? "questions" : "subtopics"
  ) => {
    // Find node and update expanding state
    const updateExpanding = (nodes: TreeNode[], expanding: boolean, hideInput: boolean): TreeNode[] =>
      nodes.map((n) => {
        if (n.id === targetNodeId) {
          return { ...n, isExpanding: expanding, showContextInput: hideInput ? false : n.showContextInput };
        }
        return { ...n, children: updateExpanding(n.children, expanding, hideInput) };
      });

    setTree((prev) => updateExpanding(prev, true, true));

    // Get breadcrumbs and existing node choices
    let targetTitle = "";
    const breadcrumbs: string[] = [];
    const findBreadcrumbs = (nodes: TreeNode[], path: string[]): boolean => {
      for (const n of nodes) {
        if (n.id === targetNodeId) {
          targetTitle = n.title;
          breadcrumbs.push(...path, n.title);
          return true;
        }
        if (findBreadcrumbs(n.children, [...path, n.title])) return true;
      }
      return false;
    };
    findBreadcrumbs(tree, []);

    const findTargetNode = (nodes: TreeNode[]): TreeNode | null => {
      for (const n of nodes) {
        if (n.id === targetNodeId) return n;
        const found = findTargetNode(n.children);
        if (found) return found;
      }
      return null;
    };

    const targetNode = findTargetNode(tree);
    const chosenSignals = targetNode?.chosenFromBatch || [];
    const rejectedSignals = targetNode
      ? [
          ...(targetNode.rejectedFromBatch || []),
          ...targetNode.candidateChildren.map((c: { id: string; title: string }) => c.title),
        ]
      : [];

    try {
      const res = await fetch("/api/generate-topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: expandMode,
          courseTitle: courseTitle || "Oral Defense Examination",
          existingTopics: tree.map((t) => t.title),
          parentTopic: targetTitle,
          hierarchyPath: breadcrumbs,
          steeringPrompt,
          difficulty: difficultyTier,
          chosenFromBatch: chosenSignals,
          rejectedFromBatch: rejectedSignals,
          comment: targetNode?.comment || "",
          existingSubtopics: (targetNode?.children || []).map((c) => c.title),
        }),
      });
      const data = await res.json();
      if (data?.topics && Array.isArray(data.topics) && data.topics.length > 0) {
        const attachCandidates = (nodes: TreeNode[]): TreeNode[] =>
          nodes.map((n) => {
            if (n.id === targetNodeId) {
              const existingCandTitles = n.candidateChildren.map((c) => c.title.toLowerCase());
              const newCandidates = data.topics
                .filter((t: any) => {
                  const title = typeof t === "object" ? t.title : String(t);
                  return title && !existingCandTitles.includes(title.toLowerCase());
                })
                .map((t: any) => {
                  if (typeof t === "object" && t !== null) {
                    return {
                      id: genId(),
                      title: String(t.title || t.question || "").trim(),
                      comment: t.comment || (t.answer ? `Ground Truth: ${t.answer}` : undefined),
                    };
                  }
                  return { id: genId(), title: String(t).trim(), comment: undefined };
                });
              // Append to existing candidateChildren (e.g. 3 unselected + 4 new = 7 total)
              return { ...n, candidateChildren: [...n.candidateChildren, ...newCandidates], isExpanding: false, error: null };
            }
            return { ...n, children: attachCandidates(n.children) };
          });
        setTree((prev) => attachCandidates(prev));
      } else {
        const attachError = (nodes: TreeNode[]): TreeNode[] =>
          nodes.map((n) => {
            if (n.id === targetNodeId) {
              return { ...n, isExpanding: false, error: data?.error || "Can't do it now, please create it on your own." };
            }
            return { ...n, children: attachError(n.children) };
          });
        setTree((prev) => attachError(prev));
      }
    } catch (e) {
      console.error(e);
      const attachError = (nodes: TreeNode[]): TreeNode[] =>
        nodes.map((n) => {
          if (n.id === targetNodeId) {
            return { ...n, isExpanding: false, error: "Can't do it now, please create it on your own." };
          }
          return { ...n, children: attachError(n.children) };
        });
      setTree((prev) => attachError(prev));
    }
  };

  // Directly add a manual subtopic under a parent node
  const handleAddManualSubtopic = (parentNodeId: string, subtopicTitle: string) => {
    if (!subtopicTitle.trim()) return;
    const cleanTitle = subtopicTitle.trim();
    const updateTree = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) => {
        if (n.id === parentNodeId) {
          const newChild: TreeNode = {
            id: genId(),
            title: cleanTitle,
            level: n.level + 1,
            accepted: true,
            children: [],
            candidateChildren: [],
            chosenFromBatch: [],
            rejectedFromBatch: [],
          };
          return {
            ...n,
            children: [...n.children, newChild],
            showContextInput: false,
          };
        }
        return { ...n, children: updateTree(n.children) };
      });
    setTree((prev) => updateTree(prev));
  };

  // Accept a Child Candidate (Learns positive signal for this node)
  const acceptChildCandidate = (parentNodeId: string, candId: string) => {
    const updateTree = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) => {
        if (n.id === parentNodeId) {
          const cand = n.candidateChildren.find((c) => c.id === candId);
          if (!cand) return n;
          const newChild: TreeNode = {
            id: cand.id,
            title: cand.title,
            comment: cand.comment,
            level: n.level + 1,
            accepted: true,
            children: [],
            candidateChildren: [],
            chosenFromBatch: [],
            rejectedFromBatch: [],
          };
          return {
            ...n,
            children: [...n.children, newChild],
            chosenFromBatch: [...(n.chosenFromBatch || []), cand.title],
            candidateChildren: n.candidateChildren.filter((c) => c.id !== candId),
          };
        }
        return { ...n, children: updateTree(n.children) };
      });
    setTree((prev) => updateTree(prev));
  };

  // Reject a Child Candidate (Learns negative signal for this node)
  const rejectChildCandidate = (parentNodeId: string, candId: string) => {
    const updateTree = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) => {
        if (n.id === parentNodeId) {
          const cand = n.candidateChildren.find((c) => c.id === candId);
          return {
            ...n,
            rejectedFromBatch: cand ? [...(n.rejectedFromBatch || []), cand.title] : n.rejectedFromBatch,
            candidateChildren: n.candidateChildren.filter((c) => c.id !== candId),
          };
        }
        return { ...n, children: updateTree(n.children) };
      });
    setTree((prev) => updateTree(prev));
  };

  // Clear all Child Candidates for a parent node
  const clearAllChildCandidates = (parentNodeId: string) => {
    const updateTree = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) => {
        if (n.id === parentNodeId) {
          return {
            ...n,
            rejectedFromBatch: [
              ...(n.rejectedFromBatch || []),
              ...n.candidateChildren.map((c) => c.title),
            ],
            candidateChildren: [],
          };
        }
        return { ...n, children: updateTree(n.children) };
      });
    setTree((prev) => updateTree(prev));
  };

  // Edit an existing accepted node's title
  const editNodeTitle = (nodeId: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    const updateTitle = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) => {
        if (n.id === nodeId) {
          return { ...n, title: newTitle.trim() };
        }
        return { ...n, children: updateTitle(n.children) };
      });
    setTree((prev) => updateTitle(prev));
  };

  // Drag & drop reordering for tree nodes (topics & subtopics)
  const handleMoveNode = (sourceId: string, targetId: string, position: "before" | "after") => {
    if (sourceId === targetId) return;

    // Check if target is inside source's subtree
    const isDescendant = (parent: TreeNode, id: string): boolean => {
      for (const child of parent.children) {
        if (child.id === id || isDescendant(child, id)) return true;
      }
      return false;
    };

    const findNode = (nodes: TreeNode[], id: string): TreeNode | null => {
      for (const n of nodes) {
        if (n.id === id) return n;
        const found = findNode(n.children, id);
        if (found) return found;
      }
      return null;
    };

    const sourceNode = findNode(tree, sourceId);
    if (!sourceNode || isDescendant(sourceNode, targetId)) return;

    // Remove source from tree
    let extracted: TreeNode | null = null;
    const removeSource = (nodes: TreeNode[]): TreeNode[] => {
      const filtered: TreeNode[] = [];
      for (const n of nodes) {
        if (n.id === sourceId) {
          extracted = n;
          continue;
        }
        filtered.push({
          ...n,
          children: removeSource(n.children),
        });
      }
      return filtered;
    };

    const treeWithoutSource = removeSource(tree);
    if (!extracted) return;

    // Helper: adjust levels recursively
    const adjustLevels = (n: TreeNode, newLevel: number): TreeNode => ({
      ...n,
      level: newLevel,
      children: n.children.map((c) => adjustLevels(c, newLevel + 1)),
    });

    // Insert extracted before/after targetId
    const insertNode = (nodes: TreeNode[]): TreeNode[] => {
      const idx = nodes.findIndex((n) => n.id === targetId);
      if (idx !== -1) {
        const targetNode = nodes[idx];
        const adjusted = adjustLevels(extracted!, targetNode.level);
        const result = [...nodes];
        const insertIndex = position === "before" ? idx : idx + 1;
        result.splice(insertIndex, 0, adjusted);
        return result;
      }
      return nodes.map((n) => ({
        ...n,
        children: insertNode(n.children),
      }));
    };

    const updatedTree = insertNode(treeWithoutSource);
    setTree(updatedTree);
    setDraggedNodeId(null);
  };

  // Delete an existing accepted node
  const deleteNode = (nodeId: string) => {
    const filterNodes = (nodes: TreeNode[]): TreeNode[] =>
      nodes.filter((n) => n.id !== nodeId).map((n) => ({ ...n, children: filterNodes(n.children) }));
    setTree((prev) => filterNodes(prev));
  };

  // Toggle Context Input for a Node
  const toggleNodeContext = (nodeId: string) => {
    const toggle = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) => {
        if (n.id === nodeId) {
          return { ...n, showContextInput: !n.showContextInput };
        }
        return { ...n, children: toggle(n.children) };
      });
    setTree((prev) => toggle(prev));
  };

  // Plan 2: Comment/Directive helpers
  const setNodeComment = (nodeId: string, comment: string) => {
    const update = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) => {
        if (n.id === nodeId) return { ...n, comment };
        return { ...n, children: update(n.children) };
      });
    setTree((prev) => update(prev));
  };

  const toggleNodeCommentInput = (nodeId: string) => {
    const toggle = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) => {
        if (n.id === nodeId) return { ...n, showCommentInput: !n.showCommentInput };
        return { ...n, children: toggle(n.children) };
      });
    setTree((prev) => toggle(prev));
  };

  // Plan 3: Dry-Run Preview Questions helper
  const handlePreviewQuestions = async () => {
    setSampleQuestionsLoading(true);
    try {
      const flatItems = flattenTree(tree);
      const res = await fetch("/api/preview-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_title: courseTitle,
          topics: flatItems.map((i) => ({ title: i.title, comment: i.comment })),
          difficulty: difficultyTier,
        }),
      });
      const data = await res.json();
      if (data?.questions && Array.isArray(data.questions)) {
        setSampleQuestions(data.questions);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSampleQuestionsLoading(false);
    }
  };

  // Plan 4: Syllabus Import helpers
  const handleDeterministicImport = () => {
    if (!importRawText.trim()) return;
    const parsed = parseDeterministicMarkdown(importRawText);
    setParsedImportPreview(parsed);
  };

  const handleNormalizeImportAI = async () => {
    if (!importRawText.trim()) return;
    setIsImportNormalizing(true);
    try {
      const res = await fetch("/api/normalize-syllabus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: importRawText }),
      });
      const data = await res.json();
      if (data?.topics && Array.isArray(data.topics)) {
        const cleanTitle = (raw: any): string => {
          const trimmed = String(raw || "Topic").trim();
          const stripped = trimmed.replace(/^(\d+(?:\.\d+)*[\.\)\s-]+|[a-zA-Z][\.\)]\s+|[-*•]\s+)/, "").trim();
          return stripped || trimmed;
        };

        const buildTreeFromJSON = (items: any[], currentLevel = 1): TreeNode[] =>
          items.map((item) => ({
            id: genId(),
            title: cleanTitle(item.title),
            level: currentLevel,
            accepted: true,
            children: item.children ? buildTreeFromJSON(item.children, currentLevel + 1) : [],
            candidateChildren: [],
          }));
        const treeNodes = buildTreeFromJSON(data.topics, 1);
        setParsedImportPreview(treeNodes);
      } else {
        handleDeterministicImport();
      }
    } catch (err) {
      console.error(err);
      handleDeterministicImport();
    } finally {
      setIsImportNormalizing(false);
    }
  };

  const handleClusterQuestionsAI = async () => {
    if (!importRawText.trim()) return;
    setIsImportNormalizing(true);
    try {
      const res = await fetch("/api/cluster-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText: importRawText,
          courseTitle: courseTitle.trim() || "Oral Examination",
        }),
      });
      const data = await res.json();
      if (data?.topics && Array.isArray(data.topics) && data.topics.length > 0) {
        const buildTreeFromJSON = (items: any[], currentLevel = 1): TreeNode[] =>
          items.map((item) => ({
            id: genId(),
            title: String(item.title || "Topic").trim(),
            level: currentLevel,
            comment: item.comment || undefined,
            accepted: true,
            children: item.children ? buildTreeFromJSON(item.children, currentLevel + 1) : [],
            candidateChildren: [],
          }));
        const treeNodes = buildTreeFromJSON(data.topics, 1);
        setParsedImportPreview(treeNodes);
      } else {
        handleNormalizeImportAI();
      }
    } catch (err) {
      console.error("Cluster questions error:", err);
      handleNormalizeImportAI();
    } finally {
      setIsImportNormalizing(false);
    }
  };

  const handleClusterBubblesAI = async () => {
    if (topicBubbles.length === 0) return;
    setIsImportNormalizing(true);
    try {
      const joinedText = topicBubbles.map((b, i) => `${i + 1}. ${b}`).join("\n\n");
      const res = await fetch("/api/cluster-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText: joinedText,
          courseTitle: courseTitle.trim() || "Oral Examination",
        }),
      });
      const data = await res.json();
      if (data?.topics && Array.isArray(data.topics) && data.topics.length > 0) {
        const buildTreeFromJSON = (items: any[], currentLevel = 1): TreeNode[] =>
          items.map((item) => ({
            id: genId(),
            title: String(item.title || "Topic").trim(),
            level: currentLevel,
            comment: item.comment || undefined,
            accepted: true,
            children: item.children ? buildTreeFromJSON(item.children, currentLevel + 1) : [],
            candidateChildren: [],
          }));
        const treeNodes = buildTreeFromJSON(data.topics, 1);
        setTree(treeNodes);
        navigateToStep(2);
      } else {
        handleProceedToBuilder();
      }
    } catch (err) {
      console.error("Cluster bubbles error:", err);
      handleProceedToBuilder();
    } finally {
      setIsImportNormalizing(false);
    }
  };

  const handleApplyImportedSyllabus = () => {
    if (!parsedImportPreview || parsedImportPreview.length === 0) return;
    setTree(parsedImportPreview);
    setTopicBubbles(parsedImportPreview.map((t) => t.title));
    setShowImportModal(false);
    setParsedImportPreview(null);
    setImportRawText("");
    if (currentStep === 1) {
      setCurrentStep(2);
    }
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

  const refreshGeneratedPrompt = async (
    targetTier = difficultyTier,
    targetStudentChoice = studentDecidesWeightage,
    targetDuration = durationMinutes,
    targetExemplarProbes = sampleQuestions
  ) => {
    const flatItems = flattenTree(tree);
    setPromptLoading(true);

    try {
      const res = await fetch("/api/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_title: courseTitle,
          selected_chapters: tree.map((i) => i.title),
          items: flatItems,
          tree: tree,
          global_directive: globalDirective,
          student_decides_weightage: targetStudentChoice,
          difficulty: targetTier,
          duration_minutes: targetDuration,
          exemplar_probes: targetExemplarProbes,
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

  const handleStartEditProbe = (idx: number) => {
    setEditingProbeIdx(idx);
    setProbeEditStarter(sampleQuestions[idx]?.starter || "");
    setProbeEditFollowUp(sampleQuestions[idx]?.followUp || "");
  };

  const handleSaveEditProbe = async (idx: number) => {
    if (!sampleQuestions[idx]) return;
    const updated = [...sampleQuestions];
    updated[idx] = {
      ...updated[idx],
      starter: probeEditStarter.trim() || updated[idx].starter,
      followUp: probeEditFollowUp.trim() || updated[idx].followUp,
      pinned: true,
    };
    setSampleQuestions(updated);
    setEditingProbeIdx(null);
    await refreshGeneratedPrompt(difficultyTier, studentDecidesWeightage, durationMinutes, updated);
  };

  const handleTogglePinProbe = async (idx: number) => {
    if (!sampleQuestions[idx]) return;
    const updated = [...sampleQuestions];
    updated[idx] = {
      ...updated[idx],
      pinned: !updated[idx].pinned,
    };
    setSampleQuestions(updated);
    await refreshGeneratedPrompt(difficultyTier, studentDecidesWeightage, durationMinutes, updated);
  };

  // Transition Step 3 -> Step 4 (Final Review & Launch)
  const handleProceedToReview = async () => {
    navigateToStep(4);
    await refreshGeneratedPrompt();
  };

  // Step 4 Actions: Save Preset & Launch Viva
  const handleSavePreset = async () => {
    if (!courseTitle.trim()) {
      setValidationError("Course title is mandatory.");
      return;
    }
    if (!leadProfessor.trim()) {
      setValidationError("Lead Professor / Course In-Charge name is mandatory.");
      return;
    }
    setValidationError(null);

    const flatItems = flattenTree(tree);
    if (flatItems.length === 0) {
      setSavedPresetNotice("Cannot save preset with 0 topics.");
      return;
    }

    const effectiveLeadProf = leadProfessor.trim();
    const effectiveInstructor = `${effectiveLeadProf} • TA: ${supervisingTaName}`;

    setIsSavingPreset(true);
    try {
      const res = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          id: editingExamId || undefined,
          courseTitle: courseTitle.trim(),
          instructorId: effectiveInstructor,
          leadProfessor: effectiveLeadProf,
          supervisingTaId: supervisingTaId || "inst_ta1",
          supervisingTaName: supervisingTaName || "ta1 (Teaching Assistant)",
          difficultyTier,
          durationMinutes,
          studentDecidesWeightage,
          globalDirective,
          accessControl: {
            type: accessControlType,
            allowedStudents: accessControlType === "RESTRICTED" ? allowedStudents : undefined,
          },
          totalTopics: flatItems.length,
          topics: flatItems,
          systemPrompt: generatedPrompt,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save exam preset");
      }

      const isUpdate = Boolean(editingExamId);
      setSavedPresetNotice(
        isUpdate
          ? `Exam preset "${data.exam.courseTitle}" successfully updated in SQLite database (${data.exam.totalTopics} topics).`
          : `Exam preset locked to SQLite database: "${data.exam.courseTitle}" (${data.exam.totalTopics} topics saved).`
      );

      // Refresh presets list so cockpit stays 100% in sync
      fetchPresets();
    } catch (err: any) {
      console.error(err);
      setSavedPresetNotice(`Error saving preset: ${err.message}`);
    } finally {
      setIsSavingPreset(false);
    }
  };

  // Start fresh curriculum in builder
  const handleStartNewExam = () => {
    setEditingExamId(null);
    setCourseTitle("");
    const defaultProf = currentInstructor?.role === "PROFESSOR" ? currentInstructor.displayName : (currentInstructor?.department === "sub2" ? "Prof 2 (sub2)" : "Prof 1 (sub1)");
    const defaultTaId = currentInstructor?.role === "TA" ? currentInstructor.id : (currentInstructor?.department === "sub2" ? "inst_ta21" : "inst_ta11");
    const defaultTaName = currentInstructor?.role === "TA" ? `${currentInstructor.displayName} (${currentInstructor.username})` : (currentInstructor?.department === "sub2" ? "TA 21 (ta21)" : "TA 11 (ta11)");
    setLeadProfessor(defaultProf);
    setInstructorId(defaultProf);
    setSupervisingTaId(defaultTaId);
    setSupervisingTaName(defaultTaName);
    setDifficultyTier("undergrad_3");
    setDurationMinutes(10);
    setStudentDecidesWeightage(false);
    setGlobalDirective("");
    setAccessControlType("OPEN");
    setAllowedStudents([]);
    setTree([]);
    setTopicBubbles([]);
    setGeneratedPrompt("");
    setSavedPresetNotice(null);
    navigateToWizardMode(1, false);
  };

  // Edit existing syllabus in interactive tree builder
  const handleEditPreset = (preset: ExamPreset) => {
    setEditingExamId(preset.id);
    setCourseTitle(preset.courseTitle || "");
    const profName = preset.leadProfessor || preset.instructorId || "Prof 1 (Course Faculty In-Charge)";
    setLeadProfessor(profName);
    setInstructorId(preset.instructorId || profName);
    setSupervisingTaId(preset.supervisingTaId || "inst_ta1");
    setSupervisingTaName(preset.supervisingTaName || "ta1 (Teaching Assistant)");
    setDifficultyTier((preset.difficultyTier as RigorTier) || "undergrad_3");
    setDurationMinutes(preset.durationMinutes || 10);
    setStudentDecidesWeightage(Boolean(preset.studentDecidesWeightage));
    setGlobalDirective(preset.globalDirective || "");
    setAccessControlType(preset.accessControl?.type || "OPEN");
    setAllowedStudents(preset.accessControl?.allowedStudents || []);

    const reconstructedTree = reconstructTreeFromTOC(preset.topics || []);
    setTree(reconstructedTree);

    const bubbles = (preset.topics || [])
      .filter((t) => t.level === 1)
      .map((t) => t.title);
    setTopicBubbles(bubbles.length > 0 ? bubbles : [preset.courseTitle]);

    setGeneratedPrompt(preset.systemPrompt || "");
    setSavedPresetNotice(null);

    // Jump straight to interactive tree builder for immediate visual topic editing
    navigateToWizardMode(2, false);
  };

  // Delete preset from SQLite database with in-app confirmation
  const handleInitiateDeletePreset = (presetId: string, title: string) => {
    setDeletePresetTarget({ id: presetId, title });
  };

  const handleConfirmDeletePreset = async () => {
    if (!deletePresetTarget) return;
    setIsDeletingPreset(true);
    setPresetNotice(null);
    try {
      const res = await fetch(`/api/presets?id=${encodeURIComponent(deletePresetTarget.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setPresets((prev) => prev.filter((p) => p.id !== deletePresetTarget.id));
        setPresetNotice({
          type: "success",
          message: `Syllabus "${deletePresetTarget.title}" deleted from openviva.db.`,
        });
        setDeletePresetTarget(null);
      } else {
        const data = await res.json();
        setPresetNotice({
          type: "error",
          message: `Failed to delete syllabus: ${data.error || "Unknown error"}`,
        });
      }
    } catch (err: any) {
      console.error("Delete preset failed:", err);
      setPresetNotice({
        type: "error",
        message: `Delete failed: ${err.message}`,
      });
    } finally {
      setIsDeletingPreset(false);
    }
  };

  // Launch defense room directly from saved preset
  const handleLaunchExamFromPreset = (preset: ExamPreset) => {
    const tocResponse: DocumentTOCResponse = {
      filename: `${preset.courseTitle}.syllabus`,
      total_pages: 1,
      extraction_mode: "Stored SQLite Curriculum Preset",
      total_items: preset.topics?.length || preset.totalTopics || 0,
      items: preset.topics || [],
    };
    onLaunchExamRoom(tocResponse, preset.systemPrompt, preset.durationMinutes);
  };

  // Retry evaluation pass for failed or pending session
  const handleRetrySessionEvaluation = async (session: ExamSessionRecord) => {
    setRetryingSessionId(session.sessionId);
    try {
      const res = await fetch("/api/defense/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "retry_evaluation",
          sessionId: session.sessionId,
        }),
      });

      const data = await res.json();
      if (res.ok && data.record) {
        setSessions((prev) =>
          prev.map((s) => (s.sessionId === session.sessionId ? data.record : s))
        );
        if (selectedSessionForModal?.sessionId === session.sessionId) {
          setSelectedSessionForModal(data.record);
        }
      } else {
        alert(`Retry evaluation failed: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      console.error("Retry failed:", err);
      alert(`Retry failed: ${err.message}`);
    } finally {
      setRetryingSessionId(null);
    }
  };

  const handleLaunchSession = () => {
    if (!courseTitle.trim()) {
      setValidationError("Course title is mandatory.");
      return;
    }
    const effectiveProf = leadProfessor.trim() || instructorId.trim();
    if (!effectiveProf) {
      setValidationError("Lead Professor / Course In-Charge name is mandatory.");
      return;
    }
    setValidationError(null);

    const flatItems = flattenTree(tree);
    const tocResponse: DocumentTOCResponse = {
      filename: `${courseTitle}.syllabus`,
      total_pages: 1,
      extraction_mode: "Interactive Co-Pilot Curriculum Generator",
      total_items: flatItems.length,
      items: flatItems,
    };
    onLaunchExamRoom(tocResponse, generatedPrompt, durationMinutes);
  };

  // HARD AUTHENTICATION GATE: Require login/sign-up before entering Cockpit or Builder
  if (authChecking) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center space-y-4 font-sans text-white">
        <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
        <div className="text-xs font-mono text-zinc-400">Verifying instructor session...</div>
      </div>
    );
  }

  if (!currentInstructor) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center py-10 px-4 font-sans text-white">
        <div className="w-full max-w-md space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Teaching Assistant Gate</span>
            </div>
            <h1 className="text-3xl font-medium tracking-tight text-white">
              Instructor Cockpit
            </h1>
            <p className="text-xs text-zinc-400 max-w-sm mx-auto">
              Sign in with your staff credentials to configure course syllabi, supervise live viva chambers, and audit evaluations.
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/70 backdrop-blur-xl p-6 sm:p-7 space-y-5 shadow-2xl">
            {/* Quick 1-Click Course Professors Login */}
            <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-3.5 space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 block">
                Quick Access • Course Professors
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleLogin("proff1", "password1")}
                  disabled={authLoading}
                  className="px-3 py-2.5 rounded-lg bg-zinc-800/70 hover:bg-zinc-800 border border-zinc-700/60 text-xs text-left transition cursor-pointer flex items-center justify-between group"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">🏛️</span>
                    <div>
                      <span className="font-medium text-white block">proff1 (sub1)</span>
                      <span className="text-[10px] text-zinc-400 font-mono">Password: password1</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded group-hover:bg-emerald-500/20 transition">
                    Sign In →
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleLogin("proff2", "password2")}
                  disabled={authLoading}
                  className="px-3 py-2.5 rounded-lg bg-zinc-800/70 hover:bg-zinc-800 border border-zinc-700/60 text-xs text-left transition cursor-pointer flex items-center justify-between group"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">🏛️</span>
                    <div>
                      <span className="font-medium text-white block">proff2 (sub2)</span>
                      <span className="text-[10px] text-zinc-400 font-mono">Password: password2</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded group-hover:bg-emerald-500/20 transition">
                    Sign In →
                  </span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between px-1 py-1 border-b border-zinc-800/80 pb-2">
              <span className="text-xs font-medium text-white">Staff Authentication</span>
              <span className="text-[10px] font-mono text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                Institutional Only
              </span>
            </div>

            {/* Error Message */}
            {authError && (
              <div className="p-3 rounded-xl border border-red-500/30 bg-red-950/20 text-xs text-red-300 font-mono flex items-center gap-2">
                <span>⚠️</span>
                <span>{authError}</span>
              </div>
            )}

            {/* STRICT SIGN IN ONLY */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleLogin();
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono uppercase tracking-widest text-zinc-400 block">
                  Staff Username
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ta1 or gpn"
                  value={authUsername}
                  onChange={(e) => setAuthUsername(e.target.value)}
                  className="w-full bg-zinc-900/70 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono uppercase tracking-widest text-zinc-400 block">
                  Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="w-full bg-zinc-900/70 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
                />
              </div>
              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-2.5 rounded-xl bg-white text-black hover:bg-zinc-200 font-medium text-xs transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 mt-2 shadow-sm"
              >
                {authLoading ? "Verifying Credentials..." : "Sign In to Cockpit →"}
              </button>
            </form>

            {/* Institutional Security Notice */}
            <div className="p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/60 text-[11px] text-zinc-400 leading-relaxed">
              <span className="text-zinc-300 font-medium block mb-0.5">🔒 Restricted Staff Portal</span>
              Public registration is disabled. Teaching Assistants must be provisioned directly by the Course Professor inside the Cockpit.
            </div>
          </div>

          {/* Return to Student Gateway */}
          <div className="text-center">
            <button
              type="button"
              onClick={onBackToGateway}
              className="text-xs text-zinc-500 hover:text-zinc-300 font-mono transition cursor-pointer"
            >
              ← Return to Student Gateway
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (taViewMode === "choice") {
    // Filter Presets: strictly limited to the logged-in TA's supervised syllabi
    const activeTaId = currentInstructor?.id || supervisingTaId;
    const activeTaUsername = currentInstructor?.username || "ta1";

    const filteredStudents = allStudents.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      (s.studentName || "").toLowerCase().includes(q) ||
      (s.regNo || "").toLowerCase().includes(q) ||
      (s.department || "").toLowerCase().includes(q) ||
      (s.cohort || "").toLowerCase().includes(q)
    );
  });

    const isProfessor = currentInstructor?.role === "PROFESSOR";
    const isAdmin = currentInstructor?.role === "ADMIN";

    const supervisedTas = registeredInstructors.filter((inst) => {
      if (inst.role !== "TA") return false;
      if (isProfessor && currentInstructor?.department) {
        return inst.department === currentInstructor.department;
      }
      return true;
    });

    const supervisedTaIds = new Set(supervisedTas.map((t) => t.id));
    const supervisedTaUsers = new Set(supervisedTas.map((t) => t.username.toLowerCase()));

    const filteredPresets = presets.filter((p) => {
      if (isAdmin) {
        if (selectedTaFilter !== "ALL") {
          const match = p.supervisingTaId === selectedTaFilter || p.supervisingTaId === `inst_${selectedTaFilter}`;
          if (!match) return false;
        }
      } else if (isProfessor) {
        if (selectedTaFilter !== "ALL") {
          const match =
            p.supervisingTaId === selectedTaFilter ||
            p.supervisingTaId === `inst_${selectedTaFilter}` ||
            (p.supervisingTaName && p.supervisingTaName.toLowerCase().includes(selectedTaFilter.toLowerCase()));
          if (!match) return false;
        } else {
          // All TAs under this professor's department
          const match =
            (p.supervisingTaId && (supervisedTaIds.has(p.supervisingTaId) || supervisedTaIds.has(`inst_${p.supervisingTaId}`))) ||
            (p.supervisingTaName && Array.from(supervisedTaUsers).some((u) => p.supervisingTaName?.toLowerCase().includes(u))) ||
            p.instructorId === currentInstructor?.id;
          if (!match) return false;
        }
      } else {
        // TA mode: strictly limited to logged-in TA
        const isMine =
          p.supervisingTaId === activeTaId ||
          p.supervisingTaId === `inst_${activeTaUsername}` ||
          (p.supervisingTaName && p.supervisingTaName.toLowerCase().includes(activeTaUsername.toLowerCase())) ||
          (!p.supervisingTaId && activeTaUsername === "ta1");
        if (!isMine) return false;
      }

      const q = searchQuery.toLowerCase();
      if (!q) return true;
      return (
        p.courseTitle.toLowerCase().includes(q) ||
        (p.leadProfessor && p.leadProfessor.toLowerCase().includes(q)) ||
        p.instructorId.toLowerCase().includes(q) ||
        (p.topics || []).some((t) => t.title.toLowerCase().includes(q))
      );
    });

    // Helper to evaluate flags and verdict for a defense session
    const getSessionFlagAnalysis = (s: ExamSessionRecord) => {
      const ev = s.evaluationResult;
      const baudit = ev?.behavioralAudit as any;
      const bflags = ev?.behavioralFlags || [];

      // 0. Voice Enrollment Status
      const isVoiceUnenrolled = Boolean(
        (ev?.verdict as any) === "UNAUDITED_NO_VOICE_ENROLLED" ||
        (baudit?.verdict as any) === "UNAUDITED_NO_VOICE_ENROLLED" ||
        (Array.isArray(baudit?.flags) && baudit.flags.includes("REFERENCE_VOICE_NOT_ENROLLED")) ||
        bflags.some((f) => f.flag === "REFERENCE_VOICE_NOT_ENROLLED")
      );

      // 1. Biometric Impersonation / Takeover (Strictly excluded if student had no enrolled reference voice)
      const isBiometricFlagged = Boolean(
        !isVoiceUnenrolled && (
          (ev?.verdict as any) === "IMPOSTER_PROXY_TAKEOVER" ||
          (baudit?.verdict as any) === "IMPOSTER_PROXY_TAKEOVER" ||
          (Array.isArray(baudit?.flags) && baudit.flags.includes("IMPOSTER_PROXY_TAKEOVER")) ||
          bflags.some((f) => f.flag === "IMPOSTER_PROXY_TAKEOVER" || f.flag?.toLowerCase().includes("imposter")) ||
          ev?.biometricAudit?.verificationStatus === "FLAGGED"
        )
      );

      // 2. Multi-Speaker / Accomplice / Off-camera Proxy
      const isAccompliceFlagged = Boolean(
        (Array.isArray(baudit?.flags) && (baudit.flags.includes("ACCOMPLICE_DETECTED") || baudit.flags.includes("MULTI_SPEAKER"))) ||
        ev?.biometricAudit?.secondaryVoiceDetected ||
        bflags.some((f) => f.flag === "ACCOMPLICE_DETECTED" || f.flag?.toLowerCase().includes("accomplice") || f.flag?.toLowerCase().includes("secondary") || f.flag?.toLowerCase().includes("proxy"))
      );

      // 3. Behavioral Integrity Flags (filibuster, evasion, anomalous reading)
      const isIntegrityFlagged = Boolean(
        baudit?.filibusterDetected ||
        baudit?.evasionAttempted ||
        bflags.some((f) => {
          const fl = f.flag?.toUpperCase() || "";
          return fl !== "IMPOSTER_PROXY_TAKEOVER" && 
                 fl !== "ACCOMPLICE_DETECTED" && 
                 fl !== "REFERENCE_VOICE_NOT_ENROLLED" &&
                 !fl.includes("IMPOSTER") && 
                 !fl.includes("ACCOMPLICE") &&
                 !fl.includes("NOT_ENROLLED");
        })
      );

      // 4. Biometric Authenticated / Verified
      const isAuthentic = Boolean(
        (ev?.verdict as any) === "VERIFIED_AUTHENTIC" ||
        (baudit?.verdict as any) === "VERIFIED_AUTHENTIC" ||
        ev?.biometricAudit?.verificationStatus === "AUTHENTICATED"
      );

      const dominantSimilarity = typeof baudit?.dominantSimilarity === "number" ? baudit.dominantSimilarity : null;
      const score = typeof ev?.overallScore === "number" ? ev.overallScore : null;
      const academicVerdict = ev?.verdict || null;

      // Extract first snippet quote for explanation preview
      const topSnippet = bflags[0]?.turnSnippet || (Array.isArray(baudit?.evidenceSnippets) && baudit.evidenceSnippets[0]?.turnSnippet) || null;

      return {
        isVoiceUnenrolled,
        isBiometricFlagged,
        isAccompliceFlagged,
        isIntegrityFlagged,
        hasAnyFlag: isBiometricFlagged || isAccompliceFlagged || isIntegrityFlagged,
        isAuthentic,
        dominantSimilarity,
        score,
        academicVerdict,
        topSnippet,
      };
    };

    // Scoped Sessions: strictly limited to the logged-in TA's supervised defenses, or Professor's TAs
    const scopedSessions = sessions.filter((s) => {
      if (isAdmin) {
        if (selectedTaFilter !== "ALL") {
          const match = s.supervisingTaId === selectedTaFilter || s.supervisingTaId === `inst_${selectedTaFilter}`;
          if (!match) return false;
        }
      } else if (isProfessor) {
        if (selectedTaFilter !== "ALL") {
          const match =
            s.supervisingTaId === selectedTaFilter ||
            s.supervisingTaId === `inst_${selectedTaFilter}` ||
            (s.supervisingTaName && s.supervisingTaName.toLowerCase().includes(selectedTaFilter.toLowerCase()));
          if (!match) return false;
        } else {
          // All TAs under this professor's department
          const match =
            (s.supervisingTaId && (supervisedTaIds.has(s.supervisingTaId) || supervisedTaIds.has(`inst_${s.supervisingTaId}`))) ||
            (s.supervisingTaName && Array.from(supervisedTaUsers).some((u) => s.supervisingTaName?.toLowerCase().includes(u))) ||
            s.instructorId === currentInstructor?.id ||
            (!s.instructorId && !s.supervisingTaId);
          if (!match) return false;
        }
      } else {
        // TA mode: strictly limited to logged-in TA
        const isMine =
          s.supervisingTaId === activeTaId ||
          s.supervisingTaId === `inst_${activeTaUsername}` ||
          (s.supervisingTaName && s.supervisingTaName.toLowerCase().includes(activeTaUsername.toLowerCase())) ||
          (!s.supervisingTaId && activeTaUsername === "ta1");
        if (!isMine) return false;

        // Strict Syllabus Bounding: TA must ONLY see sessions for courses they supervise!
        const myCourseTitles = new Set(filteredPresets.map((p) => p.courseTitle.trim().toLowerCase()));
        if (myCourseTitles.size > 0 && s.courseTitle && !myCourseTitles.has(s.courseTitle.trim().toLowerCase())) {
          return false;
        }
      }
      return true;
    });

    // Counts within current TA / Prof scope for filter tabs
    const bioFlagCount = scopedSessions.filter((s) => getSessionFlagAnalysis(s).isBiometricFlagged).length;
    const accompliceFlagCount = scopedSessions.filter((s) => getSessionFlagAnalysis(s).isAccompliceFlagged).length;
    const integrityFlagCount = scopedSessions.filter((s) => getSessionFlagAnalysis(s).isIntegrityFlagged).length;
    const anyFlagCount = scopedSessions.filter((s) => getSessionFlagAnalysis(s).hasAnyFlag).length;
    const completedCount = scopedSessions.filter((s) => s.status === "COMPLETED").length;
    const inProgressCount = scopedSessions.filter((s) => s.status === "IN_PROGRESS" || s.status === "PENDING_EVALUATION").length;

    // Filter Sessions by status / flag category & search query
    const baseSessions = scopedSessions.filter((s) => {
      if (sessionFilterStatus === "FLAGGED_BIOMETRIC") {
        if (!getSessionFlagAnalysis(s).isBiometricFlagged) return false;
      } else if (sessionFilterStatus === "FLAGGED_ACCOMPLICE") {
        if (!getSessionFlagAnalysis(s).isAccompliceFlagged) return false;
      } else if (sessionFilterStatus === "FLAGGED_INTEGRITY") {
        if (!getSessionFlagAnalysis(s).isIntegrityFlagged) return false;
      } else if (sessionFilterStatus === "FLAGGED_ANY") {
        if (!getSessionFlagAnalysis(s).hasAnyFlag) return false;
      } else if (sessionFilterStatus !== "ALL" && s.status !== sessionFilterStatus) {
        return false;
      }

      const q = searchQuery.toLowerCase();
      if (!q) return true;
      return (
        s.studentId.toLowerCase().includes(q) ||
        s.courseTitle.toLowerCase().includes(q) ||
        s.sessionId.toLowerCase().includes(q)
      );
    });

    // Available Vivas for this TA / Professor scope (strictly bounded to assigned courses)
    const availableVivas: { title: string; count: number }[] = [];
    const vivaMap = new Map<string, number>();
    const myCourseTitles = new Set(filteredPresets.map((p) => p.courseTitle.trim().toLowerCase()));

    // Seed from assigned presets first so the TA's vivas are always listed
    filteredPresets.forEach((p) => {
      const title = p.courseTitle?.trim();
      if (title && !vivaMap.has(title)) {
        vivaMap.set(title, 0);
      }
    });

    baseSessions.forEach((s) => {
      const title = s.courseTitle?.trim();
      if (!title) return;
      if (!isProfessor && !isAdmin && !myCourseTitles.has(title.toLowerCase())) {
        return;
      }
      vivaMap.set(title, (vivaMap.get(title) || 0) + 1);
    });

    vivaMap.forEach((count, title) => {
      availableVivas.push({ title, count });
    });

    // Filter Sessions by selected specific Viva (or ALL)
    const filteredSessions = baseSessions.filter((s) => {
      if (selectedVivaFilter === "ALL") return true;
      const title = s.courseTitle?.trim() || "Oral Defense Examination";
      return title.toLowerCase() === selectedVivaFilter.toLowerCase();
    });

    // Group Sessions by Viva / Course
    const groupedSessions: Record<string, ExamSessionRecord[]> = {};
    filteredSessions.forEach((s) => {
      const title = s.courseTitle?.trim() || "Oral Defense Examination";
      if (!groupedSessions[title]) groupedSessions[title] = [];
      groupedSessions[title].push(s);
    });

    // Compute Session Metrics (for current scope overview)
    const completedSessions = scopedSessions.filter((s) => s.status === "COMPLETED");
    const activeSessions = scopedSessions.filter(
      (s) => s.status === "IN_PROGRESS" || s.status === "PENDING_EVALUATION"
    );
    const totalRecordedTurns = scopedSessions.reduce(
      (acc, s) => acc + (s.turnCount || s.transcript?.length || 0),
      0
    );

    const filteredFlaggedSessions = scopedSessions.filter((s) => getSessionFlagAnalysis(s).hasAnyFlag);

    const renderSessionCard = (session: ExamSessionRecord) => {
      const isCompleted = session.status === "COMPLETED";
      const isFailed = session.status === "EVALUATION_FAILED";
      const isPending = session.status === "PENDING_EVALUATION";
      const isInProgress = session.status === "IN_PROGRESS";
      const durationMin = Math.floor((session.actualDurationSeconds || 0) / 60);
      const durationSec = (session.actualDurationSeconds || 0) % 60;
      const flags = getSessionFlagAnalysis(session);

      const isFlagged = flags.hasAnyFlag;
      const cardBorder = isFlagged
        ? "border border-zinc-800/80 border-l-[3px] border-l-red-500 bg-zinc-950/70 hover:border-red-900/60"
        : "border border-zinc-800/80 border-l-[3px] border-l-emerald-500 bg-zinc-950/70 hover:border-zinc-700";

      return (
        <div
          key={session.sessionId}
          className={`p-4 sm:p-5 rounded-2xl transition flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm ${cardBorder}`}
        >
          {/* Left: Candidate ID, Title, Prof & TA, Metadata & Dialogue Preview */}
          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs font-semibold text-white px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 shrink-0">
                {session.studentId}
              </span>
              <h3 className="text-base font-semibold text-white truncate">
                {session.courseTitle}
              </h3>
            </div>

            <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
              <span>Prof: {session.leadProfessor || session.instructorId || "Prof 1 (sub1)"}</span>
              <span className="text-zinc-600">•</span>
              <span className="text-emerald-400">TA: {session.supervisingTaName || "TA 11 (ta11)"}</span>
            </div>

            <div className="flex items-center gap-2.5 text-xs text-zinc-500 font-mono">
              <span>🕒 {durationMin > 0 ? `${durationMin}h ` : ""}{durationSec}s</span>
              <span className="text-zinc-700">•</span>
              <span>{session.turnCount || session.transcript?.length || 0} turns</span>
              <span className="text-zinc-700">•</span>
              <span>{new Date(session.startedAt).toLocaleString()}</span>
            </div>

            {/* Flagged Dialogue preview (collapsible/expandable in place) */}
            {isFlagged && flags.topSnippet && (
              <div
                onClick={() =>
                  setExpandedDialogueSessionId(
                    expandedDialogueSessionId === session.sessionId ? null : session.sessionId
                  )
                }
                className="mt-2 text-[11px] font-mono text-red-300 bg-red-950/30 hover:bg-red-950/50 border border-red-900/40 rounded-xl px-3 py-2 cursor-pointer transition flex items-center justify-between gap-2"
                title="Click to expand full flagged dialogue"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-red-400 font-bold shrink-0">🚨 Flagged Dialogue:</span>
                  <span
                    className={`italic text-zinc-300 ${
                      expandedDialogueSessionId === session.sessionId ? "whitespace-pre-wrap" : "truncate"
                    }`}
                  >
                    "{flags.topSnippet}"
                  </span>
                </div>
                <span className="text-[10px] text-zinc-400 shrink-0 font-sans">
                  {expandedDialogueSessionId === session.sessionId ? "▲ Collapse" : "▼ Expand"}
                </span>
              </div>
            )}
          </div>

          {/* Right: Security Flag / Completion status & Review Defense Dossier action */}
          <div className="flex items-center gap-3 shrink-0 flex-wrap sm:flex-nowrap justify-end">
            {isFlagged ? (
              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                {flags.isBiometricFlagged && (
                  <span className="px-3 py-1 rounded-full text-xs font-mono font-semibold bg-red-950/60 border border-red-500/60 text-red-300 flex items-center gap-1.5 shadow-sm shadow-red-950/40">
                    <span>▲</span>
                    <span>Biometric Impersonation</span>
                    {flags.dominantSimilarity !== null && (
                      <span className="text-red-400 font-mono text-[10px]">
                        ({(flags.dominantSimilarity * 100).toFixed(1)}%)
                      </span>
                    )}
                  </span>
                )}
                {flags.isAccompliceFlagged && (
                  <span className="px-3 py-1 rounded-full text-xs font-mono font-semibold bg-orange-950/60 border border-orange-500/60 text-orange-300 flex items-center gap-1.5">
                    <span>▲</span>
                    <span>Proxy Detected</span>
                  </span>
                )}
                {flags.isIntegrityFlagged && (
                  <span className="px-3 py-1 rounded-full text-xs font-mono font-semibold bg-amber-950/60 border border-amber-500/60 text-amber-300 flex items-center gap-1.5">
                    <span>▲</span>
                    <span>Integrity Flag</span>
                  </span>
                )}
                {flags.score !== null && (
                  <span className="px-2.5 py-1 rounded-xl text-xs font-mono font-bold bg-zinc-900 border border-zinc-700 text-zinc-200">
                    Score: {flags.score}/100
                  </span>
                )}
              </div>
            ) : isCompleted ? (
              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                {flags.isVoiceUnenrolled && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-zinc-900 border border-zinc-700 text-zinc-400 flex items-center gap-1 shadow-sm">
                    <span className="text-zinc-500">ℹ</span>
                    <span>Voice Unenrolled</span>
                  </span>
                )}
                <span className="px-3 py-1 rounded-full text-xs font-mono font-medium bg-emerald-950/40 border border-emerald-500/40 text-emerald-400 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>Completed</span>
                </span>
              </div>
            ) : isInProgress ? (
              <span className="px-3 py-1 rounded-full text-xs font-mono bg-amber-950/40 border border-amber-500/40 text-amber-300 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                <span>Live Defense</span>
              </span>
            ) : isPending ? (
              <span className="px-3 py-1 rounded-full text-xs font-mono bg-emerald-950/40 border border-emerald-500/40 text-emerald-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>Completed</span>
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full text-xs font-mono bg-zinc-900 border border-zinc-700 text-zinc-400">
                Archived
              </span>
            )}

            <button
              type="button"
              onClick={() => {
                setSelectedSessionForModal(session);
              }}
              className="px-4 py-2 rounded-xl text-xs font-medium bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-200 hover:text-white transition cursor-pointer shrink-0"
            >
              Review Defense Dossier →
            </button>
          </div>
        </div>
      );
    };

    return (
      <div className="min-h-[85vh] flex flex-col justify-between py-6 px-2 sm:px-4 font-sans text-white max-w-6xl mx-auto space-y-8">
        <div className="space-y-6">
          {/* Header & Quick Action Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-zinc-900">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[11px] font-mono uppercase tracking-widest text-zinc-400">
                  INSTRUCTOR CONSOLE • ONLINE
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
                Teaching Assistant Console
              </h1>
              <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                Manage examination syllabus in openviva.db and inspect candidate oral defense telemetry.
              </p>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              {/* Active Instructor Role & Context Pill */}
              <div className="flex items-center gap-2.5 bg-zinc-900/80 border border-zinc-800 rounded-full px-3 py-1.5 text-xs shadow-sm">
                {currentInstructor ? (
                  <>
                    <span
                      className={`px-3 py-0.5 rounded-full text-[11px] font-medium flex items-center gap-1.5 ${
                        currentInstructor.role === "PROFESSOR"
                          ? "bg-indigo-950/90 text-indigo-300 border border-indigo-700/60"
                          : currentInstructor.role === "ADMIN"
                          ? "bg-emerald-950/90 text-emerald-300 border border-emerald-700/60"
                          : "bg-blue-950/90 text-blue-300 border border-blue-700/60"
                      }`}
                    >
                      <span>🎓</span>
                      <span>
                        {currentInstructor.role === "PROFESSOR"
                          ? "Professor"
                          : currentInstructor.role === "ADMIN"
                          ? "Admin"
                          : "Teaching Assistant"}
                      </span>
                    </span>
                    <span className="font-medium text-zinc-200 truncate max-w-[140px]" title={currentInstructor.displayName}>
                      {currentInstructor.displayName}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthError(null);
                        setShowAuthModal(true);
                      }}
                      className="text-[11px] text-zinc-400 hover:text-white cursor-pointer transition flex items-center gap-0.5 ml-1"
                      title="Switch Instructor Account"
                    >
                      <span>Switch</span>
                      <span className="text-[9px]">⌄</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="text-[11px] text-zinc-500 hover:text-red-400 cursor-pointer transition ml-1"
                      title="Sign Out"
                    >
                      Sign Out
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setAuthError(null);
                      setShowAuthModal(true);
                    }}
                    className="text-xs text-amber-300 hover:text-amber-200 flex items-center gap-1.5 cursor-pointer font-medium"
                  >
                    <span>🔑</span>
                    <span>Sign In (Offline)</span>
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={handleStartNewExam}
                className="px-4 py-2 rounded-full bg-white text-black hover:bg-zinc-200 text-xs font-medium transition cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-[0.98]"
              >
                <span>+ Build New Syllabus</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingExamId(null);
                  navigateToWizardMode(1, true);
                }}
                className="px-4 py-2 rounded-full border border-zinc-800 bg-zinc-900/80 hover:bg-zinc-800 text-xs font-medium text-zinc-200 transition cursor-pointer flex items-center gap-1.5 active:scale-[0.98]"
              >
                <span>⬆ Upload Syllabus</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  fetchPresets();
                  fetchSessions();
                }}
                className="p-2 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 text-zinc-400 hover:text-white transition cursor-pointer flex items-center justify-center text-sm"
                title="Refresh from SQLite"
              >
                🔄
              </button>
            </div>
          </div>

          {/* Primary Navigation Bar (Enclosed Pill Container matching Mockup) */}
          <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-2xl p-1.5 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-1.5 flex-wrap md:flex-nowrap">
              <button
                type="button"
                onClick={() => setCockpitTab("presets")}
                className={`px-3.5 py-2 rounded-xl text-xs font-medium transition cursor-pointer flex items-center gap-2.5 shrink-0 ${
                  cockpitTab === "presets"
                    ? "tab-smoke-diffusion text-white"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50"
                }`}
              >
                <span>📖 Course Syllabi & Presets</span>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono shrink-0 transition ${
                  cockpitTab === "presets"
                    ? "bg-black/60 text-white border border-white/10 shadow-inner"
                    : "bg-zinc-900 text-zinc-400"
                }`}>
                  {filteredPresets.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setCockpitTab("sessions")}
                className={`px-3.5 py-2 rounded-xl text-xs font-medium transition cursor-pointer flex items-center gap-2.5 shrink-0 ${
                  cockpitTab === "sessions"
                    ? "tab-smoke-diffusion text-white"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50"
                }`}
              >
                <span>⚖️ Defenses & Evaluations</span>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono shrink-0 transition ${
                  cockpitTab === "sessions"
                    ? "bg-black/60 text-white border border-white/10 shadow-inner"
                    : "bg-zinc-900 text-zinc-400"
                }`}>
                  {filteredSessions.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCockpitTab("roster");
                  fetchStudents();
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-medium transition cursor-pointer flex items-center gap-2.5 shrink-0 ${
                  cockpitTab === "roster"
                    ? "tab-smoke-diffusion text-white"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50"
                }`}
              >
                <span>🎓 Class Roster & Credentials</span>
                <span className={`min-w-5 h-5 px-1 rounded-full flex items-center justify-center text-[10px] font-mono shrink-0 transition ${
                  cockpitTab === "roster"
                    ? "bg-black/60 text-white border border-white/10 shadow-inner"
                    : "bg-zinc-900 text-zinc-400"
                }`}>
                  {allStudents.length}
                </span>
              </button>

              {/* Gated Course Staff Tab strictly visible to PROFESSOR or ADMIN */}
              {(currentInstructor?.role === "PROFESSOR" || currentInstructor?.role === "ADMIN") && (
                <button
                  type="button"
                  onClick={() => {
                    setCockpitTab("staff");
                    fetchInstructorsList();
                  }}
                  className={`px-3.5 py-2 rounded-xl text-xs font-medium transition cursor-pointer flex items-center gap-2.5 shrink-0 ${
                    cockpitTab === "staff"
                      ? "tab-smoke-diffusion text-amber-200"
                      : "text-zinc-400 hover:text-amber-200 hover:bg-amber-950/30"
                  }`}
                >
                  <span>👥 Course Staff & TAs</span>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono shrink-0 transition ${
                    cockpitTab === "staff"
                      ? "bg-black/60 text-amber-200 border border-amber-400/20 shadow-inner"
                      : "bg-zinc-900 text-amber-400"
                  }`}>
                    {registeredInstructors.length}
                  </span>
                </button>
              )}
            </div>

            {/* Global Search Input with Search Icon */}
            <div className="relative w-full md:w-64 pr-1">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-zinc-500 text-xs">
                🔍
              </span>
              <input
                type="text"
                placeholder={
                  cockpitTab === "presets"
                    ? "Search courses or topics..."
                    : cockpitTab === "sessions"
                    ? "Search candidate or course..."
                    : cockpitTab === "roster"
                    ? "Search student name or reg_no..."
                    : "Search staff members..."
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* TAB 1: CURRICULUMS & PRESETS (SQLite backed) */}
          {cockpitTab === "presets" && (
            <div className="space-y-5">
              {/* Syllabus Action Notification */}
              {presetNotice && (
                <div
                  className={`p-3.5 rounded-xl border text-xs flex items-center justify-between transition-all ${
                    presetNotice.type === "success"
                      ? "bg-emerald-950/50 border-emerald-800/80 text-emerald-300"
                      : "bg-red-950/50 border-red-800/80 text-red-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>{presetNotice.type === "success" ? "✓" : "⚠"}</span>
                    <span>{presetNotice.message}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPresetNotice(null)}
                    className="text-zinc-400 hover:text-white text-xs cursor-pointer px-1.5"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Contextual Supervision Filters */}
              {(isProfessor || isAdmin) && (
                <div className="p-5 rounded-2xl border border-indigo-900/50 bg-gradient-to-r from-indigo-950/30 via-zinc-950/60 to-zinc-950/40 space-y-3.5 shadow-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl">🏛️</span>
                      <div>
                        <span className="text-xs font-semibold text-white">Course Faculty Syllabus Supervision</span>
                        <span className="text-[11px] text-zinc-400 block font-mono">
                          Department: {currentInstructor?.department || "sub1"} / Filter courses by supervising Teaching Assistant
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950/80 border border-indigo-800/60 px-3 py-1 rounded-full self-start sm:self-auto">
                      {supervisedTas.length} Teaching Assistants
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <button
                      type="button"
                      onClick={() => setSelectedTaFilter("ALL")}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition cursor-pointer flex items-center gap-2 ${
                        selectedTaFilter === "ALL"
                          ? "pill-smoke-diffusion text-white font-semibold"
                          : "bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 hover:text-white"
                      }`}
                    >
                      <span>🌐</span>
                      <span>All Assigned TAs</span>
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-mono ${
                        selectedTaFilter === "ALL" ? "bg-black/60 text-white border border-white/10 shadow-inner" : "bg-zinc-800 text-zinc-400"
                      }`}>
                        {presets.length}
                      </span>
                    </button>

                    {supervisedTas.map((ta) => {
                      const isSelected = selectedTaFilter === ta.id;
                      const taPresetCount = presets.filter(
                        (p) =>
                          p.supervisingTaId === ta.id ||
                          p.supervisingTaId === `inst_${ta.username}` ||
                          (p.supervisingTaName && p.supervisingTaName.toLowerCase().includes(ta.username.toLowerCase()))
                      ).length;

                      return (
                        <button
                          key={ta.id}
                          type="button"
                          onClick={() => setSelectedTaFilter(ta.id)}
                          className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition cursor-pointer flex items-center gap-2 ${
                            isSelected
                              ? "pill-smoke-diffusion text-white font-semibold"
                              : "bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 hover:text-white"
                          }`}
                        >
                          <span>🎓</span>
                          <span>{ta.displayName} (@{ta.username})</span>
                          <span
                            className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-mono ${
                              isSelected ? "bg-black/60 text-white border border-white/10 shadow-inner" : "bg-zinc-800 text-zinc-400"
                            }`}
                          >
                            {taPresetCount}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {presetsLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 py-8">
                  {[1, 2].map((i) => (
                    <div
                      key={i}
                      className="p-6 rounded-2xl border border-zinc-800/60 bg-zinc-950/40 animate-pulse space-y-4"
                    >
                      <div className="h-5 w-3/4 bg-zinc-800/80 rounded" />
                      <div className="h-4 w-1/2 bg-zinc-800/50 rounded" />
                      <div className="h-16 w-full bg-zinc-900/50 rounded" />
                    </div>
                  ))}
                </div>
              ) : filteredPresets.length === 0 ? (
                <div className="p-12 text-center border border-dashed border-zinc-800 rounded-2xl bg-zinc-950/30 space-y-4">
                  <div className="text-zinc-500 font-mono text-xs">
                    {searchQuery
                      ? `No syllabi matching "${searchQuery}".`
                      : "No exam presets found in openviva.db."}
                  </div>
                  <button
                    type="button"
                    onClick={handleStartNewExam}
                    className="px-4 py-2 rounded-full bg-white text-black hover:bg-zinc-200 text-xs font-medium transition cursor-pointer"
                  >
                    + Build Your First Syllabus
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {filteredPresets.map((preset) => {
                    const topicList = preset.topics || [];
                    const topTopics = topicList.filter((t) => t.level === 1);
                    return (
                      <div
                        key={preset.id}
                        className="p-6 rounded-2xl border border-zinc-800/80 bg-zinc-950/70 hover:border-zinc-700/90 transition-all flex flex-col justify-between space-y-5 shadow-sm"
                      >
                        <div className="space-y-3.5">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-1">
                                {preset.difficultyTier.toUpperCase()} • {preset.durationMinutes} MIN
                              </span>
                              <h3 className="text-xl font-medium text-white tracking-tight">
                                {preset.courseTitle}
                              </h3>
                              <div className="flex items-center gap-2 mt-1 text-xs text-zinc-400 font-mono">
                                <span>Prof: {preset.leadProfessor || preset.instructorId}</span>
                                {preset.supervisingTaName && (
                                  <>
                                    <span className="text-zinc-600">•</span>
                                    <span className="text-emerald-400 font-mono font-medium">TA: {preset.supervisingTaName}</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <span className="px-3 py-1 rounded-full text-[11px] font-mono border border-zinc-800/80 bg-zinc-900/80 text-zinc-300 shrink-0 flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              <span>{preset.totalTopics || topicList.length} topics</span>
                            </span>
                          </div>

                          {/* Access Policy Pill & Date */}
                          <div className="flex items-center gap-2 pt-1 text-[11px] font-mono text-zinc-400">
                            {preset.accessControl?.type === "RESTRICTED" ? (
                              <span className="text-amber-400 flex items-center gap-1.5">
                                <span>🔒</span>
                                <span>restricted ({preset.accessControl.allowedStudents?.length || 0} candidates)</span>
                              </span>
                            ) : (
                              <span className="text-emerald-400 flex items-center gap-1.5">
                                <span>🌐</span>
                                <span>open access (unrestricted)</span>
                              </span>
                            )}
                            <span className="text-zinc-600">•</span>
                            <span className="text-zinc-500">
                              {new Date(preset.createdAt).toLocaleDateString()}
                            </span>
                          </div>

                          {/* Top Topics Preview (chips) */}
                          {topTopics.length > 0 && (
                            <div className="pt-1 flex flex-wrap gap-2">
                              {topTopics.slice(0, 3).map((t, idx) => (
                                <span
                                  key={idx}
                                  className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800/80 text-xs text-zinc-300 font-mono truncate max-w-[220px]"
                                >
                                  {t.title}
                                </span>
                              ))}
                              {topTopics.length > 3 && (
                                <span className="px-2 py-1 text-[11px] text-zinc-500 font-mono self-center">
                                  +{topTopics.length - 3} more
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Card Actions Footer */}
                        <div className="flex items-center justify-between pt-4 border-t border-zinc-900 gap-2">
                          {currentInstructor?.role === "ADMIN" || currentInstructor?.role === "PROFESSOR" ? (
                            <button
                              type="button"
                              onClick={() => handleInitiateDeletePreset(preset.id, preset.courseTitle)}
                              className="text-xs text-zinc-500 hover:text-red-400 transition cursor-pointer px-2 py-1.5 flex items-center gap-1.5 group"
                              title="Delete syllabus from SQLite"
                            >
                              <span className="group-hover:scale-110 transition-transform">🗑</span>
                              <span>Delete</span>
                            </button>
                          ) : (
                            <span
                              className="text-[11px] text-zinc-600 px-2 py-1.5 cursor-not-allowed select-none flex items-center gap-1"
                              title="Deleting exam presets requires Professor or Admin privileges"
                            >
                              <span>🔒</span>
                              <span>Protected</span>
                            </span>
                          )}

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleEditPreset(preset)}
                              className="px-4 py-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 hover:bg-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-200 transition cursor-pointer"
                            >
                              Edit in Builder
                            </button>
                            <button
                              type="button"
                              onClick={() => handleLaunchExamFromPreset(preset)}
                              className="px-4 py-1.5 rounded-full bg-white text-black hover:bg-zinc-200 text-xs font-medium transition cursor-pointer flex items-center gap-1 shadow-sm active:scale-[0.98]"
                            >
                              <span>Launch Viva</span>
                              <span>→</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: LIVE SESSIONS & HISTORICAL EVALUATIONS (SQLite backed) */}
          {cockpitTab === "sessions" && (
            <div className="space-y-6">
              {/* Professor TA Supervision Filter Bar */}
              {(isProfessor || isAdmin) && (
                <div className="p-4 rounded-2xl border border-indigo-900/60 bg-gradient-to-r from-indigo-950/40 via-zinc-950/60 to-zinc-950/40 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="text-lg">🏛️</span>
                      <div>
                        <span className="text-xs font-semibold text-white">Course Faculty TA Supervision</span>
                        <span className="text-[10px] text-zinc-400 block font-mono">
                          Department: {currentInstructor?.department || "Institutional"} • Select a Teaching Assistant to inspect their assigned candidate viva defenses
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950/80 border border-indigo-800/60 px-2.5 py-0.5 rounded-full self-start sm:self-auto">
                      {supervisedTas.length} Teaching Assistants
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <button
                      type="button"
                      onClick={() => setSelectedTaFilter("ALL")}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition cursor-pointer flex items-center gap-2 ${
                        selectedTaFilter === "ALL"
                          ? "pill-smoke-diffusion text-white font-semibold"
                          : "bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 hover:text-white"
                      }`}
                    >
                      <span>🌐</span>
                      <span>All Assigned TAs</span>
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-mono ${
                        selectedTaFilter === "ALL" ? "bg-black/60 text-white border border-white/10 shadow-inner" : "bg-zinc-800 text-zinc-400"
                      }`}>
                        {sessions.length}
                      </span>
                    </button>

                    {supervisedTas.map((ta) => {
                      const isSelected = selectedTaFilter === ta.id;
                      const taSessionCount = sessions.filter(
                        (s) =>
                          s.supervisingTaId === ta.id ||
                          s.supervisingTaId === `inst_${ta.username}` ||
                          (s.supervisingTaName && s.supervisingTaName.toLowerCase().includes(ta.username.toLowerCase()))
                      ).length;

                      return (
                        <button
                          key={ta.id}
                          type="button"
                          onClick={() => setSelectedTaFilter(ta.id)}
                          className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition cursor-pointer flex items-center gap-2 ${
                            isSelected
                              ? "pill-smoke-diffusion text-white font-semibold"
                              : "bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 hover:text-white"
                          }`}
                        >
                          <span>🎓</span>
                          <span>{ta.displayName} (@{ta.username})</span>
                          <span
                            className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-mono ${
                              isSelected ? "bg-black/60 text-white border border-white/10 shadow-inner" : "bg-zinc-800 text-zinc-400"
                            }`}
                          >
                            {taSessionCount}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Five Prominent Dashboard Metrics with Sparklines */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5">
                {/* Metric 1: Total Defenses */}
                <button
                  type="button"
                  onClick={() => setSessionFilterStatus("ALL")}
                  className={`p-4 rounded-2xl border text-left transition cursor-pointer flex items-center justify-between ${
                    sessionFilterStatus === "ALL"
                      ? "border-zinc-700 bg-zinc-900/80 shadow-sm"
                      : "border-zinc-800/80 bg-zinc-950/60 hover:border-zinc-700"
                  }`}
                >
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block">
                      Total Defenses
                    </span>
                    <div className="text-3xl font-medium text-white">{scopedSessions.length}</div>
                  </div>
                  <svg className="w-16 h-8 text-blue-400/70 stroke-current fill-none stroke-[2]" viewBox="0 0 60 30">
                    <path d="M 2 24 C 15 24, 25 10, 40 18 C 50 25, 55 5, 58 8" />
                  </svg>
                </button>

                {/* Metric 2: Completed */}
                <button
                  type="button"
                  onClick={() => setSessionFilterStatus("COMPLETED")}
                  className={`p-4 rounded-2xl border text-left transition cursor-pointer flex items-center justify-between ${
                    sessionFilterStatus === "COMPLETED"
                      ? "border-emerald-700/80 bg-emerald-950/30 shadow-sm shadow-emerald-950/30"
                      : "border-zinc-800/80 bg-zinc-950/60 hover:border-zinc-700"
                  }`}
                >
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block">
                      Completed
                    </span>
                    <div className="text-3xl font-medium text-emerald-400">{completedSessions.length}</div>
                  </div>
                  <svg className="w-16 h-8 text-emerald-400/80 stroke-current fill-none stroke-[2]" viewBox="0 0 60 30">
                    <path d="M 2 26 C 15 26, 25 20, 38 12 C 48 5, 55 18, 58 10" />
                  </svg>
                </button>

                {/* Metric 3: Active / In-Flight */}
                <button
                  type="button"
                  onClick={() => setSessionFilterStatus("IN_PROGRESS")}
                  className={`p-4 rounded-2xl border text-left transition cursor-pointer flex items-center justify-between ${
                    sessionFilterStatus === "IN_PROGRESS"
                      ? "border-amber-700/80 bg-amber-950/30 shadow-sm"
                      : "border-zinc-800/80 bg-zinc-950/60 hover:border-zinc-700"
                  }`}
                >
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block">
                      Active / In-Flight
                    </span>
                    <div className="text-3xl font-medium text-amber-400">{activeSessions.length}</div>
                  </div>
                  <svg className="w-16 h-8 text-amber-400/80 stroke-current fill-none stroke-[2]" viewBox="0 0 60 30">
                    <path d="M 2 22 C 15 22, 28 20, 42 16 C 50 14, 55 20, 58 18" />
                  </svg>
                </button>

                {/* Metric 4: Security / Bio Flags (Clickable to filter flagged examinations) */}
                <button
                  type="button"
                  onClick={() =>
                    setSessionFilterStatus(sessionFilterStatus === "FLAGGED_ANY" ? "ALL" : "FLAGGED_ANY")
                  }
                  className={`p-4 rounded-2xl border text-left transition cursor-pointer flex items-center justify-between ${
                    sessionFilterStatus === "FLAGGED_ANY"
                      ? "border-red-500 bg-red-950/30 ring-1 ring-red-500/50 shadow-sm shadow-red-950/50"
                      : filteredFlaggedSessions.length > 0
                      ? "border-red-900/60 bg-red-950/15 hover:border-red-700/70"
                      : "border-zinc-800/80 bg-zinc-950/60 hover:border-zinc-700"
                  }`}
                  title="Click to filter flagged examinations"
                >
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block">
                      Security / Bio Flags
                    </span>
                    <div
                      className={`text-3xl font-medium ${
                        filteredFlaggedSessions.length > 0 ? "text-red-400 animate-pulse" : "text-zinc-500"
                      }`}
                    >
                      {filteredFlaggedSessions.length}
                    </div>
                  </div>
                  <svg className="w-16 h-8 text-red-500/80 stroke-current fill-none stroke-[2]" viewBox="0 0 60 30">
                    <path d="M 2 25 C 18 25, 28 22, 40 14 C 48 8, 54 22, 58 16" />
                  </svg>
                </button>

                {/* Metric 5: Recorded Dialogue Turns */}
                <div className="p-4 rounded-2xl border border-zinc-800/80 bg-zinc-950/60 flex items-center justify-between col-span-2 sm:col-span-1">
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block">
                      Recorded Dialogue Turns
                    </span>
                    <div className="text-3xl font-medium text-white">{totalRecordedTurns}</div>
                  </div>
                  <svg className="w-16 h-8 text-cyan-400/80 stroke-current fill-none stroke-[2]" viewBox="0 0 60 30">
                    <path d="M 2 15 L 12 15 L 16 15 L 20 8 L 24 24 L 28 4 L 32 26 L 36 12 L 40 18 L 44 15 L 58 15" />
                  </svg>
                </div>
              </div>

              {/* Viva Filter & View Mode Controls (Unified horizontal bar matching Mockup) */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 bg-zinc-950/70 border border-zinc-800/80 rounded-2xl">
                {/* Left: Filter dropdown pills */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-zinc-400 flex items-center gap-1.5 pl-1">
                    <span>🔻</span>
                    <span>Filters:</span>
                  </span>

                  <button
                    type="button"
                    onClick={() => setSelectedVivaFilter("ALL")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                      selectedVivaFilter === "ALL"
                        ? "bg-zinc-800 text-white border border-zinc-700 font-semibold shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200 bg-zinc-900/60 border border-zinc-800"
                    }`}
                  >
                    <span>📊</span>
                    <span>All Vivas</span>
                    <span className="text-[10px] text-zinc-400">▾</span>
                  </button>

                  {availableVivas.map((v) => {
                    const isSelected = selectedVivaFilter.toLowerCase() === v.title.toLowerCase();
                    return (
                      <button
                        key={v.title}
                        type="button"
                        onClick={() => setSelectedVivaFilter(isSelected ? "ALL" : v.title)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                          isSelected
                            ? "bg-zinc-800 text-white border border-zinc-700 font-semibold shadow-sm"
                            : "text-zinc-400 hover:text-zinc-200 bg-zinc-900/60 border border-zinc-800"
                        }`}
                      >
                        <span>📁</span>
                        <span className="truncate max-w-[190px]">{v.title}</span>
                        <span className="text-[10px] text-zinc-400">▾</span>
                      </button>
                    );
                  })}
                </div>

                {/* Right: View Mode Toggle (Flat Feed vs Group by Viva) */}
                <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 p-1 rounded-xl shrink-0 self-start md:self-auto">
                  <button
                    type="button"
                    onClick={() => setDefenseViewMode("flat")}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                      defenseViewMode === "flat"
                        ? "bg-indigo-600/80 text-white border border-indigo-500/60 shadow-sm font-semibold"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <span>≡</span>
                    <span>Flat Feed</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDefenseViewMode("grouped")}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                      defenseViewMode === "grouped"
                        ? "bg-indigo-600/80 text-white border border-indigo-500/60 shadow-sm font-semibold"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <span>📁</span>
                    <span>Group by Viva</span>
                  </button>
                </div>
              </div>

              {/* Sessions Table / Feed */}
              {sessionsLoading ? (
                <div className="p-8 text-center text-xs font-mono text-zinc-500 animate-pulse">
                  Querying openviva.db sessions...
                </div>
              ) : filteredSessions.length === 0 ? (
                <div className="p-12 text-center border border-dashed border-zinc-800 rounded-2xl bg-zinc-950/30 text-zinc-500 font-mono text-xs">
                  {searchQuery || sessionFilterStatus !== "ALL" || selectedVivaFilter !== "ALL"
                    ? "No defense records matching current filters."
                    : "No defense sessions recorded in openviva.db yet. Start an examination to generate live records."}
                </div>
              ) : defenseViewMode === "grouped" ? (
                /* Grouped by Viva Mode */
                <div className="space-y-4">
                  {Object.entries(groupedSessions).map(([courseName, groupSessions]) => {
                    const isCollapsed = collapsedVivas[courseName] ?? false;
                    const groupCompleted = groupSessions.filter((s) => s.status === "COMPLETED").length;
                    const groupActive = groupSessions.filter(
                      (s) => s.status === "IN_PROGRESS" || s.status === "PENDING_EVALUATION"
                    ).length;

                    return (
                      <div
                        key={courseName}
                        className="rounded-2xl border border-zinc-800/80 bg-zinc-950/70 overflow-hidden shadow-sm"
                      >
                        {/* Group Header Banner */}
                        <button
                          type="button"
                          onClick={() => setCollapsedVivas((prev) => ({ ...prev, [courseName]: !isCollapsed }))}
                          className="w-full p-4 flex items-center justify-between bg-zinc-900/40 hover:bg-zinc-900/60 transition cursor-pointer text-left border-b border-zinc-800/60"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xl">📚</span>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-semibold text-white">{courseName}</h4>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
                                  {groupSessions.length} {groupSessions.length === 1 ? "Defense" : "Defenses"}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400 mt-1">
                                <span className="text-emerald-400">{groupCompleted} Completed</span>
                                {groupActive > 0 && (
                                  <>
                                    <span>•</span>
                                    <span className="text-amber-400">{groupActive} Active</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
                            <span>{isCollapsed ? "Expand" : "Collapse"}</span>
                            <span className="text-sm">{isCollapsed ? "▼" : "▲"}</span>
                          </div>
                        </button>

                        {/* Collapsible Session Cards */}
                        {!isCollapsed && (
                          <div className="p-4 space-y-3 bg-zinc-950/30">
                            {groupSessions.map((session) => renderSessionCard(session))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Flat Feed Mode */
                <div className="space-y-3">
                  {filteredSessions.map((session) => renderSessionCard(session))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* System Status Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-zinc-500 font-mono pt-8 border-t border-zinc-900/80 gap-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-zinc-400 font-normal">
              OpenViva Cockpit • Syllabi Connected (openviva.db)
            </span>
          </div>
          <button
            type="button"
            onClick={onBackToGateway}
            className="hover:text-zinc-300 text-zinc-500 transition cursor-pointer flex items-center gap-1.5"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
            <span>Back to role selection</span>
          </button>
        </div>

        {/* In-App Delete Confirmation Modal */}
        {deletePresetTarget && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-red-950/60 border border-red-800/80 text-red-400 flex items-center justify-center text-lg shrink-0">
                  ⚠️
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-medium text-white">Delete Syllabus Preset</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Are you sure you want to permanently delete <strong className="text-white font-mono">{deletePresetTarget.title}</strong> from <span className="font-mono text-zinc-300">openviva.db</span>? This action cannot be undone.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-900">
                <button
                  type="button"
                  onClick={() => setDeletePresetTarget(null)}
                  disabled={isDeletingPreset}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent transition cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeletePreset}
                  disabled={isDeletingPreset}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition cursor-pointer flex items-center gap-2 shadow-sm disabled:opacity-50"
                >
                  {isDeletingPreset ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <span>Confirm Delete</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* In-App Revoke Access Confirmation Modal */}
        {revokeTarget && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-red-950/60 border border-red-800/80 text-red-400 flex items-center justify-center text-lg shrink-0">
                  🚫
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-medium text-white">Revoke Staff Access</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Are you sure you want to revoke Teaching Assistant access for <strong className="text-white">{revokeTarget.displayName}</strong> (<span className="font-mono text-zinc-300">@{revokeTarget.username}</span>)?
                    This will immediately invalidate their active tokens and terminate any ongoing supervisory sessions.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-900">
                <button
                  type="button"
                  onClick={() => setRevokeTarget(null)}
                  disabled={revokingInstructorId === revokeTarget.id}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent transition cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const t = revokeTarget;
                    setRevokeTarget(null);
                    handleRevokeInstructor(t.id, t.username, t.displayName);
                  }}
                  disabled={revokingInstructorId === revokeTarget.id}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition cursor-pointer flex items-center gap-2 shadow-sm disabled:opacity-50"
                >
                  {revokingInstructorId === revokeTarget.id ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Revoking...</span>
                    </>
                  ) : (
                    <span>Confirm Revoke</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Historical Defense Telemetry & Scorecard Modal */}
        {selectedSessionForModal && (
          <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6">
            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
              {/* Modal Top Bar */}
              <div className="p-5 sm:p-6 border-b border-zinc-800 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs font-mono text-zinc-400 mb-1">
                    <span>Candidate: {selectedSessionForModal.studentId}</span>
                    <span>•</span>
                    <span>Session: {selectedSessionForModal.sessionId}</span>
                  </div>
                  <h3 className="text-xl font-medium text-white tracking-tight">
                    {selectedSessionForModal.courseTitle}
                  </h3>
                  <div className="flex items-center gap-2 text-xs font-mono text-zinc-400 mt-1">
                    <span>Course Chair: {selectedSessionForModal.leadProfessor || selectedSessionForModal.instructorId || "Course Faculty"}</span>
                    <span className="text-zinc-600">•</span>
                    <span className="text-emerald-400">Supervising TA: {selectedSessionForModal.supervisingTaName || "ta1"}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-mono text-zinc-500 mt-1">
                    <span>
                      Duration: {Math.floor((selectedSessionForModal.actualDurationSeconds || 0) / 60)}m{" "}
                      {(selectedSessionForModal.actualDurationSeconds || 0) % 60}s
                    </span>
                    <span>•</span>
                    <span>
                      {selectedSessionForModal.turnCount ||
                        selectedSessionForModal.transcript?.length ||
                        0}{" "}
                      turns
                    </span>
                    <span>•</span>
                    <span>{new Date(selectedSessionForModal.startedAt).toLocaleString()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedSessionForModal(null)}
                    className="text-zinc-500 hover:text-white transition p-2 text-lg leading-none cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Modal Body: 4 Core Pillars */}
              <div className="p-6 overflow-y-auto flex-1">
                <EvaluationScorecard
                  evaluation={selectedSessionForModal.evaluationResult}
                  onClose={() => setSelectedSessionForModal(null)}
                  recordingUrl={selectedSessionForModal.recordingUrl}
                  studentId={selectedSessionForModal.studentId}
                  sessionId={selectedSessionForModal.sessionId}
                  transcripts={selectedSessionForModal.transcript}
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: CLASS ROSTER & CREDENTIAL MANAGEMENT (Air-gapped TA protocol) */}
        {cockpitTab === "roster" && (
          <div className="space-y-6">
            {/* Protocol Header Alert */}
            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/80 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
                  🛡️
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-white">Air-Gapped Identity & Password Recovery Protocol</h4>
                  <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                    In an offline campus intranet, candidate password resets require physical university ID verification by the supervising TA. Resetting a password sets it back to the candidate&apos;s registration number (e.g. <code className="text-zinc-200 bg-zinc-900 px-1 py-0.5 rounded font-mono">reg1</code>), invalidates active sessions, and enforces a mandatory personal password update upon their next login.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={fetchStudents}
                disabled={studentsLoading}
                className="px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-mono transition cursor-pointer flex items-center gap-1.5 flex-shrink-0"
              >
                <span>🔄</span>
                <span>{studentsLoading ? "Syncing..." : "Refresh Roster"}</span>
              </button>
            </div>

            {/* Reset Notification Feedback */}
            {resetNotice && (
              <div
                className={`p-3.5 rounded-xl border text-xs flex items-center justify-between transition ${
                  resetNotice.type === "success"
                    ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300"
                    : "border-red-500/30 bg-red-950/20 text-red-300"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{resetNotice.type === "success" ? "✓" : "⚠"}</span>
                  <span>{resetNotice.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setResetNotice(null)}
                  className="text-zinc-400 hover:text-white font-mono text-xs px-2 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Roster Table */}
            {studentsLoading && allStudents.length === 0 ? (
              <div className="p-12 text-center border border-zinc-800/80 rounded-2xl bg-zinc-950/40 animate-pulse text-zinc-500 text-xs font-mono">
                Loading student accounts from openviva.db...
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="p-12 text-center border border-dashed border-zinc-800 rounded-2xl bg-zinc-950/30 space-y-2">
                <div className="text-zinc-500 font-mono text-xs">
                  {searchQuery ? `No candidates matching "${searchQuery}".` : "No registered student accounts found in openviva.db."}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/40 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-900/60 border-b border-zinc-800 text-zinc-400 font-mono text-[10px] uppercase tracking-wider">
                      <tr>
                        <th className="py-3 px-4 font-medium">Candidate</th>
                        <th className="py-3 px-4 font-medium">Department &amp; Cohort</th>
                        <th className="py-3 px-4 font-medium">Password State</th>
                        <th className="py-3 px-4 font-medium">Biometric Status</th>
                        <th className="py-3 px-4 font-medium text-right">Air-Gapped Recovery</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                      {filteredStudents.map((student) => (
                        <tr key={student.regNo} className="hover:bg-zinc-900/30 transition">
                          <td className="py-3.5 px-4">
                            <div className="font-medium text-white">{student.studentName}</div>
                            <div className="font-mono text-[11px] text-zinc-400 mt-0.5">
                              {student.regNo}
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="text-zinc-300">{student.department}</div>
                            <div className="text-[11px] text-zinc-500 font-mono">{student.cohort}</div>
                          </td>
                          <td className="py-3.5 px-4">
                            {student.mustChangePassword ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                                DEFAULT (MUST CHANGE)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                PERSONALIZED
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            {student.verificationStatus === "VERIFIED" ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                ✓ VERIFIED
                              </span>
                            ) : student.verificationStatus === "PENDING" ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                ⏳ PENDING
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-zinc-800/80 text-zinc-400 border border-zinc-700">
                                NOT ENROLLED
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleResetStudentPassword(student.regNo, student.studentName)}
                              disabled={resettingRegNo === student.regNo}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 hover:text-white text-zinc-200 text-xs font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
                              title={`Reset password for ${student.regNo} back to default (${student.regNo})`}
                            >
                              <span>🔑</span>
                              <span>{resettingRegNo === student.regNo ? "Resetting..." : "Reset to Default"}</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: COURSE STAFF & TA MANAGEMENT (Task 3.1: Gated strictly to PROFESSOR / ADMIN) */}
        {cockpitTab === "staff" && (currentInstructor?.role === "PROFESSOR" || currentInstructor?.role === "ADMIN") && (
          <div className="space-y-6">
            {/* Staff Governance Banner Card matching Mockup */}
            <div className="p-5 rounded-2xl border border-zinc-800/80 bg-zinc-950/70 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 text-xl flex items-center justify-center shrink-0">
                  🏛️
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">Course Faculty & Teaching Assistant Directory</h4>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed max-w-2xl">
                    Under the Departmental Access Model, Teaching Assistants are provisioned directly by the Course Professor.
                    Only authenticated Professors and Administrators hold administrative governance over course staff accounts.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap shrink-0">
                {/* View Mode Switcher */}
                <div className="flex items-center bg-zinc-900/90 p-1 rounded-xl border border-zinc-800 gap-1 text-xs font-mono">
                  <button
                    type="button"
                    onClick={() => setStaffViewMode("nested")}
                    className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                      staffViewMode === "nested"
                        ? "bg-indigo-600 text-white font-semibold shadow-xs"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    <span>📁</span>
                    <span>Nested</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStaffViewMode("flat")}
                    className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                      staffViewMode === "flat"
                        ? "bg-indigo-600 text-white font-semibold shadow-xs"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    <span>📄</span>
                    <span>Flat</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={fetchInstructorsList}
                  className="px-3.5 py-2 rounded-xl border border-zinc-800 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-mono transition cursor-pointer flex items-center gap-1.5 shadow-sm"
                >
                  <span>🔄</span>
                  <span>Refresh Staff</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenAddTaModal()}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 shadow-md"
                >
                  <span>➕</span>
                  <span>Add Staff Member (TA / Professor)</span>
                </button>
              </div>
            </div>

            {/* Notice / Feedback Banner */}
            {staffNotice && (
              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs font-mono ${
                  staffNotice.type === "success"
                    ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
                    : "bg-red-950/40 border-red-800/60 text-red-300"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{staffNotice.type === "success" ? "✓" : "⚠"}</span>
                  <span>{staffNotice.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setStaffNotice(null)}
                  className="text-zinc-400 hover:text-white text-xs px-2 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Active Staff Roster (Nested Hierarchy & Flat Directory Modes) */}
            <div className="space-y-4">

              {staffViewMode === "nested" ? (
                /* 🌳 NESTED HIERARCHY VIEW: Grouped by Department / Lead Faculty */
                <div className="space-y-4">
                  {(() => {
                    const filtered = registeredInstructors.filter((inst) => {
                      if (!searchQuery.trim()) return true;
                      const q = searchQuery.toLowerCase().trim();
                      return (
                        inst.username.toLowerCase().includes(q) ||
                        inst.displayName.toLowerCase().includes(q) ||
                        inst.role.toLowerCase().includes(q) ||
                        (inst.department && inst.department.toLowerCase().includes(q))
                      );
                    });

                    // Build department groups
                    const groupsMap = new Map<string, {
                      department: string;
                      professors: InstructorAccount[];
                      tas: InstructorAccount[];
                      admins: InstructorAccount[];
                      others: InstructorAccount[];
                    }>();

                    // Pre-seed known departments
                    registeredInstructors.forEach((inst) => {
                      const d = inst.department?.trim() || (inst.role === "ADMIN" ? "Institutional Governance" : "General Department");
                      if (!groupsMap.has(d)) {
                        groupsMap.set(d, { department: d, professors: [], tas: [], admins: [], others: [] });
                      }
                    });

                    // Distribute filtered instructors
                    filtered.forEach((inst) => {
                      const d = inst.department?.trim() || (inst.role === "ADMIN" ? "Institutional Governance" : "General Department");
                      let grp = groupsMap.get(d);
                      if (!grp) {
                        grp = { department: d, professors: [], tas: [], admins: [], others: [] };
                        groupsMap.set(d, grp);
                      }
                      if (inst.role === "PROFESSOR") grp.professors.push(inst);
                      else if (inst.role === "TA") grp.tas.push(inst);
                      else if (inst.role === "ADMIN") grp.admins.push(inst);
                      else grp.others.push(inst);
                    });

                    // Filter groups with matching members
                    const activeGroups = Array.from(groupsMap.values()).filter(
                      (g) => g.professors.length > 0 || g.tas.length > 0 || g.admins.length > 0 || g.others.length > 0
                    );

                    // Prioritize current instructor's department first
                    activeGroups.sort((a, b) => {
                      if (currentInstructor?.department && a.department === currentInstructor.department) return -1;
                      if (currentInstructor?.department && b.department === currentInstructor.department) return 1;
                      return a.department.localeCompare(b.department);
                    });

                    if (activeGroups.length === 0) {
                      return (
                        <div className="p-8 rounded-2xl border border-zinc-800 bg-zinc-950/40 text-center text-zinc-500 font-mono text-xs">
                          No staff members found matching "{searchQuery}".
                        </div>
                      );
                    }

                    return activeGroups.map((grp) => {
                      const isMyDept = Boolean(currentInstructor?.department && grp.department === currentInstructor.department);
                      const isCollapsed = collapsedDepts.has(grp.department);

                      return (
                        <div
                          key={grp.department}
                          className="rounded-2xl border border-zinc-800/80 bg-zinc-950/70 overflow-hidden shadow-sm"
                        >
                          {/* Department Level Header matching Mockup */}
                          <div className="p-4 bg-zinc-950/90 border-b border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                              <button
                                type="button"
                                onClick={() => toggleDeptCollapse(grp.department)}
                                className="text-zinc-400 hover:text-white text-xs font-mono cursor-pointer transition p-1"
                                title={isCollapsed ? "Expand Department" : "Collapse Department"}
                              >
                                {isCollapsed ? "▸" : "▾"}
                              </button>
                              <span className="text-base">📁</span>
                              <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                                DEPARTMENT / COURSE GROUP: {grp.department}
                              </span>
                              {isMyDept && (
                                <span className="text-[10px] font-mono text-amber-300 bg-amber-950/60 border border-amber-600/60 px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                  <span>Your Department</span>
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                              <span className="text-[11px] font-mono text-purple-300 bg-purple-950/60 border border-purple-800/50 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                <span>👤</span>
                                <span>{grp.professors.length} Professor{grp.professors.length === 1 ? "" : "s"}</span>
                              </span>
                              <span className="text-[11px] font-mono text-emerald-300 bg-emerald-950/60 border border-emerald-800/50 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                <span>👥</span>
                                <span>{grp.tas.length} Supervised TA{grp.tas.length === 1 ? "" : "s"}</span>
                              </span>
                              {(currentInstructor?.role === "PROFESSOR" || currentInstructor?.role === "ADMIN") && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenAddTaModal(grp.department)}
                                  className="px-3 py-1 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 text-xs font-mono transition cursor-pointer flex items-center gap-1 shadow-xs"
                                  title={`Add Teaching Assistant pre-associated with ${grp.department}`}
                                >
                                  <span>➕</span>
                                  <span>Add TA</span>
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Collapsible Content */}
                          {!isCollapsed && (
                            <div className="p-4 sm:p-5 space-y-3">
                              {/* 1. Professor Row */}
                              {grp.professors.map((prof) => {
                                const isSelf = prof.id === currentInstructor?.id || prof.username === currentInstructor?.username;
                                return (
                                  <div
                                    key={prof.id}
                                    className={`p-3.5 sm:p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-l-[3px] ${
                                      isSelf ? "border-l-emerald-500" : "border-l-purple-500/80"
                                    }`}
                                  >
                                    <div className="flex items-center gap-3.5">
                                      <div className="w-9 h-9 rounded-xl bg-purple-950/80 border border-purple-800 text-purple-200 flex items-center justify-center font-bold text-sm shrink-0">
                                        P
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="font-semibold text-white text-sm">{prof.displayName}</span>
                                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950/90 border border-purple-800 text-purple-300 font-semibold">
                                            PROFESSOR
                                          </span>
                                          <span className="text-xs font-mono text-zinc-400">
                                            Dept(s): {prof.department || "General"}
                                          </span>
                                        </div>
                                        <div className="font-mono text-xs text-zinc-500 mt-0.5">
                                          Course Chair • Department: {prof.department || grp.department} • Added {prof.createdAt ? new Date(prof.createdAt).toLocaleDateString() : "11/11/2026"}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                      {isSelf ? (
                                        <button
                                          type="button"
                                          onClick={() => setCockpitTab("presets")}
                                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-emerald-500/50 bg-emerald-950/40 hover:bg-emerald-950/70 text-emerald-400 text-xs font-mono transition cursor-pointer"
                                          title="View active examination session and syllabus"
                                        >
                                          <span>▶</span>
                                          <span>Current Session</span>
                                          <span className="text-[10px]">›</span>
                                        </button>
                                      ) : (
                                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-purple-800/60 bg-purple-950/30 text-purple-300 text-xs font-mono">
                                          <span>🏛️</span>
                                          <span>Faculty (Protected)</span>
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}

                              {/* 2. TA Rows (Indented with Tree Connector Lines) */}
                              {grp.tas.map((ta) => {
                                const isSelf = ta.id === currentInstructor?.id || ta.username === currentInstructor?.username;
                                return (
                                  <div key={ta.id} className="flex items-center gap-3 pl-4 sm:pl-8">
                                    <span className="text-zinc-600 font-mono text-sm select-none shrink-0">
                                      └─
                                    </span>
                                    <div className="flex-1 p-3 sm:p-3.5 rounded-xl border border-zinc-800/70 bg-zinc-900/30 hover:border-zinc-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition">
                                      <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-xl bg-indigo-950/80 border border-indigo-800 text-indigo-200 flex items-center justify-center font-bold text-xs shrink-0">
                                          T
                                        </div>
                                        <div>
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-medium text-white text-xs">{ta.displayName}</span>
                                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-700/80 text-emerald-300 font-semibold">
                                              TA
                                            </span>
                                            <span className="text-xs font-mono text-zinc-400">
                                              @{ta.username}
                                            </span>
                                          </div>
                                          <div className="font-mono text-xs text-zinc-500 mt-0.5">
                                            Assigned Dept: {ta.department || grp.department} • Added {ta.createdAt ? new Date(ta.createdAt).toLocaleDateString() : "11/12/2026"}
                                          </div>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-2 shrink-0">
                                        {isSelf ? (
                                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-500/50 bg-emerald-950/40 text-emerald-400 text-xs font-mono">
                                            <span>▶</span>
                                            <span>Current Session</span>
                                          </span>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => setRevokeTarget({ id: ta.id, username: ta.username, displayName: ta.displayName })}
                                            disabled={revokingInstructorId === ta.id}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-900/50 bg-red-950/30 hover:bg-red-950/60 text-red-400 text-xs font-medium transition cursor-pointer disabled:opacity-50"
                                          >
                                            <span>🚫</span>
                                            <span>{revokingInstructorId === ta.id ? "Revoking..." : "Revoke Access"}</span>
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}

                              {grp.tas.length === 0 && grp.professors.length === 0 && (
                                <div className="p-3.5 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/10 text-center text-xs text-zinc-500 font-mono">
                                  No staff members in this department yet.
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : (
                /* 📄 FLAT DIRECTORY VIEW: Traditional Linear Roster Table */
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 overflow-hidden shadow-sm space-y-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-zinc-900/60 border-b border-zinc-800 text-zinc-400 font-mono text-[10px] uppercase tracking-wider">
                        <tr>
                          <th className="py-3 px-4 font-medium">Staff Member</th>
                          <th className="py-3 px-4 font-medium">Role</th>
                          <th className="py-3 px-4 font-medium">Department / Lab</th>
                          <th className="py-3 px-4 font-medium">Date Added</th>
                          <th className="py-3 px-4 font-medium text-right">Access Governance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                        {registeredInstructors
                          .filter((inst) => {
                            if (!searchQuery.trim()) return true;
                            const q = searchQuery.toLowerCase().trim();
                            return (
                              inst.username.toLowerCase().includes(q) ||
                              inst.displayName.toLowerCase().includes(q) ||
                              inst.role.toLowerCase().includes(q) ||
                              (inst.department && inst.department.toLowerCase().includes(q))
                            );
                          })
                          .map((inst) => {
                            const isSelf = inst.id === currentInstructor?.id || inst.username === currentInstructor?.username;
                            const isTa = inst.role === "TA";
                            return (
                              <tr key={inst.id} className="hover:bg-zinc-900/30 transition">
                                <td className="py-3.5 px-4">
                                  <div className="font-medium text-white">{inst.displayName}</div>
                                  <div className="font-mono text-[11px] text-zinc-400 mt-0.5">
                                    @{inst.username}
                                  </div>
                                </td>
                                <td className="py-3.5 px-4">
                                  <span
                                    className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                                      inst.role === "PROFESSOR"
                                        ? "bg-purple-950/60 border-purple-800/60 text-purple-300"
                                        : inst.role === "ADMIN"
                                        ? "bg-blue-950/60 border-blue-800/60 text-blue-300"
                                        : "bg-emerald-950/60 border-emerald-800/60 text-emerald-300"
                                    }`}
                                  >
                                    {inst.role}
                                  </span>
                                </td>
                                <td className="py-3.5 px-4">
                                  <span className="text-zinc-300">{inst.department || "General Department"}</span>
                                </td>
                                <td className="py-3.5 px-4 font-mono text-[11px] text-zinc-400">
                                  {inst.createdAt ? new Date(inst.createdAt).toLocaleDateString() : "Active"}
                                </td>
                                <td className="py-3.5 px-4 text-right">
                                  {isSelf ? (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-zinc-700 bg-zinc-800/60 text-zinc-400 text-[11px] font-mono">
                                      <span>🔒</span>
                                      <span>Current Session</span>
                                    </span>
                                  ) : isTa ? (
                                    <button
                                      type="button"
                                      onClick={() => handleRevokeInstructor(inst.id, inst.username, inst.displayName)}
                                      disabled={revokingInstructorId === inst.id}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-800/60 bg-red-950/40 hover:bg-red-900/60 hover:border-red-700 text-red-300 text-xs font-medium transition cursor-pointer disabled:opacity-50 shadow-xs"
                                      title={`Revoke teaching assistant credentials and terminate active sessions for @${inst.username}`}
                                    >
                                      <span>🚫</span>
                                      <span>{revokingInstructorId === inst.id ? "Revoking..." : "Revoke Access"}</span>
                                    </button>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-purple-800/40 bg-purple-950/30 text-purple-300 text-[11px] font-mono">
                                      <span>🏛️</span>
                                      <span>Faculty (Protected)</span>
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Task 3.2: Add Teaching Assistant Provisioning Modal (Inside Cockpit View) */}
        {showAddTaModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-lg w-full p-6 sm:p-7 space-y-5 shadow-2xl">
              <div className="flex items-start justify-between pb-3 border-b border-zinc-800/80">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
                    ➕
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-white tracking-tight">
                      {provisionedCredentials
                        ? (provisionedCredentials.role === "PROFESSOR" ? "Professor Account Provisioned" : "Teaching Assistant Provisioned")
                        : (newStaffRole === "PROFESSOR" ? "Add Professor / Co-Instructor" : "Add Teaching Assistant")}
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {provisionedCredentials
                        ? "Account created in openviva.db. Save temporary credentials."
                        : (newStaffRole === "PROFESSOR"
                            ? "Provision a co-instructor with full course syllabus and staff administration privileges."
                            : "Onboard a TA with scoped grading and proctoring privileges.")}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowAddTaModal(false);
                    setProvisionedCredentials(null);
                  }}
                  className="text-zinc-500 hover:text-white transition text-sm p-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {provisionedCredentials ? (
                /* One-Time Credential Confirmation Card */
                <div className="space-y-4">
                  <div className="p-3.5 bg-emerald-950/40 border border-emerald-800/60 rounded-xl space-y-1.5">
                    <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                      <span>✓</span>
                      <span>
                        {provisionedCredentials.role === "PROFESSOR"
                          ? "Professor Account Successfully Created"
                          : "TA Account Successfully Created"}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-300 leading-relaxed">
                      This account is now authorized to log in to the OpenViva Cockpit. Deliver these credentials directly to the student assistant.
                    </p>
                  </div>

                  <div className="p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-3">
                    <div className="flex items-center justify-between text-[11px] border-b border-zinc-800/80 pb-2">
                      <span className="text-zinc-400">Display Name:</span>
                      <span className="font-medium text-white">{provisionedCredentials.displayName}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] border-b border-zinc-800/80 pb-2">
                      <span className="text-zinc-400">Username:</span>
                      <span className="font-mono text-amber-300 font-semibold">@{provisionedCredentials.username}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] border-b border-zinc-800/80 pb-2">
                      <span className="text-zinc-400">Temporary Password:</span>
                      <span className="font-mono text-emerald-300 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800 font-bold select-all">
                        {provisionedCredentials.password}
                      </span>
                    </div>
                    {provisionedCredentials.department && (
                      <div className="flex items-center justify-between text-[11px] border-b border-zinc-800/80 pb-2">
                        <span className="text-zinc-400">Department / Lab:</span>
                        <span className="text-zinc-300">{provisionedCredentials.department}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400">Assigned Role:</span>
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                          provisionedCredentials.role === "PROFESSOR"
                            ? "bg-indigo-950/60 border-indigo-800/60 text-indigo-300 font-semibold"
                            : "bg-emerald-950/60 border-emerald-800/60 text-emerald-300"
                        }`}
                      >
                        {provisionedCredentials.role === "PROFESSOR"
                          ? "Professor (Lead Faculty / Co-Instructor)"
                          : "Teaching Assistant (TA)"}
                      </span>
                    </div>
                  </div>

                  <div className="p-3 bg-amber-950/30 border border-amber-800/40 rounded-xl text-[11px] text-amber-300 flex items-start gap-2">
                    <span className="text-xs">⚠️</span>
                    <span>
                      <strong>One-Time Confirmation:</strong> Passwords are stored using salted Scrypt KDF hashes and cannot be recovered in plaintext once this dialog is closed.
                    </span>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleCopyCredentials}
                      className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-2 shadow-sm"
                    >
                      <span>{copiedCredentials ? "✓" : "📋"}</span>
                      <span>{copiedCredentials ? "Copied to Clipboard!" : "Copy TA Credentials"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddTaModal(false);
                        setProvisionedCredentials(null);
                      }}
                      className="px-4 py-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-medium transition cursor-pointer"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                /* Provisioning Form */
                <form onSubmit={handleProvisionTa} className="space-y-4">
                  {newTaError && (
                    <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-xs font-mono text-red-300">
                      • {newTaError}
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-zinc-300 block mb-1 font-medium">
                        Full Name / Display Name <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Rahul Sharma (Systems TA)"
                        value={newTaName}
                        onChange={(e) => setNewTaName(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition"
                        required
                      />
                    </div>

                    <div>
                      <label className="text-xs text-zinc-300 block mb-1 font-medium">
                        Username <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. ta_rahul"
                        value={newTaUsername}
                        onChange={(e) => setNewTaUsername(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition"
                        required
                      />
                      <span className="text-[10px] text-zinc-500 mt-0.5 block">Lowercase letters, numbers, hyphens, and underscores only.</span>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-zinc-300 font-medium">
                          Temporary Initial Password <span className="text-red-400">*</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setNewTaPassword(generateSecureTempPassword())}
                          className="text-[10px] font-mono text-amber-400 hover:text-amber-300 transition cursor-pointer"
                        >
                          🎲 Generate Random
                        </button>
                      </div>
                      <input
                        type="text"
                        value={newTaPassword}
                        onChange={(e) => setNewTaPassword(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs font-mono text-emerald-300 placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition"
                        required
                      />
                    </div>

                    <div>
                      <label className="text-xs text-zinc-300 block mb-1 font-medium">
                        Assigned Department / Lab
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Computer Systems & Networks Lab"
                        value={newTaDepartment}
                        onChange={(e) => setNewTaDepartment(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-zinc-300 block mb-1.5 font-medium">
                        Institutional Privilege Role <span className="text-red-400">*</span>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setNewStaffRole("TA")}
                          className={`py-2 px-3 rounded-xl border text-xs font-medium transition cursor-pointer flex items-center justify-center gap-1.5 ${
                            newStaffRole === "TA"
                              ? "bg-amber-500/15 border-amber-500/50 text-amber-300 font-semibold"
                              : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                          }`}
                        >
                          <span>🎓</span>
                          <span>Teaching Assistant</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewStaffRole("PROFESSOR")}
                          className={`py-2 px-3 rounded-xl border text-xs font-medium transition cursor-pointer flex items-center justify-center gap-1.5 ${
                            newStaffRole === "PROFESSOR"
                              ? "bg-indigo-500/15 border-indigo-500/50 text-indigo-300 font-semibold"
                              : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                          }`}
                        >
                          <span>🏛️</span>
                          <span>Professor / Co-Instructor</span>
                        </button>
                      </div>
                    </div>

                    {newStaffRole === "PROFESSOR" && (
                      <div className="p-3.5 bg-indigo-950/30 border border-indigo-800/40 rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs text-indigo-200 font-medium flex items-center gap-1.5">
                            <span>🔑</span>
                            <span>Institutional Bootstrap Key</span>
                            <span className="text-red-400">*</span>
                          </label>
                        </div>
                        <input
                          type="password"
                          placeholder="Enter institutional root bootstrap key"
                          value={newStaffAdminKey}
                          onChange={(e) => setNewStaffAdminKey(e.target.value)}
                          className="w-full bg-zinc-900 border border-indigo-800/50 rounded-xl px-3.5 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition"
                          required
                        />
                        <p className="text-[10px] text-zinc-400 leading-normal">
                          Elevating an account to Professor grants full academic sovereignty over courses, syllabi, and staff. Departmental key confirmation is strictly required.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 pt-3 border-t border-zinc-800/80">
                    <button
                      type="button"
                      onClick={() => setShowAddTaModal(false)}
                      className="flex-1 py-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-medium transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={newTaLoading}
                      className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-2 shadow-sm"
                    >
                      {newTaLoading ? (
                        <>
                          <span className="animate-spin text-sm">⏳</span>
                          <span>Provisioning...</span>
                        </>
                      ) : (
                        <>
                          <span>➕</span>
                          <span>{newStaffRole === "PROFESSOR" ? "Create Professor Account" : "Create TA Account"}</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-[85vh] flex flex-col justify-between py-6 px-2 sm:px-4 font-sans text-white max-w-5xl mx-auto space-y-8">
      <div className="space-y-6">
        {/* Minimal Header Nav */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-900 text-xs">
          <div className="flex items-center gap-3">
            <button
              onClick={handleStepBack}
              className="text-zinc-500 hover:text-white transition flex items-center gap-2 cursor-pointer"
            >
              <span>←</span>
              <span>{currentStep === 1 ? "Curriculum" : "Back"}</span>
            </button>
            {editingExamId && (
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono text-[11px]">
                Editing SQLite Syllabus: {courseTitle || editingExamId}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 font-mono text-zinc-500">
            {currentInstructor && (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>{currentInstructor.displayName}</span>
              </span>
            )}
            <span>Step {currentStep} of 4</span>
            <span className="text-zinc-800">•</span>
            <button
              onClick={() => {
                setEditingExamId(null);
                setTaViewMode("choice");
              }}
              className="text-zinc-500 hover:text-zinc-300 transition cursor-pointer"
            >
              Exit to Cockpit
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* PERSISTENT TOP CONTROLS (Anchored across all steps) */}
        {/* ========================================================================= */}
        <div className="space-y-3">
          {/* Row 1: Course Title, Lead Professor, and Supervising TA (Locked to Logged-in Session) */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-6">
              <input
                type="text"
                placeholder="Course title (required)"
                value={courseTitle}
                onChange={(e) => {
                  setCourseTitle(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                className={`w-full bg-zinc-950/80 border rounded-xl px-4 py-3 text-lg font-medium text-white placeholder-zinc-600 focus:outline-none transition ${
                  validationError && !courseTitle.trim()
                    ? "border-red-500/80 focus:border-red-400"
                    : "border-zinc-800 focus:border-zinc-500"
                }`}
              />
            </div>
            <div className="md:col-span-3">
              <input
                type="text"
                placeholder="Lead Professor (e.g. Prof. Jane Doe)"
                value={leadProfessor}
                onChange={(e) => {
                  setLeadProfessor(e.target.value);
                  setInstructorId(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                className={`w-full bg-zinc-950/80 border rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none transition ${
                  validationError && !leadProfessor.trim() && !instructorId.trim()
                    ? "border-red-500/80 focus:border-red-400"
                    : "border-zinc-800 focus:border-zinc-500"
                }`}
              />
            </div>
            <div
              onClick={() => {
                setAuthError(null);
                setShowAuthModal(true);
              }}
              className="md:col-span-3 flex items-center gap-2 bg-zinc-950/80 border border-zinc-800/90 hover:border-zinc-700 rounded-xl px-3.5 py-2.5 cursor-pointer transition group"
              title="Click to switch or manage logged-in TA account"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-500 group-hover:text-zinc-400 block leading-tight flex items-center justify-between">
                  <span>Supervising TA</span>
                  <span className="text-[9px] text-zinc-400 underline">Switch</span>
                </span>
                <span className="text-xs font-mono text-zinc-200 truncate block">
                  {supervisingTaName}
                </span>
              </div>
              <span className="text-xs text-zinc-600 font-mono" title="Locked to authenticated TA session">🔒</span>
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
                Defense Rigor
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
                Duration
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
                Focus
              </label>
              <button
                type="button"
                onClick={() => setStudentDecidesWeightage(!studentDecidesWeightage)}
                className="w-full bg-zinc-950/80 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-left text-zinc-300 hover:border-zinc-600 transition cursor-pointer flex items-center justify-between"
              >
                <span>{studentDecidesWeightage ? "Candidate Choice" : "Autonomous Dive"}</span>
                <span className="text-[10px] text-zinc-500 font-mono">Toggle</span>
              </button>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* THE MASSIVE WORKHORSE BLOCK */}
        {/* Only the contents inside this block change as the user progresses */}
        {/* ========================================================================= */}
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-6 sm:p-10 shadow-sm transition-all">
          {currentStep === 1 && (
            <div className="space-y-6">
              {/* Top-Level Mode Selector: Question Bank vs Syllabus Topics */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-zinc-800/80 gap-3">
                <div className="flex items-center gap-1.5 p-1 bg-zinc-900/90 border border-zinc-800 rounded-xl w-fit">
                  <button
                    type="button"
                    onClick={() => {
                      setCurriculumMode("questions");
                      setImportMode("qa");
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                      curriculumMode === "questions"
                        ? "bg-emerald-600 text-white font-semibold shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <span>❓</span>
                    <span>Question Bank Mode</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCurriculumMode("topics");
                      setImportMode("syllabus");
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                      curriculumMode === "topics"
                        ? "bg-zinc-200 text-zinc-950 font-semibold shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <span>📚</span>
                    <span>Syllabus Topics Mode</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setImportMode(curriculumMode === "questions" ? "qa" : "syllabus");
                      setShowImportModal(true);
                    }}
                    className="text-xs text-zinc-300 hover:text-white transition flex items-center gap-1.5 py-1.5 px-3 rounded-xl border border-zinc-800 hover:border-zinc-600 bg-zinc-900/40 cursor-pointer shadow-sm"
                  >
                    <span>✨</span>
                    <span>{curriculumMode === "questions" ? "Paste Question Bank (Bulk)" : "Import Outline (Bulk)"}</span>
                    <span>→</span>
                  </button>
                </div>
              </div>

              {/* Minimal Header */}
              <div>
                <h2 className="text-2xl sm:text-3xl font-medium text-white tracking-tight">
                  {curriculumMode === "questions" ? "Exam questions & answer keys." : "Core topics."}
                </h2>
                <p className="text-sm text-zinc-500 mt-1">
                  {curriculumMode === "questions"
                    ? "Input your exam questions with optional answers. The AI will cluster them into domains and generate Socratic follow-up probes."
                    : "Foundational examination subjects and syllabus domains."}
                </p>
              </div>

              {/* AI Suggestions Bar (Course Name + Focus Directive / Comment) */}
              <div className="p-4 rounded-xl border border-emerald-900/50 bg-emerald-950/20 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400 text-sm">✨</span>
                    <span className="text-xs font-semibold text-emerald-300">
                      {curriculumMode === "questions" ? "AI Question Suggestions" : "AI Topic Suggestions"}
                    </span>
                    <span className="text-[11px] text-zinc-500 font-mono hidden sm:inline">
                      {curriculumMode === "questions"
                        ? "(Generates 5-7 exam question suggestions from Course Title & Directives)"
                        : "(Generates 5-7 topic suggestions from Course Title & Directives)"}
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
                    placeholder={
                      curriculumMode === "questions"
                        ? "Directive or focus (e.g. Generate questions on backprop, pooling, ResNet, and loss functions)..."
                        : "Focus directives / comment (e.g. Focus on backprop, pooling, ResNet, and loss functions)..."
                    }
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
                    disabled={isGeneratingCoreTopics || !courseTitle.trim()}
                    className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:hover:bg-emerald-700 text-white font-medium text-xs transition flex items-center justify-center gap-1.5 cursor-pointer shrink-0 shadow-sm"
                  >
                    <span>⚡</span>
                    <span>
                      {isGeneratingCoreTopics
                        ? "Suggesting..."
                        : (curriculumMode === "questions" ? "Suggest Questions" : "Suggest Topics")}
                    </span>
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

              {/* Input Bar */}
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider">
                  {curriculumMode === "questions" ? "Or Add Single Question / Q&A Manually:" : "Or Add Single Topic Manually:"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder={
                    curriculumMode === "questions"
                      ? "Add question, or 'Q: ... A: ...' (press Enter)..."
                      : "Add topic (press Enter)..."
                  }
                  value={bubbleInput}
                  onChange={(e) => setBubbleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddBubble();
                    }
                  }}
                  className="flex-1 bg-zinc-900/40 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
                />
                <button
                  type="button"
                  onClick={() => handleAddBubble()}
                  disabled={!bubbleInput.trim()}
                  className="px-5 py-3 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:hover:bg-zinc-800 text-white transition cursor-pointer"
                >
                  {curriculumMode === "questions" ? "Add Question" : "Add Topic"}
                </button>
              </div>

              {/* Topic Pills Display */}
              <div className="p-4 rounded-xl border border-zinc-900 bg-black/40 min-h-[90px] flex flex-wrap items-center gap-2">
                {topicBubbles.length === 0 ? (
                  <span className="text-xs text-zinc-600 font-mono">
                    No topics added yet.
                  </span>
                ) : (
                  topicBubbles.map((bubble, idx) => {
                    const isEditing = editingIndex === idx;
                    return isEditing ? (
                      <div key={idx} className="flex items-center gap-1.5 bg-black border border-zinc-500 rounded-full px-3 py-1">
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
                          className="bg-transparent text-white text-xs focus:outline-none w-40"
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
                        onDragEnd={() => setDraggedBubbleIndex(null)}
                        className="group flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 hover:border-zinc-600 text-xs text-zinc-200 transition cursor-grab active:cursor-grabbing select-none"
                      >
                        <span
                          onClick={() => handleStartEditBubble(idx)}
                          className="cursor-pointer hover:underline"
                          title="Click to edit"
                        >
                          {bubble}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveBubble(idx)}
                          className="text-zinc-500 hover:text-white transition text-xs leading-none cursor-pointer"
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* AI Suggestions */}
              {isSuggesting && (
                <div className="text-xs text-zinc-500 font-mono animate-pulse">
                  Generating suggestions...
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
              {!isSuggesting && dynamicSuggestions.length > 0 && (
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

              {/* Bottom Transition Bar with simple symbol to advance */}
              <div className="pt-6 border-t border-zinc-900 flex items-center justify-between">
                <span className="text-xs font-mono text-zinc-600">
                  {topicBubbles.length} {curriculumMode === "questions" ? "question" : "topic"}{topicBubbles.length === 1 ? "" : "s"}
                </span>
                <div className="flex items-center gap-3">
                  {topicBubbles.length >= 2 && curriculumMode === "questions" ? (
                    <button
                      type="button"
                      onClick={handleClusterBubblesAI}
                      disabled={isImportNormalizing}
                      className="px-4 py-2.5 rounded-xl border border-emerald-700 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition cursor-pointer flex items-center gap-2 shadow-sm"
                    >
                      <span>✨</span>
                      <span>{isImportNormalizing ? "Clustering & Analyzing..." : "AI Cluster into Hierarchy →"}</span>
                    </button>
                  ) : (
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
                      <span>{curriculumMode === "questions" ? "Build hierarchy" : "Build subtopics"}</span>
                      <span className="text-base group-hover:translate-x-1.5 transition-transform duration-200">
                        →
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

      {/* ========================================================================= */}
      {/* STEP 2: INTERACTIVE TREE BUILDER (MINIMALIST REDESIGN) */}
      {/* ========================================================================= */}
      {currentStep === 2 && (() => {
        const totalSyllabusTopics = tree.reduce((acc, n) => acc + 1 + n.children.length, 0);
        const secondsPerTopic = totalSyllabusTopics > 0 ? Math.round((durationMinutes * 60) / totalSyllabusTopics) : 0;
        return (
        <div className="space-y-6">
          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl sm:text-3xl font-medium text-white tracking-tight">
                {curriculumMode === "questions" ? "Question & probe hierarchy." : "Topic hierarchy."}
              </h2>
              <p className="text-sm text-zinc-500 mt-1">
                {curriculumMode === "questions"
                  ? "Organize question domains, inspect Socratic follow-up probes, and verify Ground Truth answers."
                  : "Structure chapters, sprout subtopics, or attach examiner directives."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowImportModal(true)}
                className="text-xs text-zinc-400 hover:text-white transition flex items-center gap-1.5 py-1.5 px-3 rounded-xl border border-zinc-800 hover:border-zinc-600 bg-zinc-900/40 cursor-pointer"
              >
                <span>Import</span>
                <span>→</span>
              </button>
              <button
                type="button"
                onClick={() => setShowRootContextInput(!showRootContextInput)}
                className="text-xs text-zinc-300 hover:text-white transition flex items-center gap-1.5 py-1.5 px-3 rounded-xl border border-zinc-800 hover:border-zinc-600 bg-zinc-900/60 cursor-pointer"
              >
                <span>+ Add topics</span>
              </button>
            </div>
          </div>

          {/* Real-Time Viva Feasibility & Socratic Budget Meter */}
          <div className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/30 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                  Viva Clock &amp; Depth Meter:
                </span>
                <span className="text-xs font-mono text-white bg-zinc-800/80 px-2.5 py-0.5 rounded-md border border-zinc-700/60">
                  {totalSyllabusTopics} topic{totalSyllabusTopics === 1 ? "" : "s"} ({tree.length} chapters, {totalSyllabusTopics - tree.length} subtopics)
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[11px] text-zinc-500 font-mono mr-1">Duration:</span>
                {DURATION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setDurationMinutes(opt.value);
                      refreshGeneratedPrompt(difficultyTier, studentDecidesWeightage, opt.value);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono transition cursor-pointer ${
                      durationMinutes === opt.value
                        ? "bg-white text-black font-medium shadow-sm"
                        : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700"
                    }`}
                  >
                    {opt.shortLabel}
                  </button>
                ))}
              </div>
            </div>

            {totalSyllabusTopics > 0 && (
              <div className="text-xs">
                {secondsPerTopic < 60 ? (
                  <div className="flex items-center gap-2 p-2.5 rounded-xl border border-amber-500/30 bg-amber-950/20 text-amber-300 font-mono">
                    <span className="text-base shrink-0">⚠️</span>
                    <span>
                      <strong>Dense Coverage (~{secondsPerTopic}s/topic):</strong> For a {durationMinutes} min oral defense, the examiner will prioritize and sample 3–5 core chapters for deep Socratic probing rather than rushing all {totalSyllabusTopics} topics.
                    </span>
                  </div>
                ) : secondsPerTopic <= 150 ? (
                  <div className="flex items-center gap-2 p-2.5 rounded-xl border border-emerald-500/30 bg-emerald-950/20 text-emerald-300 font-mono">
                    <span className="text-base shrink-0">⚡</span>
                    <span>
                      <strong>Balanced Socratic Depth (~{Math.round((secondsPerTopic / 60) * 10) / 10} min/topic):</strong> Optimal cadence for 3–4 turn deep probing per subject.
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 p-2.5 rounded-xl border border-cyan-500/30 bg-cyan-950/20 text-cyan-300 font-mono">
                    <span className="text-base shrink-0">✨</span>
                    <span>
                      <strong>Deep Socratic Focus (~{Math.round((secondsPerTopic / 60) * 10) / 10} min/topic):</strong> Excellent ratio for rigorous, exhaustive inquiry.
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Examiner Directive Bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500 font-mono text-[11px] uppercase tracking-wider">
                Examiner Directive
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
              placeholder="Instructions for examiner focus (e.g. require mathematical justifications)..."
              value={globalDirective}
              onChange={(e) => setGlobalDirective(e.target.value)}
              className="w-full bg-zinc-900/40 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
            />
          </div>

          {/* Optional Steering Context or Manual Add for Root Topics */}
          {showRootContextInput && (
            <div className="p-3 bg-zinc-950/80 border border-zinc-700/80 rounded-xl space-y-2">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input
                  type="text"
                  placeholder="Enter chapter title OR AI focus prompt..."
                  value={rootSteeringPrompt}
                  onChange={(e) => setRootSteeringPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (rootSteeringPrompt.trim()) {
                        handleAddManualRootTopic(rootSteeringPrompt.trim());
                      }
                    }
                  }}
                  className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleAddManualRootTopic(rootSteeringPrompt)}
                    disabled={!rootSteeringPrompt.trim()}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer transition flex items-center gap-1"
                    title="Add this chapter directly without AI"
                  >
                    <span>+ Add Chapter</span>
                  </button>
                  <button
                    onClick={handleGenerateRootTopics}
                    disabled={isRootExpanding}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 hover:text-white rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer transition flex items-center gap-1 border border-zinc-700"
                    title="Generate 3-4 suggestions with Phi-3.5"
                  >
                    <span>{isRootExpanding ? "Thinking..." : "✨ AI Suggest"}</span>
                  </button>
                </div>
              </div>
              <div className="text-[10px] text-zinc-500 flex items-center justify-between font-mono">
                <span>Hit Enter or click &quot;+ Add Chapter&quot; to insert directly</span>
                <span>AI Suggest adds peer chapters via Phi-3.5</span>
              </div>
            </div>
          )}

          {rootError && (
            <div className="p-3 rounded-xl border border-amber-800/60 bg-amber-950/20 text-xs text-amber-300 font-mono flex items-center justify-between">
              <span>⚠️ {rootError}</span>
              <button
                type="button"
                onClick={() => setRootError(null)}
                className="text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer ml-2"
              >
                ✕
              </button>
            </div>
          )}

          {/* Root Candidate Blocks */}
          {rootCandidates.length > 0 && (
            <div className="space-y-3 p-4 rounded-xl border border-zinc-900 bg-black/40">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400 font-medium">
                  Suggested topics ({rootCandidates.length})
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleGenerateRootTopics()}
                    disabled={isRootExpanding}
                    className="text-zinc-500 hover:text-zinc-300 text-xs transition cursor-pointer"
                  >
                    {isRootExpanding ? "Generating..." : "+ More"}
                  </button>
                  <button
                    onClick={clearAllRootCandidates}
                    className="text-zinc-600 hover:text-zinc-400 text-xs transition cursor-pointer"
                  >
                    Clear all
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(rootCandidates.length > 8 && !isRootCandidatesExpanded
                  ? rootCandidates.slice(0, 8)
                  : rootCandidates
                ).map((cand) => (
                  <div
                    key={cand.id}
                    className="p-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/40 hover:border-zinc-700 flex items-center justify-between gap-3 text-xs transition"
                  >
                    <span className="text-zinc-200 truncate">{cand.title}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => acceptRootCandidate(cand.id)}
                        className="w-6 h-6 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center justify-center transition cursor-pointer"
                        title="Add to syllabus"
                      >
                        +
                      </button>
                      <button
                        onClick={() => rejectRootCandidate(cand.id)}
                        className="w-6 h-6 rounded-lg bg-transparent hover:bg-zinc-800/60 text-zinc-500 hover:text-zinc-300 flex items-center justify-center transition cursor-pointer"
                        title="Discard"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {rootCandidates.length > 8 && (
                <button
                  onClick={() => setIsRootCandidatesExpanded(!isRootCandidatesExpanded)}
                  className="text-[11px] text-zinc-500 hover:text-zinc-300 transition cursor-pointer"
                >
                  {isRootCandidatesExpanded ? "Show fewer" : `Show all (${rootCandidates.length})`}
                </button>
              )}
            </div>
          )}

          {/* Hierarchical Syllabus Tree List */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between text-xs text-zinc-500 font-mono">
              <span>Syllabus structure ({tree.length} chapters)</span>
              <span>Drag handles to reorder</span>
            </div>

            {tree.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-zinc-900 rounded-xl text-zinc-600 text-xs">
                No chapters added yet. Go back to add core topics.
              </div>
            ) : (
              <div className="space-y-2">
                {tree.map((rootNode, rootIdx) => (
                  <RenderTreeNode
                    key={rootNode.id}
                    node={rootNode}
                    nodeNumber={`${rootIdx + 1}`}
                    draggedNodeId={draggedNodeId}
                    onDragStartNode={(id) => setDraggedNodeId(id)}
                    onDragEndNode={() => setDraggedNodeId(null)}
                    onMoveNode={handleMoveNode}
                    onToggleContext={toggleNodeContext}
                    onGenerateSubtopics={handleGenerateSubtopics}
                    onAcceptChild={acceptChildCandidate}
                    onRejectChild={rejectChildCandidate}
                    onClearAllChildren={clearAllChildCandidates}
                    onEditTitle={editNodeTitle}
                    onToggleCommentInput={toggleNodeCommentInput}
                    onSetComment={setNodeComment}
                    onDelete={deleteNode}
                    onAddManualChild={handleAddManualSubtopic}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Navigation Buttons */}
          <div className="pt-6 border-t border-zinc-900 flex items-center justify-between">
            <button
              onClick={handleStepBack}
              className="text-xs text-zinc-500 hover:text-white transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>←</span>
              <span>Topics</span>
            </button>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSavePreset}
                disabled={isSavingPreset}
                className="px-4 py-2 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 text-xs font-medium text-zinc-300 transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                <span>{isSavingPreset ? "Saving to DB..." : (editingExamId ? "Update SQLite Syllabus" : "Save Syllabus to DB")}</span>
              </button>
              <button
                type="button"
                onClick={handleLaunchSession}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-medium transition cursor-pointer flex items-center gap-1.5 shadow-sm"
                title="Bypass student roster setup and test viva immediately with Open Access"
              >
                <span>⚡ Fast-Track: Chamber Station</span>
                <span className="text-xs">→</span>
              </button>
              <button
                onClick={() => navigateToStep(3)}
                className="group flex items-center gap-2 text-sm font-medium text-zinc-200 hover:text-white transition cursor-pointer"
              >
                <span>Candidate access</span>
                <span className="text-base group-hover:translate-x-1.5 transition-transform duration-200">
                  →
                </span>
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* STEP 3: CANDIDATE ACCESS CONTROL (OPEN VS RESTRICTED ROSTER) */}
      {/* ========================================================================= */}
      {currentStep === 3 && (
        <div className="space-y-8">
          {/* Section Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl sm:text-3xl font-medium text-white tracking-tight">
                Candidate access.
              </h2>
              <p className="text-sm text-zinc-500 mt-1">
                Configure student authorization and access control for this examination.
              </p>
            </div>
            <div className="text-xs font-mono text-zinc-400 bg-zinc-950/80 border border-zinc-800 px-3.5 py-1.5 rounded-xl">
              {accessControlType === "OPEN"
                ? "Open Access Mode"
                : `Restricted • ${allowedStudents.length} Authorized`}
            </div>
          </div>

          {/* Dual Choice Cards (Open Access vs Restricted Access) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Choice 1: Open Access */}
            <div
              onClick={() => {
                setAccessControlType("OPEN");
                setCsvUploadError(null);
              }}
              className={`p-6 rounded-2xl border transition-all duration-150 cursor-pointer flex flex-col justify-between space-y-4 ${
                accessControlType === "OPEN"
                  ? "bg-zinc-900/70 border-white shadow-md ring-1 ring-white/20"
                  : "bg-zinc-950/60 border-zinc-800/80 hover:bg-zinc-900/30 hover:border-zinc-700"
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                    Mode A • Public
                  </span>
                  <div
                    className={`w-3 h-3 rounded-full border ${
                      accessControlType === "OPEN"
                        ? "bg-emerald-500 border-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                        : "border-zinc-700 bg-transparent"
                    }`}
                  />
                </div>
                <h3 className="text-lg font-medium text-white tracking-tight">
                  Open Access (Anyone Can Take It)
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed font-normal">
                  Any student with the examination portal link can enter their Student ID and sit for the viva. No pre-registration required.
                </p>
              </div>

              <div className="pt-2 text-[11px] font-mono text-zinc-500 flex items-center gap-1.5">
                <span>✓</span>
                <span>Self-serve student entry</span>
              </div>
            </div>

            {/* Choice 2: Restricted Access */}
            <div
              onClick={() => setAccessControlType("RESTRICTED")}
              className={`p-6 rounded-2xl border transition-all duration-150 cursor-pointer flex flex-col justify-between space-y-4 ${
                accessControlType === "RESTRICTED"
                  ? "bg-zinc-900/70 border-white shadow-md ring-1 ring-white/20"
                  : "bg-zinc-950/60 border-zinc-800/80 hover:bg-zinc-900/30 hover:border-zinc-700"
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                    Mode B • Secure
                  </span>
                  <div
                    className={`w-3 h-3 rounded-full border ${
                      accessControlType === "RESTRICTED"
                        ? "bg-amber-500 border-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                        : "border-zinc-700 bg-transparent"
                    }`}
                  />
                </div>
                <h3 className="text-lg font-medium text-white tracking-tight">
                  Restricted Access (Authorized Roster Only)
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed font-normal">
                  Lock the examination. Only candidates whose Registration Number is on the verified class roster can enter the chamber.
                </p>
              </div>

              <div className="pt-2 text-[11px] font-mono text-zinc-500 flex items-center gap-1.5">
                <span>🔒</span>
                <span>{allowedStudents.length} candidate{allowedStudents.length === 1 ? "" : "s"} currently authorized</span>
              </div>
            </div>
          </div>

          {/* Restricted Mode Management: CSV Upload & Manual Entry & Live Table */}
          {accessControlType === "RESTRICTED" && (
            <div className="space-y-6 pt-2">
              {/* CSV Upload Section */}
              <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 block">
                      Roster Ingestion
                    </span>
                    <h4 className="text-sm font-medium text-white mt-0.5">
                      Upload Roster CSV
                    </h4>
                    <p className="text-xs text-zinc-400 mt-1">
                      Upload a spreadsheet or CSV containing student names and registration numbers.
                    </p>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500 border border-zinc-800 px-2 py-1 rounded-md">
                    .CSV, .TXT
                  </span>
                </div>

                {/* Hidden File Input */}
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".csv,text/csv,text/plain"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleCsvFileUpload(file);
                      e.target.value = "";
                    }
                  }}
                  className="hidden"
                />

                {/* Drop / Click Target */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleCsvFileUpload(file);
                  }}
                  className="border border-dashed border-zinc-800 hover:border-zinc-600 rounded-xl p-6 text-center bg-zinc-900/20 hover:bg-zinc-900/40 transition cursor-pointer space-y-1.5"
                >
                  <div className="text-sm font-medium text-zinc-300">
                    Click to select CSV or drag and drop file here
                  </div>
                  <div className="text-xs text-zinc-500 font-mono">
                    Expected columns: <span className="text-zinc-400">Name, Registration Number</span> (e.g. Alice Smith, 2024CS042)
                  </div>
                </div>

                {csvSuccessNotice && (
                  <div className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-950/30 text-xs text-emerald-300 font-mono flex items-center justify-between">
                    <span>✓ {csvSuccessNotice}</span>
                    <button
                      type="button"
                      onClick={() => setCsvSuccessNotice(null)}
                      className="text-emerald-400 hover:text-white transition ml-2"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {csvUploadError && (
                  <div className="p-3 rounded-xl border border-red-500/40 bg-red-950/30 text-xs text-red-300 font-mono flex items-center justify-between">
                    <span>⚠ {csvUploadError}</span>
                    <button
                      type="button"
                      onClick={() => setCsvUploadError(null)}
                      className="text-red-400 hover:text-white transition ml-2"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              {/* Manual Entry Row */}
              <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-5 space-y-3">
                <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 block">
                  Add From Scratch / Manual Entry
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                  <div className="sm:col-span-5">
                    <input
                      type="text"
                      placeholder="Student Name (optional)"
                      value={newStudentName}
                      onChange={(e) => setNewStudentName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleManualAddStudent();
                      }}
                      className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
                    />
                  </div>
                  <div className="sm:col-span-5">
                    <input
                      type="text"
                      placeholder="Registration Number (e.g. 2024CS001)"
                      value={newStudentRegNo}
                      onChange={(e) => setNewStudentRegNo(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleManualAddStudent();
                      }}
                      className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 font-mono focus:outline-none focus:border-zinc-500 transition"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <button
                      type="button"
                      onClick={handleManualAddStudent}
                      disabled={!newStudentRegNo.trim()}
                      className="w-full py-2.5 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:hover:bg-zinc-800 text-xs font-medium text-white transition cursor-pointer"
                    >
                      + Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Interactive Live Roster Table */}
              <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800/60">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-white">
                      Authorized Candidates Roster
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400">
                      {allowedStudents.length} candidate{allowedStudents.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {allowedStudents.length > 5 && (
                      <input
                        type="text"
                        placeholder="Filter roster..."
                        value={rosterSearch}
                        onChange={(e) => setRosterSearch(e.target.value)}
                        className="bg-zinc-900/80 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 w-44 font-mono"
                      />
                    )}
                    {allowedStudents.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearRoster}
                        className="text-xs text-zinc-500 hover:text-red-400 transition cursor-pointer font-mono"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                </div>

                {allowedStudents.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-zinc-900 rounded-xl text-zinc-600 text-xs space-y-1">
                    <div>No candidates authorized yet.</div>
                    <div className="text-[11px] text-zinc-500">
                      Upload a CSV file or enter registration numbers above.
                    </div>
                  </div>
                ) : (
                  <div className="max-h-72 overflow-y-auto rounded-xl border border-zinc-800/50">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-zinc-900/80 text-[10px] font-mono uppercase tracking-wider text-zinc-500 sticky top-0">
                        <tr>
                          <th className="py-2.5 px-4 w-12">#</th>
                          <th className="py-2.5 px-4">Student Name</th>
                          <th className="py-2.5 px-4">Registration Number</th>
                          <th className="py-2.5 px-4 w-16 text-right">Remove</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-900">
                        {allowedStudents
                          .filter((s) => {
                            if (!rosterSearch.trim()) return true;
                            const q = rosterSearch.toLowerCase();
                            return (
                              s.name.toLowerCase().includes(q) ||
                              s.regNo.toLowerCase().includes(q)
                            );
                          })
                          .map((student, idx) => (
                            <tr
                              key={student.regNo}
                              className="hover:bg-zinc-900/40 transition-colors"
                            >
                              <td className="py-2 px-4 font-mono text-[11px] text-zinc-500">
                                {idx + 1}
                              </td>
                              <td className="py-2 px-4 font-medium text-zinc-200">
                                {student.name}
                              </td>
                              <td className="py-2 px-4 font-mono text-zinc-400">
                                {student.regNo}
                              </td>
                              <td className="py-2 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveStudent(student.regNo)}
                                  className="w-6 h-6 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-zinc-900 transition flex items-center justify-center ml-auto cursor-pointer"
                                  title="Remove student"
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3 Navigation Buttons */}
          <div className="pt-6 border-t border-zinc-900 flex items-center justify-between">
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
              onClick={handleProceedToReview}
              className="group flex items-center gap-2 text-sm font-medium text-zinc-200 hover:text-white transition cursor-pointer"
            >
              <span>Review & finalize</span>
              <span className="text-base group-hover:translate-x-1.5 transition-transform duration-200">
                →
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 4: REVIEW & LAUNCH VIVA */}
      {/* ========================================================================= */}
      {currentStep === 4 && (
        <div className="space-y-8">
          {/* Minimal Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl sm:text-3xl font-medium text-white tracking-tight">
                Review syllabus.
              </h2>
              <p className="text-sm text-zinc-500 mt-1">
                Final scope inspection and examiner launch.
              </p>
            </div>
          </div>

          {/* Locked Curriculum Tree Summary */}
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-5 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
              <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                Locked Curriculum ({flattenTree(tree).length} nodes)
              </span>
              <button
                type="button"
                onClick={handleStepBack}
                className="text-xs text-zinc-400 hover:text-white transition cursor-pointer"
              >
                Edit topics
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
                  {item.comment && (
                    <div className="text-[11px] text-zinc-500 italic pl-10">
                      Directive: &quot;{item.comment}&quot;
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Candidate Access Policy Row */}
            <div className="flex items-center justify-between pt-3 border-t border-zinc-800/60 text-xs">
              <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                Candidate Access Policy
              </span>
              <span className="font-mono text-zinc-300 flex items-center gap-1.5">
                {accessControlType === "OPEN" ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>Open Access (Unrestricted)</span>
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <span>Restricted Roster ({allowedStudents.length} authorized)</span>
                  </>
                )}
              </span>
            </div>
          </div>

          {/* Socratic Question Dry-Run Probe */}
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 block">
                  Probe Dry-Run
                </span>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Inspect candidate starter probes and follow-up depth.
                </p>
              </div>
              <button
                type="button"
                onClick={handlePreviewQuestions}
                disabled={sampleQuestionsLoading}
                className="px-3.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-200 transition disabled:opacity-40 cursor-pointer"
              >
                {sampleQuestionsLoading ? "Synthesizing..." : "Generate probes"}
              </button>
            </div>

            {sampleQuestionsLoading && (
              <div className="text-xs text-zinc-400 font-mono py-2 animate-pulse">
                Synthesizing sample probes via local model...
              </div>
            )}

            {!sampleQuestionsLoading && sampleQuestions.length > 0 && (
              <div className="space-y-3 pt-2">
                {sampleQuestions.map((q, idx) => {
                  const isEditing = editingProbeIdx === idx;
                  return (
                    <div
                      key={idx}
                      className={`p-4 rounded-xl border transition-all ${
                        q.pinned
                          ? "border-amber-500/50 bg-amber-950/20"
                          : "border-zinc-800/80 bg-zinc-950/70"
                      } space-y-3 text-xs`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-zinc-300 font-medium text-xs">
                            {q.topic}
                          </span>
                          {q.pinned && (
                            <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-md flex items-center gap-1">
                              <span>★</span>
                              <span>Gold Standard Exemplar</span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleTogglePinProbe(idx)}
                            className={`text-[11px] font-mono px-2 py-1 rounded-md transition cursor-pointer border ${
                              q.pinned
                                ? "bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30"
                                : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white"
                            }`}
                            title={q.pinned ? "Exemplar pinned for examiner" : "Pin as Gold Standard Exemplar"}
                          >
                            {q.pinned ? "★ Pinned" : "☆ Pin"}
                          </button>
                          {!isEditing ? (
                            <button
                              type="button"
                              onClick={() => handleStartEditProbe(idx)}
                              className="text-[11px] font-mono px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition cursor-pointer"
                            >
                              Edit Probe
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setEditingProbeIdx(null)}
                              className="text-[11px] font-mono px-2 py-1 text-zinc-500 hover:text-zinc-300 transition cursor-pointer"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="space-y-3 pt-1">
                          <div className="space-y-1">
                            <label className="text-[10px] font-mono uppercase text-zinc-400">
                              Opening Socratic Framing Question:
                            </label>
                            <textarea
                              rows={2}
                              value={probeEditStarter}
                              onChange={(e) => setProbeEditStarter(e.target.value)}
                              className="w-full bg-black border border-zinc-700 rounded-lg p-2.5 text-zinc-200 text-xs focus:outline-none focus:border-zinc-500 font-mono resize-none"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-mono uppercase text-zinc-400">
                              Target Deep-Dive Probe:
                            </label>
                            <textarea
                              rows={2}
                              value={probeEditFollowUp}
                              onChange={(e) => setProbeEditFollowUp(e.target.value)}
                              className="w-full bg-black border border-zinc-700 rounded-lg p-2.5 text-zinc-200 text-xs focus:outline-none focus:border-zinc-500 font-mono resize-none"
                            />
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-[10px] text-zinc-500 font-mono">
                              Saving will pin this probe into the examiner prompt
                            </span>
                            <button
                              type="button"
                              onClick={() => handleSaveEditProbe(idx)}
                              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition cursor-pointer flex items-center gap-1"
                            >
                              <span>✓ Save &amp; Inject into Examiner</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="text-zinc-300 bg-black/40 p-2.5 rounded-lg border border-zinc-900">
                            <span className="text-zinc-500 font-mono text-[10px] uppercase mr-2 block sm:inline">
                              Opening:
                            </span>
                            {q.starter}
                          </div>
                          <div className="text-zinc-400 bg-black/40 p-2.5 rounded-lg border border-zinc-900">
                            <span className="text-zinc-500 font-mono text-[10px] uppercase mr-2 block sm:inline">
                              Target Probe:
                            </span>
                            {q.followUp}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Examiner System Prompt Disclosure */}
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 block">
                  Examiner System Prompt
                </span>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {promptLoading ? "Synthesizing..." : "Configured and ready for viva."}
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

          {savedPresetNotice && (
            <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/40 text-xs text-zinc-300 font-mono">
              {savedPresetNotice}
            </div>
          )}

          {/* Navigation & Launch Bar */}
          <div className="flex items-center justify-between pt-4 border-t border-zinc-800/60">
            <button
              type="button"
              onClick={handleStepBack}
              className="text-xs text-zinc-500 hover:text-white transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>←</span>
              <span>Candidate access</span>
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSavePreset}
                disabled={isSavingPreset}
                className="px-4 py-2 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-300 transition cursor-pointer disabled:opacity-50"
              >
                {isSavingPreset
                  ? "Saving to database..."
                  : editingExamId
                  ? "Update SQLite preset"
                  : "Save preset to SQLite"}
              </button>
              <button
                type="button"
                onClick={handleLaunchSession}
                className="group flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-medium transition cursor-pointer"
              >
                <span>Enter Chamber Station (Main Stack)</span>
                <span className="text-sm group-hover:translate-x-1 transition-transform duration-200">
                  →
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
        </div>
      </div>

      {/* Minimalist Status Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-zinc-600 font-mono pt-6 border-t border-zinc-900 gap-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>Teaching Assistant Console</span>
        </div>
        <button onClick={onBackToGateway} className="hover:text-zinc-400 transition cursor-pointer">
          ← Back to role selection
        </button>
      </div>
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-2xl w-full p-6 sm:p-7 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between pb-3 border-b border-zinc-800/80">
              <div>
                <h3 className="text-xl font-medium text-white tracking-tight">
                  {importMode === "qa" ? "Question Bank & Ground Truth" : "Import Syllabus Outline"}
                </h3>
                <p className="text-xs text-zinc-500 mt-1">
                  {importMode === "qa"
                    ? "Input your questions and answers. The AI groups them into topics and preserves Ground Truth."
                    : "Paste course outline or syllabus to extract hierarchical topics."}
                </p>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-zinc-500 hover:text-white transition text-sm p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Mode Toggle */}
            <div className="flex items-center gap-2 border-b border-zinc-800/80 pb-2">
              <button
                type="button"
                onClick={() => {
                  setImportMode("qa");
                  setParsedImportPreview(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  importMode === "qa"
                    ? "bg-emerald-600 text-white font-semibold shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200 bg-zinc-900/60"
                }`}
              >
                <span>❓</span>
                <span>Question Bank Mode</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportMode("syllabus");
                  setParsedImportPreview(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  importMode === "syllabus"
                    ? "bg-zinc-200 text-zinc-950 font-semibold shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200 bg-zinc-900/60"
                }`}
              >
                <span>📚</span>
                <span>Syllabus Outline Mode</span>
              </button>
            </div>

            <textarea
              rows={8}
              placeholder={
                importMode === "qa"
                  ? `Paste questions and instructor answers, e.g.:\n\nQ1: Why do we divide by sqrt(d_k) in scaled dot-product attention?\nA1: Prevents dot products from growing excessively large, avoiding vanishing gradients in softmax.\n\nQ2: What is the time complexity of self-attention?\nA2: O(N^2) because every token computes attention against all other tokens.\n\nQ3: Explain Backpropagation Through Time (BPTT).\nA3: Unfolds the RNN across timesteps and accumulates weight gradients via chain rule.`
                  : `Paste any syllabus, outline, or course notes, e.g.:\n\n1. Foundational Architecture\n   - Microkernel and Monolithic Design\n   - Context Switching Latency\n2. Memory Virtualization\n   - Page Replacement Algorithms`
              }
              value={importRawText}
              onChange={(e) => {
                setImportRawText(e.target.value);
                setParsedImportPreview(null);
              }}
              className="w-full bg-zinc-900/40 border border-zinc-800 rounded-xl p-3.5 text-zinc-200 font-mono text-xs focus:outline-none focus:border-zinc-500 placeholder-zinc-600 resize-none"
            />

            {parsedImportPreview && (
              <div className="p-3.5 bg-zinc-900/30 border border-zinc-800 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-400">
                    Hierarchy Preview ({parsedImportPreview.length} Domains / Topics)
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {parsedImportPreview.reduce((sum, p) => sum + p.children.length, 0)} sub-items
                  </span>
                </div>
                <div className="max-h-56 overflow-y-auto space-y-2 font-mono text-xs text-zinc-300">
                  {parsedImportPreview.map((item) => (
                    <div key={item.id} className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/60 space-y-1.5">
                      <div className="font-semibold text-zinc-100 flex items-center justify-between">
                        <span className="text-emerald-400">● {item.title}</span>
                        <span className="text-[10px] text-zinc-500">({item.children.length} sub-items)</span>
                      </div>
                      {item.children.map((sub) => (
                        <div key={sub.id} className="pl-3 border-l-2 border-emerald-900/60 text-[11px] space-y-1">
                          <div className="text-zinc-200">◆ {sub.title}</div>
                          {sub.comment && (
                            <div className="text-[10px] text-emerald-400/90 italic truncate">
                              {sub.comment}
                            </div>
                          )}
                          {sub.children && sub.children.length > 0 && (
                            <div className="space-y-1 pl-2.5 border-l border-zinc-700/60 mt-1">
                              {sub.children.map((leaf) => (
                                <div key={leaf.id} className="text-[10.5px] space-y-0.5">
                                  <div className="text-zinc-300">↳ {leaf.title}</div>
                                  {leaf.comment && (
                                    <div className="text-[9.5px] text-emerald-400/80 italic truncate">
                                      {leaf.comment}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80">
              <button
                type="button"
                onClick={importMode === "qa" ? handleClusterQuestionsAI : handleNormalizeImportAI}
                disabled={!importRawText.trim() || isImportNormalizing}
                className="px-4 py-2 rounded-xl border border-emerald-800/80 bg-emerald-950/60 hover:bg-emerald-900 text-xs font-medium text-emerald-300 transition disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
              >
                <span>✨</span>
                <span>
                  {isImportNormalizing
                    ? (importMode === "qa" ? "Clustering & Analyzing..." : "Normalizing...")
                    : (importMode === "qa" ? "Auto-Cluster Questions with AI" : "Normalize with AI")}
                </span>
              </button>

              {parsedImportPreview && (
                <button
                  type="button"
                  onClick={handleApplyImportedSyllabus}
                  className="px-4 py-2 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-medium transition cursor-pointer"
                >
                  Load into builder →
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Offline Instructor Authentication Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-md w-full p-6 sm:p-7 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between pb-3 border-b border-zinc-800/80">
              <div>
                <h3 className="text-xl font-medium text-white tracking-tight">
                  Instructor Authentication
                </h3>
                <p className="text-xs text-zinc-400 mt-1">
                  Offline SQLite Access • Zero External Cloud Services
                </p>
              </div>
              <button
                onClick={() => setShowAuthModal(false)}
                className="text-zinc-500 hover:text-white transition text-sm p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Quick 1-Click Course Professors Login */}
            <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-3.5 space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 block">
                Quick Access • Course Professors
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleLogin("proff1", "password1")}
                  disabled={authLoading}
                  className="px-3 py-2.5 rounded-lg bg-zinc-800/70 hover:bg-zinc-800 border border-zinc-700/60 text-xs text-left transition cursor-pointer flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">🏛️</span>
                    <div>
                      <span className="font-medium text-white block">proff1 (sub1)</span>
                      <span className="text-[10px] text-zinc-400 font-mono">Password: password1</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded">
                    Sign In →
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleLogin("proff2", "password2")}
                  disabled={authLoading}
                  className="px-3 py-2.5 rounded-lg bg-zinc-800/70 hover:bg-zinc-800 border border-zinc-700/60 text-xs text-left transition cursor-pointer flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">🏛️</span>
                    <div>
                      <span className="font-medium text-white block">proff2 (sub2)</span>
                      <span className="text-[10px] text-zinc-400 font-mono">Password: password2</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded">
                    Sign In →
                  </span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between px-1 py-1 border-b border-zinc-800/80 pb-2">
              <span className="text-xs font-medium text-white">Staff Authentication</span>
              <span className="text-[10px] font-mono text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                Institutional Only
              </span>
            </div>

            {authError && (
              <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-xs font-mono text-red-300">
                • {authError}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleLogin();
              }}
              className="space-y-3.5"
            >
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 block mb-1">
                  Staff Username
                </label>
                <input
                  type="text"
                  placeholder="e.g. ta1, gpn"
                  value={authUsername}
                  onChange={(e) => setAuthUsername(e.target.value)}
                  className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 block mb-1">
                  Password
                </label>
                <input
                  type="password"
                  placeholder="Enter password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-zinc-500"
                />
              </div>
              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-2.5 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-medium transition cursor-pointer disabled:opacity-50 mt-2"
              >
                {authLoading ? "Authenticating..." : "Sign In to SQLite Cockpit"}
              </button>
            </form>

            <div className="p-3 bg-zinc-900/30 border border-zinc-800/60 rounded-xl text-[11px] text-zinc-400 leading-relaxed">
              <span className="text-zinc-300 font-medium block mb-0.5">🔒 Restricted Access</span>
              Staff accounts are provisioned exclusively inside the Cockpit by the Course Professor. Public self-registration is permanently disabled.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// RECURSIVE TREE NODE COMPONENT WITH DRAG & DROP, CONTEXT BAR, TICK, CROSS & PLUS
// =========================================================================
interface RenderTreeNodeProps {
  node: TreeNode;
  nodeNumber: string;
  draggedNodeId: string | null;
  onDragStartNode: (id: string) => void;
  onDragEndNode: () => void;
  onMoveNode: (sourceId: string, targetId: string, position: "before" | "after") => void;
  onToggleContext: (id: string) => void;
  onGenerateSubtopics: (id: string, prompt: string, mode?: "subtopics" | "questions") => void;
  onAcceptChild: (parentId: string, candId: string) => void;
  onRejectChild: (parentId: string, candId: string) => void;
  onClearAllChildren: (parentId: string) => void;
  onEditTitle: (nodeId: string, newTitle: string) => void;
  onToggleCommentInput: (id: string) => void;
  onSetComment: (id: string, comment: string) => void;
  onDelete: (id: string) => void;
  onAddManualChild: (parentId: string, title: string) => void;
}

function RenderTreeNode({
  node,
  nodeNumber,
  draggedNodeId,
  onDragStartNode,
  onDragEndNode,
  onMoveNode,
  onToggleContext,
  onGenerateSubtopics,
  onAcceptChild,
  onRejectChild,
  onClearAllChildren,
  onEditTitle,
  onToggleCommentInput,
  onSetComment,
  onDelete,
  onAddManualChild,
}: RenderTreeNodeProps) {
  const [steeringText, setSteeringText] = useState("");
  const [commentText, setCommentText] = useState(node.comment || "");
  const [isCandidatesExpanded, setIsCandidatesExpanded] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editingTitle, setEditingTitle] = useState<string>(node.title);
  const [dropPosition, setDropPosition] = useState<"before" | "after" | null>(null);

  React.useEffect(() => {
    setEditingTitle(node.title);
  }, [node.title]);

  React.useEffect(() => {
    setCommentText(node.comment || "");
  }, [node.comment]);

  const handleStartEdit = () => {
    setEditingTitle(node.title);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (editingTitle.trim() && editingTitle.trim() !== node.title) {
      onEditTitle(node.id, editingTitle.trim());
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditingTitle(node.title);
    setIsEditing(false);
  };

  const handleExpandSubmit = (mode: "subtopics" | "questions" = "questions") => {
    onGenerateSubtopics(node.id, steeringText, mode);
    setSteeringText("");
  };

  const isBeingDragged = draggedNodeId === node.id;

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (draggedNodeId === node.id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const pos = e.clientY < midY ? "before" : "after";
    if (dropPosition !== pos) {
      setDropPosition(pos);
    }
  };

  const handleDragLeave = () => {
    setDropPosition(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (dropPosition && draggedNodeId && draggedNodeId !== node.id) {
      onMoveNode(draggedNodeId, node.id, dropPosition);
    }
    setDropPosition(null);
  };

  const indentStyle = {
    marginLeft: `${(node.level - 1) * 20}px`,
  };

  return (
    <div className="space-y-2" style={indentStyle}>
      {/* Node Card with Drag & Drop */}
      <div
        draggable={!isEditing}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", node.id);
          e.dataTransfer.effectAllowed = "move";
          onDragStartNode(node.id);
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={onDragEndNode}
        className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-all duration-150 ${
          node.level === 1
            ? "bg-zinc-900/60 border-zinc-800 hover:border-zinc-700 text-white"
            : "bg-zinc-950/80 border-zinc-800/70 hover:border-zinc-700 text-zinc-200"
        } ${isBeingDragged ? "opacity-30 border-dashed border-zinc-500 scale-[0.99]" : ""} ${
          dropPosition === "before" ? "border-t-2 !border-t-zinc-400" : ""
        } ${
          dropPosition === "after" ? "border-b-2 !border-b-zinc-400" : ""
        }`}
      >
        <span
          className="cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 font-mono text-xs select-none pr-0.5 shrink-0"
          title="Drag to rearrange"
        >
          ⠿
        </span>
        {isEditing ? (
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="text-zinc-500 font-mono text-xs shrink-0">{nodeNumber}</span>
            <input
              type="text"
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSaveEdit();
                } else if (e.key === "Escape") {
                  handleCancelEdit();
                }
              }}
              autoFocus
              className="flex-1 bg-black border border-zinc-600 rounded-lg px-2.5 py-1 text-white text-xs font-normal focus:outline-none"
            />
            <button
              onClick={handleSaveEdit}
              className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-xs font-medium shrink-0 cursor-pointer"
              title="Save"
            >
              ✓
            </button>
            <button
              onClick={handleCancelEdit}
              className="px-2 py-1 bg-transparent hover:bg-zinc-800 text-zinc-400 rounded-lg text-xs shrink-0 cursor-pointer"
              title="Cancel"
            >
              ×
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 truncate flex-1 min-w-0 group">
            <span className="text-zinc-500 font-mono text-xs shrink-0">{nodeNumber}</span>
            <span
              onClick={handleStartEdit}
              className="text-zinc-100 text-xs font-medium truncate cursor-pointer hover:underline transition-colors"
              title="Click to edit topic name"
            >
              {node.title}
            </span>
            <button
              onClick={handleStartEdit}
              className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 text-xs transition-opacity shrink-0 px-1 cursor-pointer"
              title="Edit"
            >
              Edit
            </button>
          </div>
        )}

        {/* Action Buttons: '+' to Expand, Directive Note, '×' to Delete */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onToggleContext(node.id)}
            className="w-7 h-7 flex items-center justify-center bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium transition cursor-pointer"
            title="Add subtopics (+)"
          >
            +
          </button>
          <button
            onClick={() => onToggleCommentInput(node.id)}
            className={`px-2 h-7 flex items-center gap-1 rounded-lg text-xs transition-colors cursor-pointer border ${
              node.comment
                ? "bg-zinc-800 text-zinc-100 border-zinc-600"
                : "bg-transparent text-zinc-500 hover:text-zinc-300 border-transparent hover:border-zinc-800"
            }`}
            title={node.comment ? `Directive: "${node.comment}"` : "Add Directive"}
          >
            <span>Note</span>
            {node.comment && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
          </button>
          <button
            onClick={() => onDelete(node.id)}
            className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300 rounded-lg text-xs transition cursor-pointer"
            title="Delete"
          >
            ×
          </button>
        </div>
      </div>

      {/* Inline Examiner Directive Input Bar */}
      {node.showCommentInput && (
        <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-xl space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 shrink-0">
              Directive:
            </span>
            <input
              type="text"
              placeholder="Examiner directive for this topic..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onSetComment(node.id, commentText);
                  onToggleCommentInput(node.id);
                } else if (e.key === "Escape") {
                  setCommentText(node.comment || "");
                  onToggleCommentInput(node.id);
                }
              }}
              className="w-full bg-black border border-zinc-800 rounded-lg px-2.5 py-1 text-zinc-200 text-xs focus:outline-none focus:border-zinc-600 placeholder-zinc-600"
            />
            <button
              onClick={() => {
                onSetComment(node.id, commentText);
                onToggleCommentInput(node.id);
              }}
              className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer transition"
            >
              Save
            </button>
            {node.comment && (
              <button
                onClick={() => {
                  setCommentText("");
                  onSetComment(node.id, "");
                  onToggleCommentInput(node.id);
                }}
                className="px-2 py-1 text-zinc-500 hover:text-zinc-300 text-xs whitespace-nowrap cursor-pointer transition"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-zinc-800/60">
            <span className="text-[10px] text-zinc-500 font-mono">Quick Focus:</span>
            {[
              "Mathematical derivations",
              "Implementation trade-offs",
              "Edge cases & failure modes",
              "Critical comparison",
              "Zero hand-waving",
            ].map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setCommentText((prev) => (prev ? `${prev}; ${tag}` : tag))}
                className="px-2 py-0.5 rounded-md bg-zinc-950 hover:bg-zinc-800 text-[10px] text-zinc-400 hover:text-zinc-200 transition cursor-pointer border border-zinc-800/80"
              >
                + {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Persistent Note Display Badge */}
      {!node.showCommentInput && node.comment && (
        <div
          onClick={() => onToggleCommentInput(node.id)}
          className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/30 border border-zinc-800/80 rounded-xl text-xs text-zinc-400 cursor-pointer hover:border-zinc-700 transition"
          title="Click to edit directive"
        >
          <span className="text-zinc-500 font-mono text-[10px] uppercase">Directive:</span>
          <span className="text-zinc-300 italic truncate">&quot;{node.comment}&quot;</span>
          <span className="ml-auto text-[10px] text-zinc-500 hover:text-zinc-300">edit</span>
        </div>
      )}

      {/* Inline Subtopic Creation / Suggestion Drawer */}
      {node.showContextInput && (
        <div className="p-3 bg-zinc-950/80 border border-zinc-700/80 rounded-xl space-y-2.5">
          {node.comment && (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Active Directive Context: &quot;{node.comment}&quot;</span>
            </div>
          )}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              placeholder="Enter subtopic title OR AI focus prompt..."
              value={steeringText}
              onChange={(e) => setSteeringText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (steeringText.trim()) {
                    onAddManualChild(node.id, steeringText.trim());
                    setSteeringText("");
                  }
                }
              }}
              className="flex-1 bg-black border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
            />
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => {
                  if (steeringText.trim()) {
                    onAddManualChild(node.id, steeringText.trim());
                    setSteeringText("");
                  }
                }}
                disabled={!steeringText.trim()}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer transition flex items-center gap-1"
                title="Add this title directly"
              >
                <span>+ Add</span>
              </button>
              <button
                onClick={() => handleExpandSubmit("questions")}
                disabled={node.isExpanding}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-emerald-400 hover:text-emerald-300 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer transition flex items-center gap-1 border border-zinc-700"
                title="Generate 3-4 oral examination questions for this topic"
              >
                <span>{node.isExpanding ? "Thinking..." : "❓ AI Questions"}</span>
              </button>
              <button
                onClick={() => handleExpandSubmit("subtopics")}
                disabled={node.isExpanding}
                className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-zinc-400 hover:text-zinc-200 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer transition flex items-center gap-1 border border-zinc-800"
                title="Generate 3-4 subtopics for this topic"
              >
                <span>{node.isExpanding ? "Thinking..." : "📚 AI Subtopics"}</span>
              </button>
            </div>
          </div>
          <div className="text-[10px] text-zinc-500 flex items-center justify-between font-mono">
            <span>Hit Enter or click &quot;+ Add Subtopic&quot; to insert directly</span>
            <span>AI Suggest considers directive note &amp; existing subtopics</span>
          </div>
        </div>
      )}

      {/* Subtopic Error Notice */}
      {node.error && (
        <div className="p-3 rounded-xl border border-amber-800/60 bg-amber-950/20 text-xs text-amber-300 font-mono flex items-center justify-between">
          <span>⚠️ {node.error}</span>
          <span className="text-[10px] text-zinc-400">Use &quot;+ Add Subtopic&quot; to insert manually</span>
        </div>
      )}

      {/* Candidate Children Blocks */}
      {node.candidateChildren && node.candidateChildren.length > 0 && (
        <div className="pl-4 space-y-2 border-l border-zinc-800/80">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Suggested for &quot;{node.title}&quot; ({node.candidateChildren.length})</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => onGenerateSubtopics(node.id, "")}
                disabled={node.isExpanding}
                className="text-zinc-500 hover:text-zinc-300 text-xs transition cursor-pointer"
              >
                {node.isExpanding ? "Expanding..." : "+ More"}
              </button>
              <button
                onClick={() => {
                  onClearAllChildren(node.id);
                  setIsCandidatesExpanded(false);
                }}
                className="text-zinc-600 hover:text-zinc-400 text-xs transition cursor-pointer"
              >
                Clear all
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(node.candidateChildren.length > 8 && !isCandidatesExpanded
              ? node.candidateChildren.slice(0, 8)
              : node.candidateChildren
            ).map((cand) => (
              <div
                key={cand.id}
                className="p-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/40 hover:border-zinc-700 flex flex-col gap-1.5 text-xs transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-zinc-200 line-clamp-2">{cand.title}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => onAcceptChild(node.id, cand.id)}
                      className="w-6 h-6 rounded-lg bg-zinc-800 hover:bg-emerald-600 text-zinc-200 hover:text-white flex items-center justify-center transition cursor-pointer"
                      title="Add to syllabus"
                    >
                      +
                    </button>
                    <button
                      onClick={() => onRejectChild(node.id, cand.id)}
                      className="w-6 h-6 rounded-lg bg-transparent hover:bg-zinc-800/60 text-zinc-500 hover:text-zinc-300 flex items-center justify-center transition cursor-pointer"
                      title="Discard"
                    >
                      ×
                    </button>
                  </div>
                </div>
                {cand.comment && (
                  <div className="text-[10px] text-emerald-400/90 italic line-clamp-2">
                    {cand.comment}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Collapsible toggle when subtopics stack > 8 items */}
          {node.candidateChildren.length > 8 && (
            <button
              onClick={() => setIsCandidatesExpanded(!isCandidatesExpanded)}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 transition cursor-pointer"
            >
              {isCandidatesExpanded ? "Show fewer" : `Show all (${node.candidateChildren.length})`}
            </button>
          )}
        </div>
      )}

      {/* Render Accepted Children Recursively */}
      {node.children && node.children.length > 0 && (
        <div className="space-y-2 border-l border-zinc-800/80 pl-3">
          {node.children.map((child, childIdx) => (
            <RenderTreeNode
              key={child.id}
              node={child}
              nodeNumber={`${nodeNumber}.${childIdx + 1}`}
              draggedNodeId={draggedNodeId}
              onDragStartNode={onDragStartNode}
              onDragEndNode={onDragEndNode}
              onMoveNode={onMoveNode}
              onToggleContext={onToggleContext}
              onGenerateSubtopics={onGenerateSubtopics}
              onAcceptChild={onAcceptChild}
              onRejectChild={onRejectChild}
              onClearAllChildren={onClearAllChildren}
              onEditTitle={onEditTitle}
              onToggleCommentInput={onToggleCommentInput}
              onSetComment={onSetComment}
              onDelete={onDelete}
              onAddManualChild={onAddManualChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}
