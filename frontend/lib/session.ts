export type SessionState = {
  id: string;
  student_id?: string | null;
  code: string;
  student_name: string;
  active_sequence: number;
  active_question_id: string;
  active_question_text: string;
  active_instruction_text: string;
  active_category: string;
  active_scoring_mode: string;
  active_options: string[];
  active_correct_answer?: string | null;
  active_show_student_timer: boolean;
  camera_enabled: boolean;
  camera_width: number;
  camera_height: number;
  camera_fps: number;
  camera_source_control: "student" | "teacher";
  theme_name: string;
  status: string;
  hide_student_side: boolean;
  fullscreen_active: boolean;
  request_student_fullscreen: boolean;
  request_student_camera: boolean;
  force_student_logout: boolean;
  started_at?: string | null;
  finished_at?: string | null;
  assessment_finished: boolean;
};

export type TimelineEvent = {
  sequence: number;
  event_type: string;
  t_ms: number;
  payload: string;
};

export type AuthResponse = {
  access_token: string;
  token_type: string;
  role: "TEACHER" | "STUDENT";
};

export type StudentAuthResponse = AuthResponse & {
  session: SessionState;
};

export type StudentTokenResponse = {
  code: string;
  session: SessionState;
  expires_at: string;
};

const apiBaseStorageKey = "api-base-url";
export let apiBase: string = initialApiBase();
export const sessionCode = process.env.NEXT_PUBLIC_SESSION_CODE ?? "ASM-001";

function defaultApiBase() {
  if (typeof window === "undefined") return "http://127.0.0.1:8000";
  return `${window.location.protocol}//${window.location.hostname}:${window.location.protocol === "https:" ? "8443" : "8000"}`;
}

function initialApiBase(): string {
  const fallback = defaultApiBase();
  if (typeof window !== "undefined") {
    const savedBase = window.localStorage.getItem(apiBaseStorageKey);
    if (savedBase) return normalizeApiBase(savedBase, fallback);
  }
  const envBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (envBase) return normalizeApiBase(envBase, fallback);
  return fallback;
}

function apiBaseCandidates() {
  const candidates = [apiBase];
  if (typeof window !== "undefined") {
    candidates.push(`${window.location.protocol}//${window.location.hostname}:8443`);
    candidates.push(`${window.location.protocol}//${window.location.hostname}:8000`);
  }
  return [...new Set(candidates)];
}

export function normalizeApiBase(value: string, fallback = defaultApiBase()): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return fallback;
  const protocol = typeof window !== "undefined" ? window.location.protocol : "http:";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `${protocol}//${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (!url.port) url.port = url.protocol === "https:" ? "8443" : "8000";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/+$/, "");
  } catch {
    return withProtocol;
  }
}

export function getApiBase() {
  return apiBase;
}

export function setApiBase(value: string) {
  apiBase = normalizeApiBase(value);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(apiBaseStorageKey, apiBase);
  }
  return apiBase;
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function assertApiOk(response: Response, message: string) {
  if (response.status === 401) {
    throw new Error("SESSION_EXPIRED");
  }
  if (!response.ok) {
    throw new Error(`${message} (${response.status})`);
  }
}

export function getJwtExpiryMs(token: string) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function isJwtExpired(token: string) {
  const expiresAt = getJwtExpiryMs(token);
  return expiresAt !== null && Date.now() >= expiresAt;
}

export function formatExpiry(token: string) {
  const expiresAt = getJwtExpiryMs(token);
  if (!expiresAt) return "Tidak diketahui";
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(expiresAt);
}

export async function teacherLogin(username: string, password: string) {
  let lastError: unknown = null;
  for (const base of apiBaseCandidates()) {
    try {
      const response = await fetch(`${base}/auth/teacher/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      assertApiOk(response, "Login guru gagal");
      setApiBase(base);
      return (await response.json()) as AuthResponse;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Login guru gagal");
}

