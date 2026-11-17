import { NextRequest, NextResponse } from "next/server";
import { getDB, getStudentBiometrics, getStudentByRegNo, getRecordBySessionId } from "@/lib/db";
import { authenticateApiRequest } from "@/lib/apiAuth";
import { BehavioralIntegrityFlag } from "@/types/grading";

const SAFE_ID_REGEX = /^[a-zA-Z0-9_\-]{1,64}$/;

export async function GET(req: NextRequest) {
  try {
    // 1. Enforce Authentication & Sliding Window Rate Limiting (60 req/min)
    const authResult = await authenticateApiRequest(req, {
      allowedRoles: ["INSTRUCTOR", "STUDENT", "INTERNAL"],
      rateLimit: {
        enabled: true,
        max: 60,
        windowMs: 60000,
      },
    });

    if (!authResult.success) {
      return authResult.response;
    }

    const { auth } = authResult;

    // 2. Validate parameter presence
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId")?.trim() || "";
    let regNo = searchParams.get("regNo")?.trim() || "";

    if (!sessionId && !regNo) {
      return NextResponse.json(
        { success: false, error: "Either 'sessionId' or 'regNo' is required." },
        { status: 400 }
      );
    }

    // 3. Format & Traversal validation
    if (sessionId && !SAFE_ID_REGEX.test(sessionId)) {
      return NextResponse.json(
        { success: false, error: "Invalid 'sessionId' parameter. Only alphanumeric characters, hyphens, and underscores are permitted." },
        { status: 400 }
      );
    }

    if (regNo && !SAFE_ID_REGEX.test(regNo)) {
      return NextResponse.json(
        { success: false, error: "Invalid 'regNo' parameter. Only alphanumeric characters, hyphens, and underscores are permitted." },
        { status: 400 }
      );
    }

    let recordingUrl: string | undefined = undefined;
    let candidateName = "";

    // 4. Resolve session if sessionId provided
    let sessionRecord: any = null;
    if (sessionId) {
      sessionRecord = await getRecordBySessionId(sessionId);
      if (sessionRecord) {
        if (!regNo) regNo = sessionRecord.studentId;
        recordingUrl = sessionRecord.recordingUrl;
      }
    }

    // 5. Enforce Scope Isolation (IDOR Protection)
    if (auth.role === "STUDENT") {
      const candidateReg = (auth.studentRegNo || "").trim().toLowerCase();

      // Check regNo scope
      if (regNo && regNo.trim().toLowerCase() !== candidateReg) {
        return NextResponse.json(
          { success: false, error: "Forbidden: Candidates can only access their own biometric telemetry." },
          { status: 403 }
        );
      }

      // Check sessionId scope
      if (sessionId) {
        if (!sessionRecord) {
          return NextResponse.json(
            { success: false, error: `Defense session '${sessionId}' not found.` },
            { status: 404 }
          );
        }
        if ((sessionRecord.studentId || "").trim().toLowerCase() !== candidateReg) {
          return NextResponse.json(
            { success: false, error: "Forbidden: Candidates are not authorized to view peer defense session telemetry." },
            { status: 403 }
          );
        }
      }

      // Default candidate's regNo to their own
      if (!regNo) regNo = candidateReg;
    } else {
      // INSTRUCTOR / INTERNAL scope
      if (sessionId && !sessionRecord && !regNo) {
        return NextResponse.json(
          { success: false, error: `Defense session '${sessionId}' not found.` },
          { status: 404 }
        );
      }
    }

    const normalizedReg = regNo ? regNo.trim().toLowerCase() : "";

    // 6. Resolve candidate info from students table
    if (normalizedReg) {
      const student = await getStudentByRegNo(normalizedReg);
      if (student) candidateName = student.studentName;
    }

    // 7. Retrieve student biometrics
    const bio = normalizedReg ? await getStudentBiometrics(normalizedReg) : null;

    // 8. Retrieve forensic behavioral flags & evidence snippets from evaluations table
    let evidenceSnippets: BehavioralIntegrityFlag[] = [];
    let secondaryVoiceDetected = false;
    let acousticAuditCompleted = false;
    let acousticSimilarity: number | null = null;
    let acousticVerdict: string | null = null;

    const db = await getDB();
    let evalRes: any[] = [];

    if (sessionId) {
      evalRes = db.exec(
        `SELECT behavioral_flags_json, behavioral_audit_json FROM evaluations WHERE session_id = ?`,
        [sessionId]
      );
    }

    if ((!evalRes.length || !evalRes[0].values?.length) && normalizedReg) {
      evalRes = db.exec(
        `SELECT e.behavioral_flags_json, e.behavioral_audit_json
         FROM evaluations e
         JOIN exam_sessions s ON e.session_id = s.session_id
         WHERE LOWER(s.student_id) = ?
         ORDER BY s.started_at DESC LIMIT 1`,
        [normalizedReg]
      );
    }

    if (evalRes.length > 0 && evalRes[0].values && evalRes[0].values.length > 0) {
      const rawFlags = evalRes[0].values[0][0] as string | null;
      const rawAudit = evalRes[0].values[0][1] as string | null;

      if (rawFlags) {
        try {
          const parsed = JSON.parse(rawFlags);
          if (Array.isArray(parsed)) {
            parsed.forEach((item) => {
              if (typeof item === "object" && item !== null && item.flag) {
                evidenceSnippets.push(item);
              }
            });
          }
        } catch (parseFlagsErr) {
          console.debug("[session-hud] JSON parse flags warning:", parseFlagsErr);
        }
      }

      if (rawAudit) {
        try {
          const auditObj = JSON.parse(rawAudit);
          acousticAuditCompleted = true;
          if (typeof auditObj.dominantSimilarity === "number") {
            acousticSimilarity = auditObj.dominantSimilarity;
          }
          if (auditObj.verdict) {
            acousticVerdict = auditObj.verdict;
          }
          if (Array.isArray(auditObj.evidenceSnippets)) {
            auditObj.evidenceSnippets.forEach((s: any) => {
              if (
                !evidenceSnippets.some(
                  (e) =>
                    e.flag === s.flag &&
                    e.timestampRange?.startSeconds === s.timestampRange?.startSeconds
                )
              ) {
                evidenceSnippets.push(s);
              }
            });
          }
          if (Array.isArray(auditObj.flags)) {
            if (
              auditObj.flags.includes("ACCOMPLICE_DETECTED") ||
              auditObj.flags.includes("IMPOSTER_PROXY_TAKEOVER") ||
              auditObj.flags.includes("MULTIPLE_COLLUSION_PARTIES_DETECTED")
            ) {
              secondaryVoiceDetected = true;
            }
          }
        } catch (parseAuditErr) {
          console.debug("[session-hud] JSON parse audit warning:", parseAuditErr);
        }
      }
    }

    if (!secondaryVoiceDetected) {
      secondaryVoiceDetected = evidenceSnippets.some(
        (e) =>
          e.flag === "ACCOMPLICE_DETECTED" ||
          e.flag === "IMPOSTER_PROXY_TAKEOVER" ||
          e.flag === "MULTIPLE_COLLUSION_PARTIES_DETECTED"
      );
    }

    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/openviva";

    return NextResponse.json({
      success: true,
      sessionId,
      studentId: normalizedReg,
      studentName: candidateName || bio?.studentName || normalizedReg.toUpperCase(),
      verificationStatus: bio?.verificationStatus || "NOT_ENROLLED",
      enrolledAt: bio?.faceEnrolledAt || null,
      enrolledFaceUrl: normalizedReg
        ? `${basePath}/api/biometrics/photo?regNo=${normalizedReg}&type=reference`
        : null,
      examKeyframeUrl: normalizedReg
        ? `${basePath}/api/biometrics/photo?regNo=${normalizedReg}&type=keyframe&sessionId=${sessionId}`
        : null,
      faceMatchSimilarity: typeof bio?.lastFaceSimilarity === "number" ? bio.lastFaceSimilarity : null,
      livenessConfidence: typeof bio?.lastLivenessScore === "number" ? bio.lastLivenessScore : null,
      alignmentMethod: "UMEYAMA_5POINT_112X112",
      claheNormalized: true,
      acousticAuditCompleted,
      acousticSimilarity,
      acousticVerdict,
      secondaryVoiceDetected,
      evidenceSnippets,
      recordingUrl: recordingUrl || null,
    });
  } catch (err: any) {
    console.error("Session HUD fetch error:", err);
    return NextResponse.json(
      { success: false, error: `Failed to load session biometric HUD: ${err.message}` },
      { status: 500 }
    );
  }
}
