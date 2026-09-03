import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AssessmentItem, AssessmentSession, Student, StudentVideoRecord, SubjectiveGrade, TeacherNote, TimelineEvent
from app.schemas import (
    StudentCreate,
    StudentListItem,
    StudentPerformanceDetail,
    StudentQuestionPerformance,
    StudentRead,
    StudentSessionSummary,
    StudentVideoRecordRead,
)
from app.security import require_teacher

router = APIRouter(prefix="/students", tags=["students"])


def session_status(session: Optional[AssessmentSession]) -> str:
    if not session:
        return "belum"
    if session.finished_at or session.status == "ASSESSMENT_FINISHED":
        return "selesai"
    return "berlangsung"


def latest_session(db: Session, student_id: str) -> Optional[AssessmentSession]:
    return (
        db.query(AssessmentSession)
        .filter_by(student_id=student_id)
        .order_by(AssessmentSession.updated_at.desc(), AssessmentSession.started_at.desc())
        .first()
    )


def student_sessions(db: Session, student_id: str) -> list[AssessmentSession]:
    return (
        db.query(AssessmentSession)
        .filter_by(student_id=student_id)
        .order_by(AssessmentSession.updated_at.desc(), AssessmentSession.started_at.desc())
        .all()
    )


def latest_grade_total(db: Session, session: Optional[AssessmentSession]) -> int:
    if not session:
        return 0
    example_sequences = assessment_example_sequences(db, session)
    latest_grades = (
        db.query(SubjectiveGrade)
        .filter_by(session_id=session.id)
        .order_by(SubjectiveGrade.created_at.desc())
        .all()
    )
    totals_by_sequence: dict[int, int] = {}
    for grade in latest_grades:
        if grade.sequence in example_sequences:
            continue
        if grade.sequence not in totals_by_sequence:
            totals_by_sequence[grade.sequence] = grade.total
    score_events = (
        db.query(TimelineEvent)
        .filter(TimelineEvent.session_id == session.id)
        .filter(TimelineEvent.event_type.in_(["STUDENT_SYSTEM_SCORE", "STUDENT_MULTIPLE_CHOICE_SCORE"]))
        .order_by(TimelineEvent.created_at.desc())
        .all()
    )
    for event in score_events:
        if event.sequence in example_sequences or event.sequence in totals_by_sequence:
            continue
        try:
            payload = json.loads(event.payload or "{}")
        except json.JSONDecodeError:
            continue
        score = payload.get("score")
        if isinstance(score, (int, float)):
            totals_by_sequence[event.sequence] = int(score)
    return sum(totals_by_sequence.values())


def latest_max_score(db: Session, session: Optional[AssessmentSession]) -> int:
    if not session:
        return 30
    example_sequences = assessment_example_sequences(db, session)
    issued_sequences = {
        event.sequence
        for event in db.query(TimelineEvent)
        .filter_by(session_id=session.id, event_type="QUESTION_ISSUED")
        .all()
        if event.sequence not in example_sequences
    }
    return max(1, len(issued_sequences)) * 30


def assessment_example_sequences(db: Session, session: AssessmentSession) -> set[int]:
    events = (
        db.query(TimelineEvent)
        .filter_by(session_id=session.id, event_type="QUESTION_ISSUED")
        .order_by(TimelineEvent.created_at.desc())
        .all()
    )
    example_sequences: set[int] = set()
    for event in events:
        try:
            payload = json.loads(event.payload or "{}")
        except json.JSONDecodeError:
            continue
        question_id = payload.get("question_id", "")
        if payload.get("is_example") is True:
            example_sequences.add(event.sequence)
            continue
        if question_id:
            item = db.query(AssessmentItem).filter_by(item_code=question_id).first()
            if item and item.is_example:
                example_sequences.add(event.sequence)
    return example_sequences


def to_list_item(db: Session, student: Student) -> StudentListItem:
    session = latest_session(db, student.id)
    return StudentListItem(
        id=student.id,
        name=student.name,
        identifier=student.identifier,
        grade_level=student.grade_level,
        school_origin=student.school_origin,
        session_code=session.code if session else "Belum dibuat",
        session_date=(session.started_at or session.updated_at).isoformat() if session else None,
        status=session_status(session),
        total_score=latest_grade_total(db, session),
        max_score=latest_max_score(db, session),
    )


def session_date(session: AssessmentSession) -> str:
    return (session.started_at or session.updated_at).isoformat()


