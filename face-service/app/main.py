"""Servicio de embeddings faciales. No guarda imágenes ni plantillas."""
import base64
from functools import lru_cache

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from insightface.app import FaceAnalysis
from pydantic import BaseModel, Field

app = FastAPI(title="Nexo Drive Face Service", version="0.1.0")


class FaceImage(BaseModel):
    image_base64: str = Field(description="Imagen JPEG/PNG en base64, sin el prefijo data URL")


class Comparison(BaseModel):
    probe: list[float]
    candidate: list[float]
    threshold: float = 0.45


@lru_cache
def face_engine():
    engine = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    engine.prepare(ctx_id=-1, det_size=(640, 640))
    return engine


def decode_image(value: str) -> np.ndarray:
    try:
        encoded = value.split(",", 1)[-1]
        image = cv2.imdecode(np.frombuffer(base64.b64decode(encoded), np.uint8), cv2.IMREAD_COLOR)
    except Exception as exc:
        raise HTTPException(400, "La imagen no es un base64 válido.") from exc
    if image is None:
        raise HTTPException(400, "No se pudo leer la imagen.")
    return image


def validate_capture(image: np.ndarray, face) -> None:
    """Controles de calidad; no sustituyen la prueba de vida anti-suplantación."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    brightness = float(gray.mean())
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    height, width = image.shape[:2]
    x1, y1, x2, y2 = face.bbox.astype(int)
    face_area = max(0, x2 - x1) * max(0, y2 - y1)
    if brightness < 45 or brightness > 215:
        raise HTTPException(422, "La iluminación no es adecuada. Busca una luz frontal uniforme.")
    if sharpness < 35:
        raise HTTPException(422, "La imagen está borrosa. Mantén la cámara estable.")
    if face_area < (width * height * 0.04):
        raise HTTPException(422, "Acércate un poco más a la cámara.")


@app.get("/health")
def health():
    return {"status": "ok", "engine": "insightface/buffalo_l", "embedding_dimension": 512}


@app.post("/embedding")
def embedding(payload: FaceImage):
    image = decode_image(payload.image_base64)
    faces = face_engine().get(image)
    if len(faces) != 1:
        raise HTTPException(422, "Se requiere exactamente un rostro visible.")
    validate_capture(image, faces[0])
    vector = faces[0].normed_embedding.astype(float)
    return {
        "model": "insightface/buffalo_l",
        "dimension": len(vector),
        "embedding": vector.tolist(),
    }


@app.post("/compare")
def compare(payload: Comparison):
    probe = np.array(payload.probe, dtype=np.float32)
    candidate = np.array(payload.candidate, dtype=np.float32)
    if probe.shape != candidate.shape or probe.ndim != 1:
        raise HTTPException(400, "Los vectores deben tener la misma dimensión.")
    score = float(np.dot(probe, candidate) / (np.linalg.norm(probe) * np.linalg.norm(candidate)))
    return {"similarity": score, "matched": score >= payload.threshold, "threshold": payload.threshold}
