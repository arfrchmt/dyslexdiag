"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BarChart3, Download, Eye, FileText, FileVideo, Gauge, Map, MoreHorizontal, NotebookText, Printer, Route, ScanEye, X } from "lucide-react";

import { assessmentCategories, fetchAssessmentItems, type AssessmentItem } from "@/lib/assessmentContent";
import { StudentStimulus } from "@/components/StudentStimulus";
import { apiBase } from "@/lib/session";
import { analyzeEyeTracker, fetchStudentDetail, statusLabel, type StudentDetail, type StudentVideoRecord } from "@/lib/students";

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
  const [activeHeatmap, setActiveHeatmap] = useState<StudentDetail["questions"][number] | null>(null);
  const [activeCalibration, setActiveCalibration] = useState<StudentDetail["questions"][number] | null>(null);
  const [eyeView, setEyeView] = useState<"heatmap" | "trajectory">("heatmap");
  const [eyeSource, setEyeSource] = useState<"model" | "webgazer">("model");
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);
  const [activeNote, setActiveNote] = useState<StudentDetail["questions"][number] | null>(null);

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

  function openEyeReview(question: StudentDetail["questions"][number], source: "model" | "webgazer", view: "heatmap" | "trajectory") {
    const key = `eye-review-${Date.now()}`;
    window.localStorage.setItem(key, JSON.stringify({ question, source, view }));
    window.open(`/teacher/students/eye-review?key=${encodeURIComponent(key)}`, "_blank", "noopener,noreferrer");
    setOpenActionMenu(null);
  }

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
                      <strong>{question.prompt ? <EyeOptionContent value={question.prompt} /> : `Soal ${question.sequence}`}</strong>
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
                    <table className="achievement-metrics"><tbody>
                      <tr><th>Nilai</th><td>{question.score}/{question.max_score}</td><th>Perasaan</th><td>{question.feeling || "-"}</td></tr>
                      <tr><th>Durasi</th><td>{formatQuestionDuration(question.duration_ms)}</td><th>Klik</th><td>{question.click_count ?? 0}</td></tr>
                      <tr><th>Fixation ML</th><td>{question.eye_tracking?.fixation_count ?? 0}</td><th>Regresi ML</th><td>{question.eye_tracking?.regression_count ?? 0}</td></tr>
                      <tr><th>Saccade ML</th><td>{question.eye_tracking?.saccade_count ?? 0}</td><th>Stdev pupil</th><td>{question.eye_tracking?.pupil_size_stddev != null ? question.eye_tracking.pupil_size_stddev.toFixed(2) : "-"}</td></tr>
                      <tr><th>Blink rate</th><td>{question.eye_tracking?.blink_rate != null ? `${question.eye_tracking.blink_rate.toFixed(1)}/mnt` : "-"}</td><th>Fixation WebGazer</th><td>{question.eye_tracking_webgazer?.fixation_count ?? 0}</td></tr>
                      <tr><th>Regresi WebGazer</th><td>{question.eye_tracking_webgazer?.regression_count ?? 0}</td><th>Saccade WebGazer</th><td>{question.eye_tracking_webgazer?.saccade_count ?? 0}</td></tr>
                      <tr><th>Mean fixation</th><td>{question.eye_tracking_webgazer?.mean_fixation_duration != null ? `${question.eye_tracking_webgazer.mean_fixation_duration.toFixed(2)} dtk` : "-"}</td><th>Total fixation</th><td>{question.eye_tracking_webgazer?.total_fixation_duration != null ? `${question.eye_tracking_webgazer.total_fixation_duration.toFixed(2)} dtk` : "-"}</td></tr>
                      <tr><th>Revisit</th><td>{question.eye_tracking_webgazer?.revisit_count ?? 0}</td><th>Transisi AOI</th><td>{question.eye_tracking_webgazer?.aoi_transition_count ?? 0}</td></tr>
                      <tr><th>Dwell stimulus</th><td>{question.eye_tracking_webgazer?.dwell_time_stimulus != null ? `${question.eye_tracking_webgazer.dwell_time_stimulus.toFixed(2)} dtk` : "-"}</td><th>Dwell pilihan</th><td>{question.eye_tracking_webgazer?.dwell_time_options != null ? `${question.eye_tracking_webgazer.dwell_time_options.toFixed(2)} dtk` : "-"}</td></tr>
                      <tr><th>Response time</th><td>{question.eye_tracking_webgazer?.response_time_ms != null ? `${(question.eye_tracking_webgazer.response_time_ms / 1000).toFixed(2)} dtk` : "-"}</td><th>Correctness</th><td>{question.eye_tracking_webgazer?.correctness == null ? "-" : question.eye_tracking_webgazer.correctness}</td></tr>
                    </tbody></table>
                    <div className="achievement-actions" role="tablist" aria-label="Menu detail soal">
                      <div className="achievement-action-menu">
                        <button className="action-menu-trigger" role="tab" aria-expanded={openActionMenu === `${question.session_code}-${question.sequence}`} aria-label="Eye Tracker" onClick={() => setOpenActionMenu(openActionMenu === `${question.session_code}-${question.sequence}` ? null : `${question.session_code}-${question.sequence}`)} type="button"><Eye size={16} /><span className="action-label">Eye Tracker</span><ArrowRight size={16} /></button>
                        {openActionMenu === `${question.session_code}-${question.sequence}` ? <div className="action-menu-list">
                          <button disabled={analyzing === question.sequence || question.videos.length === 0} type="button" onClick={async () => { if (!student) return; setAnalyzing(question.sequence); try { await analyzeEyeTracker(student.id, question.session_code, question.sequence, window.localStorage.getItem("teacher-jwt") ?? ""); window.location.reload(); } catch (error) { setError(error instanceof Error ? error.message : "Analisis gagal"); } finally { setAnalyzing(null); } }}><ScanEye size={16} />{analyzing === question.sequence ? "Menganalisis..." : "Analisis eyetracker"}</button>
                          <button type="button" onClick={() => { setActiveCalibration(question); setOpenActionMenu(null); }}><Gauge size={16} />Hasil kalibrasi</button>
                          <button type="button" onClick={() => openEyeReview(question, "model", "heatmap")}><Map size={16} />Heatmap ML</button>
                          <button type="button" onClick={() => openEyeReview(question, "webgazer", "heatmap")}><Map size={16} />Heatmap WebGazer</button>
                          <button type="button" onClick={() => openEyeReview(question, "webgazer", "trajectory")}><Route size={16} />Trajektori WebGazer</button>
                          <button type="button" onClick={() => { downloadEyeData(question, eyeSource); setOpenActionMenu(null); }}><Download size={16} />Download CSV</button>
                        </div> : null}
                      </div>
                      <button className="note-button" role="tab" type="button" onClick={() => setActiveNote(question)}><FileText size={15} />Catatan <ArrowRight size={14} /></button>
                    </div>
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
          {activeHeatmap ? (
            <div className="video-player-overlay" role="dialog" aria-modal="true" aria-label="Eye heatmap">
              <div className="video-player-panel gaze-review-panel">
                <div className="video-player-head"><div><span>{eyeView === "heatmap" ? "Eye heatmap" : "Trajektori eye gaze"} - {eyeSource === "webgazer" ? "WebGazer" : "ML"}</span><strong>{activeHeatmap.question_id}</strong></div><button onClick={() => setActiveHeatmap(null)} aria-label="Tutup" type="button"><X size={18} /></button></div>
                <div className="student-shell gaze-replay-screen" style={{ position: "relative", minHeight: 0, padding: 12, overflow: "auto", background: "#eeeae1" }}>
                  <header className="student-topbar" style={{ position: "relative" }}><div><p className="eyebrow">UI Siswa</p><strong>Asesmen Membaca</strong></div><div className="status-strip"><span>Siswa</span><span>Terhubung</span><span>Fullscreen aktif</span></div></header>
                  <div style={{ position: "relative", margin: "12px auto", width: "100%" }}><div style={{ position: "relative", zIndex: 1 }}><StudentStimulus questionId={activeHeatmap.question_id} questionText={activeHeatmap.prompt || `Soal ${activeHeatmap.sequence}`} instructionText={assessmentItems.find((item) => item.item_code === activeHeatmap.question_id)?.instruction_text} /></div></div>
                  <section className="response-panel feeling-panel"><p className="eyebrow">Feedback perasaan</p><div className="feeling-grid"><button className="feeling-button" type="button">😊</button><button className="feeling-button" type="button">😐</button><button className="feeling-button" type="button">😟</button></div></section>
                  {(assessmentItems.find((item) => item.item_code === activeHeatmap.question_id)?.options ?? []).length > 0 ? <section className="response-panel multiple-choice-panel"><p className="eyebrow">Pilihan jawaban</p><div className="multiple-choice-grid">{(assessmentItems.find((item) => item.item_code === activeHeatmap.question_id)?.options ?? []).map((option) => <div className="multiple-choice-option" key={option}><EyeOptionContent value={option} /></div>)}</div></section> : null}
                  {((eyeSource === "webgazer" ? activeHeatmap.eye_tracking_webgazer?.heatmap : activeHeatmap.eye_tracking?.heatmap) ?? []).length === 0 ? <p className="muted" style={{ textAlign: "center" }}>Belum ada koordinat gaze. Jalankan Analisis eyetracker terlebih dahulu.</p> : null}
                  <svg className="gaze-review-layer" aria-label={eyeView === "heatmap" ? "Heatmap perhatian mata" : "Lintasan mata"} viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet">
                    <defs><marker id="gaze-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
                    {eyeView === "trajectory" ? <TrajectoryArrows points={(eyeSource === "webgazer" ? activeHeatmap.eye_tracking_webgazer?.trajectory : activeHeatmap.eye_tracking?.trajectory) ?? []} /> : null}
                    {eyeView === "heatmap" ? (((eyeSource === "webgazer" ? activeHeatmap.eye_tracking_webgazer?.heatmap : activeHeatmap.eye_tracking?.heatmap) ?? []).map((point, index) => <circle key={index} cx={(point.viewport_x ?? point.x) * 1000} cy={(point.viewport_y ?? point.y) * 1000} r={24 + (point.intensity ?? .5) * 35} />)) : null}
                    {eyeView === "trajectory" ? ((activeHeatmap.eye_tracking_webgazer?.fixations ?? []).map((fixation) => <g key={fixation.index}><circle className="gaze-fixation-mark" cx={(fixation.viewport_x ?? fixation.x) * 1000} cy={(fixation.viewport_y ?? fixation.y) * 1000} r="12" /><text className="gaze-fixation-label" x={(fixation.viewport_x ?? fixation.x) * 1000} y={(fixation.viewport_y ?? fixation.y) * 1000 + 4} textAnchor="middle">{fixation.index}</text></g>)) : null}
                  </svg>
                </div>
              </div>
            </div>
          ) : null}
          {activeCalibration ? (
            <div className="video-player-overlay" role="dialog" aria-modal="true" aria-label="Hasil kalibrasi WebGazer">
              <div className="video-player-panel calibration-result-panel">
                <div className="video-player-head"><div><span>Hasil kalibrasi WebGazer</span><strong>{activeCalibration.session_code}</strong></div><button onClick={() => setActiveCalibration(null)} aria-label="Tutup" type="button"><X size={18} /></button></div>
                <CalibrationResult calibration={activeCalibration.webgazer_calibration} />
              </div>
            </div>
          ) : null}
          {activeNote ? (
            <div className="video-player-overlay" role="dialog" aria-modal="true" aria-label="Catatan soal">
              <div className="video-player-panel note-modal-panel">
                <div className="video-player-head"><div><span>Catatan soal</span><strong>{activeNote.question_id}</strong></div><button onClick={() => setActiveNote(null)} aria-label="Tutup catatan" type="button"><X size={18} /></button></div>
                <p className="note-modal-text">{activeNote.note || "Belum ada catatan."}</p>
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

function CalibrationResult({ calibration }: { calibration?: StudentDetail["questions"][number]["webgazer_calibration"] }) {
  const points = calibration?.points ?? [];
  const meanError = calibration?.mean_error_px;
  const quality = meanError == null ? "Belum dapat dinilai" : meanError <= 80 ? "Baik" : meanError <= 150 ? "Perlu perhatian" : "Tidak akurat";
  if (points.length === 0) {
    return <div className="calibration-empty"><strong>Belum ada audit kalibrasi untuk sesi ini.</strong><p>Data sesi lama tidak menyimpan target dan prediksi 9 titik. Jalankan sesi baru dan lakukan kalibrasi ulang.</p></div>;
  }
  return (
    <div className="calibration-result-content">
      <div className="calibration-summary">
        <div><span>Titik terekam</span><strong>{points.length}/9</strong></div>
        <div><span>Rata-rata miss</span><strong>{meanError == null ? "-" : `${meanError.toFixed(1)} px`}</strong></div>
        <div><span>Miss terbesar</span><strong>{calibration?.max_error_px == null ? "-" : `${calibration.max_error_px.toFixed(1)} px`}</strong></div>
        <div><span>Kualitas</span><strong>{quality}</strong></div>
      </div>
      <div className="calibration-map">
        <svg viewBox="0 0 1000 650" preserveAspectRatio="none" aria-label="Perbandingan target dan prediksi kalibrasi">
          {points.map((point) => {
            if (!point.target) return null;
            const tx = point.target.x * 1000;
            const ty = point.target.y * 650;
            const px = point.predicted ? Math.max(0, Math.min(1000, point.predicted.x * 1000)) : tx;
            const py = point.predicted ? Math.max(0, Math.min(650, point.predicted.y * 650)) : ty;
            return <g key={point.index}>
              {point.predicted ? <line x1={tx} y1={ty} x2={px} y2={py} className="calibration-error-line" /> : null}
              <circle cx={tx} cy={ty} r="20" className="calibration-target-mark" />
              <text x={tx} y={ty + 6} textAnchor="middle" className="calibration-point-label">{point.index}</text>
              {point.predicted ? <><line x1={px - 16} y1={py - 16} x2={px + 16} y2={py + 16} className="calibration-prediction-mark" /><line x1={px + 16} y1={py - 16} x2={px - 16} y2={py + 16} className="calibration-prediction-mark" /></> : null}
            </g>;
          })}
        </svg>
      </div>
      <div className="calibration-legend"><span><i className="target" />Target klik</span><span><i className="prediction" />Prediksi gaze</span><span>Garis = besar arah miss</span></div>
      <table className="calibration-point-table"><thead><tr><th>Titik</th><th>Miss</th><th>Sampel</th><th>Status</th></tr></thead><tbody>{points.map((point) => <tr key={point.index}><td>{point.index}</td><td>{point.error_px == null ? "Tidak terbaca" : `${point.error_px.toFixed(1)} px`}</td><td>{point.sample_count ?? 0}</td><td>{point.error_px == null ? "Gaze kosong" : point.error_px <= 80 ? "Baik" : point.error_px <= 150 ? "Meleset" : "Buruk"}</td></tr>)}</tbody></table>
    </div>
  );
}

function TrajectoryArrows({ points }: { points: Array<{ x: number; y: number; viewport_x?: number; viewport_y?: number }> }) {
  return <>{points.slice(1).map((point, index) => {
    const previous = points[index];
    return <line key={index} x1={(previous.viewport_x ?? previous.x) * 1000} y1={(previous.viewport_y ?? previous.y) * 1000} x2={(point.viewport_x ?? point.x) * 1000} y2={(point.viewport_y ?? point.y) * 1000} markerEnd="url(#gaze-arrow)" />;
  })}</>;
}

function downloadEyeData(question: StudentDetail["questions"][number], source: "model" | "webgazer") {
  const data = source === "webgazer" ? question.eye_tracking_webgazer : question.eye_tracking;
  const rows = [["sequence", "question_id", "source", "point_index", "x_normalized", "y_normalized", "intensity"], ...(data?.trajectory ?? []).map((point, index) => [question.sequence, question.question_id, source, index, point.x, point.y, point.intensity ?? ""])];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${question.question_id}-${source}-eye-gaze.csv`; anchor.click(); URL.revokeObjectURL(url);
}

function EyeOptionContent({ value }: { value: string }) {
  const trimmed = value.trim();
  let pathname = "";
  try { pathname = new URL(trimmed).pathname.toLowerCase(); } catch { /* plain text */ }
  if (/\.(jpe?g|png|gif|webp|bmp|svg)$/.test(pathname)) return <img className="multiple-choice-media compact-option-image" src={trimmed} alt="Pilihan jawaban" />;
  if (/\.(mp3|wav|ogg|m4a|aac)$/.test(pathname)) return <audio className="multiple-choice-media" controls src={trimmed} />;
  if (/\.(mp4|webm|mov|m4v)$/.test(pathname)) return <video className="multiple-choice-media" controls playsInline src={trimmed} />;
  return <span>{value}</span>;
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
