import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AssessmentItem
from app.schemas import AssessmentItemCreate, AssessmentItemRead, AssessmentItemStatusUpdate
from app.security import require_teacher

router = APIRouter(prefix="/assessment-items", tags=["assessment-items"])


DEFAULT_ITEMS = [
    {
        "item_code": "IF001",
        "category": "intelligence_fluid",
        "title": "Contoh susun kalimat",
        "prompt": "Susun blok kata menjadi kalimat yang benar.",
        "instruction_text": "Ini soal contoh. Pindahkan semua blok kata ke slot jawaban sesuai urutan kalimat lengkap.",
        "stimulus": "adik | bola | bermain",
        "options": ["adik", "bermain", "bola"],
        "correct_answer": "adik bermain bola",
        "scoring_mode": "system",
        "sort_order": 101,
        "is_example": True,
    },
    {
        "item_code": "IF002",
        "category": "intelligence_fluid",
        "title": "Susun kalimat sederhana",
        "prompt": "Susun blok kata menjadi kalimat yang benar.",
        "instruction_text": "Pindahkan kata ke slot jawaban sampai kalimat lengkap terbentuk.",
        "stimulus": "saya | minum | susu",
        "options": ["saya", "minum", "susu"],
        "correct_answer": "saya minum susu",
        "scoring_mode": "system",
        "sort_order": 102,
    },
    {
        "item_code": "IF003",
        "category": "intelligence_fluid",
        "title": "Lengkapi kalimat",
        "prompt": "Lengkapi kalimat dengan blok kata yang sesuai.",
        "instruction_text": "Pilih dan susun kata agar bagian kosong membentuk kalimat benar.",
        "stimulus": "Ibu membeli ___ di pasar.",
        "options": ["roti", "membeli", "pasar", "ibu"],
        "correct_answer": "ibu membeli roti di pasar",
        "scoring_mode": "system",
        "sort_order": 103,
    },
    {
        "item_code": "IF004",
        "category": "intelligence_fluid",
        "title": "Urutan makna kalimat",
        "prompt": "Susun blok kata agar makna kalimat tepat.",
        "instruction_text": "Urutkan semua blok kata dari awal sampai akhir.",
        "stimulus": "pagi | setiap | membaca | rina",
        "options": ["rina", "membaca", "setiap", "pagi"],
        "correct_answer": "rina membaca setiap pagi",
        "scoring_mode": "system",
        "sort_order": 104,
    },
    {
        "item_code": "RA001",
        "category": "reading_assessment",
        "title": "Contoh baca kalimat",
        "prompt": "Bacalah kalimat berikut dengan jelas.",
        "instruction_text": "Ini soal contoh. Guru menilai kelancaran, akurasi, dan kepercayaan diri.",
        "stimulus": "Dina pergi ke taman bersama ibu.",
        "scoring_mode": "teacher_rubric",
        "sort_order": 201,
        "is_example": True,
    },
    {
        "item_code": "RA002",
        "category": "reading_assessment",
        "title": "Kalimat panjang sekolah",
        "prompt": "Bacalah kalimat panjang berikut dengan jelas.",
        "instruction_text": "Baca kalimat dari kiri ke kanan dengan suara jelas.",
        "stimulus": "Di halaman sekolah, Rani membaca buku cerita sambil menunggu ibunya datang menjemput.",
        "scoring_mode": "teacher_rubric",
        "sort_order": 202,
    },
    {
        "item_code": "RA003",
        "category": "reading_assessment",
        "title": "Kalimat informatif",
        "prompt": "Bacalah kalimat berikut tanpa melewatkan kata.",
        "instruction_text": "Guru menekan benar jika kalimat dibaca utuh dan tepat.",
        "stimulus": "Ayah menanam pohon mangga kecil di kebun belakang rumah.",
        "scoring_mode": "binary",
        "sort_order": 203,
    },
    {
        "item_code": "RA004",
        "category": "reading_assessment",
        "title": "Pemahaman kalimat sederhana",
        "prompt": "Susun kata berdasarkan kalimat yang kamu dengar.",
        "instruction_text": "Pindahkan blok kata menjadi kalimat lengkap.",
        "stimulus": "kucing | tidur | di | kursi",
        "options": ["kucing", "tidur", "di", "kursi"],
        "correct_answer": "kucing tidur di kursi",
        "scoring_mode": "system",
        "sort_order": 204,
    },
    {
        "item_code": "PA001",
        "category": "phonological_awareness",
        "title": "Contoh baca kata",
        "prompt": "Bacalah kata berikut.",
        "instruction_text": "Ini soal contoh. Fokus pada bunyi setiap suku kata, lalu baca kata utuh.",
        "stimulus": "KELAPA",
        "scoring_mode": "teacher_rubric",
        "sort_order": 301,
        "is_example": True,
    },
    {
        "item_code": "PA002",
        "category": "phonological_awareness",
        "title": "Baca kata multisuku",
        "prompt": "Bacalah kata berikut.",
        "instruction_text": "Guru menilai kelancaran, akurasi bunyi, dan kepercayaan diri.",
        "stimulus": "BERMAIN",
        "scoring_mode": "teacher_rubric",
        "sort_order": 302,
    },
    {
        "item_code": "PA003",
        "category": "phonological_awareness",
        "title": "Deteksi bunyi awal",
        "prompt": "Apakah dua kata ini memiliki bunyi awal yang sama?",
        "instruction_text": "Guru tekan benar jika siswa menjawab tepat.",
        "stimulus": "batu - buku",
        "scoring_mode": "binary",
        "sort_order": 303,
    },
    {
        "item_code": "PA004",
        "category": "phonological_awareness",
        "title": "Susun suku kata",
        "prompt": "Susun blok suku kata menjadi kata benar.",
        "instruction_text": "Pindahkan blok suku kata sesuai urutan kata.",
        "stimulus": "me | la | ti",
        "options": ["me", "la", "ti"],
        "correct_answer": "me la ti",
        "scoring_mode": "system",
        "sort_order": 304,
    },
    {
        "item_code": "RN001",
        "category": "rapid_naming",
        "title": "Contoh rapid naming",
        "prompt": "Sebutkan kata/gambar secepat dan setepat mungkin.",
        "instruction_text": "Ini soal contoh. Sebutkan setiap item dari kiri ke kanan.",
        "stimulus": "meja | buku | sapi | roda",
        "options": ["meja", "buku", "sapi", "roda"],
        "scoring_mode": "binary",
        "sort_order": 401,
        "is_example": True,
    },
    {
        "item_code": "RN002",
        "category": "rapid_naming",
        "title": "Rapid naming benda",
        "prompt": "Sebutkan semua kata secepat dan setepat mungkin.",
        "instruction_text": "Guru tekan benar jika semua item disebut tepat.",
        "stimulus": "bola | gelas | kursi | pintu | lampu",
        "options": ["bola", "gelas", "kursi", "pintu", "lampu"],
        "scoring_mode": "binary",
        "sort_order": 402,
    },
    {
        "item_code": "RN003",
        "category": "rapid_naming",
        "title": "Rapid naming warna",
        "prompt": "Sebutkan warna yang tampil dengan cepat.",
        "instruction_text": "Guru menilai kelancaran penyebutan, akurasi, dan kepercayaan diri.",
        "stimulus": "merah | biru | hijau | kuning | hitam",
        "options": ["merah", "biru", "hijau", "kuning", "hitam"],
        "scoring_mode": "teacher_rubric",
        "sort_order": 403,
    },
    {
        "item_code": "RN004",
        "category": "rapid_naming",
        "title": "Rapid naming gambar URL",
        "prompt": "Sebutkan gambar yang tampil.",
        "instruction_text": "Guru tekan benar jika gambar disebut tepat.",
        "stimulus": "https://upload.wikimedia.org/wikipedia/commons/2/25/Red.svg",
        "scoring_mode": "binary",
        "sort_order": 404,
    },
    {
        "item_code": "WR001",
        "category": "writing",
        "title": "Contoh foto tulisan",
        "prompt": "Ambil foto tulisan siswa untuk contoh.",
        "instruction_text": "Ini soal contoh. Guru memilih file foto tulisan siswa.",
        "stimulus": "Tuliskan nama lengkap.",
        "scoring_mode": "upload",
        "sort_order": 501,
        "is_example": True,
    },
    {
        "item_code": "WR002",
        "category": "writing",
        "title": "Salin kata",
        "prompt": "Ambil foto hasil salin kata siswa.",
        "instruction_text": "Guru memilih foto setelah siswa menyalin kata.",
        "stimulus": "Salin kata: matahari",
        "scoring_mode": "upload",
        "sort_order": 502,
    },
    {
        "item_code": "WR003",
        "category": "writing",
        "title": "Salin kalimat",
        "prompt": "Nilai hasil menyalin kalimat pendek.",
        "instruction_text": "Guru menilai bentuk tulisan, keterbacaan, dan ketepatan salinan.",
        "stimulus": "Saya suka membaca buku.",
        "scoring_mode": "teacher_rubric",
        "sort_order": 503,
    },
    {
        "item_code": "WR004",
        "category": "writing",
        "title": "Tulisan kata dikte",
        "prompt": "Ambil foto tulisan kata dikte siswa.",
        "instruction_text": "Guru tekan benar jika kata yang ditulis sesuai dikte.",
        "stimulus": "Kata dikte: bermain",
        "scoring_mode": "binary",
        "sort_order": 504,
    },
]


