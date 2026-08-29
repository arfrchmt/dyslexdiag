from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Dyslexic Diagnostic API"
    database_url: str = "postgresql+psycopg://dyslexicdiag:dyslexicdiag@localhost:5432/dyslexicdiag"
    jwt_secret_key: str = "dev-change-this-secret"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480
    default_teacher_username: str = "admin"
    default_teacher_password: str = "admin123"
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3002",
        "http://192.168.11.131:3001",
        "http://192.168.11.131:3002",
    ]

    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
