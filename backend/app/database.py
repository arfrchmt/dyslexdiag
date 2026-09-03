from sqlalchemy import create_engine
from sqlalchemy import inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings


def normalize_database_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


database_url = normalize_database_url(settings.database_url)
connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}

engine = create_engine(database_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_runtime_schema() -> None:
    inspector = inspect(engine)
    table_names = inspector.get_table_names()
    if "assessment_sessions" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("assessment_sessions")}
    missing_boolean_columns = [
        column
        for column in (
            "hide_student_side",
            "fullscreen_active",
            "request_student_fullscreen",
            "request_student_camera",
            "camera_enabled",
            "force_student_logout",
        )
        if column not in columns
    ]
    with engine.begin() as connection:
        for column in missing_boolean_columns:
            if column == "camera_enabled":
                default = "true" if engine.dialect.name in {"postgresql", "mysql"} else "1"
            else:
                default = "false" if engine.dialect.name in {"postgresql", "mysql"} else "0"
            connection.execute(
                text(f"ALTER TABLE assessment_sessions ADD COLUMN {column} BOOLEAN NOT NULL DEFAULT {default}")
            )
        if "student_id" not in columns:
            connection.execute(text("ALTER TABLE assessment_sessions ADD COLUMN student_id VARCHAR(36)"))
        if "finished_at" not in columns:
            connection.execute(text("ALTER TABLE assessment_sessions ADD COLUMN finished_at TIMESTAMP"))
        if "active_category" not in columns:
            connection.execute(
                text("ALTER TABLE assessment_sessions ADD COLUMN active_category VARCHAR(64) NOT NULL DEFAULT 'phonological_awareness'")
            )
        if "active_scoring_mode" not in columns:
            connection.execute(
                text("ALTER TABLE assessment_sessions ADD COLUMN active_scoring_mode VARCHAR(32) NOT NULL DEFAULT 'teacher_rubric'")
            )
        if "active_options" not in columns:
            connection.execute(text("ALTER TABLE assessment_sessions ADD COLUMN active_options TEXT NOT NULL DEFAULT '[]'"))
        if "active_correct_answer" not in columns:
            connection.execute(text("ALTER TABLE assessment_sessions ADD COLUMN active_correct_answer VARCHAR(255)"))
        if "active_show_student_timer" not in columns:
            default = "false" if engine.dialect.name in {"postgresql", "mysql"} else "0"
            connection.execute(
                text(f"ALTER TABLE assessment_sessions ADD COLUMN active_show_student_timer BOOLEAN NOT NULL DEFAULT {default}")
            )
        if "camera_width" not in columns:
            connection.execute(text("ALTER TABLE assessment_sessions ADD COLUMN camera_width INTEGER NOT NULL DEFAULT 640"))
        if "camera_height" not in columns:
            connection.execute(text("ALTER TABLE assessment_sessions ADD COLUMN camera_height INTEGER NOT NULL DEFAULT 480"))
        if "camera_fps" not in columns:
            connection.execute(text("ALTER TABLE assessment_sessions ADD COLUMN camera_fps INTEGER NOT NULL DEFAULT 25"))
        if "camera_source_control" not in columns:
            connection.execute(text("ALTER TABLE assessment_sessions ADD COLUMN camera_source_control VARCHAR(32) NOT NULL DEFAULT 'student'"))
        if "active_instruction_text" not in columns:
            connection.execute(
                text("ALTER TABLE assessment_sessions ADD COLUMN active_instruction_text TEXT NOT NULL DEFAULT 'Ikuti instruksi soal yang tampil.'")
            )
        if "theme_name" not in columns:
            connection.execute(text("ALTER TABLE assessment_sessions ADD COLUMN theme_name VARCHAR(32) NOT NULL DEFAULT 'mit'"))
        if engine.dialect.name == "postgresql":
            connection.execute(text("ALTER TABLE assessment_sessions ALTER COLUMN active_question_text TYPE TEXT"))

    if "students" in table_names:
        student_columns = {column["name"] for column in inspector.get_columns("students")}
        if "school_origin" not in student_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE students ADD COLUMN school_origin VARCHAR(160)"))

    if "assessment_items" in table_names:
        item_columns = {column["name"] for column in inspector.get_columns("assessment_items")}
        with engine.begin() as connection:
            if "instruction_text" not in item_columns:
                connection.execute(text("ALTER TABLE assessment_items ADD COLUMN instruction_text TEXT NOT NULL DEFAULT ''"))
            if "is_example" not in item_columns:
                default = "false" if engine.dialect.name in {"postgresql", "mysql"} else "0"
                connection.execute(
                    text(f"ALTER TABLE assessment_items ADD COLUMN is_example BOOLEAN NOT NULL DEFAULT {default}")
                )
            if "show_student_timer" not in item_columns:
                default = "false" if engine.dialect.name in {"postgresql", "mysql"} else "0"
                connection.execute(
                    text(f"ALTER TABLE assessment_items ADD COLUMN show_student_timer BOOLEAN NOT NULL DEFAULT {default}")
                )

    if "student_access_tokens" not in table_names:
        return

    token_columns = {column["name"] for column in inspector.get_columns("student_access_tokens")}
    if "student_id" in token_columns:
        return

    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE student_access_tokens ADD COLUMN student_id VARCHAR(36)"))
