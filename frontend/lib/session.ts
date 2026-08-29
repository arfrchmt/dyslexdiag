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
  status: string;
  hide_student_side: boolean;
  fullscreen_active: boolean;
  request_student_fullscreen: boolean;
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

export const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  (typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : "http://127.0.0.1:8000");
export const sessionCode = process.env.NEXT_PUBLIC_SESSION_CODE ?? "ASM-001";

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function assertApiOk(response: Response, message: string) {
  if (response.status === 401) {
    throw new Error("SESSION_EXPIRED");
  }
  if (!response.ok) {
    throw new Error(message);
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
  const response = await fetch(`${apiBase}/auth/teacher/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  assertApiOk(response, "Login guru gagal");

  return (await response.json()) as AuthResponse;
}

export async function studentLogin(code: string) {
  const response = await fetch(`${apiBase}/auth/student/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });

  assertApiOk(response, "Kode token siswa tidak valid");

  return (await response.json()) as StudentAuthResponse;
}

export async function generateStudentToken(token: string, student_name = "Siswa 01", student_id?: string) {
  const response = await fetch(`${apiBase}/auth/student-tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ student_id, student_name, expires_hours: 8 })
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
      correct_answer: metadata?.correct_answer ?? null
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

export async function updateUiControls(
  code: string,
  token: string,
  controls: Partial<Pick<SessionState, "hide_student_side" | "request_student_fullscreen">>
) {
  const response = await fetch(`${apiBase}/sessions/${code}/ui-controls`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(controls)
  });

  assertApiOk(response, "Gagal mengubah kontrol tampilan siswa");
  return (await response.json()) as SessionState;
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
