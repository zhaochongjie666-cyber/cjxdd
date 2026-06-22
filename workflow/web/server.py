"""xdd workflow Web server(FastAPI + SSE)。

启动:python -m workflow.web.server  →  http://localhost:8000

@implements B02-R04 SSE 实时推送执行进度
"""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ..models import DEFAULT_MODEL, available_models, reload_models
from . import engine
from .graph_io import load_graph, save_graph, validate_graph

WEB_DIR = Path(__file__).resolve().parent
STATIC_DIR = WEB_DIR / "static"

app = FastAPI(title="xdd workflow 网页版", version="0.1.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/api/models")
def api_models() -> dict[str, Any]:
    return {"models": available_models(), "default": DEFAULT_MODEL}


@app.post("/api/models/reload")
def api_models_reload() -> dict[str, Any]:
    return {"models": list(reload_models().keys()) or [DEFAULT_MODEL]}


@app.get("/api/graph")
def api_get_graph(task_dir: str = Query(...)) -> dict[str, Any]:
    if not Path(task_dir).exists():
        raise HTTPException(status_code=404, detail=f"任务目录不存在: {task_dir}")
    return load_graph(task_dir)


class SaveGraphReq(BaseModel):
    task_dir: str
    graph: dict[str, Any]


@app.post("/api/graph")
def api_save_graph(req: SaveGraphReq) -> dict[str, Any]:
    errs = validate_graph(req.graph)
    if errs:
        raise HTTPException(status_code=400, detail="; ".join(errs))
    p = save_graph(req.task_dir, req.graph)
    return {"saved": True, "path": str(p)}


@app.post("/api/graph/validate")
def api_validate(req: SaveGraphReq) -> dict[str, Any]:
    return {"errors": validate_graph(req.graph)}


class RunReq(BaseModel):
    task_dir: str
    force: bool = False


@app.post("/api/run")
def api_run(req: RunReq) -> dict[str, Any]:
    if not Path(req.task_dir).exists():
        raise HTTPException(status_code=404, detail=f"任务目录不存在: {req.task_dir}")
    graph = load_graph(req.task_dir)
    handle = engine.start_run(graph, req.task_dir, force=req.force)
    return {"run_id": handle.run_id, "task_dir": str(Path(req.task_dir).resolve())}


@app.get("/api/run/{run_id}/stream")
async def api_run_stream(run_id: str):
    handle = engine.get_run(run_id)
    if handle is None:
        raise HTTPException(status_code=404, detail=f"run 不存在: {run_id}")

    async def event_gen():
        idx = 0
        while True:
            new_events = handle.events[idx:]
            idx = len(handle.events)
            for ev in new_events:
                yield f"event: {ev.get('type', 'message')}\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n"
            if handle.finished and idx >= len(handle.events):
                return
            await asyncio.sleep(0.15)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@app.post("/api/run/{run_id}/stop")
def api_run_stop(run_id: str) -> dict[str, Any]:
    handle = engine.get_run(run_id)
    if handle is None:
        raise HTTPException(status_code=404, detail=f"run 不存在: {run_id}")
    handle.stop()
    return {"stopped": True, "run_id": run_id}


@app.get("/api/runs")
def api_runs() -> dict[str, Any]:
    return {"runs": [
        {"run_id": rid, "task_dir": h.task_dir, "finished": h.finished,
         "alive": h.is_alive(), "error": h.error, "event_count": len(h.events)}
        for rid, h in engine._RUNS.items()
    ]}


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    f = STATIC_DIR / "index.html"
    if not f.exists():
        return HTMLResponse("<h1>index.html 未生成</h1>", status_code=500)
    return HTMLResponse(f.read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description="xdd workflow 网页版 server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()
    import uvicorn
    uvicorn.run("workflow.web.server:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
