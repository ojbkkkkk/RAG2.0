"""RAG2.0 知识图谱实体关系提取器 — 基于 LLM 异步提取"""

from __future__ import annotations

import asyncio
import difflib
import json
import logging
import re
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# ── Prompt 模板 ─────────────────────────────────────────────────

_SYSTEM_PROMPT = (
    "你是知识图谱构建助手，专门从文本中提取实体和关系三元组。"
    "请严格按照JSON格式输出，不要输出任何其他文字。"
)

_USER_PROMPT_TEMPLATE = (
    "请从以下文本中提取实体和关系三元组。\n\n"
    "要求：\n"
    "1. 实体类型仅限：Person, Organization, Technology, Product, Location, Event, Concept\n"
    "2. 关系需包含置信度(0~1)\n"
    "3. 只输出JSON，不要多余文字\n\n"
    "输出格式：\n"
    "```json\n"
    '{{\n'
    '  "entities": [\n'
    '    {{"text": "实体名称", "type": "实体类型"}}\n'
    '  ],\n'
    '  "relations": [\n'
    '    {{"head": "头实体", "relation": "关系类型", "tail": "尾实体", "confidence": 0.9}}\n'
    '  ]\n'
    '}}\n'
    "```\n\n"
    "文本：\n{text}"
)

# ── 空结果常量 ─────────────────────────────────────────────────

_EMPTY_RESULT: dict[str, list[dict[str, Any]]] = {
    "entities": [],
    "relations": [],
}


