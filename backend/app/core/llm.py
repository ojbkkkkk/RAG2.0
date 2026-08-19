"""RAG2.0 LLM 客户端封装 — OpenAI 兼容 API，支持 SSE 流式输出"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

import httpx

from app.db.database import db_manager

logger = logging.getLogger(__name__)


async def _get_llm_config() -> tuple[str, str, str]:
    """从数据库读取 LLM 配置，返回 (base_url, api_key, model_name)

    Raises:
        ValueError: 配置不完整时抛出
    """
    base_url = await db_manager.get_setting("llm_base_url") or ""
    api_key = await db_manager.get_setting("llm_api_key") or ""
    model_name = await db_manager.get_setting("llm_model_name") or ""

    base_url = base_url.rstrip("/")
    if not base_url or not model_name:
        raise ValueError("LLM 未配置，请在系统设置中填写 LLM Base URL 和模型名称")

    return base_url, api_key, model_name


async def stream_chat_completion(
    messages: list[dict[str, str]],
    temperature: float = 0.7,
    max_tokens: int = 2000,
) -> AsyncGenerator[str, None]:
    """流式调用 LLM，逐步 yield content delta

    Args:
        messages: OpenAI 格式的消息列表 [{"role": "system", "content": "..."}, ...]
        temperature: 采样温度
        max_tokens: 最大生成 token 数

    Yields:
        逐个 token 的文本片段
    """
    base_url, api_key, model_name = await _get_llm_config()

    url = f"{base_url}/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model_name,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }

    logger.info(
        "LLM 流式请求: model=%s, url=%s, messages=%d 条",
        model_name, url, len(messages),
    )

    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0)) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as response:
            if response.status_code != 200:
                error_body = await response.aread()
                error_msg = error_body.decode("utf-8", errors="replace")
                logger.error("LLM 请求失败: status=%d, body=%s", response.status_code, error_msg[:500])
                raise RuntimeError(f"LLM 请求失败 (HTTP {response.status_code}): {error_msg[:300]}")

            async for line in response.aiter_lines():
                line = line.strip()
                if not line:
                    continue
                if not line.startswith("data:"):
                    continue

                data_str = line[len("data:"):].strip()
                if data_str == "[DONE]":
                    break

                try:
                    chunk = json.loads(data_str)
                except json.JSONDecodeError:
                    logger.warning("无法解析 SSE chunk: %s", data_str[:200])
                    continue

                choices = chunk.get("choices", [])
                if not choices:
                    continue

                delta = choices[0].get("delta", {})
                content = delta.get("content", "")
                if content:
                    yield content
