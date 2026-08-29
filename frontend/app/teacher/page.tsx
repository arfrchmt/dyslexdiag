"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Camera,
  Check,
  ClipboardCheck,
  FileText,
  Eye,
  EyeOff,
  LogOut,
  Maximize2,
  Radio,
  Save,
  ShieldCheck,
  UserPlus,
  X
} from "lucide-react";

import { CameraPositionCard } from "@/components/CameraPositionCard";
import { StudentStimulus } from "@/components/StudentStimulus";
import {
  fetchSession,
  fetchTimeline,
  finishSession,
  formatExpiry,
  generateStudentToken,
  isJwtExpired,
  navigateQuestion,
  saveGrade,
  saveNote,
  sendAcknowledgment,
  teacherLogin,
  updateUiControls,
  type SessionState,
  type StudentTokenResponse,
  type TimelineEvent
} from "@/lib/session";
import {
  assessmentCategories,
  categoryLabel,
  fetchAssessmentItems,
  type AssessmentCategory,
  type AssessmentItem
} from "@/lib/assessmentContent";
import { fetchStudents, type StudentListItem } from "@/lib/students";

const fallbackItems: AssessmentItem[] = [
  {
    id: "fallback-pa001",
    item_code: "PA001",
    category: "phonological_awareness",
    title: "Baca kata",
    prompt: "Bacalah kata berikut.",
    instruction_text: "Fokus pada bunyi setiap suku kata, lalu baca kata utuh.",
    stimulus: "KELAPA",
    options: [],
    correct_answer: null,
    scoring_mode: "teacher_rubric",
    sort_order: 1,
    is_active: true,
    created_at: ""
  }
];

type ScoreDraft = {
  fluency: number;
  accuracy: number;
  confidence: number;
};

const emptyScore: ScoreDraft = {
  fluency: 0,
  accuracy: 0,
  confidence: 0
};

const noteSuggestions = [
  { label: "Lambat", text: "Membaca kata dengan lambat meskipun kata relatif sederhana." },
  { label: "Terputus", text: "Membaca terputus-putus dan belum otomatis." },
  { label: "Mengeja", text: "Sering mengeja per huruf sebelum membaca kata utuh." },
  { label: "Bunyi", text: "Keliru menghubungkan huruf dengan bunyi." },
  { label: "Ragu", text: "Ragu saat membaca kata panjang atau multisuku kata." }
];