export async function studentLogin(code: string) {
  let lastError: unknown = null;
  for (const base of apiBaseCandidates()) {
    try {
      const response = await fetch(`${base}/auth/student/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });

      assertApiOk(response, "Kode token siswa tidak valid");
      setApiBase(base);
      return (await response.json()) as StudentAuthResponse;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Kode token siswa tidak valid");
}

export async function generateStudentToken(token: string, student_name = "Siswa 01", student_id?: string, cameraEnabled = true) {
  const response = await fetch(`${apiBase}/auth/student-tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ student_id, student_name, expires_hours: 8, camera_enabled: cameraEnabled })
  });

  assertApiOk(response, "Gagal membuat token siswa");

  return (await response.json()) as StudentTokenResponse;
}

export async function ensureSession(token: string) {
  const response = await fetch(`${apiBase}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ code: sessionCode, student_name: "Siswa 01" }),
    cache: "no-store"
  });

  assertApiOk(response, "Gagal membuat sesi");

  return (await response.json()) as SessionState;
}

export async function fetchSession(code: string, token: string) {
  const response = await fetch(`${apiBase}/sessions/${code}`, {
    headers: authHeaders(token),
    cache: "no-store"
  });

  assertApiOk(response, "Gagal mengambil sesi");

  return (await response.json()) as SessionState;
}

export async function navigateQuestion(
  code: string,
  token: string,
  question_id: string,
    question_text: string,
  metadata?: {
    instruction_text?: string;
    category?: string;
    scoring_mode?: string;
    options?: string[];
    correct_answer?: string | null;
    is_example?: boolean;
    show_student_timer?: boolean;
  }
) {
  const response = await fetch(`${apiBase}/sessions/${code}/navigate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      question_id,
      question_text,
      instruction_text: metadata?.instruction_text ?? "Ikuti instruksi soal yang tampil.",
      category: metadata?.category ?? "phonological_awareness",
      scoring_mode: metadata?.scoring_mode ?? "teacher_rubric",
      options: metadata?.options ?? [],
      correct_answer: metadata?.correct_answer ?? null,
      is_example: metadata?.is_example ?? false,
      show_student_timer: metadata?.show_student_timer ?? false
    })
  });

  assertApiOk(response, "Gagal mengganti soal");

  return (await response.json()) as SessionState;
}

export async function sendAcknowledgment(code: string, token: string, sequence: number, event_type: string, payload = {}) {
  const response = await fetch(`${apiBase}/sessions/${code}/ack`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      sequence,
      event_type,
      t_ms: performance.now(),
      payload
    })
  });
  assertApiOk(response, "Gagal mengirim acknowledgement");
}

export async function uploadStudentRecording(
  code: string,
  token: string,
  sequence: number,
  questionId: string,
  blob: Blob,
  durationMs: number
) {
  const params = new URLSearchParams({
    sequence: String(sequence),
    question_id: questionId,
    duration_ms: String(Math.max(0, Math.round(durationMs)))
  });
  const response = await fetch(`${apiBase}/sessions/${code}/recordings?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": blob.type || "video/webm", ...authHeaders(token) },
    body: blob
  });
  assertApiOk(response, "Gagal mengunggah rekaman siswa");
  return response.json() as Promise<{ id: string; source: string; size_bytes: number }>;
}

export async function uploadTeacherRecording(
  code: string,
  token: string,
  sequence: number,
  questionId: string,
  blob: Blob,
  durationMs: number
) {
  const params = new URLSearchParams({
    sequence: String(sequence),
    question_id: questionId,
    duration_ms: String(Math.max(0, Math.round(durationMs)))
  });
  const response = await fetch(`${apiBase}/sessions/${code}/teacher-recordings?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": blob.type || "video/webm", ...authHeaders(token) },
    body: blob
  });
  assertApiOk(response, "Gagal mengunggah rekaman guru");
  return response.json() as Promise<{ id: string; source: string; size_bytes: number }>;
}

