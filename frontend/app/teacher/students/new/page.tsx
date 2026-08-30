"use client";

import { type FormEvent, useState } from "react";
import { ArrowLeft, Save, UserPlus } from "lucide-react";

import { createStudent } from "@/lib/students";

export default function NewStudentPage() {
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [schoolOrigin, setSchoolOrigin] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const token = window.localStorage.getItem("teacher-jwt") ?? "";
      if (!token) throw new Error("Login guru diperlukan untuk menambah siswa.");
      await createStudent(token, {
        name,
        identifier,
        grade_level: gradeLevel,
        school_origin: schoolOrigin,
        guardian_name: guardianName,
        notes
      });
      window.location.href = "/teacher/students/";
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Gagal menyimpan siswa baru");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="teacher-shell">
      <header className="teacher-topbar">
        <div>
          <p className="eyebrow">Data siswa</p>
          <h1>Tambah Siswa Baru</h1>
        </div>
        <a className="nav-button" href="/teacher/students/">
          <ArrowLeft size={16} />
          Daftar siswa
        </a>
      </header>

      <form className="panel student-form" onSubmit={handleSubmit}>
        <div className="panel-title">
          <UserPlus size={18} />
          <h2>Identitas siswa</h2>
        </div>
        <label>
          <span>Nama siswa</span>
          <input required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span>NIS / kode internal</span>
          <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
        </label>
        <label>
          <span>Kelas</span>
          <input value={gradeLevel} onChange={(event) => setGradeLevel(event.target.value)} />
        </label>
        <label>
          <span>Asal sekolah</span>
          <input value={schoolOrigin} onChange={(event) => setSchoolOrigin(event.target.value)} />
        </label>
        <label>
          <span>Nama wali</span>
          <input value={guardianName} onChange={(event) => setGuardianName(event.target.value)} />
        </label>
        <label>
          <span>Catatan awal</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <button className="primary-button full" disabled={saving} type="submit">
          <Save size={17} />
          {saving ? "Menyimpan..." : "Simpan siswa"}
        </button>
      </form>
    </main>
  );
}
