"use client";

import { type FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Camera, Save, Server, Settings } from "lucide-react";

import { fetchSession, getApiBase, setApiBase, updateUiControls, type SessionState } from "@/lib/session";

const resolutionOptions = [
  { label: "426 x 240", width: 426, height: 240 },
  { label: "640 x 480", width: 640, height: 480 },
  { label: "1280 x 720", width: 1280, height: 720 },
  { label: "1920 x 1080", width: 1920, height: 1080 }
];

const fpsOptions = [10, 15, 24, 25, 30, 60];

export default function TeacherSettingsPage() {
  const [teacherJwt, setTeacherJwt] = useState("");
  const [sessionCode, setSessionCode] = useState("");
  const [session, setSession] = useState<SessionState | null>(null);
  const [cameraWidth, setCameraWidth] = useState(640);
  const [cameraHeight, setCameraHeight] = useState(480);
  const [cameraFps, setCameraFps] = useState(25);
  const [serverAddress, setServerAddress] = useState(() => getApiBase());
  const [serverStatus, setServerStatus] = useState("");
  const [status, setStatus] = useState("Memuat pengaturan...");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const token = window.localStorage.getItem("teacher-jwt") ?? "";
    const code = window.localStorage.getItem("teacher-session-code") ?? "";
    setTeacherJwt(token);
    setSessionCode(code);
    if (!token || !code) {
      setStatus("Login guru dan session aktif diperlukan.");
      return;
    }
    fetchSession(code, token)
      .then((state) => {
        setSession(state);
        setCameraWidth(state.camera_width);
        setCameraHeight(state.camera_height);
        setCameraFps(state.camera_fps);
        setStatus("Pengaturan dimuat.");
      })
      .catch(() => setStatus("Gagal memuat pengaturan sesi."));
  }, []);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!teacherJwt || !sessionCode) return;
    setSaving(true);
    setStatus("Menyimpan pengaturan...");
    try {
      const nextSession = await updateUiControls(sessionCode, teacherJwt, {
        camera_width: cameraWidth,
        camera_height: cameraHeight,
        camera_fps: cameraFps
      });
      setSession(nextSession);
      setStatus("Pengaturan tersimpan. Perangkat aktif akan memakai setting baru saat kamera dimulai ulang.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Gagal menyimpan pengaturan.");
    } finally {
      setSaving(false);
    }
  }

  function applyResolution(value: string) {
    const [width, height] = value.split("x").map(Number);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      setCameraWidth(width);
      setCameraHeight(height);
    }
  }

  function saveServerAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextBase = setApiBase(serverAddress);
    setServerAddress(nextBase);
    setServerStatus("Alamat server tersimpan. Muat ulang halaman jika data masih memakai alamat lama.");
  }

  const selectedResolution = `${cameraWidth}x${cameraHeight}`;

  return (
    <main className="teacher-shell">
      <header className="teacher-topbar">
        <div>
          <p className="eyebrow">Pengaturan</p>
          <h1>Kamera dan perekaman</h1>
        </div>
        <a className="nav-button" href="/teacher/">
          <ArrowLeft size={16} />
          Kontrol asesmen
        </a>
      </header>

      <section className="settings-grid">
        <form className="panel settings-panel" onSubmit={saveServerAddress}>
          <div className="panel-title">
            <Server size={18} />
            <h2>Alamat server</h2>
          </div>
          <label>
            <span>IP atau URL server</span>
            <input
              value={serverAddress}
              onChange={(event) => setServerAddress(event.target.value)}
              placeholder="192.168.1.10:8000"
            />
          </label>
          <button className="primary-button full" type="submit">
            <Save size={17} />
            Simpan alamat server
          </button>
          <p className="save-state">{serverStatus || `API aktif: ${getApiBase()}`}</p>
        </form>

        <form className="panel settings-panel" onSubmit={saveSettings}>
          <div className="panel-title">
            <Camera size={18} />
            <h2>Pengaturan kamera sesi</h2>
          </div>
          <label>
            <span>Session aktif</span>
            <input value={session?.code ?? sessionCode ?? ""} disabled />
          </label>
          <label>
            <span>Resolusi kamera</span>
            <select value={selectedResolution} onChange={(event) => applyResolution(event.target.value)}>
              {resolutionOptions.map((option) => (
                <option key={option.label} value={`${option.width}x${option.height}`}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid two">
            <label>
              <span>Lebar</span>
              <input min="160" max="3840" type="number" value={cameraWidth} onChange={(event) => setCameraWidth(Number(event.target.value))} />
            </label>
            <label>
              <span>Tinggi</span>
              <input min="120" max="2160" type="number" value={cameraHeight} onChange={(event) => setCameraHeight(Number(event.target.value))} />
            </label>
          </div>
          <label>
            <span>FPS</span>
            <select value={cameraFps} onChange={(event) => setCameraFps(Number(event.target.value))}>
              {fpsOptions.map((fps) => (
                <option key={fps} value={fps}>
                  {fps} fps
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button full" disabled={saving || !teacherJwt || !sessionCode} type="submit">
            <Save size={17} />
            Simpan pengaturan
          </button>
          <p className="save-state">{status}</p>
        </form>

        <section className="panel settings-panel">
          <div className="panel-title">
            <Settings size={18} />
            <h2>Dampak ke perangkat aktif</h2>
          </div>
          <div className="metric-row">
            <span>Resolusi</span>
            <strong>{cameraWidth} x {cameraHeight}</strong>
          </div>
          <div className="metric-row">
            <span>FPS</span>
            <strong>{cameraFps}</strong>
          </div>
          <p className="muted">Pemilihan kamera guru atau siswa dilakukan di panel kontrol sesi utama setelah token aktif.</p>
        </section>
      </section>
    </main>
  );
}