def build_extra_default_items() -> list[dict]:
    specs = {
        "intelligence_fluid": {
            "prefix": "IF",
            "base": 100,
            "prompt": "Susun blok kata menjadi kalimat yang benar.",
            "instruction": "Urutkan semua blok kata sampai kalimat lengkap terbentuk.",
            "stimuli": [
                ("ani | makan | nasi", ["ani", "makan", "nasi"], "ani makan nasi"),
                ("budi | membaca | buku", ["budi", "membaca", "buku"], "budi membaca buku"),
                ("kakak | menyiram | bunga", ["kakak", "menyiram", "bunga"], "kakak menyiram bunga"),
                ("mereka | bermain | di | taman", ["mereka", "bermain", "di", "taman"], "mereka bermain di taman"),
            ],
            "mode": "system",
        },
        "reading_assessment": {
            "prefix": "RA",
            "base": 200,
            "prompt": "Bacalah kalimat berikut dengan jelas.",
            "instruction": "Baca dari kiri ke kanan, perhatikan jeda dan ketepatan kata.",
            "stimuli": [
                "Siswa membaca buku cerita di perpustakaan sekolah.",
                "Ibu menyiapkan sarapan sebelum semua anak berangkat belajar.",
                "Cuaca pagi ini cerah sehingga kelas olahraga dilakukan di lapangan.",
                "Raka membawa pensil warna untuk menggambar pemandangan gunung.",
            ],
            "mode": "teacher_rubric",
        },
        "phonological_awareness": {
            "prefix": "PA",
            "base": 300,
            "prompt": "Bacalah kata atau pasangan bunyi berikut.",
            "instruction": "Perhatikan bunyi awal, tengah, dan akhir sebelum menjawab.",
            "stimuli": ["MELATI", "BERLARI", "padi - pagi", "sapu - sapi", "kereta", "matahari"],
            "mode": "teacher_rubric",
        },
        "rapid_naming": {
            "prefix": "RN",
            "base": 400,
            "prompt": "Sebutkan semua item secepat dan setepat mungkin.",
            "instruction": "Sebutkan item dari kiri ke kanan tanpa jeda lama.",
            "stimuli": [
                "apel | meja | roda | buku | topi",
                "merah | biru | hijau | putih | hitam",
                "kuda | sapi | ayam | ikan | bebek",
                "satu | dua | tiga | empat | lima",
            ],
            "mode": "binary",
        },
        "writing": {
            "prefix": "WR",
            "base": 500,
            "prompt": "Dokumentasikan hasil tulisan siswa.",
            "instruction": "Guru mengambil atau memilih foto hasil tulisan siswa.",
            "stimuli": [
                "Salin kata: sekolah",
                "Salin kalimat: Aku suka belajar.",
                "Tulis kata dikte: keluarga",
                "Tulis nama benda di kelas.",
            ],
            "mode": "upload",
        },
    }
    existing_codes = {item["item_code"] for item in DEFAULT_ITEMS}
    extras: list[dict] = []
    for category, spec in specs.items():
        prefix = spec["prefix"]
        for number in range(5, 26):
            code = f"{prefix}{number:03d}"
            if code in existing_codes:
                continue
            mode = spec["mode"]
            if category == "reading_assessment" and number % 5 == 0:
                mode = "binary"
            if category == "phonological_awareness" and number % 4 == 0:
                mode = "binary"
            if category == "rapid_naming" and number % 6 == 0:
                mode = "teacher_rubric"
            if category == "writing" and number % 5 == 0:
                mode = "teacher_rubric"
            stimulus_source = spec["stimuli"][(number - 5) % len(spec["stimuli"])]
            payload = {
                "item_code": code,
                "category": category,
                "title": f"Sampel {code}",
                "prompt": spec["prompt"],
                "instruction_text": spec["instruction"],
                "scoring_mode": mode,
                "sort_order": spec["base"] + number,
                "show_student_timer": mode in {"binary", "teacher_rubric"} and number % 3 == 0,
            }
            if category == "intelligence_fluid":
                stimulus, options, answer = stimulus_source
                payload.update({"stimulus": stimulus, "options": options, "correct_answer": answer})
            else:
                payload["stimulus"] = stimulus_source
            extras.append(payload)
    return extras


