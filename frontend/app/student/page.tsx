"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Clock, Eye, EyeOff, LogOut, Maximize2, MousePointerClick, Save, UserRound, Wifi } from "lucide-react";

import { CameraPositionCard } from "@/components/CameraPositionCard";
import { StudentStimulus } from "@/components/StudentStimulus";
import {
  fetchSession,
  formatExpiry,
  isJwtExpired,
  sendAcknowledgment,
  studentLogin,
  updateStudentStatus,
  type SessionState
} from "@/lib/session";

const feelingOptions = [
  { value: "senang", icon: "🙂", label: "Senyum" },
  { value: "netral", icon: "😐", label: "Netral" },
  { value: "sedih", icon: "🙁", label: "Sedih" },
  { value: "menangis", icon: "😢", label: "Menangis" },
  { value: "pusing", icon: "😵", label: "Pusing" }
];

type WordBlock = {
  id: number;
  word: string;
};

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
  const [assembledWordIndexes, setAssembledWordIndexes] = useState<number[]>([]);
  const [shuffledWordBlocks, setShuffledWordBlocks] = useState<WordBlock[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [clicks, setClicks] = useState(0);
  const [saved, setSaved] = useState("Tersimpan lokal");
  const lastAcknowledgedSequence = useRef<number | null>(null);

  useEffect(() => {
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
        setSession(state);
        if (lastAcknowledgedSequence.current !== state.active_sequence) {
          lastAcknowledgedSequence.current = state.active_sequence;
          await sendAcknowledgment(sessionCode, studentJwt, state.active_sequence, "QUESTION_RENDERED", {
            pageVisible: document.visibilityState === "visible",
            assetStatus: "READY",
            questionId: state.active_question_id
          });
        }
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
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [studentJwt, sessionCode]);

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("student-feeling-drafts", JSON.stringify(feelingDrafts));
  }, [feelingDrafts]);

  useEffect(() => {
    if (!session) return;
    setSelectedFeeling(feelingDrafts[session.active_question_id] ?? "");
    setAssembledWordIndexes([]);
    setShuffledWordBlocks(getAnswerBlocksForQuestion(session));
  }, [session?.active_question_id, session?.active_options.join("\u0001")]);

  const duration = useMemo(() => {
    const minutes = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const rest = (seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${rest}`;
  }, [seconds]);

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
    await sendAcknowledgment(sessionCode, studentJwt, session.active_sequence, "STUDENT_SYSTEM_SCORE", {
      questionId: session.active_question_id,
      answer,
      expected,
      score
    });
    setSaved(score > 0 ? "Jawaban benar" : "Jawaban tersimpan");
  }

  function selectWordBlock(index: number) {
    if (assembledWordIndexes.includes(index)) return;
    const nextIndexes = [...assembledWordIndexes, index];
    setAssembledWordIndexes(nextIndexes);
    if (nextIndexes.length === (session?.active_options.length ?? 0)) {
      submitSystemAnswer(nextIndexes).catch(() => setSaved("Tersimpan lokal"));
    }
  }

  function removeWordBlock(slotIndex: number) {
    setAssembledWordIndexes((indexes) => indexes.filter((_, index) => index !== slotIndex));
  }

  function resetSystemAnswer() {
    if (!session) return;
    setAssembledWordIndexes([]);
    setShuffledWordBlocks(getAnswerBlocksForQuestion(session));
  }

  function expireStudentSession() {
    window.localStorage.removeItem("student-jwt");
    window.localStorage.removeItem("student-session-code");
    setStudentJwt("");
    setSessionCode("");
    setSession(null);
    setLoginError("Sesi siswa expired. Masukkan token baru dari guru.");
  }

  function logoutStudent() {
    window.localStorage.removeItem("student-jwt");
    window.localStorage.removeItem("student-session-code");
    setStudentJwt("");
    setSessionCode("");
    setSession(null);
    setStudentCode("");
    setSelectedFeeling("");
    lastAcknowledgedSequence.current = null;
  }

  async function enterFullscreen() {
    setFullscreenMessage("");
    if (!document.fullscreenEnabled) {
      setFullscreenMessage("Browser/perangkat tidak mengizinkan fullscreen.");
      return;
    }

    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
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
    <main className="student-shell" onClick={() => setClicks((value) => value + 1)}>
      <header className="student-topbar">
        <div>
          <p className="eyebrow">UI Siswa</p>
          <h1>Sesi Asesmen Membaca</h1>
        </div>
        <div className="status-strip">
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

      {fullscreenMessage ? <p className="error-text fullscreen-error">{fullscreenMessage}</p> : null}
      {session?.assessment_finished ? (
        <section className="fullscreen-request">
          <strong>Asesmen sudah diselesaikan guru.</strong>
        </section>
      ) : null}

      <section className={hideSidePanel ? "student-grid side-hidden" : "student-grid"}>
        <div className="student-main">
          {session ? (
            <>
              <StudentStimulus
                instructionText={session.active_instruction_text}
                questionId={session.active_question_id}
                questionText={session.active_question_text}
              />
              {session.active_scoring_mode === "system" && session.active_options.length > 0 ? (
                <section className="response-panel block-answer-panel">
                  <span>{session.active_instruction_text}</span>
                  <div className="answer-slot-row">
                    {session.active_options.map((_, slotIndex) => {
                      const wordIndex = assembledWordIndexes[slotIndex];
                      const word = typeof wordIndex === "number" ? session.active_options[wordIndex] : "";
                      return (
                        <button
                          className={word ? "answer-slot filled" : "answer-slot"}
                          disabled={!word || Boolean(session.assessment_finished)}
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
                        className={assembledWordIndexes.includes(id) ? "word-block used" : "word-block"}
                        disabled={assembledWordIndexes.includes(id) || Boolean(session.assessment_finished)}
                        key={`${word}-${id}`}
                        onClick={() => selectWordBlock(id)}
                        type="button"
                      >
                        {word}
                      </button>
                    ))}
                  </div>
                  <button
                    className="full"
                    disabled={assembledWordIndexes.length === 0 || Boolean(session.assessment_finished)}
                    onClick={resetSystemAnswer}
                    type="button"
                  >
                    Ulangi
                  </button>
                </section>
              ) : null}
            </>
          ) : (
            <div className="stimulus">Memuat sesi...</div>
          )}

          <section className="response-panel">
            <span>Perasaan saat membaca soal ini</span>
            <div className="feeling-grid">
              {feelingOptions.map((feeling) => (
                <button
                  aria-label={feeling.label}
                  className={selectedFeeling === feeling.value ? "feeling-button selected" : "feeling-button"}
                  disabled={Boolean(session?.assessment_finished)}
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
            <CameraPositionCard />
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
              <button className="full" onClick={logoutStudent} type="button">
                <LogOut size={17} />
                Logout siswa
              </button>
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
