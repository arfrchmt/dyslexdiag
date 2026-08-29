# Dyslexic Diagnostic UI Prototype

Prototype aplikasi asesmen sinkron berbasis web.

## Stack

- Backend: Python, FastAPI, Uvicorn, SQLAlchemy
- Database: PostgreSQL atau MySQL
- Frontend: Next.js, TypeScript
- Realtime-ready: API contract sudah menyiapkan session state, acknowledgment, penilaian, dan catatan

Machine learning belum diimplementasikan. Fokus fase ini adalah UI/UX, session flow, dan struktur data.

## Port

- Backend API: `http://localhost:8000`
- UI Siswa: `http://localhost:3001/student`
- UI Guru: `http://localhost:3002/teacher`

Kedua UI memakai codebase Next.js yang sama, tetapi dijalankan pada port berbeda agar akses guru dan siswa terpisah secara operasional.

## Struktur

```text
backend/
  app/
    main.py
    config.py
    database.py
    models.py
    schemas.py
    routers/
frontend/
  app/
    student/
    teacher/
  components/
  lib/
```

## Menjalankan Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Default memakai PostgreSQL lokal dari file `.env` di root folder:

```bash
DATABASE_URL=postgresql://postgres:passwd1@localhost:5432/dyslexdiag
```

atau:

```bash
DATABASE_URL=mysql+pymysql://user:password@localhost:3306/dyslexicdiag
```

Untuk akses dari perangkat lain pada Wi-Fi yang sama:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Login dan Keamanan

Backend memakai bcrypt untuk hash password dan JWT bearer untuk pengamanan API.

Default akun guru development dibaca dari root `.env`:

```bash
DEFAULT_TEACHER_USERNAME=admin
DEFAULT_TEACHER_PASSWORD=admin123
JWT_SECRET_KEY=dev-local-change-before-production
```

Alur akses:

1. Guru login di UI guru dengan username/password.
2. Guru membuat token siswa dari panel kontrol.
3. Siswa membuka UI siswa dan memasukkan kode token.
4. Setelah login, guru dan siswa memakai JWT untuk setiap request API.
5. Jika JWT expired, UI akan kembali ke layar login dan meminta autentikasi baru.

Untuk production, ganti `JWT_SECRET_KEY` dan password default sebelum aplikasi dipakai.

## Menjalankan UI Siswa

```bash
cd frontend
npm install
npm run dev:student
```

## Menjalankan UI Guru

```bash
cd frontend
npm install
npm run dev:teacher
```

Catatan Next.js 16: satu direktori proyek hanya stabil untuk satu proses `next dev`.
Untuk menjalankan dua port paralel, gunakan mode production:

```bash
cd frontend
npm run build
npm run start:student
npm run start:teacher
```

Jalankan `start:student` dan `start:teacher` pada dua terminal berbeda.
Server static bind ke `0.0.0.0`, sehingga dapat diakses dari perangkat lain pada Wi-Fi yang sama memakai IP PC.

## Konsep UI

UI siswa menampilkan stimulus, area respons, status sesi, clickstream ringan, durasi interaksi, dan preview posisi kamera kecil.

UI guru menampilkan shadow preview tampilan siswa, panel kontrol navigasi, preview/status kamera, panel penilaian, catatan, dan timeline event.

Preview siswa di sisi guru bukan screen streaming. Preview tersebut merender state soal yang sama dari session controller.