DEFAULT_ITEMS.extend(build_extra_default_items())


def to_read(item: AssessmentItem) -> AssessmentItemRead:
    return AssessmentItemRead(
        id=item.id,
        item_code=item.item_code,
        category=item.category,
        title=item.title,
        prompt=item.prompt,
        instruction_text=item.instruction_text,
        stimulus=item.stimulus,
        options=json.loads(item.options or "[]"),
        correct_answer=item.correct_answer,
        scoring_mode=item.scoring_mode,
        sort_order=item.sort_order,
        is_active=item.is_active,
        is_example=item.is_example,
        show_student_timer=item.show_student_timer,
        created_at=item.created_at.isoformat(),
    )


def validate_example_limit(db: Session, category: str, is_example: bool, is_active: bool, item_id: Optional[str] = None) -> None:
    if not is_example or not is_active:
        return
    query = db.query(AssessmentItem).filter_by(category=category, is_example=True, is_active=True)
    if item_id:
        query = query.filter(AssessmentItem.id != item_id)
    if query.count() >= 2:
        raise HTTPException(status_code=422, detail="Maksimal 2 soal contoh aktif per kategori")


def ensure_default_items(db: Session) -> None:
    for payload in DEFAULT_ITEMS:
        exists = db.query(AssessmentItem).filter_by(item_code=payload["item_code"]).first()
        if exists:
            if payload.get("is_example") and not exists.is_example:
                exists.is_example = True
            continue
        db.add(
            AssessmentItem(
                item_code=payload["item_code"],
                category=payload["category"],
                title=payload["title"],
                prompt=payload["prompt"],
                instruction_text=payload.get("instruction_text", ""),
                stimulus=payload.get("stimulus", ""),
                options=json.dumps(payload.get("options", [])),
                correct_answer=payload.get("correct_answer"),
                scoring_mode=payload["scoring_mode"],
                sort_order=payload["sort_order"],
                is_example=payload.get("is_example", False),
                show_student_timer=payload.get("show_student_timer", False),
            )
        )
    db.commit()