class LLMExtractor:
    """基于 LLM 的知识图谱实体关系提取器

    通过调用 OpenAI-compatible API 从文档 chunk 文本中提取
    实体（Entity）和关系三元组（Relation Triple），支持批量处理与结果去重。

    用法::

        async with LLMExtractor(base_url, api_key, model) as extractor:
            result = await extractor.extract_from_text("一些文本")
            # result = {"entities": [...], "relations": [...]}
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        temperature: float = 0.3,
        max_tokens: int = 2000,
        max_gleanings: int = 1,
        dedup_enabled: bool = True,
        confidence_filter: bool = True,
        confidence_threshold: float = 0.6,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.max_gleanings = max_gleanings
        self.dedup_enabled = dedup_enabled
        self.confidence_filter = confidence_filter
        self.confidence_threshold = confidence_threshold
        self._client: httpx.AsyncClient | None = None

    # ── 异步上下文管理器 ───────────────────────────────────────

    async def __aenter__(self) -> LLMExtractor:
        self._client = httpx.AsyncClient(timeout=60.0)
        return self

    async def __aexit__(self, *args: Any) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # ── 公开接口 ────────────────────────────────────────────────

    async def extract_from_text(self, text: str) -> dict[str, list[dict[str, Any]]]:
        """从单段文本中提取实体和关系，支持 Gleaning 追问

        首次提取后，若 max_gleanings > 0，循环追问 LLM 检查是否有
        遗漏的实体或关系，直到达到最大轮数或返回空结果。

        Args:
            text: 待提取的文本内容

        Returns:
            {"entities": [...], "relations": [...]}
        """
        if not text or not text.strip():
            logger.debug("输入文本为空，跳过提取")
            return _copy_empty()

        # 首次提取
        content = await self._call_llm(text)
        first_result = self._parse_llm_response(content)

        if self.max_gleanings <= 0:
            return first_result

        # Gleaning：多轮追问
        all_results = [first_result]
        messages: list[dict[str, str]] = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": _USER_PROMPT_TEMPLATE.format(text=text)},
            {"role": "assistant", "content": content},
        ]

        gleaning_prompt = (
            "请检查上面的提取结果，是否还有遗漏的实体或关系？"
            "如果有，请按相同JSON格式补充输出；"
            "如果没有遗漏，请输出空JSON：{\"entities\": [], \"relations\": []}"
        )

        for gleaning_idx in range(self.max_gleanings):
            messages.append({"role": "user", "content": gleaning_prompt})
            gleaning_content = await self._call_llm_messages(messages)
            gleaning_result = self._parse_llm_response(gleaning_content)

            # 如果返回空结果，提前结束 gleaning
            if not gleaning_result["entities"] and not gleaning_result["relations"]:
                logger.debug("Gleaning 第 %d 轮返回空结果，提前结束", gleaning_idx + 1)
                break

            all_results.append(gleaning_result)
            messages.append({"role": "assistant", "content": gleaning_content})
            logger.debug(
                "Gleaning 第 %d 轮补充: %d entities, %d relations",
                gleaning_idx + 1,
                len(gleaning_result["entities"]),
                len(gleaning_result["relations"]),
            )

        return self._merge_results(all_results)

    async def extract_from_chunks(
        self,
        chunks: list[dict],
        batch_size: int = 5,
    ) -> dict[str, list[dict[str, Any]]]:
        """批量处理多个 chunks，2路并发，合并去重结果

        将 chunks 按 batch_size 合并为多段文本，再以 Semaphore(2) 限制
        同时最多 2 路 LLM 请求并发执行，失败的任务不影响其他任务。

        Args:
            chunks: 文本块列表，每项需包含 ``text`` 或 ``content`` 字段
            batch_size: 每批合并的 chunk 数量

        Returns:
            合并去重后的 {"entities": [...], "relations": [...]}
        """
        if not chunks:
            return _copy_empty()

        # 按 batch_size 分批，将每批 chunk 文本合并为一段
        batches: list[str] = []
        for i in range(0, len(chunks), batch_size):
            batch_text = "\n\n---\n\n".join(
                chunk.get("text") or chunk.get("content") or ""
                for chunk in chunks[i : i + batch_size]
            )
            batches.append(batch_text)

        # 2路并发处理
        semaphore = asyncio.Semaphore(2)

        async def process_batch(text: str) -> dict[str, list[dict[str, Any]]]:
            async with semaphore:
                return await self.extract_from_text(text)

        tasks = [process_batch(text) for text in batches]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        all_results: list[dict[str, list[dict[str, Any]]]] = []
        for idx, result in enumerate(results):
            if isinstance(result, Exception):
                logger.warning("Batch %d 提取失败: %s", idx, result)
                continue
            if result:
                all_results.append(result)

        merged = self._merge_results(all_results)

        # 置信度过滤
        if self.confidence_filter:
            original_count = len(merged["relations"])
            merged["relations"] = [
                r for r in merged["relations"]
                if r.get("confidence", 0.0) >= self.confidence_threshold
            ]
            filtered_count = original_count - len(merged["relations"])
            if filtered_count > 0:
                logger.info(
                    "置信度过滤: 移除 %d 条关系 (阈值=%.2f)",
                    filtered_count,
                    self.confidence_threshold,
                )

        logger.info(
            "批量提取完成: %d entities, %d relations",
            len(merged["entities"]),
            len(merged["relations"]),
        )
        return merged

    # ── LLM 调用 ────────────────────────────────────────────────

    async def _call_llm(self, text: str) -> str:
        """调用 LLM API，带指数退避重试

        Args:
            text: 用户提示中的文本

        Returns:
            LM 返回的原始文本内容
        """
        if self._client is None:
            raise RuntimeError("LLMExtractor 未初始化，请使用 async with 语句")

        url = f"{self.base_url}/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": _USER_PROMPT_TEMPLATE.format(text=text)},
            ],
        }

        last_error: Exception | None = None
        for attempt in range(3):
            try:
                response = await self._client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
                content: str = data["choices"][0]["message"]["content"]
                logger.debug("LLM 响应长度: %d 字符", len(content))
                return content
            except (httpx.HTTPError, KeyError, json.JSONDecodeError) as exc:
                last_error = exc
                wait = 2 ** (attempt + 1)  # 2s, 4s, 8s
                logger.warning(
                    "LLM 调用失败 (第 %d/3 次, %s)，%d 秒后重试",
                    attempt + 1,
                    type(exc).__name__,
                    wait,
                )
                await asyncio.sleep(wait)

        logger.error("LLM 调用最终失败: %s", last_error)
        return ""

    async def _call_llm_messages(self, messages: list[dict[str, str]]) -> str:
        """调用 LLM API（完整 messages 列表），带指数退避重试

        与 _call_llm 不同，本方法接受完整的聊天消息列表，
        适用于多轮对话场景（如 Gleaning 追问）。

        Args:
            messages: 完整的聊天消息列表

        Returns:
            LLM 返回的原始文本内容
        """
        if self._client is None:
            raise RuntimeError("LLMExtractor 未初始化，请使用 async with 语句")

        url = f"{self.base_url}/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "messages": messages,
        }

        last_error: Exception | None = None
        for attempt in range(3):
            try:
                response = await self._client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
                content: str = data["choices"][0]["message"]["content"]
                logger.debug("LLM 响应长度: %d 字符", len(content))
                return content
            except (httpx.HTTPError, KeyError, json.JSONDecodeError) as exc:
                last_error = exc
                wait = 2 ** (attempt + 1)  # 2s, 4s, 8s
                logger.warning(
                    "LLM 调用失败 (第 %d/3 次, %s)，%d 秒后重试",
                    attempt + 1,
                    type(exc).__name__,
                    wait,
                )
                await asyncio.sleep(wait)

        logger.error("LLM 调用最终失败: %s", last_error)
        return ""

    # ── 辅助函数 ────────────────────────────────────────────────

    def _parse_llm_response(self, content: str) -> dict[str, list[dict[str, Any]]]:
        """解析 LLM 响应，处理各种格式

        依次尝试：
        1. 直接 JSON 解析
        2. 从 ```json ... ``` 代码块中提取
        3. 返回空结果

        Args:
            content: LLM 返回的原始文本

        Returns:
            {"entities": [...], "relations": [...]}
        """
        if not content or not content.strip():
            return _copy_empty()

        # 尝试 1：直接 JSON 解析
        try:
            result = json.loads(content)
            return _validate_result(result)
        except json.JSONDecodeError:
            pass

        # 尝试 2：从 markdown 代码块中提取
        json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", content, re.DOTALL)
        if json_match:
            try:
                result = json.loads(json_match.group(1))
                return _validate_result(result)
            except json.JSONDecodeError:
                pass

        # 尝试 3：从文本中寻找第一个 { 到最后一个 } 的子串
        brace_match = re.search(r"\{.*\}", content, re.DOTALL)
        if brace_match:
            try:
                result = json.loads(brace_match.group(0))
                return _validate_result(result)
            except json.JSONDecodeError:
                pass

        logger.warning("无法从 LLM 响应中解析 JSON，内容前 200 字符: %s", content[:200])
        return _copy_empty()

    def _merge_results(
        self,
        results: list[dict[str, list[dict[str, Any]]]],
    ) -> dict[str, list[dict[str, Any]]]:
        """合并多次提取结果，去重

        当 dedup_enabled=True 时，实体使用模糊匹配去重
        （SequenceMatcher ratio >= 0.85 且类型相同视为同一实体，保留较长名称）；
        当 dedup_enabled=False 时，使用精确匹配（text.lower() + type）。

        关系去重：相同 (head, relation, tail) 合并，取最高 confidence

        Args:
            results: 多次提取的结果列表

        Returns:
            合并去重后的结果
        """
        # 实体去重
        if self.dedup_enabled:
            entity_map = self._merge_entities_fuzzy(results)
        else:
            entity_map: dict[tuple[str, str], dict[str, Any]] = {}
            for result in results:
                for entity in result.get("entities", []):
                    key = (entity.get("text", "").lower(), entity.get("type", ""))
                    if key not in entity_map:
                        entity_map[key] = entity

        # 关系去重
        relation_map: dict[tuple[str, str, str], dict[str, Any]] = {}
        for result in results:
            for rel in result.get("relations", []):
                key = (
                    rel.get("head", ""),
                    rel.get("relation", ""),
                    rel.get("tail", ""),
                )
                existing = relation_map.get(key)
                if existing is None:
                    relation_map[key] = rel
                else:
                    # 取最高 confidence
                    old_conf = existing.get("confidence", 0.0)
                    new_conf = rel.get("confidence", 0.0)
                    if new_conf > old_conf:
                        relation_map[key] = rel

        return {
            "entities": list(entity_map.values()),
            "relations": list(relation_map.values()),
        }

    @staticmethod
    def _merge_entities_fuzzy(
        results: list[dict[str, list[dict[str, Any]]]],
    ) -> dict[tuple[str, str], dict[str, Any]]:
        """使用模糊匹配合并实体

        对同类型实体，如果 SequenceMatcher ratio >= 0.85，
        视为同一实体，保留较长名称作为 canonical text，合并 chunk_ids。

        Args:
            results: 多次提取的结果列表

        Returns:
            去重后的实体映射 {(normalized_text, type): entity_dict}
        """
        entity_map: dict[tuple[str, str], dict[str, Any]] = {}
        for result in results:
            for entity in result.get("entities", []):
                text = entity.get("text", "").strip()
                etype = entity.get("type", "")
                norm = text.lower()
                # 检查是否与已有实体模糊匹配
                matched_key: tuple[str, str] | None = None
                for existing_key in entity_map:
                    if existing_key[1] != etype:
                        continue
                    ratio = difflib.SequenceMatcher(
                        None, norm, existing_key[0]
                    ).ratio()
                    if ratio >= 0.85:
                        matched_key = existing_key
                        break

                if matched_key is not None:
                    # 合并：保留较长名称，合并 chunk_ids
                    existing = entity_map[matched_key]
                    existing_text = existing.get("text", "")
                    if len(text) > len(existing_text):
                        existing["text"] = text
                    # 合并 chunk_ids（如果有的话）
                    if "chunk_ids" in entity:
                        existing_ids = existing.get("chunk_ids", [])
                        merged_ids = list(set(existing_ids + entity["chunk_ids"]))
                        existing["chunk_ids"] = merged_ids
                else:
                    key = (norm, etype)
                    if key not in entity_map:
                        entity_map[key] = entity

        return entity_map


# ── 模块级辅助 ──────────────────────────────────────────────────


def _copy_empty() -> dict[str, list[dict[str, Any]]]:
    """返回空结果的深拷贝，避免共享引用"""
    return {"entities": [], "relations": []}


def _validate_result(result: Any) -> dict[str, list[dict[str, Any]]]:
    """校验并规范化 LLM 返回的 JSON 结构

    Args:
        result: 已解析的 JSON 对象

    Returns:
        规范化后的 {"entities": [...], "relations": [...]}
    """
    if not isinstance(result, dict):
        logger.warning("LLM 返回非 dict 类型: %s", type(result).__name__)
        return _copy_empty()

    entities = result.get("entities", [])
    relations = result.get("relations", [])

    if not isinstance(entities, list):
        logger.warning("entities 字段非 list 类型，已忽略")
        entities = []
    if not isinstance(relations, list):
        logger.warning("relations 字段非 list 类型，已忽略")
        relations = []

    # 过滤掉结构不完整的条目
    valid_entities = [
        e for e in entities
        if isinstance(e, dict) and e.get("text") and e.get("type")
    ]
    valid_relations = [
        r for r in relations
        if isinstance(r, dict) and r.get("head") and r.get("relation") and r.get("tail")
    ]

    return {"entities": valid_entities, "relations": valid_relations}
