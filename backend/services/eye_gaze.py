from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any
import logging

LOG_DIR = Path(__file__).resolve().parents[1] / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("eye_tracker")
if not logger.handlers:
    handler = logging.FileHandler(LOG_DIR / "eye_tracker.log", encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


@dataclass
class EyeGazeConfig:
    enabled: bool = True
    confidence_threshold: float = 0.60
    input_size: int = 224
    device: str = "auto"
    sample_fps: int = 10


class EyeGazeService:
    """Lazy MobileNetV3 eye-gaze inference service.

    The classifier predicts gaze direction. Fixation, saccade and regression
    are derived from the time series of predictions; pupil size is supplied by
    the face-landmark pipeline when available.
    """

    labels = ("left", "center", "right")

    def __init__(self, model_path: str | Path):
        self.model_dir = Path(model_path).parent
        self.model_path = Path(model_path)
        self.config = EyeGazeConfig()
        self._model: Any = None
        self._torch: Any = None
        self._lock = Lock()

    def info(self) -> dict[str, Any]:
        models = [{"name": p.name, "type": "mediapipe" if p.suffix == ".task" else "pytorch"} for p in sorted(self.model_dir.iterdir()) if p.suffix.lower() in {".pth", ".pt", ".task", ".onnx"}]
        return {
            "enabled": self.config.enabled,
            "model": self.model_path.name,
            "model_path": str(self.model_path),
            "selected_model": self.model_path.name,
            "models": models,
            "available": self.model_path.exists(),
            "loaded": self._model is not None,
            "labels": list(self.labels),
            "confidence_threshold": self.config.confidence_threshold,
            "input_size": self.config.input_size,
            "device": self.config.device,
            "sample_fps": self.config.sample_fps,
            "derived_metrics": ["fixation", "saccade", "regression", "pupil_size"],
        }

    def update_config(self, values: dict[str, Any]) -> dict[str, Any]:
        selected = values.get("model") or values.get("selected_model")
        if selected:
            candidate = (self.model_dir / str(selected)).resolve()
            if candidate.parent != self.model_dir.resolve() or not candidate.exists():
                raise ValueError("Model eye-tracker tidak ditemukan")
            if candidate != self.model_path.resolve():
                self.model_path = candidate
                self._model = None
                self._torch = None
        for key in ("enabled", "confidence_threshold", "input_size", "device", "sample_fps"):
            if key in values and values[key] is not None:
                setattr(self.config, key, values[key])
        return self.info()

    def _load(self) -> None:
        if self._model is not None:
            return
        if not self.model_path.exists():
            logger.error("model_not_found path=%s", self.model_path)
            raise FileNotFoundError(f"Eye-gaze model not found: {self.model_path}")
        if self.model_path.suffix == ".task":
            try:
                import mediapipe as mp
                options = mp.tasks.vision.FaceLandmarkerOptions(
                    base_options=mp.tasks.BaseOptions(model_asset_path=str(self.model_path)),
                    running_mode=mp.tasks.vision.RunningMode.IMAGE,
                    num_faces=1,
                )
                self._model = mp.tasks.vision.FaceLandmarker.create_from_options(options)
                self._mp = mp
                logger.info("mediapipe_face_landmarker_loaded path=%s", self.model_path)
                return
            except ImportError as exc:
                raise RuntimeError("Install mediapipe to use a .task eye-tracker model") from exc
        try:
            import torch
        except ImportError as exc:
            raise RuntimeError("Install torch and torchvision to enable eye-gaze inference") from exc
        with self._lock:
            if self._model is not None:
                return
            device = "cuda" if self.config.device == "auto" and torch.cuda.is_available() else ("cpu" if self.config.device == "auto" else self.config.device)
            logger.info("loading_model path=%s device=%s", self.model_path, device)
            model = torch.jit.load(str(self.model_path), map_location=device) if self.model_path.suffix == ".pt" else torch.load(str(self.model_path), map_location=device, weights_only=False)
            if isinstance(model, dict):
                logger.info("checkpoint_keys=%s", list(model.keys()))
                from torchvision.models import mobilenet_v3_small
                state = model.get("model_state_dict", model.get("state_dict", model.get("model", model)))
                model = mobilenet_v3_small(weights=None)
                model.classifier[3] = torch.nn.Linear(model.classifier[3].in_features, 3)
                model.load_state_dict({k.removeprefix("module."): v for k, v in state.items()})
            self._model, self._torch = model.eval(), torch
            self._device = device
            logger.info("model_loaded type=%s", type(model).__name__)

    def predict(self, image: Any) -> dict[str, Any]:
        if not self.config.enabled:
            return {"enabled": False}
        self._load()
        logger.debug("predict image_type=%s", type(image).__name__)
        if self.model_path.suffix == ".task":
            import numpy as np
            result = self._model.detect(self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=np.asarray(image)))
            if not result.face_landmarks:
                return {"enabled": True, "accepted": False, "reason": "face_not_detected"}
            marks = result.face_landmarks[0]
            # Iris points 468..477 and eye corners from MediaPipe Face Mesh.
            left_iris = marks[468:473]
            right_iris = marks[473:478]
            def center(items): return (sum(p.x for p in items) / len(items), sum(p.y for p in items) / len(items))
            left_x, left_y = center(left_iris); right_x, right_y = center(right_iris)
            gaze_x, gaze_y = (left_x + right_x) / 2, (left_y + right_y) / 2
            pupil_size = sum(((p.x - cx) ** 2 + (p.y - cy) ** 2) ** .5 for points, cx, cy in ((left_iris, left_x, left_y), (right_iris, right_x, right_y)) for p in points[1:]) / 8
            eye_open = abs(marks[159].y - marks[145].y) + abs(marks[386].y - marks[374].y)
            label = "left" if gaze_x < .45 else "right" if gaze_x > .55 else "center"
            return {"enabled": True, "accepted": True, "label": label, "confidence": 1.0, "gaze_x": gaze_x, "gaze_y": gaze_y, "pupil_size": pupil_size, "blink": eye_open < .012}
        from torchvision.transforms import v2 as transforms
        tensor = transforms.Compose([transforms.ToImage(), transforms.Resize((self.config.input_size, self.config.input_size)), transforms.ToDtype(self._torch.float32, scale=True), transforms.Normalize([.485, .456, .406], [.229, .224, .225])])(image).unsqueeze(0).to(self._device)
        with self._torch.inference_mode():
            probabilities = self._torch.softmax(self._model(tensor), dim=1)[0]
        confidence, index = probabilities.max(0)
        return {"enabled": True, "label": self.labels[int(index)], "confidence": round(float(confidence), 4), "accepted": float(confidence) >= self.config.confidence_threshold}


# Face Landmarker provides iris/pupil landmarks required for the current video
# analytics pipeline. The MobileNet checkpoint can still be selected in Settings.
eye_gaze_service = EyeGazeService(Path(__file__).resolve().parents[2] / "ml_model" / "face_landmarker.task")