export default function TeacherPage() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [teacherJwt, setTeacherJwt] = useState("");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [studentName, setStudentName] = useState("Siswa 01");
  const [studentId, setStudentId] = useState("");
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [studentToken, setStudentToken] = useState<StudentTokenResponse | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [assessmentItems, setAssessmentItems] = useState<AssessmentItem[]>(fallbackItems);
  const [activeCategory, setActiveCategory] = useState<AssessmentCategory>("phonological_awareness");
  const [selectedQuestion, setSelectedQuestion] = useState(0);
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, ScoreDraft>>(() => {
    if (typeof window === "undefined") return {};
    const saved = window.localStorage.getItem("teacher-score-drafts");
    return saved ? (JSON.parse(saved) as Record<string, ScoreDraft>) : {};
  });
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    const saved = window.localStorage.getItem("teacher-note-drafts");
    return saved ? (JSON.parse(saved) as Record<string, string>) : {};
  });
  const [fluency, setFluency] = useState(0);
  const [accuracy, setAccuracy] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [note, setNote] = useState("");
  const [saveState, setSaveState] = useState("Belum disimpan");
  const [pulseKey, setPulseKey] = useState(0);
  const [feelingPulseKey, setFeelingPulseKey] = useState(0);
  const lastRenderedSignature = useRef("");
  const lastFeelingSignature = useRef("");
  const noteSaveTimer = useRef<number | null>(null);

  async function refresh() {
    if (!teacherJwt || !session) return;
    const [state, events] = await Promise.all([
      fetchSession(session.code, teacherJwt),
      fetchTimeline(session.code, teacherJwt).catch(() => [])
    ]);
    setSession(state);
    setTimeline(events);
    const renderedEvent = events.find(
      (event) => event.event_type === "QUESTION_RENDERED" && event.sequence === state.active_sequence
    );
    const signature = renderedEvent
      ? `${renderedEvent.sequence}-${renderedEvent.t_ms}`
      : `waiting-${state.active_sequence}`;
    if (renderedEvent && signature !== lastRenderedSignature.current) {
      setPulseKey((value) => value + 1);
      lastRenderedSignature.current = signature;
    }
    const feelingEvent = events.find(
      (event) => event.event_type === "STUDENT_FEELING_SELECTED" && event.sequence === state.active_sequence
    );
    const feelingSignature = feelingEvent ? `${feelingEvent.sequence}-${feelingEvent.t_ms}` : "";
    if (feelingEvent && feelingSignature !== lastFeelingSignature.current) {
      setFeelingPulseKey((value) => value + 1);
      lastFeelingSignature.current = feelingSignature;
    }
    const stateCategory = state.active_category as AssessmentCategory;
    if (assessmentCategories.some((item) => item.value === stateCategory)) {
      setActiveCategory(stateCategory);
      const categoryItems = assessmentItems.filter((item) => item.category === stateCategory && item.is_active);
      const index = categoryItems.findIndex((item) => item.item_code === state.active_question_id);
      if (index >= 0) setSelectedQuestion(index);
    }
  }

  useEffect(() => {
    const savedJwt = window.localStorage.getItem("teacher-jwt") ?? "";
    const savedSessionCode = window.localStorage.getItem("teacher-session-code") ?? "";
    if (savedJwt) setTeacherJwt(savedJwt);
    if (savedJwt && savedSessionCode) {
      fetchSession(savedSessionCode, savedJwt)
        .then(setSession)
        .catch(() => window.localStorage.removeItem("teacher-session-code"));
    }
  }, []);

  useEffect(() => {
    if (!teacherJwt) return;
    fetchStudents(teacherJwt)
      .then((items) => {
        setStudents(items);
        if (items.length > 0) {
          setStudentId((current) => current || items[0].id);
          setStudentName((current) => current === "Siswa 01" ? items[0].name : current);
        }
      })
      .catch(() => setStudents([]));
    fetchAssessmentItems(teacherJwt)
      .then((items) => {
        const activeItems = items.filter((item) => item.is_active);
        setAssessmentItems(activeItems.length > 0 ? activeItems : fallbackItems);
      })
      .catch(() => setAssessmentItems(fallbackItems));
  }, [teacherJwt]);

  useEffect(() => {
    if (!teacherJwt || !session) return;
    if (isJwtExpired(teacherJwt)) {
      expireTeacherSession();
      return;
    }
    refresh();
    const interval = window.setInterval(refresh, 2500);
    return () => window.clearInterval(interval);
  }, [teacherJwt, session?.code]);

  useEffect(() => {
    window.localStorage.setItem("teacher-score-drafts", JSON.stringify(scoreDrafts));
  }, [scoreDrafts]);

  useEffect(() => {
    window.localStorage.setItem("teacher-note-drafts", JSON.stringify(noteDrafts));
  }, [noteDrafts]);

  useEffect(() => {
    return () => {
      if (noteSaveTimer.current) window.clearTimeout(noteSaveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const draft = scoreDrafts[session.active_question_id] ?? emptyScore;
    setFluency(draft.fluency);
    setAccuracy(draft.accuracy);
    setConfidence(draft.confidence);
    setNote(noteDrafts[session.active_question_id] ?? "");
    setSaveState(scoreDrafts[session.active_question_id] ? "Draft nilai dimuat" : "Nilai awal 0");
  }, [session?.active_question_id]);

  const total = useMemo(() => fluency + accuracy + confidence, [fluency, accuracy, confidence]);
  const categoryItems = useMemo(() => {
    return assessmentItems.filter((item) => item.category === activeCategory && item.is_active);
  }, [activeCategory, assessmentItems]);
  const hasActiveCategoryQuestion = categoryItems.length > 0;
  const activeItem = categoryItems[selectedQuestion] ?? categoryItems[0] ?? fallbackItems[0];
  const assessmentLocked = Boolean(session?.started_at && !session.assessment_finished);
  const controlsDisabled = !session || Boolean(session.assessment_finished);
  const questionControlsDisabled = controlsDisabled || !hasActiveCategoryQuestion;
  const activeRenderedAck = timeline.find(
    (event) => event.event_type === "QUESTION_RENDERED" && event.sequence === session?.active_sequence
  );
  const activeFeelingAck = timeline.find(
    (event) => event.event_type === "STUDENT_FEELING_SELECTED" && event.sequence === session?.active_sequence
  );
  const activeFeeling = activeFeelingAck ? parseTimelinePayload(activeFeelingAck.payload).feeling : "";

  useEffect(() => {
    if (selectedQuestion >= categoryItems.length) {
      setSelectedQuestion(0);
    }
  }, [categoryItems.length, selectedQuestion]);

  async function persistAssessment(score: ScoreDraft, noteText: string, sequence?: number) {
    if (!session || !teacherJwt || session.assessment_finished) return;
    if (noteSaveTimer.current) {
      window.clearTimeout(noteSaveTimer.current);
      noteSaveTimer.current = null;
    }
    const targetSequence = sequence ?? session.active_sequence;
    setSaveState("Menyimpan...");
    if (session.active_scoring_mode === "teacher_rubric") {
      await saveGrade(session.code, teacherJwt, targetSequence, score.fluency, score.accuracy, score.confidence);
    }
    await saveNote(session.code, teacherJwt, targetSequence, noteText);
    setSaveState(`Tersimpan seq ${targetSequence}`);
  }

  function recordScoreChange(field: keyof ScoreDraft, value: number) {
    if (!session || !teacherJwt || session.assessment_finished) return;

    const nextScore = {
      fluency,
      accuracy,
      confidence,
      [field]: value
    };

    setScoreDrafts((drafts) => ({
      ...drafts,
      [session.active_question_id]: nextScore
    }));

    if (field === "fluency") setFluency(value);
    if (field === "accuracy") setAccuracy(value);
    if (field === "confidence") setConfidence(value);
    setSaveState(`Menyimpan ${session.active_question_id}...`);
    saveGrade(session.code, teacherJwt, session.active_sequence, nextScore.fluency, nextScore.accuracy, nextScore.confidence)
      .then(() => setSaveState(`Skor ${session.active_question_id} tersimpan`))
      .catch(() => setSaveState(`Skor ${session.active_question_id} belum tersimpan`));
  }

  function recordNoteChange(value: string) {
    if (!session || !teacherJwt || session.assessment_finished) return;
    setNote(value);
    setNoteDrafts((drafts) => ({
      ...drafts,
      [session.active_question_id]: value
    }));
    setSaveState(`Menyimpan catatan ${session.active_question_id}...`);
    if (noteSaveTimer.current) window.clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = window.setTimeout(() => {
      saveNote(session.code, teacherJwt, session.active_sequence, value)
        .then(() => setSaveState(`Catatan ${session.active_question_id} tersimpan`))
        .catch(() => setSaveState(`Catatan ${session.active_question_id} belum tersimpan`));
    }, 450);
  }

  function addNoteSuggestion(suggestion: string) {
    const nextNote = note.trim().length > 0 ? `${note.trim()}\n${suggestion}` : suggestion;
    recordNoteChange(nextNote);
  }

  async function handleCategoryChange(value: AssessmentCategory) {
    setActiveCategory(value);
    setSelectedQuestion(0);
    if (!session || !teacherJwt) return;
    const firstItem = assessmentItems.find((item) => item.category === value && item.is_active);
    if (!firstItem) return;
    await persistAssessment({ fluency, accuracy, confidence }, note, session.active_sequence);
    setSession(
      await navigateQuestion(session.code, teacherJwt, firstItem.item_code, itemDisplayText(firstItem), {
        instruction_text: firstItem.instruction_text,
        category: firstItem.category,
        scoring_mode: firstItem.scoring_mode,
        options: firstItem.options,
        correct_answer: firstItem.correct_answer
      })
    );
    await refresh();
  }

  async function goToQuestion(index: number) {
    if (!session || !teacherJwt) return;
    await persistAssessment({ fluency, accuracy, confidence }, note, session.active_sequence);
    if (categoryItems.length === 0) return;
    const bounded = Math.max(0, Math.min(index, categoryItems.length - 1));
    const target = categoryItems[bounded];
    setSelectedQuestion(bounded);
    setSession(
      await navigateQuestion(session.code, teacherJwt, target.item_code, itemDisplayText(target), {
        instruction_text: target.instruction_text,
        category: target.category,
        scoring_mode: target.scoring_mode,
        options: target.options,
        correct_answer: target.correct_answer
      })
    );
    await refresh();
  }

  async function handleSaveAssessment() {
    if (!session || !teacherJwt) return;
    setSaveState("Menyimpan...");
    if (session.active_scoring_mode === "teacher_rubric") {
      await saveGrade(session.code, teacherJwt, session.active_sequence, fluency, accuracy, confidence);
    }
    await saveNote(session.code, teacherJwt, session.active_sequence, note);
    setSaveState("Tersimpan");
    await refresh();
  }

  async function handleFinishAssessment() {
    if (!session || !teacherJwt) return;
    const confirmed = window.confirm(
      `Selesaikan asesmen untuk ${session.student_name}? Setelah selesai, kontrol sesi ini akan dikunci.`
    );
    if (!confirmed) return;
    await persistAssessment({ fluency, accuracy, confidence }, note, session.active_sequence);
    setSession(await finishSession(session.code, teacherJwt));
    setStudentToken(null);
    setSaveState("Asesmen selesai");
    await refresh();
  }

  async function recordBinaryScore(correct: boolean) {
    if (!session || !teacherJwt || session.assessment_finished) return;
    const score = correct ? 10 : 0;
    setFluency(score);
    setAccuracy(score);
    setConfidence(score);
    setScoreDrafts((drafts) => ({
      ...drafts,
      [session.active_question_id]: { fluency: score, accuracy: score, confidence: score }
    }));
    setSaveState(correct ? "Jawaban benar tersimpan" : "Jawaban salah tersimpan");
    await saveGrade(session.code, teacherJwt, session.active_sequence, score, score, score);
  }

  async function recordWritingUpload(fileName: string) {
    if (!session || !teacherJwt || session.assessment_finished || !fileName) return;
    await sendAcknowledgment(session.code, teacherJwt, session.active_sequence, "WRITING_PHOTO_SELECTED", {
      questionId: session.active_question_id,
      fileName
    });
    setSaveState(`Foto ${fileName} tercatat`);
    await refresh();
  }

  function expireTeacherSession() {
    window.localStorage.removeItem("teacher-jwt");
    window.localStorage.removeItem("teacher-session-code");
    setTeacherJwt("");
    setSession(null);
    setAuthError("Sesi guru expired. Silakan login kembali.");
  }

  function logoutTeacher() {
    window.localStorage.removeItem("teacher-jwt");
    window.localStorage.removeItem("teacher-session-code");
    setTeacherJwt("");
    setSession(null);
    setStudentToken(null);
    setTimeline([]);
    setPassword("");
  }

  async function handleTeacherLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const response = await teacherLogin(username, password);
      window.localStorage.setItem("teacher-jwt", response.access_token);
      setTeacherJwt(response.access_token);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Login guru gagal");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleGenerateStudentToken() {
    if (!teacherJwt) return;
    const selectedStudent = students.find((student) => student.id === studentId);
    const response = await generateStudentToken(
      teacherJwt,
      selectedStudent?.name ?? studentName,
      selectedStudent?.id
    );
    window.localStorage.setItem("teacher-session-code", response.session.code);
    setStudentToken(response);
    setSession(response.session);
    setTimeline([]);
  }

  async function toggleStudentSidePanel() {
    if (!session || !teacherJwt) return;
    try {
      setSession(await updateUiControls(session.code, teacherJwt, { hide_student_side: !session.hide_student_side }));
    } catch (error) {
      if (error instanceof Error && error.message === "SESSION_EXPIRED") {
        expireTeacherSession();
      }
    }
  }

  async function requestStudentFullscreen() {
    if (!session || !teacherJwt) return;
    try {
      setSession(await updateUiControls(session.code, teacherJwt, { request_student_fullscreen: true }));
    } catch (error) {
      if (error instanceof Error && error.message === "SESSION_EXPIRED") {
        expireTeacherSession();
      }
    }
  }

  if (!teacherJwt) {
    return (
      <main className="auth-shell">
        <form className="auth-panel" onSubmit={handleTeacherLogin}>
          <div className="panel-title">
            <ShieldCheck size={20} />
            <h1>Login Guru</h1>
          </div>
          <label>
            <span>Username</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="admin123"
            />
          </label>
          {authError ? <p className="error-text">{authError}</p> : null}
          <button className="primary-button full" disabled={authLoading} type="submit">
            {authLoading ? "Memproses..." : "Masuk"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="teacher-shell">
      <header className="teacher-topbar">
        <div>
          <p className="eyebrow">UI Guru</p>
          <h1>Kontrol Asesmen Sinkron</h1>
        </div>
        <div className="live-pill">
          <Radio size={16} />
          Session {session?.code ?? "belum dibuat"}
        </div>
        {session ? (
          <div className={session.assessment_finished ? "live-pill status-ok" : "live-pill status-warn"}>
            {session.assessment_finished ? "Asesmen selesai" : session.started_at ? "Siswa mulai" : "Menunggu siswa"}
          </div>
        ) : null}
        <div className="live-pill">
          Exp {formatExpiry(teacherJwt)}
        </div>
        <Link className="nav-button" href="/teacher/students/">
          Daftar siswa
        </Link>
        <Link className="nav-button" href="/teacher/content/">
          Konten asesmen
        </Link>
        <button className="nav-button" onClick={logoutTeacher} type="button">
          <LogOut size={16} />
          Logout
        </button>
      </header>

      <section className="teacher-grid">
        <div className="teacher-column primary">
          <section className="panel shadow-panel">
            <div className="panel-title">
              <BookOpen size={18} />
              <h2>Shadow preview siswa</h2>
              <div
                key={pulseKey}
                className={activeRenderedAck ? "render-pulse active" : "render-pulse waiting"}
                title="Status render soal di perangkat siswa"
              >
                <span className="pulse-dot" />
                <strong>{activeRenderedAck ? "Tampil di siswa" : "Menunggu siswa"}</strong>
                <em>
                  {activeRenderedAck
                    ? `Seq ${activeRenderedAck.sequence} diterima`
                    : `Seq ${session?.active_sequence ?? "-"}`}
                </em>
              </div>
            </div>
            {session ? (
              <StudentStimulus
                instructionText={session.active_instruction_text}
                preview
                questionId={session.active_question_id}
                questionText={session.active_question_text}
              />
            ) : (
              <div className="stimulus preview">Memuat sesi...</div>
            )}
            <div className="ack-grid">
              <span className="ack ok">Tablet aktif</span>
              <span className={activeRenderedAck ? "ack ok pulse-ack" : "ack warn"}>
                {activeRenderedAck ? "Soal berubah di siswa" : "Menunggu render"}
              </span>
              <span className="ack warn">Latency 24 ms</span>
              <span className={session?.fullscreen_active ? "ack ok" : "ack warn"}>
                {session?.fullscreen_active ? "Fullscreen aktif" : "Belum fullscreen"}
              </span>
              <span key={feelingPulseKey} className={activeFeeling ? "ack ok pulse-ack" : "ack warn"}>
                {activeFeeling ? `Perasaan: ${activeFeeling}` : "Belum ada respons"}
              </span>
            </div>
          </section>
        </div>

        <aside className="teacher-column sidebar">
          <section className="panel control-panel">
            <div className="panel-title">
              <ClipboardCheck size={18} />
              <h2>Panel kontrol</h2>
            </div>
            <div className="token-box">
              <label>
                <span>Nama siswa</span>
                <select
                  disabled={assessmentLocked}
                  value={studentId}
                  onChange={(event) => {
                    const id = event.target.value;
                    setStudentId(id);
                    const selectedStudent = students.find((student) => student.id === id);
                    if (selectedStudent) setStudentName(selectedStudent.name);
                  }}
                >
                  {students.length === 0 ? (
                    <option value="">Belum ada data siswa</option>
                  ) : (
                    students.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              {assessmentLocked ? (
                <span className="detail-link disabled-link">Siswa terkunci</span>
              ) : (
                <Link className="detail-link compact-icon-link" href="/teacher/students/new/" title="Tambah siswa baru" aria-label="Tambah siswa baru">
                  <UserPlus size={17} />
                </Link>
              )}
              <button
                className="primary-button full"
                disabled={students.length === 0 || assessmentLocked}
                onClick={handleGenerateStudentToken}
                title="Generate token siswa"
                aria-label="Generate token siswa"
                type="button"
              >
                <UserPlus size={17} />
                Token
              </button>
              {studentToken ? (
                <div className="student-token">
                  <span>Kode token siswa</span>
                  <strong>{studentToken.code}</strong>
                  <em>Session {studentToken.session.code}</em>
                </div>
              ) : null}
            </div>
            <label className="compact-label">
              <span>Kategori soal</span>
              <select
                disabled={controlsDisabled}
                value={activeCategory}
                onChange={(event) => handleCategoryChange(event.target.value as AssessmentCategory)}
              >
                {assessmentCategories.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="assessment-meta">
              <span>{categoryLabel(activeCategory)}</span>
              <strong>{hasActiveCategoryQuestion ? `${activeItem.item_code} - ${activeItem.title}` : "Tidak ada soal aktif"}</strong>
            </div>
            <div className="question-nav" aria-label="Navigasi soal kategori aktif">
              {categoryItems.map((item, index) => (
                <button
                  className={index === selectedQuestion ? "question-nav-button active" : "question-nav-button"}
                  disabled={questionControlsDisabled}
                  key={item.id}
                  onClick={() => goToQuestion(index)}
                  title={`${item.item_code} - ${item.title}`}
                  type="button"
                >
                  {index + 1}
                </button>
              ))}
              {categoryItems.length === 0 ? <span className="muted">Tidak ada soal aktif pada kategori ini.</span> : null}
            </div>
            <div className="button-row">
              <button
                disabled={questionControlsDisabled}
                onClick={() => goToQuestion(selectedQuestion - 1)}
                title="Soal sebelumnya"
                aria-label="Soal sebelumnya"
                type="button"
              >
                <ArrowLeft size={17} />
              </button>
              <button
                disabled={questionControlsDisabled}
                className="primary-button"
                onClick={() => goToQuestion(selectedQuestion + 1)}
                title="Soal berikutnya"
                aria-label="Soal berikutnya"
                type="button"
              >
                <ArrowRight size={17} />
              </button>
            </div>
            <button
              className="full"
              disabled={controlsDisabled}
              onClick={toggleStudentSidePanel}
              title={session?.hide_student_side ? "Tampilkan panel siswa" : "Sembunyikan preview/status siswa"}
              aria-label={session?.hide_student_side ? "Tampilkan panel siswa" : "Sembunyikan preview/status siswa"}
              type="button"
            >
              {session?.hide_student_side ? <Eye size={17} /> : <EyeOff size={17} />}
            </button>
            <button
              className="full"
              disabled={controlsDisabled || Boolean(session?.fullscreen_active)}
              onClick={requestStudentFullscreen}
              title={session?.fullscreen_active ? "Siswa sudah fullscreen" : "Minta fullscreen siswa"}
              aria-label={session?.fullscreen_active ? "Siswa sudah fullscreen" : "Minta fullscreen siswa"}
              type="button"
            >
              <Maximize2 size={17} />
            </button>
          </section>

          <section className="panel scoring-panel">
            <div className="panel-title">
              <Check size={18} />
              <h2>Penilaian</h2>
            </div>
            {!hasActiveCategoryQuestion ? <p className="muted">Aktifkan minimal satu soal pada kategori ini.</p> : null}
            {hasActiveCategoryQuestion && activeItem.scoring_mode === "teacher_rubric" ? (
              <>
                <ScoreInput
                  label="Kelancaran"
                  disabled={controlsDisabled}
                  value={fluency}
                  onChange={(value) => recordScoreChange("fluency", value)}
                />
                <ScoreInput
                  label="Akurasi"
                  disabled={controlsDisabled}
                  value={accuracy}
                  onChange={(value) => recordScoreChange("accuracy", value)}
                />
                <ScoreInput
                  label="Kepercayaan diri"
                  disabled={controlsDisabled}
                  value={confidence}
                  onChange={(value) => recordScoreChange("confidence", value)}
                />
                <div className="score-total">
                  <span>Total</span>
                  <strong>{total}/30</strong>
                </div>
              </>
            ) : null}
            {hasActiveCategoryQuestion && activeItem.scoring_mode === "binary" ? (
              <div className="button-row">
                <button
                  disabled={controlsDisabled}
                  onClick={() => recordBinaryScore(false)}
                  title="Salah"
                  aria-label="Salah"
                  type="button"
                >
                  <X size={17} />
                </button>
                <button
                  className="primary-button"
                  disabled={controlsDisabled}
                  onClick={() => recordBinaryScore(true)}
                  title="Benar"
                  aria-label="Benar"
                  type="button"
                >
                  <Check size={17} />
                </button>
              </div>
            ) : null}
            {hasActiveCategoryQuestion && activeItem.scoring_mode === "system" ? (
              <div className="system-score-box">
                <span>Skor dihitung sistem dari urutan blok kata siswa.</span>
                <strong>Kunci: {activeItem.correct_answer ?? "-"}</strong>
              </div>
            ) : null}
            {hasActiveCategoryQuestion && activeItem.scoring_mode === "upload" ? (
              <label className="upload-control">
                <span>Foto tulisan siswa</span>
                <input
                  disabled={controlsDisabled}
                  type="file"
                  accept="image/*"
                  onChange={(event) => recordWritingUpload(event.target.files?.[0]?.name ?? "")}
                />
              </label>
            ) : null}
          </section>

          <section className="panel notes-panel">
            <div className="panel-title">
              <FileText size={18} />
              <h2>Catatan</h2>
            </div>
            <div className="suggestion-row" aria-label="Saran catatan">
              {noteSuggestions.map((suggestion) => (
                <button
                  className="suggestion-button"
                  disabled={controlsDisabled || note.includes(suggestion.text)}
                  key={suggestion.label}
                  onClick={() => addNoteSuggestion(suggestion.text)}
                  title={suggestion.text}
                  type="button"
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
            <textarea disabled={controlsDisabled} value={note} onChange={(event) => recordNoteChange(event.target.value)} />
            <button className="primary-button full" disabled={controlsDisabled} onClick={handleSaveAssessment}>
              <Save size={17} /> Simpan nilai dan catatan
            </button>
            <button className="full danger-button" disabled={!session || Boolean(session.assessment_finished)} onClick={handleFinishAssessment}>
              Selesaikan asesmen
            </button>
            <p className="save-state">{saveState}</p>
          </section>
        </aside>

        <section className="panel camera-panel">
          <div className="panel-title">
            <Camera size={18} />
            <h2>Preview kamera dan posisi</h2>
          </div>
          <div className="camera-teacher-grid">
            <CameraPositionCard compact />
            <div className="camera-metrics">
              <div className="metric-row">
                <span>Recording</span>
                <strong>Standby</strong>
              </div>
              <div className="metric-row">
                <span>FPS target</span>
                <strong>90</strong>
              </div>
              <div className="metric-row">
                <span>Face quality</span>
                <strong>Valid</strong>
              </div>
              <div className="metric-row">
                <span>ML</span>
                <strong>Belakangan</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="panel timeline-panel">
          <div className="panel-title">
            <Radio size={18} />
            <h2>Timeline sesi</h2>
          </div>
          <div className="timeline-list">
            {timeline.length === 0 ? (
              <p className="muted">Belum ada event.</p>
            ) : (
              timeline.map((event, index) => (
                <div className="timeline-item" key={`${event.event_type}-${event.t_ms}-${index}`}>
                  <span>{event.event_type}</span>
                  <strong>Seq {event.sequence}</strong>
                  <em>{event.t_ms.toFixed(0)} ms</em>
                </div>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function ScoreInput({
  label,
  disabled,
  value,
  onChange
}: {
  label: string;
  disabled?: boolean;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="score-input">
      <span>{label}</span>
      <input
        type="range"
        disabled={disabled}
        min="0"
        max="10"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <strong>{value}</strong>
    </label>
  );
}

function parseTimelinePayload(payload: string) {
  try {
    return JSON.parse(payload) as Record<string, string>;
  } catch {
    return {};
  }
}

function itemDisplayText(item: AssessmentItem) {
  const stimulus = item.stimulus.trim();
  if (!stimulus) return item.prompt;
  return `${item.prompt}\n${stimulus}`;
}
