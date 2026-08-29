import { apiBase } from "@/lib/session";

export type StudentStatus = "selesai" | "berlangsung" | "belum";

export type StudentListItem = {
  id: string;
  name: string;
  identifier?: string | null;
  grade_level?: string | null;
  school_origin?: string | null;
  session_code: string;
  status: StudentStatus;
  total_score: number;
  max_score: number;
};

export type StudentQuestionPerformance = {
  question_id: string;
  prompt: string;
  sequence: number;
  score: number;
  max_score: number;
  note: string;
  feeling: string;
};

export type StudentVideoRecord = {
  id: string;
  label: string;
  source: string;
  duration: string;
  captured_at: string;
  status: "tersedia" | "menunggu" | "gagal";
};

export type StudentDetail = StudentListItem & {
  created_at: string;
  questions: StudentQuestionPerformance[];
  videos: StudentVideoRecord[];
};

export type StudentCreatePayload = {
  name: string;
  identifier?: string;
  grade_level?: string;
  school_origin?: string;
  guardian_name?: string;
  notes?: string;
};

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function assertOk(response: Response, message: string) {
  if (!response.ok) throw new Error(message);
}

export async function fetchStudents(token: string) {
  const response = await fetch(`${apiBase}/students`, {
    headers: authHeaders(token),
    cache: "no-store"
  });
  await assertOk(response, "Gagal mengambil daftar siswa");
  return (await response.json()) as StudentListItem[];
}

export async function createStudent(token: string, payload: StudentCreatePayload) {
  const response = await fetch(`${apiBase}/students`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload)
  });
  await assertOk(response, "Gagal menyimpan siswa baru");
  return (await response.json()) as { id: string; name: string };
}

export async function fetchStudentDetail(token: string, id: string) {
  const response = await fetch(`${apiBase}/students/${id}`, {
    headers: authHeaders(token),
    cache: "no-store"
  });
  await assertOk(response, "Gagal mengambil detail siswa");
  return (await response.json()) as StudentDetail;
}

export function statusLabel(status: StudentStatus) {
  if (status === "selesai") return "Selesai";
  if (status === "berlangsung") return "Berlangsung";
  return "Belum";
}
