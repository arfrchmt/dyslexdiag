import { getApiBase } from "@/lib/session";

export type StudentStatus = "selesai" | "berlangsung" | "belum";

export type StudentListItem = {
  id: string;
  name: string;
  identifier?: string | null;
  grade_level?: string | null;
  school_origin?: string | null;
  session_code: string;
  session_date?: string | null;
  status: StudentStatus;
  total_score: number;
  max_score: number;
};

export type StudentQuestionPerformance = {
  session_code: string;
  session_date?: string | null;
  question_id: string;
  prompt: string;
  sequence: number;
  score: number;
  max_score: number;
  note: string;
  feeling: string;
  duration_ms?: number | null;
  click_count: number;
  clicked_components: string[];
  clickstream: Record<string, unknown>[];
  additional_data: Record<string, unknown>;
  is_example: boolean;
  question_active: boolean;
  videos: StudentVideoRecord[];
};

export type StudentSessionSummary = {
  code: string;
  session_date?: string | null;
  status: StudentStatus;
  total_score: number;
  max_score: number;
};

export type StudentVideoRecord = {
  id: string;
  sequence: number;
  question_id: string;
  label: string;
  source: string;
  source_device?: "student" | "teacher";
  duration: string;
  captured_at: string;
  status: "tersedia" | "menunggu" | "gagal";
};

export type StudentDetail = StudentListItem & {
  created_at: string;
  sessions: StudentSessionSummary[];
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
  if (!response.ok) throw new Error(`${message} (${response.status})`);
}

async function fetchWithTimeout(url: string, init: RequestInit, message: string, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`${message}: timeout`);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchStudents(token: string) {
  const response = await fetchWithTimeout(
    `${getApiBase()}/students`,
    {
      headers: authHeaders(token),
      cache: "no-store"
    },
    "Gagal mengambil daftar siswa"
  );
  await assertOk(response, "Gagal mengambil daftar siswa");
  return (await response.json()) as StudentListItem[];
}

export async function createStudent(token: string, payload: StudentCreatePayload) {
  const response = await fetch(`${getApiBase()}/students`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload)
  });
  await assertOk(response, "Gagal menyimpan siswa baru");
  return (await response.json()) as { id: string; name: string };
}

export async function fetchStudentDetail(token: string, id: string) {
  const response = await fetchWithTimeout(
    `${getApiBase()}/students/${id}`,
    {
      headers: authHeaders(token),
      cache: "no-store"
    },
    "Gagal mengambil detail siswa"
  );
  await assertOk(response, "Gagal mengambil detail siswa");
  return (await response.json()) as StudentDetail;
}

export function statusLabel(status: StudentStatus) {
  if (status === "selesai") return "Selesai";
  if (status === "berlangsung") return "Berlangsung";
  return "Belum";
}
