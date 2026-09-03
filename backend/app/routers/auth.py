from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import AssessmentSession, Student, StudentAccessToken, TimelineEvent, User
from app.routers.sessions import elapsed_ms, to_state
from app.schemas import (
    AuthResponse,
    StudentAuthResponse,
    StudentTokenCreate,
    StudentTokenLogin,
    StudentTokenResponse,
    TeacherLogin,
)
from app.security import (
    create_jwt,
    ensure_default_teacher,
    find_valid_student_token,
    generate_student_code,
    hash_password,
    require_teacher,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/teacher/login", response_model=AuthResponse)
def teacher_login(payload: TeacherLogin, db: Session = Depends(get_db)):
    ensure_default_teacher(db)
    user = db.query(User).filter_by(username=payload.username).first()
    if not user or user.role != "TEACHER" or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Username or password is invalid",
        )

    return AuthResponse(access_token=create_jwt(user.id, user.role), role=user.role)


@router.post("/student/login", response_model=StudentAuthResponse)
def student_login(payload: StudentTokenLogin, db: Session = Depends(get_db)):
    token_row = find_valid_student_token(db, payload.code)
    if not token_row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Student token is invalid")

    session = db.get(AssessmentSession, token_row.session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session not found")
    if session.finished_at:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Assessment already finished")

    if not session.started_at:
        session.started_at = datetime.utcnow()
        session.updated_at = session.started_at
        session.status = "STUDENT_STARTED"
        db.add(
            TimelineEvent(
                session_id=session.id,
                sequence=session.active_sequence,
                event_type="STUDENT_STARTED",
                t_ms=elapsed_ms(),
            )
        )
        db.commit()
        db.refresh(session)

    access_token = create_jwt(
        token_row.id,
        "STUDENT",
        {"session_id": session.id, "student_name": token_row.student_name},
    )
    return StudentAuthResponse(access_token=access_token, role="STUDENT", session=to_state(session))


@router.post("/student-tokens", response_model=StudentTokenResponse)
def create_student_token(
    payload: StudentTokenCreate,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    ensure_default_teacher(db)
    student_name = payload.student_name
    if payload.student_id:
        student = db.get(Student, payload.student_id)
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")
        student_name = student.name

    session_code = f"ASM-PENGAMBILAN-{datetime.utcnow().strftime('%d%m%Y-%H%M%S')}"
    session = AssessmentSession(
        code=session_code,
        student_id=payload.student_id,
        student_name=student_name,
        active_question_id="WAITING",
        active_question_text="Menunggu guru menekan tombol Mulai.",
        active_instruction_text="Siapkan diri, soal akan tampil setelah guru memulai.",
        active_category="waiting",
        active_scoring_mode="waiting",
        active_options="[]",
        active_correct_answer=None,
        camera_enabled=payload.camera_enabled,
        status="WAITING_TO_START",
        hide_student_side=True,
    )
    db.add(session)
    db.flush()

    code = generate_student_code()
    expires_at = datetime.utcnow() + timedelta(hours=payload.expires_hours)
    db.add(
        StudentAccessToken(
            session_id=session.id,
            student_id=payload.student_id,
            teacher_id=teacher.id,
            token_hash=hash_password(code),
            token_hint=code[:4],
            student_name=student_name,
            expires_at=expires_at,
        )
    )
    db.add(
        TimelineEvent(
            session_id=session.id,
            sequence=session.active_sequence,
            event_type="STUDENT_TOKEN_CREATED",
            t_ms=elapsed_ms(),
        )
    )
    db.commit()
    db.refresh(session)

    return StudentTokenResponse(
        code=code,
        session=to_state(session),
        expires_at=expires_at.isoformat(),
    )
