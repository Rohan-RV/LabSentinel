"""AI Kavach - FastAPI service.

Endpoints:
  GET  /api/health
  GET  /api/scenarios                 -> the demo validations available
  POST /api/validate                  -> run the full pipeline, return final result
  GET  /api/validate/stream?...       -> Server-Sent Events, one message per stage
                                          (this is what the live pipeline UI uses)

Run:  python -m uvicorn main:app --reload --port 8000   (from the backend/ directory)
"""

import json
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import pipeline

app = FastAPI(title="AI Kavach", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Visual pacing (seconds) between streamed stages so a human can follow the
# pipeline. Presentational only; the work is real. Tune via env VRG_PACING.
PACING = float(os.environ.get("VRG_PACING", "0.5"))


class ValidateRequest(BaseModel):
    instrument: str
    baseline: str
    candidate: str
    trials: int | None = None


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "version-regression-guard"}


@app.get("/api/scenarios")
def scenarios():
    return {"validations": pipeline.list_validations()}


@app.post("/api/validate")
def validate(req: ValidateRequest):
    try:
        return pipeline.run_validation(req.instrument, req.baseline, req.candidate, req.trials)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}")


@app.get("/api/validate/stream")
def validate_stream(instrument: str, baseline: str, candidate: str, trials: int | None = None):
    def event_source():
        try:
            for ev in pipeline.iter_validation(instrument, baseline, candidate, trials, pace=PACING):
                yield f"data: {json.dumps(ev)}\n\n"
        except Exception as exc:  # surface errors to the client as an event
            yield f"data: {json.dumps({'stage': 'error', 'message': f'{type(exc).__name__}: {exc}'})}\n\n"

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