def session_summary(db: Session, session: AssessmentSession) -> StudentSessionSummary:
    return StudentSessionSummary(
        code=session.code,
        session_date=session_date(session),
        status=session_status(session),
        total_score=latest_grade_total(db, session),
        max_score=latest_max_score(db, session),
    )


def video_record_to_read(video: StudentVideoRecord) -> StudentVideoRecordRead:
    duration_seconds = (video.duration_ms or 0) / 1000
    source_device = "teacher" if "-teacher-" in video.file_path else "student"
    return StudentVideoRecordRead(
        id=video.id,
        sequence=video.sequence,
        question_id=video.question_id,
        label=f"Seq {video.sequence} - {video.question_id} ({'guru' if source_device == 'teacher' else 'siswa'})",
        source=f"/media/{video.file_path}",
        source_device=source_device,
        duration=f"{duration_seconds:.1f} dtk",
        captured_at=video.created_at.isoformat(),
        status="tersedia",
    )


def session_questions(db: Session, session: AssessmentSession) -> list[StudentQuestionPerformance]:
    grades = (
        db.query(SubjectiveGrade)
        .filter_by(session_id=session.id)
        .order_by(SubjectiveGrade.created_at.desc())
        .all()
    )
    notes = (
        db.query(TeacherNote)
        .filter_by(session_id=session.id)
        .order_by(TeacherNote.created_at.desc())
        .all()
    )
    events = (
        db.query(TimelineEvent)
        .filter_by(session_id=session.id)
        .order_by(TimelineEvent.created_at.desc())
        .all()
    )
    videos = (
        db.query(StudentVideoRecord)
        .filter_by(session_id=session.id)
        .order_by(StudentVideoRecord.created_at.desc())
        .all()
    )
    videos_by_sequence: dict[int, list[StudentVideoRecordRead]] = {}
    for video in videos:
        videos_by_sequence.setdefault(video.sequence, []).append(video_record_to_read(video))

    grade_by_sequence: dict[int, SubjectiveGrade] = {}
    for grade in grades:
        grade_by_sequence.setdefault(grade.sequence, grade)

    score_by_sequence: dict[int, int] = {}
    note_by_sequence: dict[int, str] = {}
    for note in notes:
        note_by_sequence.setdefault(note.sequence, note.note)

    question_by_sequence: dict[int, tuple[str, str]] = {
        session.active_sequence: (session.active_question_id, session.active_question_text)
    }
    feeling_by_sequence: dict[int, str] = {}
    duration_by_sequence: dict[int, float] = {}
    clickstream_by_sequence: dict[int, list[dict]] = {}
    example_sequences = assessment_example_sequences(db, session)
    for event in events:
        if event.event_type == "QUESTION_ISSUED":
            try:
                payload = json.loads(event.payload)
                question_by_sequence.setdefault(
                    event.sequence,
                    (payload.get("question_id", f"Seq {event.sequence}"), payload.get("question_text", "")),
                )
            except json.JSONDecodeError:
                pass
        if event.event_type == "STUDENT_FEELING_SELECTED":
            try:
                payload = json.loads(event.payload)
                feeling_by_sequence.setdefault(event.sequence, payload.get("feeling", ""))
            except json.JSONDecodeError:
                pass
        if event.event_type in {"STUDENT_SYSTEM_SCORE", "STUDENT_MULTIPLE_CHOICE_SCORE", "TEACHER_RESPONSE_TIME"}:
            try:
                payload = json.loads(event.payload)
                duration_ms = payload.get("duration_ms")
                if isinstance(duration_ms, (int, float)):
                    duration_by_sequence.setdefault(event.sequence, float(duration_ms))
                score = payload.get("score")
                if event.event_type in {"STUDENT_SYSTEM_SCORE", "STUDENT_MULTIPLE_CHOICE_SCORE"} and isinstance(score, (int, float)):
                    score_by_sequence.setdefault(event.sequence, int(score))
            except json.JSONDecodeError:
                pass
        if event.event_type == "STUDENT_CLICKSTREAM":
            try:
                payload = json.loads(event.payload)
                if isinstance(payload, dict):
                    clickstream_by_sequence.setdefault(event.sequence, []).append(
                        {
                            "component": payload.get("component", ""),
                            "component_role": payload.get("component_role", ""),
                            "component_label": payload.get("component_label", ""),
                            "component_text": payload.get("component_text", ""),
                            "action": payload.get("action", "click"),
                            "client_time": payload.get("client_time", ""),
                            "client_time_ms": payload.get("client_time_ms"),
                            "elapsed_ms": payload.get("elapsed_ms"),
                            "question_elapsed_ms": payload.get("question_elapsed_ms"),
                            "click_index": payload.get("click_index"),
                            "question_click_index": payload.get("question_click_index"),
                            "pointer": payload.get("pointer", {}),
                            "viewport": payload.get("viewport", {}),
                            "page": payload.get("page", {}),
                            "session_code": session.code,
                            "sequence": event.sequence,
                            "question_id": payload.get("questionId", ""),
                        }
                    )
            except json.JSONDecodeError:
                pass

    sequences = sorted(set(question_by_sequence) | set(grade_by_sequence) | set(score_by_sequence) | set(note_by_sequence))
    questions: list[StudentQuestionPerformance] = []
    for sequence in sequences:
        question_id, prompt = question_by_sequence.get(sequence, (f"Seq {sequence}", ""))
        item = db.query(AssessmentItem).filter_by(item_code=question_id).first()
        clickstream = list(reversed(clickstream_by_sequence.get(sequence, [])))
        clicked_components = sorted(
            {
                str(entry.get("component"))
                for entry in clickstream
                if entry.get("component")
            }
        )
        first_click = clickstream[0] if clickstream else None
        last_click = clickstream[-1] if clickstream else None
        click_elapsed_values = [
            entry.get("question_elapsed_ms")
            for entry in clickstream
            if isinstance(entry.get("question_elapsed_ms"), (int, float))
        ]
        questions.append(
            StudentQuestionPerformance(
                session_code=session.code,
                session_date=session_date(session),
                sequence=sequence,
                question_id=question_id,
                prompt=prompt,
                score=grade_by_sequence[sequence].total if sequence in grade_by_sequence else score_by_sequence.get(sequence, 0),
                note=note_by_sequence.get(sequence, ""),
                feeling=feeling_by_sequence.get(sequence, ""),
                duration_ms=duration_by_sequence.get(sequence),
                click_count=len(clickstream),
                clicked_components=clicked_components,
                clickstream=clickstream,
                additional_data={
                    "clickstream": clickstream,
                    "clickstream_summary": {
                        "click_count": len(clickstream),
                        "clicked_components": clicked_components,
                        "first_click_time": first_click.get("client_time") if first_click else None,
                        "last_click_time": last_click.get("client_time") if last_click else None,
                        "first_click_elapsed_ms": click_elapsed_values[0] if click_elapsed_values else None,
                        "last_click_elapsed_ms": click_elapsed_values[-1] if click_elapsed_values else None,
                        "total_click_window_ms": (
                            click_elapsed_values[-1] - click_elapsed_values[0]
                            if len(click_elapsed_values) >= 2
                            else 0
                        ),
                    },
                },
                is_example=sequence in example_sequences,
                question_active=item.is_active if item else True,
                videos=videos_by_sequence.get(sequence, []),
            )
        )
    return questions


