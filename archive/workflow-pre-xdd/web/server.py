"""xdd workflow 网页版 server。

启动:
    python -m web.server                  # → http://localhost:8000
    python -m web.server --host 0.0.0.0 --port 8000

路由:
    GET  /                            画布页
    GET  /api/models                  可用模型列表
    POST /api/models/reload           热刷 models.yaml
    GET  /api/graph?task_dir=         读编排图(无则默认图)
    POST /api/graph                   保存编排图
    POST /api/graph/validate          校验编排图
    POST /api/run                     启动执行,返回 run_id
    GET  /api/run/{run_id}/stream     SSE 实时事件流
    POST /api/run/{run_id}/stop       停止执行
    GET  /api/runs                    所有 run 句柄状态
"""
from __future__ import annotations

import asyncio
import argparse
import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import engine
from .graph_io import default_graph, load_graph, save_graph, validate_graph


WEB_DIR = Path(__file__).resolve().parent
STATIC_DIR = WEB_DIR / "static"

app = FastAPI(title="xdd workflow 网页版", version="0.1.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ==================== models ====================
@app.get("/api/models")
def api_models() -> dict[str, Any]:
    return {"models": engine.available_models(), "default": engine.DEFAULT_MODEL}


@app.post("/api/models/reload")
def api_models_reload() -> dict[str, Any]:
    return {"models": engine.reload_models()}


# ==================== graph ====================
@app.get("/api/graph")
def api_get_graph(task_dir: str = Query(..., description="项目目录(须含 prd.md)")) -> dict[str, Any]:
    p = Path(task_dir)
    if not p.exists():
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
def api_validate_graph(req: SaveGraphReq) -> dict[str, Any]:
    return {"errors": validate_graph(req.graph)}


# ==================== run ====================
class RunReq(BaseModel):
    task_dir: str
    force: bool = False


@app.post("/api/run")
def api_run(req: RunReq) -> dict[str, Any]:
    task_dir = Path(req.task_dir)
    if not task_dir.exists():
        raise HTTPException(status_code=404, detail=f"任务目录不存在: {task_dir}")
    # 用当前已保存的 graph;没保存过就用默认图
    graph = load_graph(req.task_dir)
    handle = engine.start_run(graph, str(task_dir.resolve()), force=req.force)
    return {"run_id": handle.run_id, "task_dir": str(task_dir.resolve())}


@app.get("/api/run/{run_id}/stream")
async def api_run_stream(run_id: str):
    """SSE:推该 run 的所有事件(历史 + 实时)。

    协议:每条事件 `data: <json>\n\n`,event 名 = 事件 type。
    """
    handle = engine.get_run(run_id)
    if handle is None:
        raise HTTPException(status_code=404, detail=f"run 不存在: {run_id}")

    async def event_gen():
        idx = 0
        while True:
            # 不持锁读 list(append 是原子的,idx 单调),拿到新增事件就推
            new_events = handle.events[idx:]
            idx = len(handle.events)
            for ev in new_events:
                evtype = ev.get("type", "message")
                yield f"event: {evtype}\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n"
            if handle.finished and idx >= len(handle.events):
                # 已完成且没有更多事件,补推一次 done 后退出
                return
            await asyncio.sleep(0.15)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
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
    out = []
    for rid, h in engine._RUNS.items():
        out.append({
            "run_id": rid,
            "task_dir": h.task_dir,
            "finished": h.finished,
            "alive": h.is_alive(),
            "error": h.error,
            "event_count": len(h.events),
        })
    return {"runs": out}


# ==================== 首页 ====================
@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    index_html = STATIC_DIR / "index.html"
    if not index_html.exists():
        return HTMLResponse("<h1>index.html 未生成</h1>", status_code=500)
    return HTMLResponse(index_html.read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description="xdd workflow 网页版 server")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true", help="开发模式热重载")
    args = parser.parse_args()

    import uvicorn
    uvicorn.run(
        "workflow.web.server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
