import json
from pathlib import Path
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
from services.eye_gaze import eye_gaze_service
import logging

eye_tracker_logger = logging.getLogger("eye_tracker")

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
    eye_by_sequence: dict[int, dict] = {}
    webgazer_by_sequence: dict[int, dict] = {}
    calibration_points: list[dict] = []
    gaze_layout_by_sequence: dict[int, dict] = {}
    example_sequences = assessment_example_sequences(db, session)
    for event in events:
        if event.event_type == "EYE_TRACKING_ANALYZED":
            try: eye_by_sequence.setdefault(event.sequence, json.loads(event.payload))
            except json.JSONDecodeError: pass
        if event.event_type == "STUDENT_EYE_GAZE":
            try:
                gaze = json.loads(event.payload)
                # New WebGazer samples are already normalized to the actual
                # student stimulus rectangle. Keep the legacy viewport
                # fallback so previously recorded sessions remain readable.
                if gaze.get("gaze_region"):
                    point = {"x": float(gaze.get("x", 0)), "y": float(gaze.get("y", 0)), "viewport_x": gaze.get("viewport_x"), "viewport_y": gaze.get("viewport_y"), "ui_target": gaze.get("ui_target"), "client_time_ms": gaze.get("client_time_ms"), "intensity": 1}
                else:
                    point = {"x": gaze.get("x", 0) / max(1, gaze.get("viewport", {}).get("width", 1)), "y": gaze.get("y", 0) / max(1, gaze.get("viewport", {}).get("height", 1)), "intensity": 1}
                webgazer_by_sequence.setdefault(event.sequence, {"heatmap": [], "trajectory": []})["heatmap"].append(point)
                webgazer_by_sequence[event.sequence]["trajectory"].append(point)
            except (json.JSONDecodeError, TypeError, AttributeError): pass
        if event.event_type == "STUDENT_EYE_GAZE_CALIBRATION_POINT":
            try:
                calibration_point = json.loads(event.payload)
                if isinstance(calibration_point, dict):
                    calibration_points.append(calibration_point)
            except json.JSONDecodeError:
                pass
        if event.event_type == "STUDENT_SCREEN_LAYOUT":
            try:
                payload = json.loads(event.payload)
                if isinstance(payload, dict):
                    gaze_layout_by_sequence.setdefault(event.sequence, payload)
            except json.JSONDecodeError:
                pass
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

    # Events are loaded newest-first for summary fields, but gaze is a time
    # series. Restore chronological order before review and metric calculation.
    for gaze_data in webgazer_by_sequence.values():
        gaze_data["heatmap"].reverse()
        gaze_data["trajectory"].reverse()
    calibration_points.reverse()
    calibration_errors = [
        float(point["error_px"])
        for point in calibration_points
        if isinstance(point.get("error_px"), (int, float))
    ]
    calibration_summary = {
        "points": calibration_points,
        "point_count": len(calibration_points),
        "mean_error_px": sum(calibration_errors) / len(calibration_errors) if calibration_errors else None,
        "max_error_px": max(calibration_errors) if calibration_errors else None,
    }

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
                eye_tracking=eye_by_sequence.get(sequence, {}),
                eye_tracking_webgazer={
                    **webgazer_metrics(webgazer_by_sequence.get(sequence, {})),
                    "response_time_ms": duration_by_sequence.get(sequence),
                    "correctness": score_by_sequence.get(sequence),
                    "max_score": 10 if item else None,
                },
                webgazer_calibration=calibration_summary,
                gaze_layout=gaze_layout_by_sequence.get(sequence, {}),
            )
        )
    return questions


def webgazer_metrics(data: dict) -> dict:
    points = data.get("trajectory", [])
    distances = [((b["x"] - a["x"]) ** 2 + (b["y"] - a["y"]) ** 2) ** .5 for a, b in zip(points, points[1:])]
    moving = [distance > .012 for distance in distances]
    fixation = sum(not current and (index == 0 or moving[index - 1]) for index, current in enumerate(moving))
    if points and fixation == 0: fixation = 1
    fixation_groups: list[list[dict]] = []
    current_group: list[dict] = [points[0]] if points else []
    for index, point in enumerate(points[1:]):
        if moving[index]:
            if current_group:
                fixation_groups.append(current_group)
            current_group = [point]
        else:
            current_group.append(point)
    if current_group:
        fixation_groups.append(current_group)
    fixations = []
    for number, group in enumerate(fixation_groups, 1):
        fixations.append({
            "index": number,
            "x": sum(point["x"] for point in group) / len(group),
            "y": sum(point["y"] for point in group) / len(group),
            "viewport_x": sum(point.get("viewport_x") or point["x"] for point in group) / len(group),
            "viewport_y": sum(point.get("viewport_y") or point["y"] for point in group) / len(group),
            "sample_count": len(group),
        })
    # Collapse nearby gaze samples into density circles. Duration is estimated
    # from client timestamps, with a conservative fallback for legacy samples.
    heatmap: list[dict] = []
    for point in points:
        match = next((cluster for cluster in heatmap if ((cluster["x"] - point["x"]) ** 2 + (cluster["y"] - point["y"]) ** 2) ** .5 <= .035), None)
        if match is None:
            heatmap.append({"x": point["x"], "y": point["y"], "viewport_x": point.get("viewport_x"), "viewport_y": point.get("viewport_y"), "sample_count": 1, "duration_seconds": .5})
        else:
            count = match["sample_count"]
            match["x"] = (match["x"] * count + point["x"]) / (count + 1)
            match["y"] = (match["y"] * count + point["y"]) / (count + 1)
            match["sample_count"] = count + 1
            match["duration_seconds"] += .5
    for point in heatmap:
        point["intensity"] = min(1, point["duration_seconds"] / 5)
    fixation_durations = [max(.5, (group[-1].get("client_time_ms") - group[0].get("client_time_ms")) / 1000) if group[-1].get("client_time_ms") is not None and group[0].get("client_time_ms") is not None else len(group) * .5 for group in fixation_groups]
    aoi_labels = [((point.get("ui_target") or {}).get("component") or "other") for point in points]
    aoi_transitions = sum(left != right for left, right in zip(aoi_labels, aoi_labels[1:]))
    visited_aois: set[str] = set()
    previous_aoi = None
    revisit_count = 0
    for aoi in aoi_labels:
        if aoi != previous_aoi:
            if aoi in visited_aois: revisit_count += 1
            visited_aois.add(aoi)
            previous_aoi = aoi
    dwell_stimulus = sum(.5 for label in aoi_labels if label in {"stimulus", "stimulus-content"})
    dwell_options = sum(.5 for label in aoi_labels if label in {"answer-option", "feeling-button"})
    total_duration = sum(fixation_durations)
    return {**data, "heatmap": heatmap, "fixation_count": fixation, "mean_fixation_duration": sum(fixation_durations) / len(fixation_durations) if fixation_durations else 0, "total_fixation_duration": total_duration, "fixation_durations": fixation_durations, "fixations": fixations, "saccade_count": sum(current for current in moving), "regression_count": sum(b["x"] - a["x"] < -.012 for a, b in zip(points, points[1:])), "revisit_count": revisit_count, "aoi_transition_count": aoi_transitions, "aoi_transition_frequency": aoi_transitions / max(.5, total_duration), "dwell_time_stimulus": dwell_stimulus, "dwell_time_options": dwell_options, "blink_rate": None}