@router.get("", response_model=list[StudentListItem])
def list_students(_teacher=Depends(require_teacher), db: Session = Depends(get_db)):
    students = db.query(Student).order_by(Student.created_at.desc()).all()
    return [to_list_item(db, student) for student in students]


@router.post("", response_model=StudentRead)
def create_student(payload: StudentCreate, _teacher=Depends(require_teacher), db: Session = Depends(get_db)):
    student = Student(**payload.model_dump())
    db.add(student)
    db.commit()
    db.refresh(student)
    return StudentRead(
        id=student.id,
        name=student.name,
        identifier=student.identifier,
        grade_level=student.grade_level,
        school_origin=student.school_origin,
        guardian_name=student.guardian_name,
        notes=student.notes,
        created_at=student.created_at.isoformat(),
    )


@router.get("/{student_id}", response_model=StudentPerformanceDetail)
def student_detail(student_id: str, _teacher=Depends(require_teacher), db: Session = Depends(get_db)):
    student = db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    sessions = student_sessions(db, student.id)
    session = sessions[0] if sessions else None
    item = to_list_item(db, student)
    questions: list[StudentQuestionPerformance] = []
    videos: list[StudentVideoRecordRead] = []
    for session_entry in sessions:
        questions.extend(session_questions(db, session_entry))
        session_videos = (
            db.query(StudentVideoRecord)
            .filter_by(session_id=session_entry.id)
            .order_by(StudentVideoRecord.created_at.desc())
            .all()
        )
        videos.extend(video_record_to_read(video) for video in session_videos)

    return StudentPerformanceDetail(
        **item.model_dump(),
        created_at=student.created_at.isoformat(),
        sessions=[session_summary(db, session_entry) for session_entry in sessions],
        questions=questions,
        videos=videos,
    )
