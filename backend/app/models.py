from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def uuid_str() -> str:
    return str(uuid.uuid4())


class AssessmentSession(Base):
    __tablename__ = "assessment_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    student_id: Mapped[Optional[str]] = mapped_column(ForeignKey("students.id"), nullable=True, index=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    student_name: Mapped[str] = mapped_column(String(120))
    active_sequence: Mapped[int] = mapped_column(Integer, default=1)
    active_question_id: Mapped[str] = mapped_column(String(64), default="Q001")
    active_question_text: Mapped[str] = mapped_column(Text, default="BACA: KELAPA")
    active_instruction_text: Mapped[str] = mapped_column(Text, default="Ikuti instruksi soal yang tampil.")
    active_category: Mapped[str] = mapped_column(String(64), default="phonological_awareness")
    active_scoring_mode: Mapped[str] = mapped_column(String(32), default="teacher_rubric")
    active_options: Mapped[str] = mapped_column(Text, default="[]")
    active_correct_answer: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    active_show_student_timer: Mapped[bool] = mapped_column(Boolean, default=False)
    camera_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    camera_width: Mapped[int] = mapped_column(Integer, default=640)
    camera_height: Mapped[int] = mapped_column(Integer, default=480)
    camera_fps: Mapped[int] = mapped_column(Integer, default=25)
    camera_source_control: Mapped[str] = mapped_column(String(32), default="student")
    theme_name: Mapped[str] = mapped_column(String(32), default="mit")
    status: Mapped[str] = mapped_column(String(32), default="READY")
    hide_student_side: Mapped[bool] = mapped_column(Boolean, default=False)
    fullscreen_active: Mapped[bool] = mapped_column(Boolean, default=False)
    request_student_fullscreen: Mapped[bool] = mapped_column(Boolean, default=False)
    request_student_camera: Mapped[bool] = mapped_column(Boolean, default=False)
    force_student_logout: Mapped[bool] = mapped_column(Boolean, default=False)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    events: Mapped[list["TimelineEvent"]] = relationship(back_populates="session")
    grades: Mapped[list["SubjectiveGrade"]] = relationship(back_populates="session")
    notes: Mapped[list["TeacherNote"]] = relationship(back_populates="session")
    videos: Mapped[list["StudentVideoRecord"]] = relationship(back_populates="session")
    student: Mapped[Optional["Student"]] = relationship(back_populates="sessions")


class Student(Base):
    __tablename__ = "students"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    name: Mapped[str] = mapped_column(String(120), index=True)
    identifier: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    grade_level: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    school_origin: Mapped[Optional[str]] = mapped_column(String(160), nullable=True)
    guardian_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    sessions: Mapped[list["AssessmentSession"]] = relationship(back_populates="student")


class AssessmentItem(Base):
    __tablename__ = "assessment_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    item_code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    category: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(160))
    prompt: Mapped[str] = mapped_column(Text)
    instruction_text: Mapped[str] = mapped_column(Text, default="")
    stimulus: Mapped[str] = mapped_column(Text, default="")
    options: Mapped[str] = mapped_column(Text, default="[]")
    correct_answer: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    scoring_mode: Mapped[str] = mapped_column(String(32), default="teacher_rubric")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_example: Mapped[bool] = mapped_column(Boolean, default=False)
    show_student_timer: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), default="TEACHER")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class StudentAccessToken(Base):
    __tablename__ = "student_access_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    session_id: Mapped[str] = mapped_column(ForeignKey("assessment_sessions.id"), index=True)
    student_id: Mapped[Optional[str]] = mapped_column(ForeignKey("students.id"), nullable=True, index=True)
    teacher_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(255))
    token_hint: Mapped[str] = mapped_column(String(16), index=True)
    student_name: Mapped[str] = mapped_column(String(120))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TimelineEvent(Base):
    __tablename__ = "timeline_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    session_id: Mapped[str] = mapped_column(ForeignKey("assessment_sessions.id"), index=True)
    sequence: Mapped[int] = mapped_column(Integer, index=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    t_ms: Mapped[float] = mapped_column(Float)
    payload: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    session: Mapped[AssessmentSession] = relationship(back_populates="events")


class SubjectiveGrade(Base):
    __tablename__ = "subjective_grades"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    session_id: Mapped[str] = mapped_column(ForeignKey("assessment_sessions.id"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    fluency: Mapped[int] = mapped_column(Integer, default=0)
    accuracy: Mapped[int] = mapped_column(Integer, default=0)
    confidence: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    session: Mapped[AssessmentSession] = relationship(back_populates="grades")


class TeacherNote(Base):
    __tablename__ = "teacher_notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    session_id: Mapped[str] = mapped_column(ForeignKey("assessment_sessions.id"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    session: Mapped[AssessmentSession] = relationship(back_populates="notes")


class StudentVideoRecord(Base):
    __tablename__ = "student_video_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    session_id: Mapped[str] = mapped_column(ForeignKey("assessment_sessions.id"), index=True)
    sequence: Mapped[int] = mapped_column(Integer, index=True)
    question_id: Mapped[str] = mapped_column(String(64), index=True)
    file_path: Mapped[str] = mapped_column(Text)
    mime_type: Mapped[str] = mapped_column(String(120), default="video/webm")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    session: Mapped[AssessmentSession] = relationship(back_populates="videos")
