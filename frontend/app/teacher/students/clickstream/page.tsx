"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download } from "lucide-react";

import { fetchStudentDetail, type StudentDetail } from "@/lib/students";

type ClickstreamEntry = Record<string, unknown> & {
  question_id?: string;
  sequence?: number;
  component?: string;
  component_label?: string;
  action?: string;
  client_time?: string;
  question_elapsed_ms?: number;
};

export default function ClickstreamAnalyticsPage() {
  const [student, setStudent] = useState<StudentDetail | null>(null);
  const [sessionCode, setSessionCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = window.localStorage.getItem("teacher-jwt") ?? "";
    const params = new URLSearchParams(window.location.search);
    const studentId = params.get("id") ?? "";
    const session = params.get("session") ?? "";
    setSessionCode(session);
    if (!token || !studentId || !session) {
      setError("Parameter siswa, sesi, atau login guru tidak tersedia.");
      setLoading(false);
      return;
    }
    fetchStudentDetail(token, studentId)
      .then(setStudent)
      .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : "Gagal mengambil clickstream"))
      .finally(() => setLoading(false));
  }, []);

  const sessionQuestions = useMemo(() => {
    return student?.questions.filter((question) => question.session_code === sessionCode) ?? [];
  }, [sessionCode, student]);

  const entries = useMemo(() => {
    return sessionQuestions
      .flatMap((question) =>
        (question.clickstream ?? []).map((entry) => ({
          ...entry,
          question_id: question.question_id,
          sequence: question.sequence
        }) as ClickstreamEntry)
      )
      .sort((left, right) => Number(left.client_time_ms ?? 0) - Number(right.client_time_ms ?? 0));
  }, [sessionQuestions]);

  const componentRows = useMemo(() => summarizeComponents(entries), [entries]);
  const jsonPayload = useMemo(
    () =>
      JSON.stringify(
        {
          student: student?.name ?? "",
          session_code: sessionCode,
          question_count: sessionQuestions.length,
          click_count: entries.length,
          components: componentRows,
          clickstream: entries
        },
        null,
        2
      ),
    [componentRows, entries, sessionCode, sessionQuestions.length, student?.name]
  );

  function downloadJson() {
    const blob = new Blob([jsonPayload], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `clickstream-${sessionCode}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="teacher-shell">
      <header className="teacher-topbar">
        <div>
          <p className="eyebrow">Analitik clickstream</p>
          <h1>{student?.name ?? "Memuat data"}</h1>
        </div>
        <button className="nav-button" onClick={() => window.close()} type="button">
          <ArrowLeft size={16} />
          Tutup tab
        </button>
        <button className="nav-button" disabled={entries.length === 0} onClick={downloadJson} type="button">
          <Download size={16} />
          JSON
        </button>
      </header>

      {loading ? <p className="muted">Memuat clickstream...</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {!loading && !error ? (
        <>
          <section className="detail-insight-grid clickstream-summary">
            <div>
              <span>Sesi</span>
              <strong>{sessionCode || "-"}</strong>
            </div>
            <div>
              <span>Soal</span>
              <strong>{sessionQuestions.length}</strong>
            </div>
            <div>
              <span>Total klik</span>
              <strong>{entries.length}</strong>
            </div>
            <div>
              <span>Komponen unik</span>
              <strong>{componentRows.length}</strong>
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <h2>Komponen paling sering diklik</h2>
            </div>
            <div className="clickstream-component-list">
              {componentRows.length === 0 ? (
                <p className="muted">Belum ada clickstream pada sesi ini.</p>
              ) : (
                componentRows.map((row) => (
                  <div key={row.component}>
                    <span>{row.component}</span>
                    <strong>{row.count}</strong>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <h2>Timeline klik</h2>
            </div>
            <div className="clickstream-table">
              <span>Waktu</span>
              <span>Soal</span>
              <span>Komponen</span>
              <span>Label</span>
              <span>t soal</span>
              {entries.map((entry, index) => (
                <ClickstreamRow entry={entry} index={index} key={`${entry.client_time_ms}-${index}`} />
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <h2>Dataset JSON</h2>
            </div>
            <pre className="clickstream-json">{jsonPayload}</pre>
          </section>
        </>
      ) : null}
    </main>
  );
}

function ClickstreamRow({ entry, index }: { entry: ClickstreamEntry; index: number }) {
  return (
    <>
      <strong>{formatClickTime(entry.client_time) || `#${index + 1}`}</strong>
      <strong>{entry.question_id ?? "-"}</strong>
      <strong>{entry.component ?? "-"}</strong>
      <strong>{entry.component_label ?? "-"}</strong>
      <strong>{formatElapsed(entry.question_elapsed_ms)}</strong>
    </>
  );
}

function summarizeComponents(entries: ClickstreamEntry[]) {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const component = String(entry.component ?? "unknown");
    counts.set(component, (counts.get(component) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([component, count]) => ({ component, count }))
    .sort((left, right) => right.count - left.count || left.component.localeCompare(right.component));
}

function formatClickTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(date);
}

function formatElapsed(value?: number) {
  if (typeof value !== "number") return "-";
  return `${(value / 1000).toFixed(2)} dtk`;
}