export async function uploadCameraPreview(
  code: string,
  token: string,
  sequence: number,
  questionId: string,
  blob: Blob
) {
  const params = new URLSearchParams({
    sequence: String(sequence),
    question_id: questionId
  });
  const response = await fetch(`${apiBase}/sessions/${code}/camera-preview?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": blob.type || "image/jpeg", ...authHeaders(token) },
    body: blob
  });
  assertApiOk(response, "Gagal mengunggah preview kamera siswa");
  return response.json() as Promise<{ source: string; size_bytes: number }>;
}

export async function saveGrade(code: string, token: string, sequence: number, fluency: number, accuracy: number, confidence: number) {
  const response = await fetch(`${apiBase}/sessions/${code}/grades`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ sequence, fluency, accuracy, confidence })
  });

  assertApiOk(response, "Gagal menyimpan nilai");

  return response.json() as Promise<{ total: number }>;
}

export async function saveNote(code: string, token: string, sequence: number, note: string) {
  const response = await fetch(`${apiBase}/sessions/${code}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ sequence, note })
  });

  assertApiOk(response, "Gagal menyimpan catatan");
}

export async function finishSession(code: string, token: string) {
  const response = await fetch(`${apiBase}/sessions/${code}/finish`, {
    method: "POST",
    headers: authHeaders(token)
  });

  assertApiOk(response, "Gagal menyelesaikan asesmen");
  return (await response.json()) as SessionState;
}

export async function fetchTimeline(code: string, token: string) {
  const response = await fetch(`${apiBase}/sessions/${code}/timeline`, {
    headers: authHeaders(token),
    cache: "no-store"
  });

  assertApiOk(response, "Gagal mengambil timeline");

  return (await response.json()) as TimelineEvent[];
}

export async function fetchGradedQuestionIds(code: string, token: string) {
  const response = await fetch(`${apiBase}/sessions/${code}/graded-question-ids`, {
    headers: authHeaders(token),
    cache: "no-store"
  });

  assertApiOk(response, "Gagal mengambil status nilai soal");

  return (await response.json()) as { question_ids: string[] };
}

export async function fetchQuestionScores(code: string, token: string) {
  const response = await fetch(`${apiBase}/sessions/${code}/question-scores`, {
    headers: authHeaders(token),
    cache: "no-store"
  });

  assertApiOk(response, "Gagal mengambil skor soal");

  return (await response.json()) as {
    scores: Record<string, { fluency: number; accuracy: number; confidence: number; total: number; sequence: number }>;
  };
}

export async function forceStudentLogout(code: string, token: string) {
  const response = await fetch(`${apiBase}/sessions/${code}/student-logout`, {
    method: "POST",
    headers: authHeaders(token)
  });

  assertApiOk(response, "Gagal logout siswa");
  return (await response.json()) as SessionState;
}

export async function updateUiControls(
  code: string,
  token: string,
  controls: Partial<Pick<SessionState, "hide_student_side" | "request_student_fullscreen" | "request_student_camera" | "camera_width" | "camera_height" | "camera_fps" | "camera_source_control" | "theme_name">>
) {
  const response = await fetch(`${apiBase}/sessions/${code}/ui-controls`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(controls)
  });

  assertApiOk(response, "Gagal mengubah kontrol tampilan siswa");
  return (await response.json()) as SessionState;
}

export async function fetchEyeGazeConfig(token: string) {
  const response = await fetch(`${apiBase}/eye-gaze/config`, { headers: authHeaders(token) });
  assertApiOk(response, "Gagal memuat konfigurasi eye tracking");
  return response.json();
}

export async function updateEyeGazeConfig(token: string, config: Record<string, unknown>) {
  const response = await fetch(`${apiBase}/eye-gaze/config`, { method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders(token) }, body: JSON.stringify(config) });
  assertApiOk(response, "Gagal menyimpan konfigurasi eye tracking");
  return response.json();
}

export async function updateStudentStatus(code: string, token: string, fullscreen_active: boolean) {
  const response = await fetch(`${apiBase}/sessions/${code}/student-status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ fullscreen_active })
  });

  assertApiOk(response, "Gagal mengirim status siswa");
  return (await response.json()) as SessionState;
}
