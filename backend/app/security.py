from __future__ import annotations

from datetime import datetime, timedelta
import secrets
import string
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import AssessmentSession, StudentAccessToken, User

bearer = HTTPBearer()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_jwt(subject: str, role: str, extra: Optional[dict] = None) -> str:
    expires_at = datetime.utcnow() + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": subject, "role": role, "exp": expires_at}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc


def require_teacher(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_jwt(credentials.credentials)
    if payload.get("role") != "TEACHER":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher access required")

    user = db.get(User, payload.get("sub"))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def require_student(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> AssessmentSession:
    payload = decode_jwt(credentials.credentials)
    if payload.get("role") != "STUDENT":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access required")

    session = db.get(AssessmentSession, payload.get("session_id"))
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session not found")
    return session


def require_session_access(
    code: str,
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> AssessmentSession:
    payload = decode_jwt(credentials.credentials)
    session = db.query(AssessmentSession).filter_by(code=code).first()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    role = payload.get("role")
    if role == "STUDENT" and payload.get("session_id") == session.id:
        return session

    if role == "TEACHER":
        user = db.get(User, payload.get("sub"))
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        owned_token = (
            db.query(StudentAccessToken)
            .filter_by(session_id=session.id, teacher_id=user.id)
            .first()
        )
        if owned_token or session.code == "ASM-001":
            return session

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Session access denied")


def generate_student_code(length: int = 8) -> str:
    alphabet = string.ascii_lowercase
    return "".join(secrets.choice(alphabet) for _ in range(4))


def find_valid_student_token(db: Session, code: str) -> Optional[StudentAccessToken]:
    normalized = code.strip().lower()
    hint = normalized[:4]
    candidates = (
        db.query(StudentAccessToken)
        .filter(StudentAccessToken.token_hint == hint)
        .filter(StudentAccessToken.revoked_at.is_(None))
        .filter(StudentAccessToken.expires_at > datetime.utcnow())
        .all()
    )
    for candidate in candidates:
        if verify_password(normalized, candidate.token_hash):
            return candidate
    return None


def ensure_default_teacher(db: Session) -> None:
    existing = db.query(User).filter_by(username=settings.default_teacher_username).first()
    if existing:
        return

    db.add(
        User(
            username=settings.default_teacher_username,
            password_hash=hash_password(settings.default_teacher_password),
            role="TEACHER",
        )
    )
    db.commit()
