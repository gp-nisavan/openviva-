"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";

export interface StudentAuthData {
  regNo: string;
  studentName: string;
  department: string;
  cohort: string;
  mustChangePassword?: boolean;
}

interface StudentAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (data: {
    student: StudentAuthData;
    token: string;
    mustChangePassword: boolean;
    biometricsEnrolled?: boolean;
  }) => void;
  initialRegNo?: string;
}

export function StudentAuthModal({
  isOpen,
  onClose,
  onAuthSuccess,
  initialRegNo = "",
}: StudentAuthModalProps) {
  const [step, setStep] = useState<"login" | "register" | "change_password" | "face_reset" | "forgot_help">("login");
  const [regNo, setRegNo] = useState<string>(initialRegNo);
  const [password, setPassword] = useState<string>("");
  const [tempToken, setTempToken] = useState<string>("");

  // Registration fields
  const [registerName, setRegisterName] = useState<string>("");
  const [registerDept, setRegisterDept] = useState<string>("Computer Science");
  const [registerPassword, setRegisterPassword] = useState<string>("");
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState<string>("");

  // Change password fields
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [studentInfo, setStudentInfo] = useState<StudentAuthData | null>(null);

  // Biometric Face Reset State
  const [cameraReady, setCameraReady] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [verifyingFace, setVerifyingFace] = useState<boolean>(false);
  const [faceResetSuccess, setFaceResetSuccess] = useState<{
    similarity: number;
    threshold: number;
    message: string;
  } | null>(null);

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Camera Management for Biometric Face Reset
  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(console.error);
          setCameraReady(true);
        };
      }
    } catch (err: any) {
      console.error("Camera access failed:", err);
      setCameraError(err.message || "Failed to access webcam. Please allow camera permissions.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  // Control camera when entering/exiting face_reset step or modal open/close
  useEffect(() => {
    if (isOpen && step === "face_reset") {
      setFaceResetSuccess(null);
      setError(null);
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, step, startCamera, stopCamera]);

  if (!isOpen) return null;

  const handleClose = () => {
    stopCamera();
    onClose();
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!regNo.trim() || !password) {
      setError("Registration number and password are required.");
      return;
    }

    try {
      setLoading(true);
      const res = await fetch("/api/auth/student-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regNo: regNo.trim(), password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Authentication failed.");
      }

      if (data.mustChangePassword) {
        setStudentInfo(data.student);
        setTempToken(data.tempToken);
        setStep("change_password");
      } else {
        onAuthSuccess({
          student: data.student,
          token: data.token,
          mustChangePassword: false,
          biometricsEnrolled: Boolean(data.biometricsEnrolled),
        });
        handleClose();
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to log in.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regNo.trim()) {
      setError("Please enter your Registration Number.");
      return;
    }
    if (!registerName.trim()) {
      setError("Please enter your Full Name.");
      return;
    }
    if (!registerPassword) {
      setError("Please enter a password (min 4 characters).");
      return;
    }
    if (registerPassword !== registerConfirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/auth/student-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regNo: regNo.trim(),
          studentName: registerName.trim(),
          password: registerPassword,
          department: registerDept.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Candidate registration failed.");
      }

      onAuthSuccess({
        student: data.student,
        token: data.token,
        mustChangePassword: false,
        biometricsEnrolled: false,
      });
      handleClose();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to register.");
    } finally {
      setLoading(false);
    }
  };

  // Automated Biometric Face Password Reset (Task 5.3)
  const handleFaceResetCapture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError("Camera feed not ready. Please wait a moment.");
      return;
    }

    if (!regNo.trim()) {
      setError("Please enter your Registration Number to verify against your biometric record.");
      return;
    }

    try {
      setVerifyingFace(true);
      setError(null);
      setFaceResetSuccess(null);

      // Capture frame to canvas
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas initialization failed.");

      // Flip horizontally for un-mirrored capture
      ctx.translate(640, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, 640, 480);

      const liveFrameBase64 = canvas.toDataURL("image/jpeg", 0.92);

      const res = await fetch("/api/auth/reset-password-face", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regNo: regNo.trim(),
          liveFrameBase64,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.verified) {
        throw new Error(data.error || "Biometric facial verification failed.");
      }

      // Success! 5-minute temporary session granted
      setFaceResetSuccess({
        similarity: data.similarity,
        threshold: data.threshold,
        message: data.message,
      });
      setTempToken(data.tempToken);
      setStudentInfo(data.student);

      // Transition to password reset step after brief confirmation
      setTimeout(() => {
        stopCamera();
        setStep("change_password");
      }, 1200);
    } catch (err: any) {
      console.error("Biometric face reset failed:", err);
      setError(err.message || "Biometric verification failed. Please try again or contact your TA.");
    } finally {
      setVerifyingFace(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!newPassword || newPassword.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }

    if (newPassword === regNo.trim().toLowerCase()) {
      setError("New password cannot be identical to your registration ID.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setLoading(true);
      const res = await fetch("/api/auth/student-change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tempToken}`,
        },
        body: JSON.stringify({
          newPassword,
          confirmPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update password.");
      }

      onAuthSuccess({
        student: data.student,
        token: data.token,
        mustChangePassword: false,
        biometricsEnrolled: Boolean(data.biometricsEnrolled),
      });
      handleClose();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Password update failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 font-sans text-white">
      <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-900 pb-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <span>{step === "face_reset" ? "📷" : "🎓"}</span>
              <span>
                {step === "login"
                  ? "Candidate Portal"
                  : step === "register"
                  ? "Register Candidate"
                  : step === "change_password"
                  ? "Set Private Password"
                  : step === "face_reset"
                  ? "Biometric Face Recovery"
                  : "Offline Password Recovery"}
              </span>
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              {step === "login"
                ? "Air-gapped examination network authentication"
                : step === "register"
                ? "Create your student account to begin oral examination & enrollment"
                : step === "change_password"
                ? "Authorized password change. Create your private defense credential."
                : step === "face_reset"
                ? "Automated biometric face match against sealed ground truth"
                : "Air-gapped institutional support"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-zinc-500 hover:text-white transition text-sm cursor-pointer p-1"
          >
            ✕
          </button>
        </div>

        {/* Step Selector: Sign In vs Register */}
        {(step === "login" || step === "register") && (
          <div className="flex rounded-xl bg-zinc-900/90 p-1 border border-zinc-800">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep("login");
              }}
              className={`flex-1 py-1.5 text-xs font-mono rounded-lg transition font-medium cursor-pointer ${
                step === "login"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep("register");
              }}
              className={`flex-1 py-1.5 text-xs font-mono rounded-lg transition font-medium cursor-pointer ${
                step === "register"
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              + Register as Candidate
            </button>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs font-mono leading-relaxed">
            {error}
          </div>
        )}

        {/* REGISTER NEW CANDIDATE FORM */}
        {step === "register" && (
          <form onSubmit={handleRegister} className="space-y-3">
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-1">
                Candidate Registration Number (Reg No)
              </label>
              <input
                type="text"
                autoFocus
                placeholder="e.g. 2026-CS-001 or roll number"
                value={regNo}
                onChange={(e) => setRegNo(e.target.value)}
                className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition"
              />
            </div>

            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-1">
                Candidate Full Name
              </label>
              <input
                type="text"
                placeholder="e.g. Jane Doe"
                value={registerName}
                onChange={(e) => setRegisterName(e.target.value)}
                className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-1">
                  Department
                </label>
                <input
                  type="text"
                  placeholder="Computer Science"
                  value={registerDept}
                  onChange={(e) => setRegisterDept(e.target.value)}
                  className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-1">
                  Password
                </label>
                <input
                  type="password"
                  placeholder="Min 4 characters"
                  value={registerPassword}
                  onChange={(e) => setRegisterPassword(e.target.value)}
                  className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-1">
                Confirm Password
              </label>
              <input
                type="password"
                placeholder="Re-enter password"
                value={registerConfirmPassword}
                onChange={(e) => setRegisterConfirmPassword(e.target.value)}
                className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !regNo.trim() || !registerName.trim() || !registerPassword || registerPassword !== registerConfirmPassword}
              className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs transition disabled:opacity-40 cursor-pointer shadow flex items-center justify-center gap-2 mt-2"
            >
              <span>{loading ? "Registering..." : "Create Candidate Account & Start Enrollment →"}</span>
            </button>
          </form>
        )}

        {/* STEP 1: LOGIN FORM */}
        {step === "login" && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-1">
                Registration Number (Reg No)
              </label>
              <input
                type="text"
                autoFocus
                placeholder="Enter your candidate Registration Number"
                value={regNo}
                onChange={(e) => setRegNo(e.target.value)}
                className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep("face_reset");
                  }}
                  className="text-[10px] font-mono text-violet-400 hover:text-violet-300 transition cursor-pointer flex items-center gap-1"
                >
                  <span>📷</span>
                  <span>Forgot? Verify Face</span>
                </button>
              </div>
              <input
                type="password"
                placeholder="Enter candidate password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition"
              />
              <div className="flex items-center justify-end mt-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep("forgot_help");
                  }}
                  className="text-[10px] font-mono text-zinc-500 hover:text-zinc-400 transition cursor-pointer"
                >
                  Offline TA Help →
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !regNo.trim() || !password}
              className="w-full py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-zinc-200 transition disabled:opacity-40 cursor-pointer shadow"
            >
              {loading ? "Authenticating..." : "Sign In to Candidate Chamber →"}
            </button>
          </form>
        )}

        {/* STEP 2: AUTOMATED BIOMETRIC FACE RESET (TASK 5.3) */}
        {step === "face_reset" && (
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-1">
                Candidate Registration Number
              </label>
              <input
                type="text"
                autoFocus
                placeholder="e.g. reg1, reg2, reg10"
                value={regNo}
                onChange={(e) => setRegNo(e.target.value)}
                className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition"
              />
            </div>

            {/* Camera Viewport */}
            <div className="relative rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 aspect-video flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />

              {!cameraReady && !cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/90 text-zinc-400 text-xs space-y-2">
                  <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                  <span>Initializing Camera...</span>
                </div>
              )}

              {cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/95 text-rose-400 text-xs p-4 text-center">
                  <span>⚠️ {cameraError}</span>
                </div>
              )}

              {/* Clean Camera Focus Viewfinder (Automatic Neural Face Matching) */}
              {cameraReady && !faceResetSuccess && (
                <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                  {/* Subtle Clean Face Frame */}
                  <div className="w-48 h-60 rounded-3xl border-2 border-violet-400/50 shadow-[0_0_20px_rgba(139,92,246,0.15)] flex items-center justify-center transition-all duration-300" />

                  {/* Simple Guidance Tag */}
                  <div className="absolute bottom-3 px-3 py-1 rounded-full bg-zinc-950/80 backdrop-blur-xs border border-zinc-800 text-[11px] font-sans text-zinc-300 shadow-md">
                    Look directly into the camera
                  </div>
                </div>
              )}

              {/* Scanning Active Overlay */}
              {verifyingFace && (
                <div className="absolute inset-0 bg-black/70 backdrop-blur-xs flex flex-col items-center justify-center space-y-3 text-violet-300">
                  <div className="relative">
                    <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                    <div className="w-6 h-6 border-2 border-fuchsia-400 border-b-transparent rounded-full animate-spin absolute inset-2" />
                  </div>
                  <div className="text-center space-y-1">
                    <div className="text-xs font-mono font-semibold text-white tracking-wide">
                      Extracting 512-dim ArcFace Vectors...
                    </div>
                    <div className="text-[10px] font-mono text-violet-400/80">
                      MiniFASNet-V2 Anti-Spoof Liveness Check (τ = 0.85)
                    </div>
                  </div>
                </div>
              )}

              {/* Verified Success Overlay */}
              {faceResetSuccess && (
                <div className="absolute inset-0 bg-emerald-950/92 backdrop-blur-xs flex flex-col items-center justify-center space-y-2 text-emerald-300 animate-in fade-in duration-200">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 text-2xl font-bold shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                    ✓
                  </div>
                  <span className="text-xs font-bold font-mono tracking-wide">
                    Neural Identity Authenticated
                  </span>
                  <div className="px-3 py-1 rounded bg-zinc-950/80 border border-emerald-500/30 text-[11px] font-mono text-emerald-400 text-center">
                    Similarity: <span className="font-bold text-white">{(faceResetSuccess.similarity * 100).toFixed(1)}%</span>
                    <span className="text-emerald-500/80 text-[10px] ml-1.5">(Calibrated: &ge; 62.0%)</span>
                  </div>
                </div>
              )}
            </div>

            <div className="text-[11px] text-zinc-400 leading-relaxed">
              Position your face directly in front of the camera. The system will match your live face against your sealed biometric enrollment record.
            </div>

            <button
              type="button"
              onClick={handleFaceResetCapture}
              disabled={verifyingFace || !cameraReady || !regNo.trim() || !!faceResetSuccess}
              className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs transition disabled:opacity-40 cursor-pointer shadow flex items-center justify-center gap-2"
            >
              <span>📷</span>
              <span>{verifyingFace ? "Analyzing Biometrics..." : "Verify Face & Reset Password"}</span>
            </button>

            <div className="flex items-center justify-between pt-2 border-t border-zinc-900 text-xs">
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  setStep("login");
                }}
                className="text-zinc-500 hover:text-white transition font-mono text-[11px] cursor-pointer"
              >
                ← Back to Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  setStep("forgot_help");
                }}
                className="text-zinc-500 hover:text-zinc-300 transition font-mono text-[11px] cursor-pointer"
              >
                Report to TA Desk →
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: PASSWORD CHANGE */}
        {step === "change_password" && (
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="p-3 rounded-xl bg-violet-950/40 border border-violet-800/60 text-violet-300 text-xs leading-relaxed">
              <span className="font-semibold block mb-0.5">🔒 Temporary Authorization Active:</span>
              Identity verified. Please set your new private oral defense password.
            </div>

            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-1">
                Candidate
              </label>
              <div className="px-3.5 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-300">
                {studentInfo?.studentName || regNo.toUpperCase()} ({regNo.toUpperCase()})
              </div>
            </div>

            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-1">
                New Password (minimum 6 characters)
              </label>
              <input
                type="password"
                autoFocus
                placeholder="Choose a secure password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition"
              />
            </div>

            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-1">
                Confirm New Password
              </label>
              <input
                type="password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !newPassword || !confirmPassword}
              className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs transition disabled:opacity-40 cursor-pointer shadow"
            >
              {loading ? "Updating Credentials..." : "Save Password & Enter Examination Portal →"}
            </button>
          </form>
        )}

        {/* STEP 4: OFFLINE FORGOT PASSWORD HELP */}
        {step === "forgot_help" && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2 text-xs leading-relaxed text-zinc-300">
              <span className="font-semibold text-white block">Offline Password Reset Procedure (Supervised)</span>
              <p>
                OpenViva operates on an isolated, air-gapped intranet network without external email or SMS delivery.
              </p>
              <p>
                To reset a forgotten password:
              </p>
              <ol className="list-decimal list-inside space-y-1 text-zinc-400">
                <li>Notify your supervising TA or Course Professor in person at the lab with your physical student ID.</li>
                <li>The TA will click &ldquo;Reset to Default&rdquo; in the Class Roster tab of the TA Console.</li>
                <li>Your password will instantly reset back to your default Registration Number (<code className="text-zinc-200">{regNo || "e.g. reg1"}</code>).</li>
                <li>You can then sign in and choose a new private password.</li>
              </ol>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep("face_reset");
                }}
                className="w-full py-2.5 rounded-xl bg-violet-600/20 border border-violet-500/40 hover:bg-violet-600/30 text-violet-300 font-mono text-xs transition cursor-pointer flex items-center justify-center gap-2"
              >
                <span>📷</span>
                <span>Try Biometric Face Recovery Instead</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep("login");
                }}
                className="w-full py-2.5 rounded-xl border border-zinc-800 hover:bg-zinc-900 text-white font-mono text-xs transition cursor-pointer"
              >
                ← Back to Sign In
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
