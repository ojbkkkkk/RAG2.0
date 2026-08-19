"""RAG2.0 对接配置 API"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from app.db.database import db_manager
from app.models.schemas import (
    IntegrationServiceCreate,
    IntegrationServiceUpdate,
    IntegrationServiceResponse,
    IntegrationConfigResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

# 项目根目录（用于生成配置路径）
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent


def _build_config(service: dict[str, Any]) -> IntegrationConfigResponse:
    """根据服务配置生成 MCP 对接配置"""
    agent_type = service["agent_type"]
    retrieval_mode = service["retrieval_mode"]
    collections = service["collections"]
    service_name = service["name"]

    # 检索模式描述
    mode_desc = {
        "vector": "向量语义检索（Embedding切片）",
        "graph": "知识图谱检索（LLM实体关系）",
        "hybrid": "混合检索（向量 + 图谱综合）",
    }.get(retrieval_mode, "向量检索")

    # MCP 配置 JSON（所有 agent 类型通用 stdio 模式）
    python_cmd = sys.executable or "python3"
    project_path = str(_PROJECT_ROOT)

    # 基本 args
    args = ["-m", "mcp_server"]

    # 环境变量：传递检索模式和知识库范围
    env_vars: dict[str, str] = {}
    if retrieval_mode != "vector":
        env_vars["RAG2_RETRIEVAL_MODE"] = retrieval_mode
    if collections:
        env_vars["RAG2_COLLECTIONS"] = ",".join(collections)

    mcp_server_config: dict[str, Any] = {
        "command": python_cmd,
        "args": args,
        "cwd": project_path,
    }
    if env_vars:
        mcp_server_config["env"] = env_vars

    # 根据 agent_type 生成不同的外层配置结构
    if agent_type == "claude_code":
        config_json = {
            "mcpServers": {
                f"rag-{service_name}": mcp_server_config
            }
        }
        config_path = "~/.claude/claude_desktop_config.json"
        instructions = [
            f"1. 打开 Claude Code 配置文件：{config_path}",
            "2. 将以下 JSON 内容合并到配置文件的 mcpServers 对象中",
            "3. 保存文件后重启 Claude Code",
            f"4. 在 Tools 菜单中确认看到 \"rag-{service_name}\" 服务",
            f"5. 检索模式：{mode_desc}",
        ]
        verification = "在 Claude Code 对话中输入「请列出所有知识库」，确认能正常返回知识库列表"

    elif agent_type == "codex":
        config_json = {
            "mcpServers": {
                f"rag-{service_name}": mcp_server_config
            }
        }
        config_path = "~/.codex/config.json"
        instructions = [
            f"1. 打开 Codex 配置文件：{config_path}",
            "2. 将以下 JSON 内容合并到配置文件的 mcpServers 对象中",
            "3. 保存文件后重启 Codex",
            f"4. 确认 Codex 已加载 \"rag-{service_name}\" MCP 服务",
            f"5. 检索模式：{mode_desc}",
        ]
        verification = "在 Codex 中请求检索知识库内容，确认能正常返回结果"

    elif agent_type == "hermes":
        config_json = {
            "servers": {
                f"rag-{service_name}": {
                    "type": "stdio",
                    **mcp_server_config,
                }
            }
        }
        config_path = "~/.hermes/config.json"
        instructions = [
            f"1. 打开 Hermes 配置文件：{config_path}",
            "2. 将以下 JSON 内容合并到配置文件的 servers 对象中",
            "3. 运行 hermes start 启动聚合服务",
            f"4. 确认 \"rag-{service_name}\" 已注册",
            f"5. 检索模式：{mode_desc}",
        ]
        verification = "运行 hermes list 确认服务已注册，然后通过 Hermes HTTP 接口测试检索功能"

    else:
        config_json = {}
        config_path = ""
        instructions = ["不支持的 Agent 类型"]
        verification = ""

    return IntegrationConfigResponse(
        service_name=service_name,
        agent_type=agent_type,
        retrieval_mode=retrieval_mode,
        config_json=config_json,
        config_path=config_path,
        instructions=instructions,
        verification=verification,
    )


@router.get("", response_model=list[IntegrationServiceResponse])
async def list_services():
    """列出所有对接服务"""
    services = await db_manager.list_integration_services()
    return [
        IntegrationServiceResponse(
            id=s["id"],
            name=s["name"],
            agent_type=s["agent_type"],
            enabled=bool(s["enabled"]),
            collections=s["collections"],
            retrieval_mode=s.get("retrieval_mode", "vector"),
            created_at=s["created_at"],
            updated_at=s["updated_at"],
        )
        for s in services
    ]


@router.post("", response_model=IntegrationServiceResponse)
async def create_service(data: IntegrationServiceCreate):
    """创建对接服务"""
    # 验证 agent_type
    if data.agent_type not in ("claude_code", "codex", "hermes"):
        raise HTTPException(status_code=400, detail="agent_type 必须为 claude_code / codex / hermes")
    if data.retrieval_mode not in ("vector", "graph", "hybrid"):
        raise HTTPException(status_code=400, detail="retrieval_mode 必须为 vector / graph / hybrid")

    service = await db_manager.create_integration_service(data.model_dump())
    return IntegrationServiceResponse(
        id=service["id"],
        name=service["name"],
        agent_type=service["agent_type"],
        enabled=bool(service["enabled"]),
        collections=service["collections"],
        retrieval_mode=service.get("retrieval_mode", "vector"),
        created_at=service["created_at"],
        updated_at=service["updated_at"],
    )


@router.put("/{service_id}", response_model=IntegrationServiceResponse)
async def update_service(service_id: str, data: IntegrationServiceUpdate):
    """更新对接服务"""
    updates = data.model_dump(exclude_none=True)
    if "enabled" in updates:
        updates["enabled"] = int(updates["enabled"])
    if "agent_type" in updates and updates["agent_type"] not in ("claude_code", "codex", "hermes"):
        raise HTTPException(status_code=400, detail="agent_type 必须为 claude_code / codex / hermes")
    if "retrieval_mode" in updates and updates["retrieval_mode"] not in ("vector", "graph", "hybrid"):
        raise HTTPException(status_code=400, detail="retrieval_mode 必须为 vector / graph / hybrid")

    service = await db_manager.update_integration_service(service_id, updates)
    if service is None:
        raise HTTPException(status_code=404, detail="对接服务不存在")
    return IntegrationServiceResponse(
        id=service["id"],
        name=service["name"],
        agent_type=service["agent_type"],
        enabled=bool(service["enabled"]),
        collections=service["collections"],
        retrieval_mode=service.get("retrieval_mode", "vector"),
        created_at=service["created_at"],
        updated_at=service["updated_at"],
    )


@router.delete("/{service_id}")
async def delete_service(service_id: str):
    """删除对接服务"""
    deleted = await db_manager.delete_integration_service(service_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="对接服务不存在")
    return {"status": "ok", "message": "已删除"}


@router.get("/{service_id}/config", response_model=IntegrationConfigResponse)
async def get_service_config(service_id: str):
    """生成对接配置"""
    service = await db_manager.get_integration_service(service_id)
    if service is None:
        raise HTTPException(status_code=404, detail="对接服务不存在")
    return _build_config(service)