@router.post("/{student_id}/sessions/{code}/questions/{sequence}/analyze-eyetracker")
def analyze_eyetracker(student_id: str, code: str, sequence: int, _teacher=Depends(require_teacher), db: Session = Depends(get_db)):
    eye_tracker_logger.info("analysis_started student_id=%s session=%s sequence=%s", student_id, code, sequence)
    session = db.query(AssessmentSession).filter_by(code=code, student_id=student_id).first()
    if not session: raise HTTPException(404, "Sesi tidak ditemukan")
    videos = db.query(StudentVideoRecord).filter_by(session_id=session.id, sequence=sequence).order_by(StudentVideoRecord.created_at.desc()).all()
    # StudentVideoRecord predates the source_device field; teacher recordings
    # are marked in their filename, so do not access a non-existent ORM attr.
    video = next((item for item in videos if "-teacher-" not in item.file_path), videos[0] if videos else None)
    if not video:
        eye_tracker_logger.warning("video_not_found session=%s sequence=%s", code, sequence)
        raise HTTPException(404, "Rekaman siswa tidak ditemukan")
    try:
        import cv2
        from PIL import Image
        capture = cv2.VideoCapture(str(Path(__file__).resolve().parents[2] / "media" / video.file_path))
        frame_count = 0
        labels, points, pupils, blinks = [], [], [], []
        while len(labels) < 300:
            ok, frame = capture.read()
            if not ok: break
            frame_count += 1
            result = eye_gaze_service.predict(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
            if result.get("accepted"):
                labels.append(result["label"])
                points.append({"x": result.get("gaze_x", {"left": .25, "center": .5, "right": .75}[result["label"]]), "y": result.get("gaze_y", .5), "intensity": result["confidence"]})
                if result.get("pupil_size") is not None: pupils.append(result["pupil_size"])
                blinks.append(bool(result.get("blink")))
        capture.release()
        eye_tracker_logger.info("frames_read=%s accepted_predictions=%s video=%s", frame_count, len(labels), video.file_path)
    except Exception as exc:
        eye_tracker_logger.exception("analysis_failed session=%s sequence=%s", code, sequence)
        raise HTTPException(422, f"Analisis gagal: {exc}")
    distances = [((b["x"] - a["x"]) ** 2 + (b["y"] - a["y"]) ** 2) ** .5 for a, b in zip(points, points[1:])]
    transitions = sum(value > .012 for value in distances)
    regressions = sum(b["x"] - a["x"] < -.012 for a, b in zip(points, points[1:]))
    fixation_count = 0
    was_moving = True
    for value in distances:
        moving = value > .012
        if not moving and was_moving: fixation_count += 1
        was_moving = moving
    if points and fixation_count == 0: fixation_count = 1
    import statistics
    fps = capture.get(cv2.CAP_PROP_FPS) or 25
    blink_events = sum(current and not previous for previous, current in zip([False] + blinks, blinks))
    blink_rate = blink_events * 60 / max(1, len(blinks) / fps)
    metrics = {"fixation_count": fixation_count, "regression_count": regressions, "saccade_count": transitions, "pupil_size_stddev": statistics.pstdev(pupils) if len(pupils) > 1 else 0, "blink_rate": blink_rate, "heatmap": points, "trajectory": points, "frame_width": 1, "frame_height": 1}
    db.add(TimelineEvent(session_id=session.id, sequence=sequence, event_type="EYE_TRACKING_ANALYZED", t_ms=0, payload=json.dumps(metrics)))
    db.commit()
    eye_tracker_logger.info("analysis_finished sequence=%s fixation=%s regression=%s saccade=%s", sequence, metrics["fixation_count"], regressions, transitions)
    return {**metrics, "diagnostics": {"frames_read": frame_count, "accepted_predictions": len(labels), "log_file": "backend/logs/eye_tracker.log"}}


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
                    eye_tracking={},
    )
