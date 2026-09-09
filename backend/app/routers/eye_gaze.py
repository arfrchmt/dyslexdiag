from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Request
from app.security import require_teacher
from services.eye_gaze import eye_gaze_service

router = APIRouter(prefix="/eye-gaze", tags=["eye-gaze"])

@router.get("/config")
def get_config(_teacher=Depends(require_teacher)):
    return eye_gaze_service.info()

@router.patch("/config")
def update_config(payload: dict[str, Any], _teacher=Depends(require_teacher)):
    try:
        threshold = payload.get("confidence_threshold")
        if threshold is not None and not 0 <= float(threshold) <= 1: raise ValueError
        if payload.get("sample_fps") is not None and not 1 <= int(payload["sample_fps"]) <= 60: raise ValueError
        return eye_gaze_service.update_config(payload)
    except (TypeError, ValueError):
        raise HTTPException(422, "Konfigurasi eye-gaze tidak valid")

@router.post("/predict")
async def predict(request: Request, _teacher=Depends(require_teacher)):
    try:
        from PIL import Image
        import io
        return eye_gaze_service.predict(Image.open(io.BytesIO(await request.body())).convert("RGB"))
    except Exception as exc:
        raise HTTPException(422, str(exc))
