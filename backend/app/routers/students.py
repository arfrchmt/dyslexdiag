import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AssessmentSession, Student, SubjectiveGrade, TeacherNote, TimelineEvent
from app.schemas import (
    StudentCreate,
    StudentListItem,
    StudentPerformanceDetail,
    StudentQuestionPerformance,
    StudentRead,
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


def latest_grade_total(db: Session, session: Optional[AssessmentSession]) -> int:
    if not session:
        return 0
    latest_grades = (
        db.query(SubjectiveGrade)
        .filter_by(session_id=session.id)
        .order_by(SubjectiveGrade.created_at.desc())
        .all()
    )
    totals_by_sequence: dict[int, int] = {}
    for grade in latest_grades:
        if grade.sequence not in totals_by_sequence:
            totals_by_sequence[grade.sequence] = grade.total
    return sum(totals_by_sequence.values())


def to_list_item(db: Session, student: Student) -> StudentListItem:
    session = latest_session(db, student.id)
    return StudentListItem(
        id=student.id,
        name=student.name,
        identifier=student.identifier,
        grade_level=student.grade_level,
        school_origin=student.school_origin,
        session_code=session.code if session else "Belum dibuat",
        status=session_status(session),
        total_score=latest_grade_total(db, session),
    )


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

    session = latest_session(db, student.id)
    item = to_list_item(db, student)
    questions: list[StudentQuestionPerformance] = []
    if session:
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

        grade_by_sequence: dict[int, SubjectiveGrade] = {}
        for grade in grades:
            grade_by_sequence.setdefault(grade.sequence, grade)

        note_by_sequence: dict[int, str] = {}
        for note in notes:
            note_by_sequence.setdefault(note.sequence, note.note)

        question_by_sequence: dict[int, tuple[str, str]] = {
            session.active_sequence: (session.active_question_id, session.active_question_text)
        }
        feeling_by_sequence: dict[int, str] = {}
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

        sequences = sorted(set(question_by_sequence) | set(grade_by_sequence) | set(note_by_sequence))
        questions = [
            StudentQuestionPerformance(
                sequence=sequence,
                question_id=question_by_sequence.get(sequence, (f"Seq {sequence}", ""))[0],
                prompt=question_by_sequence.get(sequence, ("", ""))[1],
                score=grade_by_sequence[sequence].total if sequence in grade_by_sequence else 0,
                note=note_by_sequence.get(sequence, ""),
                feeling=feeling_by_sequence.get(sequence, ""),
            )
            for sequence in sequences
        ]

    return StudentPerformanceDetail(
        **item.model_dump(),
        created_at=student.created_at.isoformat(),
        questions=questions,
        videos=[],
    )
