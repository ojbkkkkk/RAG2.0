# RAG2.0 MCP Server

RAG2.0 的 MCP (Model Context Protocol) Server，通过 stdio 协议与 Claude Code、Claude Desktop 等 AI Agent 通信，提供本地知识库检索能力。

## 配置方式

### Claude Code

在项目根目录的 `.mcp.json` 中添加：

```json
{
  "mcpServers": {
    "rag-knowledge-base": {
      "command": "python",
      "args": ["-m", "mcp_server"],
      "cwd": "/path/to/RAG2.0"
    }
  }
}
```

### Claude Desktop

在 `claude_desktop_config.json` 中添加：

```json
{
  "mcpServers": {
    "rag-knowledge-base": {
      "command": "python",
      "args": ["-m", "mcp_server"],
      "cwd": "/path/to/RAG2.0"
    }
  }
}
```

> **注意**：请将 `/path/to/RAG2.0` 替换为项目的实际绝对路径。

## 直接运行测试

```bash
cd /path/to/RAG2.0
python -m mcp_server
```

## 可用工具

### 1. `search_knowledge`

在本地 RAG 知识库中进行语义相似度搜索，返回与查询最相关的文本片段。

**参数：**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `query` | string | ✅ | — | 搜索查询文本 |
| `collection_name` | string | ❌ | — | 指定知识库名称，不传则搜索所有 |
| `top_k` | integer | ❌ | 5 | 返回结果数量 |
| `score_threshold` | number | ❌ | 0.3 | 最低相似度阈值 (0~1) |

**示例：**

```json
{
  "query": "如何配置数据库连接",
  "collection_name": "tech-docs",
  "top_k": 3,
  "score_threshold": 0.5
}
```

### 2. `list_collections`

列出所有可用的知识库及其统计信息。

**参数：** 无

### 3. `get_document_chunks`

根据文档 ID 获取该文档的所有文本分块。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `document_id` | string | ✅ | 文档 ID |

### 4. `get_collection_stats`

获取指定知识库的详细统计信息，包括文档列表、分块数等。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `collection_name` | string | ✅ | 知识库名称 |

## 工作原理

- MCP Server 是独立进程，不依赖 FastAPI 服务器运行
- 它复用后端的核心模块（embedding、retriever、database），共享相同的数据存储（SQLite + ChromaDB）
- Embedding 模型采用懒加载策略，仅在首次搜索时加载，避免启动缓慢
- 通过 stdio 协议通信，适合与 AI Agent 集成
