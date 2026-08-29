"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Edit3, Layers3, Plus, Power, Save, X } from "lucide-react";

import {
  assessmentCategories,
  categoryLabel,
  createAssessmentItem,
  fetchAssessmentItems,
  scoringModes,
  updateAssessmentItem,
  updateAssessmentItemActive,
  type AssessmentCategory,
  type AssessmentItem,
  type ScoringMode
} from "@/lib/assessmentContent";

export default function AssessmentContentPage() {
  const [items, setItems] = useState<AssessmentItem[]>([]);
  const [category, setCategory] = useState<AssessmentCategory>("phonological_awareness");
  const [scoringMode, setScoringMode] = useState<ScoringMode>("teacher_rubric");
  const [itemCode, setItemCode] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [instructionText, setInstructionText] = useState("");
  const [stimulus, setStimulus] = useState("");
  const [options, setOptions] = useState("");
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterCategory, setFilterCategory] = useState<AssessmentCategory | "all">("all");
  const [editingItem, setEditingItem] = useState<AssessmentItem | null>(null);

  const nextOrder = useMemo(() => editingItem?.sort_order ?? items.length + 1, [editingItem?.sort_order, items.length]);
  const filteredItems = useMemo(
    () => (filterCategory === "all" ? items : items.filter((item) => item.category === filterCategory)),
    [filterCategory, items]
  );

  async function loadItems() {
    const token = window.localStorage.getItem("teacher-jwt") ?? "";
    if (!token) {
      setError("Login guru diperlukan untuk mengelola konten asesmen.");
      return;
    }
    setItems(await fetchAssessmentItems(token));
  }

  useEffect(() => {
    loadItems().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Gagal memuat konten"));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (scoringMode === "system" && !correctAnswer.trim()) {
      setError("Kunci jawaban wajib diisi untuk mode penilaian skor sistem.");
      return;
    }
    if (scoringMode === "system" && !options.trim()) {
      setError("Pilihan blok kata wajib diisi untuk mode penilaian skor sistem.");
      return;
    }
    setSaving(true);
    try {
      const token = window.localStorage.getItem("teacher-jwt") ?? "";
      const payload = {
        item_code: itemCode,
        category,
        title,
        prompt,
        instruction_text: instructionText,
        stimulus,
        options: options
          .split("\n")
          .map((option) => option.trim())
          .filter(Boolean),
        correct_answer: correctAnswer || null,
        scoring_mode: scoringMode,
        sort_order: nextOrder,
        is_active: editingItem?.is_active ?? true
      };
      if (editingItem) {
        await updateAssessmentItem(token, editingItem.id, payload);
      } else {
        await createAssessmentItem(token, payload);
      }
      resetForm();
      await loadItems();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Gagal menyimpan konten asesmen");
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setEditingItem(null);
    setItemCode("");
    setTitle("");
    setPrompt("");
    setInstructionText("");
    setStimulus("");
    setOptions("");
    setCorrectAnswer("");
  }

  function startEdit(item: AssessmentItem) {
    setEditingItem(item);
    setCategory(item.category);
    setScoringMode(item.scoring_mode);
    setItemCode(item.item_code);
    setTitle(item.title);
    setPrompt(item.prompt);
    setInstructionText(item.instruction_text);
    setStimulus(item.stimulus);
    setOptions(item.options.join("\n"));
    setCorrectAnswer(item.correct_answer ?? "");
    setError("");
  }

  async function toggleItemActive(item: AssessmentItem) {
    setError("");
    try {
      const token = window.localStorage.getItem("teacher-jwt") ?? "";
      const updated = await updateAssessmentItemActive(token, item.id, !item.is_active);
      setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Gagal mengubah status soal");
    }
  }

  return (
    <main className="teacher-shell">
      <header className="teacher-topbar">
        <div>
          <p className="eyebrow">UI Guru</p>
          <h1>Konten Asesmen</h1>
        </div>
        <Link className="nav-button" href="/teacher/">
          <ArrowLeft size={16} />
          Kembali ke kontrol
        </Link>
      </header>

      <section className="content-grid">
        <form className="panel content-form" onSubmit={handleSubmit}>
          <div className="panel-title">
            {editingItem ? <Edit3 size={18} /> : <Plus size={18} />}
            <h2>{editingItem ? "Edit konten" : "Tambah konten"}</h2>
          </div>
          {editingItem ? (
            <div className="edit-banner">
              <span>Mengedit {editingItem.item_code}</span>
              <button onClick={resetForm} type="button">
                <X size={15} />
                Batal
              </button>
            </div>
          ) : null}
          <div className="form-grid">
            <label>
              <span>Kategori</span>
              <select value={category} onChange={(event) => setCategory(event.target.value as AssessmentCategory)}>
                {assessmentCategories.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Mode penilaian</span>
              <select value={scoringMode} onChange={(event) => setScoringMode(event.target.value as ScoringMode)}>
                {scoringModes.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Kode soal</span>
              <input required value={itemCode} onChange={(event) => setItemCode(event.target.value.toUpperCase())} />
            </label>
            <label>
              <span>Judul</span>
              <input required value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
          </div>
          <label>
            <span>Instruksi</span>
            <textarea required value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          </label>
          <label>
            <span>Petunjuk instruksional untuk siswa</span>
            <textarea
              required
              value={instructionText}
              onChange={(event) => setInstructionText(event.target.value)}
              placeholder="Contoh: Pindahkan kata ke slot jawaban hingga kalimat lengkap terbentuk."
            />
          </label>
          <div className="instruction-help">
            <strong>Petunjuk guru</strong>
            <span>Fill the blank: gunakan pola stimulus "Ibu membeli ___ di pasar.", opsi satu kata per baris, kunci "Ibu membeli roti di pasar."</span>
            <span>Susun kata: gunakan pola stimulus "adik | bola | bermain" atau kalimat acak, opsi satu blok per baris, kunci "adik bermain bola".</span>
            <span>Kalimat lengkap: opsi dapat berupa kata/frasa pendek per baris; urutan kunci harus sama persis dengan jawaban benar.</span>
          </div>
          <label>
            <span>Stimulus / teks / kata / gambar URL</span>
            <textarea value={stimulus} onChange={(event) => setStimulus(event.target.value)} />
          </label>
          <label>
            <span>Pilihan jawaban / blok kata / opsi rapid naming</span>
            <textarea
              required={scoringMode === "system"}
              value={options}
              onChange={(event) => setOptions(event.target.value)}
              placeholder="Satu opsi per baris"
            />
          </label>
          <label>
            <span>Kunci jawaban sistem</span>
            <input
              required={scoringMode === "system"}
              value={correctAnswer}
              onChange={(event) => setCorrectAnswer(event.target.value)}
            />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <button className="primary-button full" disabled={saving} type="submit">
            <Save size={17} />
            {saving ? "Menyimpan..." : editingItem ? "Update konten" : "Simpan konten"}
          </button>
        </form>

        <section className="panel">
          <div className="panel-title">
            <Layers3 size={18} />
            <h2>Daftar konten</h2>
          </div>
          <div className="content-toolbar">
            <label>
              <span>Filter kategori</span>
              <select value={filterCategory} onChange={(event) => setFilterCategory(event.target.value as AssessmentCategory | "all")}>
                <option value="all">Semua kategori</option>
                {assessmentCategories.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="content-list">
            {filteredItems.map((item) => (
              <article className={item.is_active ? "content-item" : "content-item inactive"} key={item.id}>
                <div>
                  <span>{item.item_code}</span>
                  <strong>{item.title}</strong>
                  <em>{categoryLabel(item.category)} | {item.scoring_mode}</em>
                </div>
                <div className="content-actions">
                  <button className="status-toggle" onClick={() => startEdit(item)} type="button">
                    <Edit3 size={15} />
                    Edit
                  </button>
                  <button
                    className={item.is_active ? "status-toggle active" : "status-toggle"}
                    onClick={() => toggleItemActive(item)}
                    type="button"
                  >
                    <Power size={15} />
                    {item.is_active ? "Aktif" : "Nonaktif"}
                  </button>
                </div>
                <p>{item.prompt}</p>
                <p>{item.instruction_text}</p>
              </article>
            ))}
            {filteredItems.length === 0 ? <p className="muted">Belum ada konten pada filter ini.</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
