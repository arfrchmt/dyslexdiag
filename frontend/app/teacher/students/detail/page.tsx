"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, Download, FileText, FileVideo, Gauge, NotebookText, Printer, X } from "lucide-react";

import { assessmentCategories, fetchAssessmentItems, type AssessmentItem } from "@/lib/assessmentContent";
import { apiBase } from "@/lib/session";
import { fetchStudentDetail, statusLabel, type StudentDetail, type StudentVideoRecord } from "@/lib/students";

type DetailSortKey = "sequence_asc" | "date_desc" | "date_asc" | "session_asc" | "session_desc";

export default function StudentDetailPage() {
  const [student, setStudent] = useState<StudentDetail | null>(null);
  const [assessmentItems, setAssessmentItems] = useState<AssessmentItem[]>([]);
  const [sessionFilter, setSessionFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [sortKey, setSortKey] = useState<DetailSortKey>("sequence_asc");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [clientReady, setClientReady] = useState(false);
  const [activeVideo, setActiveVideo] = useState<StudentVideoRecord | null>(null);

  useEffect(() => {
    let mounted = true;
    setClientReady(true);
    setLoading(true);
    const token = window.localStorage.getItem("teacher-jwt") ?? "";
    const id = new URLSearchParams(window.location.search).get("id") ?? "";
    if (!token) {
      setError("Login guru diperlukan untuk membuka detail siswa.");
      setLoading(false);
      return;
    }
    if (!id) {
      setError("ID siswa tidak ditemukan.");
      setLoading(false);
      return;
    }
    Promise.race([
      fetchStudentDetail(token, id),
      new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("Timeout mengambil detail siswa")), 12000))
    ])
      .then((detail) => {
        if (!mounted) return;
        setStudent(detail);
        setSessionFilter(detail.sessions[0]?.code ?? "all");
      })
      .catch((fetchError) => {
        if (!mounted) return;
        setError(fetchError instanceof Error ? fetchError.message : "Gagal mengambil detail siswa");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    fetchAssessmentItems(token)
      .then((items) => {
        if (mounted) setAssessmentItems(items);
      })
      .catch(() => {
        if (mounted) setAssessmentItems([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const selectedSession = useMemo(() => {
    if (!student) return null;
    if (sessionFilter === "all") return null;
    return student.sessions.find((session) => session.code === sessionFilter) ?? null;
  }, [sessionFilter, student]);

  const visibleQuestions = useMemo(() => {
    if (!student) return [];
    return student.questions
      .filter((question) => {
        const sessionMatches = sessionFilter === "all" || question.session_code === sessionFilter;
        const dateMatches = !dateFilter || normalizeDateValue(question.session_date) === dateFilter;
        return sessionMatches && dateMatches;
      })
      .sort((left, right) => compareQuestions(left, right, sortKey));
  }, [dateFilter, sessionFilter, sortKey, student]);
  const insight = useMemo(() => buildQuestionInsight(visibleQuestions), [visibleQuestions]);

  const summary = selectedSession ?? {
    code: student?.session_code ?? "-",
    session_date: student?.session_date ?? null,
    status: student?.status ?? "belum",
    total_score: student?.total_score ?? 0,
    max_score: student?.max_score ?? 30
  };

  function printCurrentView() {
    window.print();
  }

  function exportExcel() {
    if (!student) return;
    const lines = [
      ["Siswa", student.name].join(","),
      ["Filter kode sesi", sessionFilter === "all" ? "semua" : sessionFilter].join(","),
      ["Filter tanggal", dateFilter || "semua"].join(","),
      ["Sort", sortKey].join(","),
      "",
      ["Kode sesi", "Tanggal", "Status", "Nilai total"].join(","),
      ...student.sessions.map((session) =>
        [
          session.code,
          formatDetailDate(session.session_date),
          statusLabel(session.status),
          `${session.total_score}/${session.max_score}`
        ].map(csvCell).join(",")
      ),
      "",
      ["Sesi", "Tanggal", "Seq", "Kode soal", "Contoh", "Soal aktif", "Nilai", "Perasaan", "Durasi", "Jumlah klik", "Komponen diklik", "Clickstream JSON", "Catatan", "Prompt"].join(","),
      ...visibleQuestions.map((question) =>
        [
          question.session_code,
          formatDetailDate(question.session_date),
          String(question.sequence),
          question.question_id,
          question.is_example ? "contoh" : "asli",
          question.question_active ? "aktif" : "nonaktif",
          `${question.score}/${question.max_score}`,
          question.feeling || "",
          formatQuestionDuration(question.duration_ms),
          String(question.click_count ?? 0),
          (question.clicked_components ?? []).join(" | "),
          JSON.stringify(question.clickstream ?? []),
          question.note || "",
          question.prompt || ""
        ].map(csvCell).join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `detail-${student.name.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function openClickstreamAnalytics() {
    if (!student) return;
    const session = sessionFilter === "all" ? student.sessions[0]?.code : sessionFilter;
    if (!session) return;
    const params = new URLSearchParams({ id: student.id, session });
    window.open(`/teacher/students/clickstream/?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  if (!clientReady) {
    return (
      <main className="teacher-shell">
        <p className="muted">Memuat detail siswa...</p>
      </main>
    );
  }

  return (
    <main className="teacher-shell">
      <header className="teacher-topbar">
        <div>
          <p className="eyebrow">Detail siswa</p>
          <h1>{student?.name ?? "Memuat siswa"}</h1>
        </div>
        <a className="nav-button" href="/teacher/students/">
          <ArrowLeft size={16} />
          Daftar siswa
        </a>
      </header>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="muted">Memuat detail siswa...</p> : null}
      {!loading && !error && !student ? <p className="error-text">Data siswa tidak ditemukan atau tidak dapat dimuat.</p> : null}

      {student ? (
        <>
          <section className="detail-grid">
            <section className="panel">
              <div className="panel-title">
                <Gauge size={18} />
                <h2>Ringkasan capaian</h2>
              </div>
              <div className="summary-grid">
                <div>
                  <span>Nilai total</span>
                  <strong>
                    {summary.total_score}/{summary.max_score}
                  </strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{statusLabel(summary.status)}</strong>
                </div>
                <div>
                  <span>Sesi</span>
                  <strong>{summary.code}</strong>
                </div>
                <div>
                  <span>Tanggal sesi</span>
                  <strong>{formatDetailDate(summary.session_date)}</strong>
                </div>
                <div>
                  <span>Kelas</span>
                  <strong>{student.grade_level ?? "-"}</strong>
                </div>
                <div>
                  <span>Asal sekolah</span>
                  <strong>{student.school_origin ?? "-"}</strong>
                </div>
              </div>
            </section>
          </section>

          <section className="panel detail-report-panel">
            <div className="panel-title">
              <FileText size={18} />
              <h2>Filter dan cetak capaian per soal</h2>
              <button className="detail-link panel-title-action" onClick={openClickstreamAnalytics} type="button">
                <BarChart3 size={16} />
                Analitik clickstream
              </button>
            </div>
            <div className="student-report-toolbar">
              <label>
                <span>Kode sesi</span>
                <select value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)}>
                  <option value="all">Semua sesi</option>
                  {student.sessions.map((session) => (
                    <option key={session.code} value={session.code}>
                      {session.code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Tanggal sesi</span>
                <input value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} type="date" />
              </label>
              <label>
                <span>Urutkan</span>
                <select value={sortKey} onChange={(event) => setSortKey(event.target.value as DetailSortKey)}>
                  <option value="sequence_asc">Nomor soal</option>
                  <option value="date_desc">Tanggal terbaru</option>
                  <option value="date_asc">Tanggal terlama</option>
                  <option value="session_asc">Kode sesi A-Z</option>
                  <option value="session_desc">Kode sesi Z-A</option>
                </select>
              </label>
              <button onClick={printCurrentView} type="button">
                <Printer size={16} />
                PDF
              </button>
              <button onClick={exportExcel} type="button">
                <Download size={16} />
                Excel
              </button>
            </div>
            <div className="print-summary">
              <strong>Data detail aktif</strong>
              <span>Filter kode sesi: {sessionFilter === "all" ? "semua" : sessionFilter} | Filter tanggal: {dateFilter || "semua"} | Sort: {sortKey}</span>
              <span>Total baris soal tampil: {visibleQuestions.length}</span>
            </div>
            <div className="detail-insight-grid">
              <div>
                <span>Skor asli</span>
                <strong>{insight.realScore}/{insight.realMax}</strong>
              </div>
              <div>
                <span>Rata-rata</span>
                <strong>{insight.averageScore.toFixed(1)}</strong>
              </div>
              <div>
                <span>Durasi rata-rata</span>
                <strong>{formatQuestionDuration(insight.averageDurationMs)}</strong>
              </div>
              <div>
                <span>Soal contoh</span>
                <strong>{insight.exampleCount}</strong>
              </div>
            </div>
            <div className="chart-grid" aria-label="Grafik capaian per soal">
              {visibleQuestions.slice(0, 18).map((question) => (
                <div className="chart-row" key={`${question.session_code}-${question.sequence}-${question.question_id}`}>
                  <span>{question.is_example ? "C" : question.question_id}</span>
                  <div>
                    <i style={{ width: `${Math.min(100, (question.score / Math.max(1, question.max_score)) * 100)}%` }} />
                  </div>
                  <strong>{question.score}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <NotebookText size={18} />
              <h2>Capaian per soal</h2>
            </div>
            <div className="achievement-list">
              {student.questions.length === 0 || visibleQuestions.length === 0 ? (
                <p className="muted">Belum ada data soal pada filter ini.</p>
              ) : (
                visibleQuestions.map((question) => (
                  <article className="achievement-item" key={`${question.sequence}-${question.question_id}`}>
                    <div>
                      <span>{question.is_example ? "Contoh" : question.question_id}</span>
                      <strong>{question.prompt || `Soal ${question.sequence}`}</strong>
                    </div>
                    <div>
                      <span>Status soal</span>
                      <strong>{question.question_active ? "Aktif" : "Nonaktif"}</strong>
                    </div>
                    {question.videos.length > 0 ? (
                      <button
                        className="question-video-thumb"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setActiveVideo(question.videos[0]);
                        }}
                        title={`Buka video ${question.videos[0].label}`}
                        type="button"
                      >
                        <video muted playsInline preload="metadata" src={mediaUrl(question.videos[0].source)} tabIndex={-1} />
                        <span>Video</span>
                        <strong>
                          {question.videos.length} file - {question.videos[0].source_device === "teacher" ? "guru" : "siswa"}
                        </strong>
                      </button>
                    ) : (
                      <div className="question-video-thumb">
                        <FileVideo size={20} />
                        <span>Video</span>
                        <strong>Belum ada</strong>
                      </div>
                    )}
                    <div>
                      <span>Nilai</span>
                      <strong>
                        {question.score}/{question.max_score}
                      </strong>
                    </div>
                    <div>
                      <span>Perasaan</span>
                      <strong>{question.feeling || "-"}</strong>
                    </div>
                    <div>
                      <span>Durasi</span>
                      <strong>{formatQuestionDuration(question.duration_ms)}</strong>
                    </div>
                    <div>
                      <span>Klik</span>
                      <strong>{question.click_count ?? 0}</strong>
                    </div>
                    <p>{question.note || "Belum ada catatan."}</p>
                  </article>
                ))
              )}
            </div>
          </section>
          {activeVideo ? (
            <div className="video-player-overlay" role="dialog" aria-modal="true" aria-label={`Video ${activeVideo.label}`}>
              <div className="video-player-panel">
                <div className="video-player-head">
                  <div>
                    <span>{activeVideo.label}</span>
                    <strong>{activeVideo.duration}</strong>
                  </div>
                  <button onClick={() => setActiveVideo(null)} title="Tutup video" aria-label="Tutup video" type="button">
                    <X size={18} />
                  </button>
                </div>
                <video controls autoPlay playsInline src={mediaUrl(activeVideo.source)} />
                <a className="detail-link" href={mediaUrl(activeVideo.source)} target="_blank" rel="noreferrer">
                  Buka file video
                </a>
              </div>
            </div>
          ) : null}
          <section className="print-only print-content-audit">
            <div className="panel-title">
              <FileText size={18} />
              <h2>Audit konten soal</h2>
            </div>
            {assessmentCategories.map((category) => (
              <div key={category.value}>
                <strong>{category.label}</strong>
                {assessmentItems
                  .filter((item) => item.category === category.value)
                  .map((item) => (
                    <p key={item.id}>
                      {item.item_code} | {item.title} | {item.scoring_mode} | {item.is_example ? "contoh" : "asli"} | {item.is_active ? "aktif" : "nonaktif"}
                    </p>
                  ))}
              </div>
            ))}
          </section>
        </>
      ) : null}
    </main>
  );
}

function formatQuestionDuration(durationMs?: number | null) {
  if (durationMs === null || durationMs === undefined) return "-";
  const seconds = Math.max(0, durationMs / 1000);
  return `${seconds.toFixed(1)} dtk`;
}

function formatDetailDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function normalizeDateValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function compareQuestions(
  left: StudentDetail["questions"][number],
  right: StudentDetail["questions"][number],
  sortKey: DetailSortKey
) {
  if (sortKey === "session_asc") return left.session_code.localeCompare(right.session_code) || left.sequence - right.sequence;
  if (sortKey === "session_desc") return right.session_code.localeCompare(left.session_code) || left.sequence - right.sequence;
  if (sortKey === "date_asc") return questionTime(left) - questionTime(right) || left.sequence - right.sequence;
  if (sortKey === "date_desc") return questionTime(right) - questionTime(left) || left.sequence - right.sequence;
  return left.sequence - right.sequence;
}

function questionTime(question: StudentDetail["questions"][number]) {
  if (!question.session_date) return 0;
  const time = new Date(question.session_date).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function mediaUrl(source: string) {
  if (/^https?:\/\//i.test(source)) return source;
  return `${apiBase}${source}`;
}

function buildQuestionInsight(questions: StudentDetail["questions"]) {
  const realQuestions = questions.filter((question) => !question.is_example);
  const realScore = realQuestions.reduce((sum, question) => sum + question.score, 0);
  const realMax = realQuestions.reduce((sum, question) => sum + question.max_score, 0);
  const durations = questions
    .map((question) => question.duration_ms)
    .filter((duration): duration is number => typeof duration === "number");
  return {
    realScore,
    realMax,
    averageScore: realQuestions.length > 0 ? realScore / realQuestions.length : 0,
    averageDurationMs: durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
    exampleCount: questions.length - realQuestions.length
  };
}
