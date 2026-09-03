import { getApiBase } from "@/lib/session";

export type AssessmentCategory =
  | "intelligence_fluid"
  | "reading_assessment"
  | "phonological_awareness"
  | "rapid_naming"
  | "writing";

export type ScoringMode = "system" | "multiple_choice" | "teacher_rubric" | "binary" | "upload";

export type AssessmentItem = {
  id: string;
  item_code: string;
  category: AssessmentCategory;
  title: string;
  prompt: string;
  instruction_text: string;
  stimulus: string;
  options: string[];
  correct_answer?: string | null;
  scoring_mode: ScoringMode;
  sort_order: number;
  is_active: boolean;
  is_example: boolean;
  show_student_timer: boolean;
  created_at: string;
};

export const assessmentCategories: Array<{ value: AssessmentCategory; label: string; scoring: string }> = [
  { value: "intelligence_fluid", label: "Intelligence Fluid", scoring: "Skor sistem" },
  { value: "reading_assessment", label: "Reading Assessment", scoring: "Rubrik guru" },
  { value: "phonological_awareness", label: "Phonological Awareness", scoring: "Rubrik guru" },
  { value: "rapid_naming", label: "Rapid Naming", scoring: "Benar / salah" },
  { value: "writing", label: "Writing", scoring: "Upload foto" }
];

export const scoringModes: Array<{ value: ScoringMode; label: string }> = [
  { value: "system", label: "Dinilai sistem / kunci jawaban" },
  { value: "multiple_choice", label: "Pilihan ganda" },
  { value: "binary", label: "Dinilai guru: benar / salah" },
  { value: "teacher_rubric", label: "Dinilai guru: slider nilai" },
  { value: "upload", label: "Upload foto" }
];

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function categoryLabel(category: string) {
  return assessmentCategories.find((item) => item.value === category)?.label ?? category;
}

export async function fetchAssessmentItems(token: string) {
  const response = await fetch(`${getApiBase()}/assessment-items`, {
    headers: authHeaders(token),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Gagal mengambil konten asesmen");
  return (await response.json()) as AssessmentItem[];
}

export async function createAssessmentItem(token: string, payload: Omit<AssessmentItem, "id" | "created_at">) {
  const response = await fetch(`${getApiBase()}/assessment-items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("Gagal menyimpan konten asesmen");
  return (await response.json()) as AssessmentItem;
}

export async function updateAssessmentItem(
  token: string,
  itemId: string,
  payload: Omit<AssessmentItem, "id" | "created_at">
) {
  const response = await fetch(`${getApiBase()}/assessment-items/${itemId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("Gagal memperbarui konten asesmen");
  return (await response.json()) as AssessmentItem;
}

export async function updateAssessmentItemActive(token: string, itemId: string, isActive: boolean) {
  const response = await fetch(`${getApiBase()}/assessment-items/${itemId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ is_active: isActive })
  });
  if (!response.ok) throw new Error("Gagal mengubah status konten asesmen");
  return (await response.json()) as AssessmentItem;
}
