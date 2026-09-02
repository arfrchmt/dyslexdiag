"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Clock, Eye, EyeOff, LogOut, Maximize2, MousePointerClick, RotateCcw, Save, UserRound, Wifi } from "lucide-react";

import { StudentStimulus } from "@/components/StudentStimulus";
import {
  fetchSession,
  formatExpiry,
  isJwtExpired,
  sendAcknowledgment,
  studentLogin,
  updateStudentStatus,
  uploadCameraPreview,
  uploadStudentRecording,
  type SessionState
} from "@/lib/session";
import { appThemes, getSavedTheme, saveTheme, type AppTheme } from "@/lib/theme";

const studentFeelingOptions = [
  { value: "senang", icon: "\u{1F642}", label: "Senyum" },
  { value: "menangis", icon: "\u{1F622}", label: "Menangis" }
];

type WordBlock = {
  id: number;
  word: string;
};

type WordSlot = number | null;

export default function StudentPage() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [sessionCode, setSessionCode] = useState("");
  const [studentJwt, setStudentJwt] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [localHideSide, setLocalHideSide] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenMessage, setFullscreenMessage] = useState("");
  const [feelingDrafts, setFeelingDrafts] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    const saved = window.localStorage.getItem("student-feeling-drafts");
    return saved ? (JSON.parse(saved) as Record<string, string>) : {};
  });
  const [selectedFeeling, setSelectedFeeling] = useState("");
  const [assembledWordIndexes, setAssembledWordIndexes] = useState<WordSlot[]>([]);
  const [shuffledWordBlocks, setShuffledWordBlocks] = useState<WordBlock[]>([]);
  const [draggingWordIndex, setDraggingWordIndex] = useState<number | null>(null);
  const [activeDropSlotIndex, setActiveDropSlotIndex] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [questionTimerMs, setQuestionTimerMs] = useState(0);
  const [clicks, setClicks] = useState(0);
  const [saved, setSaved] = useState("Tersimpan lokal");
  const [recordingState, setRecordingState] = useState("Kamera belum aktif");
  const [cameraReady, setCameraReady] = useState(false);
  const [theme, setTheme] = useState<AppTheme>("mit");
  const lastAcknowledgedSequence = useRef<number | null>(null);
  const questionRenderedAt = useRef<Record<number, number>>({});
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingMetaRef = useRef<{ sequence: number; questionId: string; startedAt: number } | null>(null);
  const recentPlacedWordRef = useRef<{ index: number; at: number } | null>(null);
  const questionDisplayed = Boolean(
    session &&
      !session.assessment_finished &&
      session.active_question_id !== "WAITING" &&
      session.active_category !== "waiting"
  );

  useEffect(() => {
    setTheme(getSavedTheme());
    const savedJwt = window.localStorage.getItem("student-jwt") ?? "";
    const savedCode = window.localStorage.getItem("student-session-code") ?? "";
    if (savedJwt && savedCode) {
      setStudentJwt(savedJwt);
      setSessionCode(savedCode);
    }
  }, []);

  useEffect(() => {
    if (!studentJwt || !sessionCode) return;
    if (isJwtExpired(studentJwt)) {
      expireStudentSession();
      return;
    }
    let active = true;

    async function load() {
      try {
        const state = await fetchSession(sessionCode, studentJwt);
        if (!active) return;
        if (state.force_student_logout) {
          forceLogoutByTeacher();
          return;
        }
        setSession(state);
      } catch (error) {
        if (error instanceof Error && error.message === "SESSION_EXPIRED") {
          expireStudentSession();
        }
      }
    }

    load();
    const interval = window.setInterval(load, 2500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [studentJwt, sessionCode]);

  useEffect(() => {
    if (!studentJwt || !sessionCode) return;
    if (!session) return;
    if (!session?.camera_enabled) {
      stopQuestionRecording("camera_disabled");
      stopCameraStream();
      setRecordingState("Kamera dinonaktifkan guru");
      return;
    }
    if (!questionDisplayed || !session) {
      stopQuestionRecording("waiting");
      if (session?.assessment_finished) {
        stopCameraStream();
        setRecordingState("Akses kamera selesai");
      }
      return;
    }

    startQuestionRecording(session).catch(() => setRecordingState("Kamera tidak tersedia"));

    return () => {
      stopQuestionRecording("question_changed");
    };
  }, [questionDisplayed, session?.active_sequence, session?.camera_enabled, sessionCode, studentJwt]);

  useEffect(() => {
    if (!studentJwt || !sessionCode || !session?.camera_enabled || session.assessment_finished) return;
    ensureCameraStream()
      .then(() => {
        if (!questionDisplayed) setRecordingState("Kamera standby");
      })
      .catch(() => setRecordingState("Kamera tidak tersedia"));
  }, [studentJwt, sessionCode, session?.camera_enabled, session?.assessment_finished, session?.request_student_camera]);

  useEffect(() => {
    if (!session || !studentJwt || !sessionCode) return;
    if (session.active_question_id === "WAITING" || session.active_category === "waiting") return;
    if (lastAcknowledgedSequence.current === session.active_sequence) return;

    const frame = window.requestAnimationFrame(() => {
      const renderedAtMs = performance.now();
      questionRenderedAt.current[session.active_sequence] = renderedAtMs;
      setQuestionTimerMs(0);
      lastAcknowledgedSequence.current = session.active_sequence;
      sendAcknowledgment(sessionCode, studentJwt, session.active_sequence, "QUESTION_RENDERED", {
        pageVisible: document.visibilityState === "visible",
        assetStatus: "READY",
        questionId: session.active_question_id,
        rendered_at_ms: renderedAtMs
      }).catch(() => undefined);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [session?.active_question_id, session?.active_sequence, sessionCode, studentJwt]);

  useEffect(() => {
    if (!session?.active_show_student_timer || !questionDisplayed) {
      setQuestionTimerMs(0);
      return;
    }
    const interval = window.setInterval(() => {
      const renderedAtMs = questionRenderedAt.current[session.active_sequence];
      if (!renderedAtMs) return;
      setQuestionTimerMs(performance.now() - renderedAtMs);
    }, 200);
    return () => window.clearInterval(interval);
  }, [questionDisplayed, session?.active_sequence, session?.active_show_student_timer]);

  useEffect(() => {
    if (!session || !studentJwt || !sessionCode || !questionDisplayed || !session.camera_enabled) return;
    let uploading = false;
    const uploadSnapshot = async () => {
      if (uploading) return;
      uploading = true;
      try {
        const blob = await captureCameraPreview();
        if (blob) {
          await uploadCameraPreview(sessionCode, studentJwt, session.active_sequence, session.active_question_id, blob);
        }
      } catch {
        // Preview is best-effort; recording remains the source of evidence.
      } finally {
        uploading = false;
      }
    };

    uploadSnapshot();
    const interval = window.setInterval(uploadSnapshot, 2000);
    return () => window.clearInterval(interval);
  }, [questionDisplayed, session?.active_sequence, session?.active_question_id, sessionCode, studentJwt]);

  useEffect(() => {
    function handleFullscreenChange() {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (studentJwt && sessionCode) {
        updateStudentStatus(sessionCode, studentJwt, active)
          .then(setSession)
          .catch(() => undefined);
      }
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, [studentJwt, sessionCode]);

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      stopQuestionRecording("unmount");
      stopCameraStream();
    };
  }, []);

  useEffect(() => {
    if (cameraPreviewRef.current && mediaStreamRef.current) {
      cameraPreviewRef.current.srcObject = mediaStreamRef.current;
    }
  }, [localHideSide, session?.hide_student_side]);

  useEffect(() => {
    window.localStorage.setItem("student-feeling-drafts", JSON.stringify(feelingDrafts));
  }, [feelingDrafts]);

  useEffect(() => {
    if (!session) return;
    if (isKnownTheme(session.theme_name)) {
      setTheme(session.theme_name);
      saveTheme(session.theme_name);
    }
    setSelectedFeeling(feelingDrafts[session.active_question_id] ?? "");
    setAssembledWordIndexes(createEmptyWordSlots(session.active_options.length));
    setActiveDropSlotIndex(null);
    setShuffledWordBlocks(getAnswerBlocksForQuestion(session));
  }, [session?.active_question_id, session?.active_options.join("\u0001"), session?.theme_name]);

  useEffect(() => {
    if (!session || session.active_scoring_mode !== "system" || session.active_options.length === 0) return;
    let cleanup = false;

    async function setupInteract() {
      const interactModule = await import("interactjs");
      const interact = interactModule.default;
      if (cleanup) return;

      interact(".word-block").draggable({
        inertia: false,
        autoScroll: true,
        listeners: {
          start(event) {
            const target = event.target as HTMLElement;
            if (target.classList.contains("used")) return;
            const wordIndex = Number(target.dataset.wordIndex);
            if (Number.isFinite(wordIndex)) setDraggingWordIndex(wordIndex);
            target.classList.add("dragging");
            target.dataset.dropped = "";
          },
          move(event) {
            const target = event.target as HTMLElement;
            if (target.classList.contains("used")) return;
            const x = (Number(target.dataset.x) || 0) + event.dx;
            const y = (Number(target.dataset.y) || 0) + event.dy;
            target.style.transform = `translate(${x}px, ${y}px)`;
            target.dataset.x = String(x);
            target.dataset.y = String(y);
          },
          end(event) {
            const target = event.target as HTMLElement;
            target.classList.remove("dragging");
            target.style.transform = "";
            target.dataset.x = "0";
            target.dataset.y = "0";
            target.dataset.dropped = "";
            setDraggingWordIndex(null);
            setActiveDropSlotIndex(null);
          }
        }
      });

      interact(".answer-slot, .answer-slot-row").dropzone({
        accept: ".word-block",
        overlap: 0.35,
        ondropactivate(event) {
          (event.target as HTMLElement).classList.add("drop-active");
        },
        ondropdeactivate(event) {
          (event.target as HTMLElement).classList.remove("drop-active", "drop-target");
        },
        ondragenter(event) {
          const target = event.target as HTMLElement;
          target.classList.add("drop-target");
          const slotIndex = getDropSlotIndex(target);
          setActiveDropSlotIndex(slotIndex);
        },
        ondragleave(event) {
          (event.target as HTMLElement).classList.remove("drop-target");
          setActiveDropSlotIndex(null);
        },
        ondrop(event) {
          const wordIndex = Number((event.relatedTarget as HTMLElement).dataset.wordIndex);
          const slotIndex = getDropSlotIndex(event.target as HTMLElement);
          if (Number.isFinite(wordIndex) && Number.isFinite(slotIndex)) {
            (event.relatedTarget as HTMLElement).dataset.dropped = "true";
            placeWordBlockInSlot(wordIndex, slotIndex);
          }
          (event.target as HTMLElement).classList.remove("drop-active", "drop-target");
          setActiveDropSlotIndex(null);
        }
      });
    }

    setupInteract();

    return () => {
      cleanup = true;
      void import("interactjs").then(({ default: interact }) => {
        interact(".word-block").unset();
        interact(".answer-slot").unset();
        interact(".answer-slot-row").unset();
      });
    };
  }, [
    session?.active_question_id,
    session?.active_options.join("\u0001"),
    session?.active_scoring_mode,
    session?.assessment_finished,
    assembledWordIndexes.join("\u0001")
  ]);

  const duration = useMemo(() => {
    const minutes = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const rest = (seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${rest}`;
  }, [seconds]);
  const filledWordSlotCount = assembledWordIndexes.filter((index) => typeof index === "number").length;
  const firstEmptyWordSlotIndex = assembledWordIndexes.findIndex((index) => index === null);

  async function handleFeeling(value: string) {
    if (!session || session.assessment_finished) return;
    setSelectedFeeling(value);
    setFeelingDrafts((drafts) => ({
      ...drafts,
      [session.active_question_id]: value
    }));
    setSaved("Menyimpan...");
    try {
      await sendAcknowledgment(sessionCode, studentJwt, session.active_sequence, "STUDENT_FEELING_SELECTED", {
        questionId: session.active_question_id,
        feeling: value
      });
      setSaved("Tersimpan");
    } catch (error) {
      if (error instanceof Error && error.message === "SESSION_EXPIRED") {
        expireStudentSession();
        return;
      }
      setSaved("Tersimpan lokal");
    }
  }

  async function submitSystemAnswer(indexes: number[]) {
    if (!session || session.assessment_finished) return;
    const words = indexes.map((index) => session.active_options[index]);
    const answer = words.join(" ").toLowerCase().trim();
    const expected = (session.active_correct_answer ?? "").toLowerCase().trim();
    const score = expected && answer === expected ? 10 : 0;
    const renderedAtMs = questionRenderedAt.current[session.active_sequence] ?? performance.now();
    const durationMs = Math.max(0, Math.round(performance.now() - renderedAtMs));
    await sendAcknowledgment(sessionCode, studentJwt, session.active_sequence, "STUDENT_SYSTEM_SCORE", {
      questionId: session.active_question_id,
      answer,
      expected,
      score,
      duration_ms: durationMs
    });
    setSaved(score > 0 ? "Jawaban benar" : "Jawaban tersimpan");
  }

  function updateChunkAnswer(indexes: WordSlot[], status: "draft" | "reset" | "submitted" = "draft") {
    setAssembledWordIndexes(indexes);
    publishChunkDraft(indexes, status);
    const completedIndexes = getCompletedWordIndexes(indexes);
    if (session && completedIndexes.length === session.active_options.length) {
      submitSystemAnswer(completedIndexes).catch(() => setSaved("Tersimpan lokal"));
    }
  }

  function publishChunkDraft(indexes: WordSlot[], status: "draft" | "reset" | "submitted" = "draft") {
    if (!session || session.assessment_finished || session.active_scoring_mode !== "system") return;
    const words = indexes.map((index) => typeof index === "number" ? session.active_options[index] : "");
    sendAcknowledgment(sessionCode, studentJwt, session.active_sequence, "STUDENT_CHUNK_DRAFT", {
      questionId: session.active_question_id,
      words,
      answer: words.filter(Boolean).join(" ").trim(),
      status,
      complete: getCompletedWordIndexes(indexes).length === session.active_options.length
    }).catch(() => undefined);
  }

  function selectWordBlock(index: number) {
    const recentPlacement = recentPlacedWordRef.current;
    if (recentPlacement?.index === index && performance.now() - recentPlacement.at < 250) return;
    if (assembledWordIndexes.includes(index)) return;
    const nextIndexes = normalizeWordSlots(assembledWordIndexes, session?.active_options.length ?? 0);
    const slotIndex = nextIndexes.findIndex((slot) => slot === null);
    if (slotIndex < 0) return;
    nextIndexes[slotIndex] = index;
    updateChunkAnswer(nextIndexes);
  }

  function placeWordBlockInSlot(wordIndex: number, slotIndex: number) {
    if (session?.assessment_finished) return;
    if (assembledWordIndexes.includes(wordIndex)) return;
    const nextIndexes = normalizeWordSlots(assembledWordIndexes, session?.active_options.length ?? 0);
    const boundedSlotIndex = Math.max(0, Math.min(slotIndex, nextIndexes.length - 1));
    if (nextIndexes[boundedSlotIndex] !== null) return;
    nextIndexes[boundedSlotIndex] = wordIndex;
    recentPlacedWordRef.current = { index: wordIndex, at: performance.now() };
    updateChunkAnswer(nextIndexes);
  }

  function removeWordBlock(slotIndex: number) {
    setAssembledWordIndexes((indexes) => {
      const nextIndexes = normalizeWordSlots(indexes, session?.active_options.length ?? 0);
      nextIndexes[slotIndex] = null;
      publishChunkDraft(nextIndexes);
      return nextIndexes;
    });
  }

  function resetSystemAnswer() {
    if (!session) return;
    setShuffledWordBlocks(getAnswerBlocksForQuestion(session));
    updateChunkAnswer(createEmptyWordSlots(session.active_options.length), "reset");
  }

  function expireStudentSession() {
    stopQuestionRecording("session_expired");
    stopCameraStream();
    window.localStorage.removeItem("student-jwt");
    window.localStorage.removeItem("student-session-code");
    setStudentJwt("");
    setSessionCode("");
    setSession(null);
    setLoginError("Sesi siswa expired. Masukkan token baru dari guru.");
  }

  function forceLogoutByTeacher() {
    stopQuestionRecording("teacher_logout");
    stopCameraStream();
    window.localStorage.removeItem("student-jwt");
    window.localStorage.removeItem("student-session-code");
    setStudentJwt("");
    setSessionCode("");
    setSession(null);
    setStudentCode("");
    setSelectedFeeling("");
    setLoginError("Guru telah mengakhiri akses token siswa.");
  }

  function logoutStudent() {
    const confirmed = window.confirm("Logout dari sesi siswa?");
    if (!confirmed) return;
    window.localStorage.removeItem("student-jwt");
    window.localStorage.removeItem("student-session-code");
    setStudentJwt("");
    setSessionCode("");
    setSession(null);
    setStudentCode("");
    setSelectedFeeling("");
    stopQuestionRecording("logout");
    stopCameraStream();
    lastAcknowledgedSequence.current = null;
    questionRenderedAt.current = {};
  }

  async function ensureCameraStream() {
    if (mediaStreamRef.current) return mediaStreamRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera API is unavailable");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        frameRate: { ideal: 25, max: 25 },
        width: { ideal: 640 },
        height: { ideal: 480 }
      }
    });
    mediaStreamRef.current = stream;
    setCameraReady(true);
    if (cameraPreviewRef.current) {
      cameraPreviewRef.current.srcObject = stream;
    }
    return stream;
  }

  async function startQuestionRecording(currentSession: SessionState) {
    if (!currentSession.camera_enabled) return;
    if (mediaRecorderRef.current?.state === "recording") return;
    const stream = await ensureCameraStream();
    const mimeType = getSupportedRecordingMimeType();
    const chunks: Blob[] = [];
    const meta = {
      sequence: currentSession.active_sequence,
      questionId: currentSession.active_question_id,
      startedAt: performance.now()
    };
    recordingChunksRef.current = chunks;
    recordingMetaRef.current = meta;
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      if (recordingMetaRef.current === meta) {
        recordingChunksRef.current = [];
        recordingMetaRef.current = null;
      }
      if (!meta || chunks.length === 0) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
      const durationMs = performance.now() - meta.startedAt;
      setRecordingState("Mengunggah rekaman...");
      uploadStudentRecording(sessionCode, studentJwt, meta.sequence, meta.questionId, blob, durationMs)
        .then(() => setRecordingState("Rekaman tersimpan"))
        .catch(() => setRecordingState("Rekaman belum tersimpan"));
    };
    mediaRecorderRef.current = recorder;
    recorder.start(1000);
    setRecordingState("Merekam 25fps");
    sendAcknowledgment(sessionCode, studentJwt, currentSession.active_sequence, "STUDENT_RECORDING_STARTED", {
      questionId: currentSession.active_question_id,
      fps: 25,
      started_at_ms: meta.startedAt
    }).catch(() => undefined);
  }

  function stopQuestionRecording(_reason: string) {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    mediaRecorderRef.current = null;
    recorder.stop();
  }

  function stopCameraStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    setCameraReady(false);
    if (cameraPreviewRef.current) {
      cameraPreviewRef.current.srcObject = null;
    }
  }

  async function requestCameraPermission() {
    if (!session?.camera_enabled) return;
    setRecordingState("Meminta izin kamera...");
    try {
      await ensureCameraStream();
      setRecordingState(questionDisplayed ? "Kamera siap merekam" : "Kamera standby");
      if (sessionCode && studentJwt && session) {
        sendAcknowledgment(sessionCode, studentJwt, session.active_sequence, "STUDENT_CAMERA_READY", {
          questionId: session.active_question_id
        }).catch(() => undefined);
      }
    } catch {
      setRecordingState("Izin kamera belum diberikan");
    }
  }

  function captureCameraPreview() {
    const video = cameraPreviewRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return Promise.resolve(null);
    }
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return Promise.resolve(null);
    context.drawImage(video, 0, 0, width, height);
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.72);
    });
  }

  async function enterFullscreen() {
    setFullscreenMessage("");
    const element = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    const requestFullscreen = element.requestFullscreen?.bind(element) ?? element.webkitRequestFullscreen?.bind(element);
    if (!document.fullscreenEnabled && !element.webkitRequestFullscreen) {
      setFullscreenMessage("Browser ini tidak mendukung fullscreen halaman. Pada Firefox iPad fitur ini biasanya tidak tersedia.");
      return;
    }

    try {
      if (!document.fullscreenElement) {
        await requestFullscreen?.();
      }
      setIsFullscreen(true);
      if (studentJwt && sessionCode) {
        setSession(await updateStudentStatus(sessionCode, studentJwt, true));
      }
    } catch {
      setFullscreenMessage("Fullscreen perlu klik langsung dari siswa atau tidak didukung browser.");
    }
  }

  async function handleStudentLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      const response = await studentLogin(studentCode);
      window.localStorage.setItem("student-jwt", response.access_token);
      window.localStorage.setItem("student-session-code", response.session.code);
      setStudentJwt(response.access_token);
      setSessionCode(response.session.code);
      setSession(response.session);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Login siswa gagal");
    } finally {
      setLoginLoading(false);
    }
  }

  const hideSidePanel = localHideSide || Boolean(session?.hide_student_side);

  if (!studentJwt || !sessionCode) {
    return (
      <main className="auth-shell">
        <form className="auth-panel" onSubmit={handleStudentLogin}>
          <p className="eyebrow">UI Siswa</p>
          <h1>Masuk sesi asesmen</h1>
          <label>
            <span>Kode token dari guru</span>
            <input
              value={studentCode}
              onChange={(event) => setStudentCode(event.target.value.toLowerCase())}
              placeholder="abcd"
              maxLength={4}
            />
          </label>
          {loginError ? <p className="error-text">{loginError}</p> : null}
          <button className="primary-button full" disabled={loginLoading} type="submit">
            {loginLoading ? "Memproses..." : "Masuk"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className={`student-shell theme-${theme}`} onClick={() => setClicks((value) => value + 1)}>
      <header className="student-topbar">
        <div>
          <p className="eyebrow">UI Siswa</p>
        </div>
        <div className="status-strip">
          <label className="theme-picker" title="Theme">
            <select
              value={theme}
              onChange={(event) => {
                const nextTheme = event.target.value as AppTheme;
                setTheme(nextTheme);
                saveTheme(nextTheme);
              }}
            >
              {appThemes.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <span>
            <UserRound size={16} /> {session?.student_name ?? "Siswa"}
          </span>
          <span>
            <Wifi size={16} /> Terhubung
          </span>
          <span>
            <Clock size={16} /> {duration}
          </span>
          <span>
            <MousePointerClick size={16} /> {clicks}
          </span>
          <span>
            <Clock size={16} /> Exp {formatExpiry(studentJwt)}
          </span>
          <span className={isFullscreen ? "status-ok" : "status-warn"}>
            {session?.assessment_finished ? "Asesmen selesai" : isFullscreen ? "Fullscreen aktif" : "Belum fullscreen"}
          </span>
          <button className="icon-action" onClick={enterFullscreen} type="button" title="Fullscreen">
            <Maximize2 size={16} />
          </button>
          <button
            className="icon-action"
            onClick={() => setLocalHideSide((value) => !value)}
            type="button"
            title="Sembunyikan/tampilkan preview kamera dan status"
          >
            {hideSidePanel ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
          <button className="icon-action" onClick={logoutStudent} type="button" title="Logout siswa" aria-label="Logout siswa">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {session?.request_student_fullscreen && !isFullscreen ? (
        <section className="fullscreen-request">
          <strong>Guru meminta layar fullscreen.</strong>
          <button className="primary-button" onClick={enterFullscreen} type="button">
            <Maximize2 size={17} />
            Aktifkan fullscreen
          </button>
        </section>
      ) : null}

      {session?.camera_enabled && !cameraReady ? (
        <section className="fullscreen-request">
          <strong>Kamera siswa perlu diizinkan untuk preview dan perekaman.</strong>
          <button className="primary-button" onClick={requestCameraPermission} type="button">
            <Camera size={17} />
            Izinkan kamera
          </button>
        </section>
      ) : null}

      {fullscreenMessage ? <p className="error-text fullscreen-error">{fullscreenMessage}</p> : null}
      {session?.assessment_finished ? (
        <section className="fullscreen-request">
          <strong>Asesmen sudah diselesaikan guru.</strong>
        </section>
      ) : null}
      {hideSidePanel ? <video ref={cameraPreviewRef} autoPlay muted playsInline className="camera-hidden-preview" /> : null}

      <section className={hideSidePanel ? "student-grid side-hidden" : "student-grid"}>
        <div className="student-main">
          {session ? (
            <>
              <div className="student-content-block">
                <StudentStimulus
                  instructionText={session.active_instruction_text}
                  questionId={session.active_question_id}
                  questionText={session.active_question_text}
                />
                {session.active_show_student_timer && questionDisplayed ? (
                  <div className="student-digital-timer">{formatDigitalTimer(questionTimerMs)}</div>
                ) : null}
              </div>
              {session.active_scoring_mode === "system" && session.active_options.length > 0 ? (
                <section className="response-panel block-answer-panel">
                  <div className="block-answer-header">
                    <span>{session.active_instruction_text}</span>
                    <button
                      className="student-answer-action reset"
                      disabled={filledWordSlotCount === 0 || Boolean(session.assessment_finished)}
                      onClick={resetSystemAnswer}
                      title="Ulangi"
                      aria-label="Ulangi"
                      type="button"
                    >
                      <RotateCcw size={28} />
                    </button>
                  </div>
                  <div
                    className={[
                      "answer-slot-row",
                      activeDropSlotIndex === firstEmptyWordSlotIndex ? "drop-target" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-answer-slot-index={firstEmptyWordSlotIndex >= 0 ? firstEmptyWordSlotIndex : 0}
                  >
                    {session.active_options.map((_, slotIndex) => {
                          const wordIndex = assembledWordIndexes[slotIndex];
                          const word = typeof wordIndex === "number" ? session.active_options[wordIndex] : "";
                          return (
                            <button
                          className={[
                            "answer-slot",
                            word ? "filled" : "",
                            activeDropSlotIndex === slotIndex && !word ? "drop-target" : ""
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          data-answer-slot-index={slotIndex}
                          disabled={Boolean(session.assessment_finished)}
                          key={`slot-${slotIndex}`}
                          onClick={() => removeWordBlock(slotIndex)}
                          type="button"
                        >
                          {word || " "}
                        </button>
                      );
                    })}
                  </div>
                  <div className="word-block-grid">
                    {shuffledWordBlocks.map(({ id, word }) => (
                      <button
                        className={[
                          "word-block",
                          assembledWordIndexes.includes(id) ? "used" : "",
                          draggingWordIndex === id ? "dragging" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        data-word-index={id}
                        disabled={assembledWordIndexes.includes(id) || Boolean(session.assessment_finished)}
                        key={`${word}-${id}`}
                        onClick={() => selectWordBlock(id)}
                        type="button"
                      >
                        {word}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <div className="stimulus">Memuat sesi...</div>
          )}

          <section className="response-panel feeling-panel">
            <div className="feeling-grid">
              {studentFeelingOptions.map((feeling) => (
                <button
                  aria-label={feeling.label}
                  className={selectedFeeling === feeling.value ? "feeling-button selected" : "feeling-button"}
                  disabled={!questionDisplayed}
                  key={feeling.value}
                  onClick={() => handleFeeling(feeling.value)}
                  title={feeling.label}
                  type="button"
                >
                  <span aria-hidden="true">{feeling.icon}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
        {!hideSidePanel ? (
          <aside className="student-side">
            <section className="device-panel student-assessment-title">
              <p className="eyebrow">Asesmen</p>
              <h2>Sesi Asesmen Membaca</h2>
            </section>
            <section className="camera-card live-camera-card">
              <div className="camera-frame">
                <video ref={cameraPreviewRef} autoPlay muted playsInline className="camera-video-preview" />
                <span className="camera-badge">
                  <Camera size={15} /> Preview
                </span>
                <div className="target-box" />
                <div className="face-oval" />
              </div>
              <div className="metric-row">
                <span>Kamera</span>
                <strong>{cameraReady ? recordingState : `${recordingState} - klik Izinkan kamera`}</strong>
              </div>
            </section>
            <section className="device-panel">
              <h2>Status perangkat</h2>
              <div className="metric-row">
                <span>Soal</span>
                <strong>{session?.active_sequence ?? "-"}</strong>
              </div>
              <div className="metric-row">
                <span>Render</span>
                <strong>Siap</strong>
              </div>
              <div className="metric-row">
                <span>Halaman</span>
                <strong>Aktif</strong>
              </div>
              <div className="metric-row">
                <span>Penyimpanan</span>
                <strong>
                  <Save size={15} /> {saved}
                </strong>
              </div>
              <div className="metric-row">
                <span>Rekaman</span>
                <strong>{recordingState}</strong>
              </div>
            </section>
          </aside>
        ) : null}
      </section>
    </main>
  );
}

function shuffleWordBlocks(options: string[]) {
  const blocks = options.map((word, id) => ({ id, word }));
  for (let index = blocks.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [blocks[index], blocks[swapIndex]] = [blocks[swapIndex], blocks[index]];
  }
  return blocks;
}

function getAnswerBlocksForQuestion(session: SessionState) {
  const blocks = session.active_options.map((word, id) => ({ id, word }));
  if (!shouldShuffleAnswerBlocks(session)) return blocks;
  return shuffleWordBlocks(session.active_options);
}

function createEmptyWordSlots(length: number): WordSlot[] {
  return Array.from({ length }, () => null);
}

function normalizeWordSlots(indexes: WordSlot[], length: number): WordSlot[] {
  return Array.from({ length }, (_, index) => indexes[index] ?? null);
}

function getCompletedWordIndexes(indexes: WordSlot[]) {
  return indexes.filter((index): index is number => typeof index === "number");
}

function shouldShuffleAnswerBlocks(session: SessionState) {
  if (session.active_scoring_mode !== "system" || session.active_options.length < 2) return false;
  const markerText = `${session.active_category} ${session.active_question_text} ${session.active_instruction_text}`.toLowerCase();
  return (
    markerText.includes("fill") ||
    markerText.includes("blank") ||
    markerText.includes("___") ||
    markerText.includes("|") ||
    markerText.includes("blok") ||
    markerText.includes("susun")
  );
}

function getDropSlotIndex(target: HTMLElement) {
  const slot = target.closest("[data-answer-slot-index]") as HTMLElement | null;
  const slotIndex = Number(slot?.dataset.answerSlotIndex);
  return Number.isFinite(slotIndex) ? slotIndex : 0;
}

function formatDigitalTimer(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  const tenths = Math.floor((Math.max(0, value) % 1000) / 100);
  return `${minutes}:${seconds}.${tenths}`;
}

function isKnownTheme(value: string): value is AppTheme {
  return appThemes.some((theme) => theme.value === value);
}

function getSupportedRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4"
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}
