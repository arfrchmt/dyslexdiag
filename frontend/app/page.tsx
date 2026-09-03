"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Save, Server } from "lucide-react";

import { getApiBase, setApiBase } from "@/lib/session";

export default function Home() {
  const [serverAddress, setServerAddress] = useState(() => getApiBase());
  const [serverStatus, setServerStatus] = useState("");

  function saveServerAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextBase = setApiBase(serverAddress);
    setServerAddress(nextBase);
    setServerStatus("Alamat server tersimpan.");
  }

  return (
    <main className="home-shell">
      <section className="home-panel">
        <p className="eyebrow">Dyslexic Diagnostic</p>
        <h1>Pilih antarmuka</h1>
        <div className="home-actions">
          <Link href="/student">UI Siswa</Link>
          <Link href="/teacher">UI Guru</Link>
        </div>
        <form className="server-config" onSubmit={saveServerAddress}>
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
            <Save size={16} />
            Simpan alamat
          </button>
          {serverStatus ? <p className="save-state">{serverStatus}</p> : null}
        </form>
      </section>
    </main>
  );
}
