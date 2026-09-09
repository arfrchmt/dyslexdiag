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
  eye_tracking?: { fixation_count?: number; regression_count?: number; saccade_count?: number; pupil_size_stddev?: number; blink_rate?: number; heatmap?: { x: number; y: number; viewport_x?: number; viewport_y?: number; intensity?: number }[]; trajectory?: { x: number; y: number; viewport_x?: number; viewport_y?: number; intensity?: number }[] };
  eye_tracking_webgazer?: { fixation_count?: number; regression_count?: number; saccade_count?: number; blink_rate?: number; mean_fixation_duration?: number; total_fixation_duration?: number; revisit_count?: number; aoi_transition_count?: number; aoi_transition_frequency?: number; dwell_time_stimulus?: number; dwell_time_options?: number; response_time_ms?: number | null; correctness?: number | null; heatmap?: { x: number; y: number; viewport_x?: number; viewport_y?: number; intensity?: number; duration_seconds?: number; sample_count?: number }[]; trajectory?: { x: number; y: number; viewport_x?: number; viewport_y?: number; intensity?: number }[]; fixations?: { index: number; x: number; y: number; viewport_x?: number; viewport_y?: number; sample_count?: number }[] };
  webgazer_calibration?: {
    point_count?: number;
    mean_error_px?: number | null;
    max_error_px?: number | null;
    points?: Array<{
      index: number;
      target?: { x: number; y: number; client_x?: number; client_y?: number };
      predicted?: { x: number; y: number; client_x?: number; client_y?: number } | null;
      error_px?: number | null;
      sample_count?: number;
    }>;
  };
  gaze_layout?: { viewport?: { width: number; height: number; device_pixel_ratio?: number }; question?: { id?: string; text?: string; instruction?: string; options?: string[]; scoring_mode?: string; theme?: string }; components?: Array<{ component?: string; label?: string; rect?: { left: number; top: number; width: number; height: number } }>; };
};

export async function analyzeEyeTracker(studentId: string, code: string, sequence: number, token: string) {
  const response = await fetch(`${getApiBase()}/students/${studentId}/sessions/${encodeURIComponent(code)}/questions/${sequence}/analyze-eyetracker`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("Analisis eye-tracker gagal.");
  return response.json();
}

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
