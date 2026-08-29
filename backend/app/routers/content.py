import json

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
        "title": "Susun kalimat",
        "prompt": "Susun blok kata menjadi kalimat yang benar.",
        "instruction_text": "Pindahkan semua blok kata ke slot jawaban sesuai urutan kalimat lengkap.",
        "stimulus": "adik | bola | bermain",
        "options": ["adik", "bermain", "bola"],
        "correct_answer": "adik bermain bola",
        "scoring_mode": "system",
        "sort_order": 1,
    },
    {
        "item_code": "RA001",
        "category": "reading_assessment",
        "title": "Baca kalimat panjang",
        "prompt": "Bacalah kalimat panjang berikut dengan jelas.",
        "instruction_text": "Baca kalimat dari kiri ke kanan dengan suara jelas.",
        "stimulus": "Di halaman sekolah, Rani membaca buku cerita sambil menunggu ibunya datang menjemput.",
        "scoring_mode": "teacher_rubric",
        "sort_order": 2,
    },
    {
        "item_code": "PA001",
        "category": "phonological_awareness",
        "title": "Baca kata",
        "prompt": "Bacalah kata berikut.",
        "instruction_text": "Fokus pada bunyi setiap suku kata, lalu baca kata utuh.",
        "stimulus": "KELAPA",
        "scoring_mode": "teacher_rubric",
        "sort_order": 3,
    },
    {
        "item_code": "RN001",
        "category": "rapid_naming",
        "title": "Rapid naming kata",
        "prompt": "Sebutkan kata/gambar secepat dan setepat mungkin.",
        "instruction_text": "Sebutkan setiap item dari kiri ke kanan tanpa berhenti lama.",
        "stimulus": "meja | buku | sapi | roda",
        "options": ["meja", "buku", "sapi", "roda"],
        "scoring_mode": "binary",
        "sort_order": 4,
    },
    {
        "item_code": "WR001",
        "category": "writing",
        "title": "Foto tulisan",
        "prompt": "Unggah foto tulisan siswa untuk dokumentasi.",
        "instruction_text": "Guru mengambil atau memilih foto tulisan siswa setelah tugas menulis selesai.",
        "stimulus": "Foto tulisan tangan siswa",
        "scoring_mode": "upload",
        "sort_order": 5,
    },
]


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
        created_at=item.created_at.isoformat(),
    )


def ensure_default_items(db: Session) -> None:
    for payload in DEFAULT_ITEMS:
        exists = db.query(AssessmentItem).filter_by(item_code=payload["item_code"]).first()
        if exists:
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
    if payload.scoring_mode == "system" and not payload.correct_answer:
        raise HTTPException(status_code=422, detail="Correct answer is required for system scoring")
    if payload.scoring_mode == "system" and not payload.options:
        raise HTTPException(status_code=422, detail="Options are required for system scoring")
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
    if payload.scoring_mode == "system" and not payload.correct_answer:
        raise HTTPException(status_code=422, detail="Correct answer is required for system scoring")
    if payload.scoring_mode == "system" and not payload.options:
        raise HTTPException(status_code=422, detail="Options are required for system scoring")
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
    item.is_active = payload.is_active
    db.commit()
    db.refresh(item)
    return to_read(item)
