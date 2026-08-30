from pydantic import BaseModel, Field
from typing import Optional


class SessionState(BaseModel):
    id: str
    student_id: Optional[str] = None
    code: str
    student_name: str
    active_sequence: int
    active_question_id: str
    active_question_text: str
    active_instruction_text: str = "Ikuti instruksi soal yang tampil."
    active_category: str = "phonological_awareness"
    active_scoring_mode: str = "teacher_rubric"
    active_options: list[str] = Field(default_factory=list)
    active_correct_answer: Optional[str] = None
    active_show_student_timer: bool = False
    camera_enabled: bool = True
    theme_name: str = "mit"
    status: str
    hide_student_side: bool = False
    fullscreen_active: bool = False
    request_student_fullscreen: bool = False
    request_student_camera: bool = False
    force_student_logout: bool = False
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    assessment_finished: bool = False


class SessionCreate(BaseModel):
    code: str = "ASM-001"
    student_name: str = "Siswa 01"


class NavigationCommand(BaseModel):
    question_id: str
    question_text: str
    instruction_text: str = "Ikuti instruksi soal yang tampil."
    category: str = "phonological_awareness"
    scoring_mode: str = "teacher_rubric"
    options: list[str] = Field(default_factory=list)
    correct_answer: Optional[str] = None
    is_example: bool = False
    show_student_timer: bool = False


class AcknowledgmentCreate(BaseModel):
    sequence: int
    event_type: str = "QUESTION_RENDERED"
    t_ms: float
    payload: dict = Field(default_factory=dict)


class SubjectiveGradeCreate(BaseModel):
    sequence: int
    fluency: int = Field(ge=0, le=10)
    accuracy: int = Field(ge=0, le=10)
    confidence: int = Field(ge=0, le=10)


class TeacherNoteCreate(BaseModel):
    sequence: int
    note: str


class TimelineEventRead(BaseModel):
    sequence: int
    event_type: str
    t_ms: float
    payload: str


class SessionUiControlUpdate(BaseModel):
    hide_student_side: Optional[bool] = None
    request_student_fullscreen: Optional[bool] = None
    request_student_camera: Optional[bool] = None
    theme_name: Optional[str] = None


class StudentStatusUpdate(BaseModel):
    fullscreen_active: bool


class TeacherLogin(BaseModel):
    username: str
    password: str


class StudentTokenLogin(BaseModel):
    code: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str


class StudentAuthResponse(AuthResponse):
    session: SessionState


class StudentTokenCreate(BaseModel):
    student_id: Optional[str] = None
    student_name: str = "Siswa 01"
    expires_hours: int = Field(default=8, ge=1, le=72)
    camera_enabled: bool = True


class StudentTokenResponse(BaseModel):
    code: str
    session: SessionState
    expires_at: str


class StudentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    identifier: Optional[str] = Field(default=None, max_length=64)
    grade_level: Optional[str] = Field(default=None, max_length=64)
    school_origin: Optional[str] = Field(default=None, max_length=160)
    guardian_name: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = None


class StudentRead(StudentCreate):
    id: str
    created_at: str


class StudentListItem(BaseModel):
    id: str
    name: str
    identifier: Optional[str] = None
    grade_level: Optional[str] = None
    school_origin: Optional[str] = None
    session_code: str = "Belum dibuat"
    session_date: Optional[str] = None
    status: str = "belum"
    total_score: int = 0
    max_score: int = 30


class StudentSessionSummary(BaseModel):
    code: str
    session_date: Optional[str] = None
    status: str = "belum"
    total_score: int = 0
    max_score: int = 30


class StudentVideoRecordRead(BaseModel):
    id: str
    sequence: int = 0
    question_id: str = ""
    label: str
    source: str
    duration: str
    captured_at: str
    status: str


class StudentQuestionPerformance(BaseModel):
    session_code: str = ""
    session_date: Optional[str] = None
    question_id: str
    prompt: str
    sequence: int
    score: int
    max_score: int = 30
    note: str = ""
    feeling: str = ""
    duration_ms: Optional[float] = None
    is_example: bool = False
    question_active: bool = True
    videos: list[StudentVideoRecordRead] = Field(default_factory=list)


class StudentPerformanceDetail(StudentListItem):
    created_at: str
    sessions: list[StudentSessionSummary] = Field(default_factory=list)
    questions: list[StudentQuestionPerformance] = Field(default_factory=list)
    videos: list[StudentVideoRecordRead] = Field(default_factory=list)


class AssessmentItemCreate(BaseModel):
    item_code: str = Field(min_length=1, max_length=64)
    category: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=160)
    prompt: str = Field(min_length=1)
    instruction_text: str = ""
    stimulus: str = ""
    options: list[str] = Field(default_factory=list)
    correct_answer: Optional[str] = Field(default=None, max_length=255)
    scoring_mode: str = "teacher_rubric"
    sort_order: int = 0
    is_active: bool = True
    is_example: bool = False
    show_student_timer: bool = False


class AssessmentItemStatusUpdate(BaseModel):
    is_active: bool


class AssessmentItemRead(AssessmentItemCreate):
    id: str
    created_at: str
