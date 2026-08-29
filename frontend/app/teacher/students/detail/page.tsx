"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, FileVideo, Gauge, NotebookText } from "lucide-react";

import { fetchStudentDetail, statusLabel, type StudentDetail } from "@/lib/students";

export default function StudentDetailPage() {
  const [student, setStudent] = useState<StudentDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = window.localStorage.getItem("teacher-jwt") ?? "";
    const id = new URLSearchParams(window.location.search).get("id") ?? "";
    if (!token) {
      setError("Login guru diperlukan untuk membuka detail siswa.");
      return;
    }
    if (!id) {
      setError("ID siswa tidak ditemukan.");
      return;
    }
    fetchStudentDetail(token, id)
      .then(setStudent)
      .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : "Gagal mengambil detail"));
  }, []);

  return (
    <main className="teacher-shell">
      <header className="teacher-topbar">
        <div>
          <p className="eyebrow">Detail siswa</p>
          <h1>{student?.name ?? "Memuat siswa"}</h1>
        </div>
        <Link className="nav-button" href="/teacher/students/">
          <ArrowLeft size={16} />
          Daftar siswa
        </Link>
      </header>

      {error ? <p className="error-text">{error}</p> : null}

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
                    {student.total_score}/{student.max_score}
                  </strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{statusLabel(student.status)}</strong>
                </div>
                <div>
                  <span>Sesi</span>
                  <strong>{student.session_code}</strong>
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

            <section className="panel">
              <div className="panel-title">
                <FileVideo size={18} />
                <h2>Data video</h2>
              </div>
              <div className="video-list">
                {student.videos.length === 0 ? (
                  <p className="muted">Belum ada video.</p>
                ) : (
                  student.videos.map((video) => (
                    <div className="video-item" key={video.id}>
                      <div className="video-thumb">
                        <FileVideo size={28} />
                      </div>
                      <div>
                        <strong>{video.label}</strong>
                        <span>{video.source}</span>
                        <em>
                          {video.duration} | {video.captured_at} | {video.status}
                        </em>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </section>

          <section className="panel">
            <div className="panel-title">
              <NotebookText size={18} />
              <h2>Capaian per soal</h2>
            </div>
            <div className="achievement-list">
              {student.questions.length === 0 ? (
                <p className="muted">Siswa belum memulai asesmen.</p>
              ) : (
                student.questions.map((question) => (
                  <article className="achievement-item" key={`${question.sequence}-${question.question_id}`}>
                    <div>
                      <span>{question.question_id}</span>
                      <strong>{question.prompt || `Soal ${question.sequence}`}</strong>
                    </div>
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
                    <p>{question.note || "Belum ada catatan."}</p>
                  </article>
                ))
              )}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
