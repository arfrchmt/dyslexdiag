import json
import re
from time import perf_counter

from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AssessmentSession, StudentVideoRecord, SubjectiveGrade, TeacherNote, TimelineEvent
from app.schemas import (
    AcknowledgmentCreate,
    NavigationCommand,
    SessionCreate,
    SessionState,
    SessionUiControlUpdate,
    StudentStatusUpdate,
    SubjectiveGradeCreate,
    TeacherNoteCreate,
    TimelineEventRead,
)
from app.security import require_session_access, require_student, require_teacher

router = APIRouter(prefix="/sessions", tags=["sessions"])
server_started = perf_counter()
media_root = Path(__file__).resolve().parents[2] / "media"


def elapsed_ms() -> float:
    return round((perf_counter() - server_started) * 1000, 3)


def safe_filename_part(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-")[:80] or "item"


def normalize_answer(value: object) -> str:
    text = str(value or "").lower().strip()
    return " ".join(text.replace(".", "").replace(",", "").split())


def system_answer_score(payload: dict) -> int:
    answer = normalize_answer(payload.get("answer"))
    expected = normalize_answer(payload.get("expected"))
    if not answer or not expected:
        return 0
    if answer == expected:
        return 10
    if answer in expected or expected in answer:
        return 10
    return int(payload.get("score", 0))


def to_state(session: AssessmentSession) -> SessionState:
    return SessionState(
        id=session.id,
        student_id=session.student_id,
        code=session.code,
        student_name=session.student_name,
        active_sequence=session.active_sequence,
        active_question_id=session.active_question_id,
        active_question_text=session.active_question_text,
        active_instruction_text=session.active_instruction_text,
        active_category=session.active_category,
        active_scoring_mode=session.active_scoring_mode,
        active_options=json.loads(session.active_options or "[]"),
        active_correct_answer=session.active_correct_answer,
        active_show_student_timer=session.active_show_student_timer,
        camera_enabled=session.camera_enabled,
        theme_name=session.theme_name,
        status=session.status,
        hide_student_side=session.hide_student_side,
        fullscreen_active=session.fullscreen_active,
        request_student_fullscreen=session.request_student_fullscreen,
        request_student_camera=session.request_student_camera,
        force_student_logout=session.force_student_logout,
        started_at=session.started_at.isoformat() if session.started_at else None,
        finished_at=session.finished_at.isoformat() if session.finished_at else None,
        assessment_finished=session.finished_at is not None or session.status == "ASSESSMENT_FINISHED",
    )


@router.post("", response_model=SessionState)
def create_session(
    payload: SessionCreate,
    _teacher=Depends(require_teacher),
    db: Session = Depends(get_db),
):
    existing = db.query(AssessmentSession).filter_by(code=payload.code).first()
    if existing:
        return to_state(existing)

    session = AssessmentSession(code=payload.code, student_name=payload.student_name)
    db.add(session)
    db.flush()
    db.add(
        TimelineEvent(
            session_id=session.id,
            sequence=session.active_sequence,
            event_type="SESSION_CREATED",
            t_ms=elapsed_ms(),
        )
    )
    db.commit()
    db.refresh(session)
    return to_state(session)


@router.get("/{code}", response_model=SessionState)
def get_session(session: AssessmentSession = Depends(require_session_access)):
    return to_state(session)


@router.post("/{code}/navigate", response_model=SessionState)
def navigate(
    code: str,
    payload: NavigationCommand,
    _teacher=Depends(require_teacher),
    db: Session = Depends(get_db),
):
    session = db.query(AssessmentSession).filter_by(code=code).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.finished_at:
        raise HTTPException(status_code=409, detail="Assessment already finished")

    session.active_sequence += 1
    session.active_question_id = payload.question_id
    session.active_question_text = payload.question_text
    session.active_instruction_text = payload.instruction_text
    session.active_category = payload.category
    session.active_scoring_mode = payload.scoring_mode
    session.active_options = json.dumps(payload.options)
    session.active_correct_answer = payload.correct_answer
    session.active_show_student_timer = payload.show_student_timer
    session.force_student_logout = False
    session.status = "QUESTION_ISSUED"
    session.updated_at = datetime.utcnow()
    db.add(
        TimelineEvent(
            session_id=session.id,
            sequence=session.active_sequence,
            event_type="QUESTION_ISSUED",
            t_ms=elapsed_ms(),
            payload=json.dumps(payload.model_dump()),
        )
    )
    db.commit()
    db.refresh(session)
    return to_state(session)


@router.patch("/{code}/ui-controls", response_model=SessionState)
def update_ui_controls(
    code: str,
    payload: SessionUiControlUpdate,
    _teacher=Depends(require_teacher),
    db: Session = Depends(get_db),
):
    session = db.query(AssessmentSession).filter_by(code=code).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.finished_at:
        raise HTTPException(status_code=409, detail="Assessment already finished")

    if payload.hide_student_side is not None:
        session.hide_student_side = payload.hide_student_side
    if payload.request_student_fullscreen is not None:
        session.request_student_fullscreen = payload.request_student_fullscreen
    if payload.request_student_camera is not None:
        session.request_student_camera = payload.request_student_camera
    if payload.theme_name is not None:
        session.theme_name = payload.theme_name
    session.updated_at = datetime.utcnow()
    db.add(
        TimelineEvent(
            session_id=session.id,
            sequence=session.active_sequence,
            event_type="UI_CONTROL_UPDATED",
            t_ms=elapsed_ms(),
            payload=json.dumps(payload.model_dump()),
        )
    )
    db.commit()
    db.refresh(session)
    return to_state(session)


@router.patch("/{code}/student-status", response_model=SessionState)
def update_student_status(
    code: str,
    payload: StudentStatusUpdate,
    student_session: AssessmentSession = Depends(require_student),
    db: Session = Depends(get_db),
):
    if student_session.code != code:
        raise HTTPException(status_code=403, detail="Session access denied")

    student_session.fullscreen_active = payload.fullscreen_active
    if payload.fullscreen_active:
        student_session.request_student_fullscreen = False
    student_session.updated_at = datetime.utcnow()
    db.add(
        TimelineEvent(
            session_id=student_session.id,
            sequence=student_session.active_sequence,
            event_type="STUDENT_FULLSCREEN_CHANGED",
            t_ms=elapsed_ms(),
            payload=json.dumps(payload.model_dump()),
        )
    )
    db.commit()
    db.refresh(student_session)
    return to_state(student_session)


@router.post("/{code}/ack", response_model=TimelineEventRead)
def acknowledge(
    payload: AcknowledgmentCreate,
    session: AssessmentSession = Depends(require_session_access),
    db: Session = Depends(get_db),
):
    event = TimelineEvent(
        session_id=session.id,
        sequence=payload.sequence,
        event_type=payload.event_type,
        t_ms=payload.t_ms,
        payload=json.dumps(payload.payload),
    )
    session.status = payload.event_type
    session.updated_at = datetime.utcnow()
    db.add(event)
    if payload.event_type == "STUDENT_SYSTEM_SCORE":
        score = max(0, min(10, system_answer_score(payload.payload)))
        grade = SubjectiveGrade(
            session_id=session.id,
            sequence=payload.sequence,
            fluency=score,
            accuracy=score,
            confidence=score,
            total=score * 3,
        )
        db.add(grade)
    db.commit()
    return TimelineEventRead(
        sequence=event.sequence,
        event_type=event.event_type,
        t_ms=event.t_ms,
        payload=event.payload,
    )


@router.post("/{code}/recordings")
async def upload_recording(
    code: str,
    request: Request,
    sequence: int,
    question_id: str,
    duration_ms: float = 0,
    student_session: AssessmentSession = Depends(require_student),
    db: Session = Depends(get_db),
):
    if student_session.code != code:
        raise HTTPException(status_code=403, detail="Session access denied")
    if student_session.finished_at:
        raise HTTPException(status_code=409, detail="Assessment already finished")
    if not student_session.camera_enabled:
        raise HTTPException(status_code=409, detail="Camera recording is disabled")

    body = await request.body()
    if not body:
        raise HTTPException(status_code=422, detail="Recording body is empty")

    mime_type = request.headers.get("content-type", "video/webm").split(";")[0]
    extension = "webm" if "webm" in mime_type else "mp4" if "mp4" in mime_type else "bin"
    session_dir = media_root / "recordings" / safe_filename_part(code)
    session_dir.mkdir(parents=True, exist_ok=True)
    safe_question_id = safe_filename_part(question_id)
    filename = f"seq-{sequence:03d}-{safe_question_id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}.{extension}"
    file_path = session_dir / filename
    file_path.write_bytes(body)

    relative_path = file_path.relative_to(media_root).as_posix()
    record = StudentVideoRecord(
        session_id=student_session.id,
        sequence=sequence,
        question_id=question_id,
        file_path=relative_path,
        mime_type=mime_type,
        size_bytes=len(body),
        duration_ms=duration_ms,
    )
    db.add(record)
    db.add(
        TimelineEvent(
            session_id=student_session.id,
            sequence=sequence,
            event_type="STUDENT_RECORDING_SAVED",
            t_ms=elapsed_ms(),
            payload=json.dumps(
                {
                    "questionId": question_id,
                    "duration_ms": duration_ms,
                    "size_bytes": len(body),
                    "source": f"/media/{relative_path}",
                }
            ),
        )
    )
    db.commit()
    db.refresh(record)
    return {"id": record.id, "source": f"/media/{relative_path}", "size_bytes": len(body)}


@router.post("/{code}/camera-preview")
async def upload_camera_preview(
    code: str,
    request: Request,
    sequence: int,
    question_id: str,
    student_session: AssessmentSession = Depends(require_student),
    db: Session = Depends(get_db),
):
    if student_session.code != code:
        raise HTTPException(status_code=403, detail="Session access denied")
    if student_session.finished_at:
        raise HTTPException(status_code=409, detail="Assessment already finished")
    if not student_session.camera_enabled:
        raise HTTPException(status_code=409, detail="Camera preview is disabled")

    body = await request.body()
    if not body:
        raise HTTPException(status_code=422, detail="Preview body is empty")

    session_dir = media_root / "previews" / safe_filename_part(code)
    session_dir.mkdir(parents=True, exist_ok=True)
    safe_question_id = safe_filename_part(question_id)
    filename = f"preview-seq-{sequence:03d}-{safe_question_id}.jpg"
    file_path = session_dir / filename
    file_path.write_bytes(body)
    relative_path = file_path.relative_to(media_root).as_posix()
    source = f"/media/{relative_path}?v={int(datetime.utcnow().timestamp() * 1000)}"

    db.add(
        TimelineEvent(
            session_id=student_session.id,
            sequence=sequence,
            event_type="STUDENT_CAMERA_PREVIEW",
            t_ms=elapsed_ms(),
            payload=json.dumps(
                {
                    "questionId": question_id,
                    "source": source,
                    "size_bytes": len(body),
                }
            ),
        )
    )
    student_session.status = "STUDENT_CAMERA_PREVIEW"
    student_session.updated_at = datetime.utcnow()
    db.commit()
    return {"source": source, "size_bytes": len(body)}


@router.post("/{code}/grades")
def create_grade(
    code: str,
    payload: SubjectiveGradeCreate,
    _teacher=Depends(require_teacher),
    db: Session = Depends(get_db),
):
    session = db.query(AssessmentSession).filter_by(code=code).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.finished_at:
        raise HTTPException(status_code=409, detail="Assessment already finished")

    total = payload.fluency + payload.accuracy + payload.confidence
    session.updated_at = datetime.utcnow()
    grade = SubjectiveGrade(session_id=session.id, total=total, **payload.model_dump())
    db.add(grade)
    db.add(
        TimelineEvent(
            session_id=session.id,
            sequence=payload.sequence,
            event_type="TEACHER_SCORE",
            t_ms=elapsed_ms(),
            payload=json.dumps({"total": total}),
        )
    )
    db.commit()
    return {"total": total}


@router.post("/{code}/notes")
def create_note(
    code: str,
    payload: TeacherNoteCreate,
    _teacher=Depends(require_teacher),
    db: Session = Depends(get_db),
):
    session = db.query(AssessmentSession).filter_by(code=code).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.finished_at:
        raise HTTPException(status_code=409, detail="Assessment already finished")

    note = TeacherNote(session_id=session.id, **payload.model_dump())
    session.updated_at = datetime.utcnow()
    db.add(note)
    db.add(
        TimelineEvent(
            session_id=session.id,
            sequence=payload.sequence,
            event_type="TEACHER_NOTE",
            t_ms=elapsed_ms(),
            payload=json.dumps({"note": payload.note}),
        )
    )
    db.commit()
    return {"status": "saved"}


@router.post("/{code}/finish", response_model=SessionState)
def finish_assessment(
    code: str,
    _teacher=Depends(require_teacher),
    db: Session = Depends(get_db),
):
    session = db.query(AssessmentSession).filter_by(code=code).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.status = "ASSESSMENT_FINISHED"
    session.force_student_logout = True
    session.finished_at = datetime.utcnow()
    session.updated_at = session.finished_at
    db.add(
        TimelineEvent(
            session_id=session.id,
            sequence=session.active_sequence,
            event_type="ASSESSMENT_FINISHED",
            t_ms=elapsed_ms(),
        )
    )
    db.commit()
    db.refresh(session)
    return to_state(session)


@router.post("/{code}/student-logout", response_model=SessionState)
def force_student_logout(
    code: str,
    _teacher=Depends(require_teacher),
    db: Session = Depends(get_db),
):
    session = db.query(AssessmentSession).filter_by(code=code).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.force_student_logout = True
    session.status = "STUDENT_LOGOUT_REQUESTED"
    session.updated_at = datetime.utcnow()
    db.add(
        TimelineEvent(
            session_id=session.id,
            sequence=session.active_sequence,
            event_type="STUDENT_LOGOUT_REQUESTED",
            t_ms=elapsed_ms(),
        )
    )
    db.commit()
    db.refresh(session)
    return to_state(session)


@router.get("/{code}/graded-question-ids")
def graded_question_ids(
    code: str,
    _teacher=Depends(require_teacher),
    db: Session = Depends(get_db),
):
    session = db.query(AssessmentSession).filter_by(code=code).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    graded_sequences = {
        sequence
        for (sequence,) in db.query(SubjectiveGrade.sequence)
        .filter_by(session_id=session.id)
        .distinct()
        .all()
    }
    if not graded_sequences:
        return {"question_ids": []}

    question_ids = set()
    issued_events = (
        db.query(TimelineEvent)
        .filter_by(session_id=session.id, event_type="QUESTION_ISSUED")
        .filter(TimelineEvent.sequence.in_(graded_sequences))
        .all()
    )
    for event in issued_events:
        try:
            payload = json.loads(event.payload or "{}")
        except json.JSONDecodeError:
            payload = {}
        question_id = payload.get("question_id")
        if isinstance(question_id, str) and question_id:
            question_ids.add(question_id)

    if session.active_sequence in graded_sequences and session.active_question_id != "WAITING":
        question_ids.add(session.active_question_id)

    return {"question_ids": sorted(question_ids)}


@router.get("/{code}/question-scores")
def question_scores(
    code: str,
    _teacher=Depends(require_teacher),
    db: Session = Depends(get_db),
):
    session = db.query(AssessmentSession).filter_by(code=code).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    sequence_to_question = {}
    issued_events = (
        db.query(TimelineEvent)
        .filter_by(session_id=session.id, event_type="QUESTION_ISSUED")
        .order_by(TimelineEvent.created_at.asc())
        .all()
    )
    for event in issued_events:
        try:
            payload = json.loads(event.payload or "{}")
        except json.JSONDecodeError:
            payload = {}
        question_id = payload.get("question_id")
        if isinstance(question_id, str) and question_id:
            sequence_to_question[event.sequence] = question_id

    if session.active_question_id != "WAITING":
        sequence_to_question.setdefault(session.active_sequence, session.active_question_id)

    grades = (
        db.query(SubjectiveGrade)
        .filter_by(session_id=session.id)
        .order_by(SubjectiveGrade.created_at.desc())
        .all()
    )
    scores = {}
    for grade in grades:
        question_id = sequence_to_question.get(grade.sequence)
        if not question_id or question_id in scores:
            continue
        scores[question_id] = {
            "fluency": grade.fluency,
            "accuracy": grade.accuracy,
            "confidence": grade.confidence,
            "total": grade.total,
            "sequence": grade.sequence,
        }

    return {"scores": scores}


@router.get("/{code}/timeline", response_model=list[TimelineEventRead])
def timeline(session: AssessmentSession = Depends(require_session_access), db: Session = Depends(get_db)):
    events = (
        db.query(TimelineEvent)
        .filter_by(session_id=session.id)
        .order_by(TimelineEvent.created_at.desc())
        .limit(200)
        .all()
    )
    return [
        TimelineEventRead(
            sequence=event.sequence,
            event_type=event.event_type,
            t_ms=event.t_ms,
            payload=event.payload,
        )
        for event in events
    ]
