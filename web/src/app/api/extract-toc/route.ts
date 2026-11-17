import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import path from "path";
import fs from "fs/promises";
import * as fsSync from "fs";
import crypto from "crypto";
import { DocumentTOCResponse } from "@/types/toc";
import { validateInstructorSession, validateStudentSession } from "@/lib/db";

/**
 * Resolves the root directory of the OpenViva repository.
 */
function getWorkspaceRoot(): string {
  if (process.env.OPENVIVA_WORKSPACE_ROOT && fsSync.existsSync(process.env.OPENVIVA_WORKSPACE_ROOT)) {
    return process.env.OPENVIVA_WORKSPACE_ROOT;
  }
  const cur = process.cwd();
  if (fsSync.existsSync(path.join(cur, "services", "toc_extractor"))) {
    return cur;
  }
  const parent = path.resolve(cur, "..");
  if (fsSync.existsSync(path.join(parent, "services", "toc_extractor"))) {
    return parent;
  }
  return cur;
}

/**
 * Resolves the appropriate Python executable for TOC extraction.
 * Supports Windows, Linux virtualenvs, and GPU host environments.
 */
function resolvePythonExecutable(workspaceRoot: string): string {
  if (process.env.MINERU_PYTHON_PATH && fsSync.existsSync(process.env.MINERU_PYTHON_PATH)) {
    return process.env.MINERU_PYTHON_PATH;
  }
  if (process.env.OPENVIVA_PYTHON_PATH && fsSync.existsSync(process.env.OPENVIVA_PYTHON_PATH)) {
    return process.env.OPENVIVA_PYTHON_PATH;
  }

  const candidates = [
    // Standard Mineru virtualenv paths
    path.join(workspaceRoot, ".venv_mineru", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
    // Server agent virtualenv path on 10.10.16.13
    "/home/savan/openviva/agent_env/bin/python",
    // Standard virtualenvs
    path.join(workspaceRoot, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
    path.join(workspaceRoot, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
  ];

  for (const c of candidates) {
    if (c && fsSync.existsSync(c)) {
      return c;
    }
  }

  return process.platform === "win32" ? "python" : "python3";
}

export async function POST(req: NextRequest) {
  let targetPdfPath = "";
  let isTempUpload = false;

  try {
    // 1. Enforce Authentication (Requires active Examiner or Candidate session)
    const authHeader = req.headers.get("authorization");
    let token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : null;
    if (!token) {
      token =
        req.cookies.get("openviva_session")?.value ||
        req.cookies.get("openviva_student_session")?.value ||
        null;
    }

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized: Active examiner or candidate session required to extract syllabus documents." },
        { status: 401 }
      );
    }

    const [instructor, student] = await Promise.all([
      validateInstructorSession(token).catch(() => null),
      validateStudentSession(token).catch(() => null),
    ]);

    if (!instructor && !student) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or expired session credentials." },
        { status: 401 }
      );
    }

    // 2. Parse and sanitize input payload
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const sampleName = formData.get("sample") as string | null;
    const samplePages = formData.get("sample_pages") as string | null;
    const engine = formData.get("engine") as string | null;

    const workspaceRoot = getWorkspaceRoot();
    const uploadDir = path.join(workspaceRoot, "storage", "uploads");
    const outputDir = path.join(workspaceRoot, "storage", "toc_output");
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });

    let baseFileName = "";

    if (file && typeof file === "object" && "name" in file && file.name) {
      const rawName = path.basename(file.name);
      if (!rawName.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json(
          { error: "Invalid file type. Only PDF documents (.pdf) are supported." },
          { status: 400 }
        );
      }

      // Sanitize display name (strip any shell / path special characters)
      baseFileName = rawName.replace(/[^a-zA-Z0-9_\-\. ]/g, "_").slice(0, 100) || "document.pdf";
      const uniqueStagingId = `${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
      const stagingFileName = `upload_${uniqueStagingId}.pdf`;
      targetPdfPath = path.join(uploadDir, stagingFileName);

      const bytes = await file.arrayBuffer();
      if (bytes.byteLength === 0) {
        return NextResponse.json({ error: "Uploaded PDF file is empty." }, { status: 400 });
      }
      if (bytes.byteLength > 100 * 1024 * 1024) {
        return NextResponse.json({ error: "Uploaded PDF exceeds maximum allowed size (100MB)." }, { status: 400 });
      }

      await fs.writeFile(targetPdfPath, Buffer.from(bytes));
      isTempUpload = true;
    } else if (sampleName && typeof sampleName === "string") {
      const safeSample = path.basename(sampleName.trim());
      if (!safeSample.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json({ error: "Invalid sample file format. Expected a .pdf file." }, { status: 400 });
      }

      const dataDir = path.join(workspaceRoot, "data");
      targetPdfPath = path.resolve(dataDir, safeSample);

      // Strict containment check: prevent path traversal attacks
      if (!targetPdfPath.startsWith(path.resolve(dataDir))) {
        return NextResponse.json({ error: "Access denied: Invalid sample path." }, { status: 403 });
      }

      try {
        await fs.access(targetPdfPath);
      } catch {
        return NextResponse.json(
          { error: `Sample PDF '${safeSample}' not found in data directory.` },
          { status: 404 }
        );
      }
      baseFileName = safeSample;
    } else {
      return NextResponse.json(
        { error: "No PDF file uploaded or valid sample selected. Please provide a PDF." },
        { status: 400 }
      );
    }

    const safePrefix = path.parse(baseFileName).name.replace(/[^a-zA-Z0-9_\-]/g, "_") || "doc";
    const outputJsonName = `${safePrefix}_${Date.now()}_raw_toc.json`;
    const outputJsonPath = path.join(outputDir, outputJsonName);

    const scriptPath = path.join(workspaceRoot, "services", "toc_extractor", "extract_toc_with_coords.py");
    if (!fsSync.existsSync(scriptPath)) {
      return NextResponse.json(
        { error: "TOC Extractor service script not found on host." },
        { status: 500 }
      );
    }

    const pyExe = resolvePythonExecutable(workspaceRoot);

    // 3. Construct argument vector (Array-based invocation prevents shell command injection)
    const args: string[] = [
      scriptPath,
      "--pdf_path",
      targetPdfPath,
      "--output_path",
      outputJsonPath,
    ];

    if (engine === "pymupdf") {
      args.push("--no_mineru");
    } else {
      args.push("--use_mineru");
    }

    if (samplePages) {
      const parsedPages = parseInt(samplePages, 10);
      if (!isNaN(parsedPages) && parsedPages > 0 && parsedPages <= 1000) {
        args.push("--sample_pages", parsedPages.toString());
      }
    }

    // 4. Execute via execFile (Zero shell invocation: passes arguments directly to OS kernel)
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFile(
        pyExe,
        args,
        {
          cwd: workspaceRoot,
          maxBuffer: 25 * 1024 * 1024,
          timeout: 120000, // 2-minute safety timeout
        },
        (err, stdout, stderr) => {
          if (err) {
            reject(Object.assign(err, { stdout, stderr }));
          } else {
            resolve({ stdout, stderr });
          }
        }
      );
    });

    if (stderr) {
      console.log("\n--- PIPELINE EXECUTION LOGS ---");
      console.log(stderr);
      console.log("-------------------------------\n");
    }

    let result: DocumentTOCResponse & { storage_path?: string };
    try {
      result = JSON.parse(stdout);
    } catch {
      if (fsSync.existsSync(outputJsonPath)) {
        const fileContent = await fs.readFile(outputJsonPath, "utf-8");
        result = JSON.parse(fileContent);
      } else {
        throw new Error(`Failed to parse TOC extraction output: ${stderr || stdout}`);
      }
    }

    result.filename = baseFileName;
    result.storage_path = `storage/toc_output/${outputJsonName}`;
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Extraction API Error:", error);
    return NextResponse.json(
      { error: "TOC Extraction Failed", details: error.stderr || error.message },
      { status: 500 }
    );
  } finally {
    // 5. Clean up temporary uploaded file
    if (isTempUpload && targetPdfPath) {
      try {
        await fs.unlink(targetPdfPath);
      } catch {
        // Suppress non-fatal unlink error
      }
    }
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "No active PDF TOC. Please upload a PDF file." },
    { status: 404 }
  );
}
