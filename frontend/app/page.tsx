import Link from "next/link";

export default function Home() {
  return (
    <main className="home-shell">
      <section className="home-panel">
        <p className="eyebrow">Dyslexic Diagnostic</p>
        <h1>Pilih antarmuka</h1>
        <div className="home-actions">
          <Link href="/student">UI Siswa</Link>
          <Link href="/teacher">UI Guru</Link>
        </div>
      </section>
    </main>
  );
}
