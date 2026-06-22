"""读 models.yaml 模型 env 配置。

每个模型配一段 env(API key / base_url),run_workflow 和 web 共享。
models.yaml 不入库(含 key)。

@implements 基础层(被 B01/B02 共享)
"""
from __future__ import annotations

from pathlib import Path

import yaml

WORKFLOW_DIR = Path(__file__).resolve().parent

DEFAULT_MODEL = "YACC"


def load_model_envs() -> dict:
    """读 workflow/models.yaml,返回 {模型名: {"env": "..."}}。文件不存在返回 {}。"""
    f = WORKFLOW_DIR / "models.yaml"
    if not f.exists():
        return {}
    with open(f, encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    return data.get("models", {}) or {}


# import 时缓存(改 models.yaml 后调 reload_models 刷新)
MODEL_ENVS: dict = load_model_envs()


def reload_models() -> dict:
    """热刷 models.yaml(改 key 后调)。"""
    global MODEL_ENVS
    MODEL_ENVS = load_model_envs()
    return MODEL_ENVS


def available_models() -> list[str]:
    """可用模型名列表(DEFAULT_MODEL 排首位)。"""
    keys = list(MODEL_ENVS.keys()) if MODEL_ENVS else []
    if DEFAULT_MODEL not in keys:
        keys.insert(0, DEFAULT_MODEL)
    return keys


def model_env(model: str) -> str:
    """取某模型的 env 字符串,缺失返回空串。"""
    return MODEL_ENVS.get(model, {}).get("env", "")
