"""subprocess 调 claude CLI + stream-json 解析。

内核照搬旧版 run_workflow.py 的 parser_msg + agent_worker(parser_msg 原样,
agent_worker 改成生成器版:把 log() 换成 on_log 回调 + stop_check 中断)。

@implements 基础层(被 B01 run_workflow 和 B02 engine 共享)
"""
from __future__ import annotations

import json
import logging
import select
import subprocess
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterator

from .models import WORKFLOW_DIR, model_env


def parser_msg(data: dict, output_format: str = "text"):
    """解析 Claude stream-json 单条消息 → 字符串(无内容返回 None)。

    照搬旧版 run_workflow.parser_msg,支持 stream_event/assistant/user/result/system。
    """
    msg_type = data.get("type")
    result: Any = None

    def extract_text_thinking(delta: dict):
        if delta.get("text"):
            return delta.get("text")
        if delta.get("thinking"):
            return delta.get("thinking")
        partial = delta.get("partial_json", "")
        if partial:
            partial_str = str(partial)
            if '"text"' in partial_str or '"thinking"' in partial_str:
                return partial
        return None

    if msg_type == "stream_event":
        event = data.get("event", {})
        event_type = event.get("type")
        if event_type in ("content_block_start", "content_block_stop"):
            content = event.get("content_block", {})
            if content.get("type") == "thinking":
                return content.get("thinking") or content.get("text")
            return None
        if event_type in ("content_block_delta", "message_delta"):
            delta = event.get("delta", {})
            if delta.get("partial_json"):
                return delta.get("partial_json")
            result = extract_text_thinking(delta)
            if event_type == "content_block_delta" and delta.get("type") == "input_json_delta":
                partial = delta.get("partial_json", "")
                if partial and ('"text"' in str(partial) or '"thinking"' in str(partial)):
                    result = partial
                else:
                    result = None
            return result
        if event_type in ("message_start", "message_stop"):
            return None
    elif msg_type == "assistant":
        message = data.get("message", {})
        content = message.get("content", [])
        if content:
            last = content[-1]
            if last.get("type") == "tool_use":
                tool_name = last.get("name", "")
                tool_input = last.get("input", {})
                return f"[TOOL: {tool_name}] {tool_input}"
            result = last.get("thinking") or last.get("text")
    elif msg_type == "user":
        message = data.get("message", {})
        content = message.get("content", [])
        if content:
            last = content[-1]
            result = last.get("content") or last.get("text")
            if result:
                return result
    elif msg_type == "result":
        result = data.get("result")
    elif msg_type == "system":
        subtype = data.get("subtype", "")
        hook_name = data.get("hook_name", "unknown")
        if subtype == "hook_started":
            result = f"[HOOK: {hook_name} started]"
        elif subtype == "hook_response":
            output = data.get("output", "")
            result = f"[HOOK: {hook_name} response]" + (f" {output}" if output else "")
        else:
            result = f"[SYSTEM: {subtype}]"

    if output_format == "json" and result:
        try:
            return json.dumps(result, ensure_ascii=False)
        except (TypeError, ValueError):
            return str(result)
    return result


def run_agent_stream(
    agent: str,
    prompt: str,
    task_dir: Path,
    model: str = "",
    on_log: Callable[[str], None] | None = None,
    stop_check: Callable[[], bool] | None = None,
    timeout: int = 3000,
) -> Iterator[dict]:
    """跑一个 claude 节点,流式产出事件(生成器)。

    Args:
        agent: 节点名(用于日志文件名)。
        prompt: 节点 prompt。
        task_dir: 任务目录(log 落此处)。
        model: 模型名(取 models.yaml 的 env)。
        on_log: 日志回调(每行解析后调);None 则不回调(调用方迭代事件)。
        stop_check: 返回 True 则中断(kill subprocess)。
        timeout: 单节点超时秒数。

    Yields:
        事件 dict:{"type": "log"|"success"|"timeout"|"stopped", ...}
    """
    task_dir = Path(task_dir)
    claude_env = model_env(model) if model else ""
    if not claude_env:
        yield {"type": "log", "text": f"[warn] 模型 '{model}' 无 env 配置,用默认"}

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    debug_dir = task_dir / "log" / "claude"
    debug_dir.mkdir(parents=True, exist_ok=True)
    debug_file = debug_dir / f"{timestamp}_{agent}_{uuid.uuid4().hex[:8]}.log"

    add_system_prompt_file = WORKFLOW_DIR / "SYSTEM.md"
    tmp_system = task_dir / "log" / "prompt" / f"system_{timestamp}_{uuid.uuid4().hex[:8]}.md"
    tmp_system.parent.mkdir(parents=True, exist_ok=True)
    if add_system_prompt_file.exists():
        tmp_system.write_text(add_system_prompt_file.read_text(encoding="utf-8"), encoding="utf-8")

    tt = f"/tmp/prompt_{uuid.uuid4().hex[:8]}.md"
    Path(tt).write_text(prompt, encoding="utf-8")

    cmd = (
        f"{claude_env} && echo {tt} | claude "
        f"--append-system-prompt-file {tmp_system} "
        f"--permission-mode bypassPermissions --include-partial-messages "
        f"--debug-file {debug_file} --output-format stream-json --verbose -p"
    )
    yield {"type": "log", "text": f"$ {cmd[:140]}"}
    if on_log:
        on_log(f"$ {cmd}")

    try:
        process = subprocess.Popen(
            cmd, shell=True, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, bufsize=1,
        )
    except Exception as e:
        yield {"type": "log", "text": f"[error] 启动 claude 失败: {e}"}
        return

    start = time.time()
    success = False
    while True:
        if stop_check and stop_check():
            process.kill()
            yield {"type": "stopped"}
            return
        ready, _, _ = select.select([process.stdout], [], [], 2)
        if ready:
            line = process.stdout.readline()
            if not line:
                break
            if line == "/bin/sh: 1: Test: not found\n":
                continue
            try:
                data = json.loads(line)
                msg = parser_msg(data)
                if msg:
                    if "'type': 'image'" not in str(msg):
                        yield {"type": "log", "text": str(msg)}
                        if on_log:
                            on_log(str(msg))
                if data.get("type") == "result" and data.get("subtype") == "success":
                    success = True
            except json.JSONDecodeError:
                # 非 JSON 行(claude 的非流式输出/脏行),跳过不处理
                continue
        else:
            if process.poll() is not None:
                break
            if time.time() - start > timeout:
                process.kill()
                yield {"type": "timeout", "timeout": timeout}
                return

    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()

    if success:
        yield {"type": "success"}
    else:
        yield {"type": "log", "text": f"[warn] claude 未返回 success(rc={process.returncode})"}
        yield {"type": "success", "success": False}  # 调用方据此判节点成败