@router.get("", response_model=list[AssessmentItemRead])
def list_items(_teacher=Depends(require_teacher), db: Session = Depends(get_db)):
    ensure_default_items(db)
    items = db.query(AssessmentItem).order_by(AssessmentItem.sort_order, AssessmentItem.created_at).all()
    return [to_read(item) for item in items]


@router.post("", response_model=AssessmentItemRead)
def create_item(payload: AssessmentItemCreate, _teacher=Depends(require_teacher), db: Session = Depends(get_db)):
    exists = db.query(AssessmentItem).filter_by(item_code=payload.item_code).first()
    if exists:
        raise HTTPException(status_code=409, detail="Item code already exists")
    if payload.scoring_mode in {"system", "multiple_choice"} and not payload.correct_answer:
        raise HTTPException(status_code=422, detail="Correct answer is required for this scoring mode")
    if payload.scoring_mode in {"system", "multiple_choice"} and not payload.options:
        raise HTTPException(status_code=422, detail="Options are required for this scoring mode")
    validate_example_limit(db, payload.category, payload.is_example, payload.is_active)
    item = AssessmentItem(
        item_code=payload.item_code,
        category=payload.category,
        title=payload.title,
        prompt=payload.prompt,
        instruction_text=payload.instruction_text,
        stimulus=payload.stimulus,
        options=json.dumps(payload.options),
        correct_answer=payload.correct_answer,
        scoring_mode=payload.scoring_mode,
        sort_order=payload.sort_order,
        is_active=payload.is_active,
        is_example=payload.is_example,
        show_student_timer=payload.show_student_timer,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return to_read(item)


@router.put("/{item_id}", response_model=AssessmentItemRead)
def update_item(
    item_id: str,
    payload: AssessmentItemCreate,
    _teacher=Depends(require_teacher),
    db: Session = Depends(get_db),
):
    item = db.get(AssessmentItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Assessment item not found")
    exists = db.query(AssessmentItem).filter(AssessmentItem.item_code == payload.item_code).first()
    if exists and exists.id != item.id:
        raise HTTPException(status_code=409, detail="Item code already exists")
    if payload.scoring_mode in {"system", "multiple_choice"} and not payload.correct_answer:
        raise HTTPException(status_code=422, detail="Correct answer is required for this scoring mode")
    if payload.scoring_mode in {"system", "multiple_choice"} and not payload.options:
        raise HTTPException(status_code=422, detail="Options are required for this scoring mode")
    validate_example_limit(db, payload.category, payload.is_example, payload.is_active, item.id)
    item.item_code = payload.item_code
    item.category = payload.category
    item.title = payload.title
    item.prompt = payload.prompt
    item.instruction_text = payload.instruction_text
    item.stimulus = payload.stimulus
    item.options = json.dumps(payload.options)
    item.correct_answer = payload.correct_answer
    item.scoring_mode = payload.scoring_mode
    item.sort_order = payload.sort_order
    item.is_active = payload.is_active
    item.is_example = payload.is_example
    item.show_student_timer = payload.show_student_timer
    db.commit()
    db.refresh(item)
    return to_read(item)


@router.patch("/{item_id}/status", response_model=AssessmentItemRead)
def update_item_status(
    item_id: str,
    payload: AssessmentItemStatusUpdate,
    _teacher=Depends(require_teacher),
    db: Session = Depends(get_db),
):
    item = db.get(AssessmentItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Assessment item not found")
    validate_example_limit(db, item.category, item.is_example, payload.is_active, item.id)
    item.is_active = payload.is_active
    db.commit()
    db.refresh(item)
    return to_read(item)
