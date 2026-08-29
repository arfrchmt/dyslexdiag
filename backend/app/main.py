from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, SessionLocal, engine, ensure_runtime_schema
from app.routers.auth import router as auth_router
from app.routers.content import router as content_router
from app.routers.sessions import router as sessions_router
from app.routers.students import router as students_router
from app.security import ensure_default_teacher

Base.metadata.create_all(bind=engine)
ensure_runtime_schema()

with SessionLocal() as db:
    ensure_default_teacher(db)

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(content_router)
app.include_router(sessions_router)
app.include_router(students_router)


@app.get("/health")
def health():
    return {"status": "ok"}
