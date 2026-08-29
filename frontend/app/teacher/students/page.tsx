"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ClipboardList, Plus, Users } from "lucide-react";

import { fetchStudents, statusLabel, type StudentListItem } from "@/lib/students";

export default function TeacherStudentsPage() {
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = window.localStorage.getItem("teacher-jwt") ?? "";
    if (!token) {
      setError("Login guru diperlukan untuk membuka daftar siswa.");
      return;
    }
    fetchStudents(token)
      .then(setStudents)
      .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : "Gagal mengambil data"));
  }, []);

  return (
    <main className="teacher-shell">
      <header className="teacher-topbar">
        <div>
          <p className="eyebrow">UI Guru</p>
          <h1>Daftar Siswa</h1>
        </div>
        <Link className="nav-button" href="/teacher/students/new/">
          <Plus size={16} />
          Tambah siswa
        </Link>
        <Link className="nav-button" href="/teacher/">
          Kembali ke kontrol
        </Link>
      </header>

      <section className="panel">
        <div className="panel-title">
          <Users size={18} />
          <h2>Monitoring capaian</h2>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="student-table">
          <div className="student-table-head">
            <span>Nama</span>
            <span>Sesi</span>
            <span>Nilai total</span>
            <span>Status</span>
            <span>Detail</span>
          </div>
          {students.length === 0 ? (
            <div className="student-table-row">
              <strong>Belum ada siswa</strong>
              <span>Tambahkan data siswa baru untuk memulai asesmen.</span>
              <span>-</span>
              <span className="status-badge belum">Belum</span>
              <Link className="detail-link" href="/teacher/students/new/">
                <Plus size={16} />
                Tambah
              </Link>
            </div>
          ) : (
            students.map((student) => (
              <div className="student-table-row" key={student.id}>
                <strong>{student.name}</strong>
                <span>{student.session_code}</span>
                <span>
                  {student.total_score}/{student.max_score}
                </span>
                <span className={`status-badge ${student.status}`}>{statusLabel(student.status)}</span>
                <Link className="detail-link" href={`/teacher/students/detail/?id=${student.id}`}>
                  <ClipboardList size={16} />
                  Detail
                  <ArrowRight size={16} />
                </Link>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
