# RAG 知识库系统 v1.03

> 完全本地运行的 RAG 知识库管理平台，支持多格式文档解析、BGE-M3 语义检索、MCP 协议对接 Claude Code 等 AI Agent。

## 功能特性

- **多格式文档解析** — 支持 Markdown、PDF、Word、PPT、纯文本、CSV/TSV、JSON 等 7 种格式
- **BGE-M3 满血向量化** — 本地运行 BAAI/bge-m3 模型，支持 Dense + Sparse + Multi-vector 三种检索模式，Apple Silicon MPS 加速
- **MCP 协议对接** — 内置 MCP Server（stdio 模式），可直接对接 Claude Code 等 AI Agent
- **可视化管理界面** — 基于 React 18 的 Web UI，支持知识库管理、文档上传、语义搜索、分块预览
- **ChromaDB 向量存储** — 嵌入式向量数据库，零运维，数据完全本地
- **一键启停** — 提供 `start.sh` / `stop.sh` / `restart.sh` 脚本，开箱即用
- **REST API** — FastAPI 提供完整的 REST API，自带 Swagger 文档

## 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | macOS（Apple Silicon 推荐，支持 MPS 加速） |
| Python | 3.10+（推荐 3.11） |
| Node.js | 18+ |
| 磁盘空间 | 约 5GB（含 BGE-M3 模型） |
| 内存 | 16GB+（推荐 32GB） |

## 快速开始

### 一键启动

```bash
./start.sh
```

启动脚本会自动：
1. 检查 Python / Node.js 环境
2. 安装缺失的前后端依赖
3. 检查端口占用
4. 启动后端（FastAPI）和前端（Vite dev server）
5. 等待服务就绪并输出访问地址

> 首次启动时，BGE-M3 模型会自动从 HuggingFace 下载（约 2.2GB），请确保网络通畅。也可提前运行 `cd backend && python3.11 scripts/download_model.py` 手动下载。

### 一键停止

```bash
./stop.sh
```

### 重启服务

```bash
./restart.sh
```

### 访问地址

| 服务 | 地址 |
|------|------|
| 前端界面 | http://localhost:3000 |
| 后端 API | http://localhost:8000 |
| API 文档 | http://localhost:8000/docs |

## 首次使用指南

### 1. 创建知识库

打开 http://localhost:3000，点击「新建知识库」，填写名称和描述。例如创建一个名为 `技术文档` 的知识库。

### 2. 上传文档

进入知识库详情页，拖拽或选择文件上传。支持多文件批量上传，系统会自动解析并分块。

### 3. 搜索测试

进入「语义搜索」页面，输入查询语句即可测试检索效果。搜索结果会显示匹配的分块内容、来源文档和相似度评分。

### 4. 配置 MCP 对接 Claude Code

见下方「对接 Claude Code」章节。

## 对接 Claude Code

通过 MCP 协议（stdio 模式），Claude Code 可以直接调用本系统的检索能力。

在项目根目录或用户目录下创建 `.mcp.json` 文件：

```json
{
  "mcpServers": {
    "rag-knowledge-base": {
      "command": "python3.11",
      "args": [
        "-m",
        "mcp_server"
      ],
      "cwd": "/Users/kevin/AI-project/Qoder/RAG2.0"
    }
  }
}
```

> **注意：**
> - `cwd` 需要替换为你的实际项目路径
> - `python3.11` 需要替换为你系统中可用的 Python 路径（可能需要用 `python3` 或 `python3.10`）
> - 确保 `mcp_server` 依赖已安装：`cd backend && pip install -r requirements.txt`

配置完成后，Claude Code 将获得以下工具：

| 工具名 | 说明 |
|--------|------|
| `search_knowledge` | 语义检索知识库，支持指定知识库、返回数量、相似度阈值 |
| `list_collections` | 列出所有知识库及其统计信息 |
| `get_document_chunks` | 获取指定文档的所有分块内容 |
| `get_collection_stats` | 获取指定知识库的详细统计信息 |

## 对接其他 AI Agent

除了 MCP 协议，本系统也提供完整的 REST API，任何支持 HTTP 请求的 AI Agent 都可对接。

### 搜索接口

```bash
curl -X POST http://localhost:8000/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "如何配置MCP",
    "collection_name": "技术文档",
    "top_k": 5,
    "score_threshold": 0.3
  }'
```

### 列出知识库

```bash
curl http://localhost:8000/api/collections
```

### 获取知识库详情

```bash
curl http://localhost:8000/api/collections/{collection_id}
```

### 上传文档

```bash
curl -X POST http://localhost:8000/api/collections/{collection_id}/documents \
  -F "files=@/path/to/document.pdf"
```

完整 API 文档请访问 http://localhost:8000/docs

## 支持的文件格式

| 格式 | 扩展名 | 说明 |
|------|--------|------|
| Markdown | `.md`, `.markdown` | 直接解析，按标题分块 |
| PDF | `.pdf` | 逐页提取文本 |
| Word | `.docx` | 提取段落 + 表格 |
| PPT | `.pptx` | 提取文字 + 备注 + 表格 |
| 纯文本 | `.txt`, `.log` | 直接读取 |
| CSV/TSV | `.csv`, `.tsv` | 表格转文本 |
| JSON | `.json` | 格式化读取 |

## 项目结构

```
RAG2.0/
├── backend/                 # Python 后端（FastAPI）
│   ├── app/
│   │   ├── api/             # REST API 路由
│   │   ├── core/            # 核心逻辑：分块、Embedding、检索
│   │   ├── db/              # 数据库管理（SQLite + ChromaDB）
│   │   ├── models/          # Pydantic 数据模型
│   │   ├── parsers/         # 文档解析器（PDF/DOCX/PPTX/MD/TXT）
│   │   ├── config.py        # 配置管理
│   │   └── main.py          # FastAPI 入口
│   ├── data/                # 运行时数据（向量库、SQLite、上传文件）
│   └── scripts/             # 辅助脚本（模型下载等）
├── frontend/                # React 前端
│   └── src/
│       ├── api/             # API 客户端
│       ├── components/      # UI 组件
│       ├── pages/           # 页面组件
│       └── types/           # TypeScript 类型定义
├── mcp_server/              # MCP Server（stdio 模式）
│   ├── server.py            # MCP 工具定义与实现
│   └── __main__.py          # 入口
├── start.sh                 # 一键启动
├── stop.sh                  # 一键停止
└── restart.sh               # 一键重启
```

## 技术架构

| 组件 | 技术选型 |
|------|----------|
| 后端框架 | FastAPI + Python 3.11 |
| 前端框架 | React 18 + Vite 5 + TailwindCSS |
| 向量数据库 | ChromaDB（嵌入式） |
| Embedding 模型 | BGE-M3（BAAI，本地满血运行，支持 MPS 加速） |
| 元数据存储 | SQLite |
| AI Agent 对接 | MCP 协议（stdio 模式） |

## 配置说明

### 环境变量

所有配置项均可通过环境变量覆盖，前缀为 `RAG2_`。例如：

```bash
export RAG2_DEVICE=cpu                    # 强制使用 CPU（默认自动检测）
export RAG2_CHUNK_SIZE=512               # 分块大小
export RAG2_CHUNK_OVERLAP=50             # 分块重叠
export RAG2_DEFAULT_TOP_K=5              # 默认检索数量
export RAG2_EMBEDDING_BATCH_SIZE=12      # Embedding 批处理大小
```

也可在 `backend/` 目录下创建 `.env` 文件：

```ini
RAG2_DEVICE=mps
RAG2_CHUNK_SIZE=512
RAG2_CHUNK_OVERLAP=50
RAG2_EMBEDDING_BATCH_SIZE=12
```

### 配置文件位置

| 文件 | 说明 |
|------|------|
| `backend/app/config.py` | 所有配置项的默认值和定义 |
| `backend/.env` | 本地环境变量覆盖（不纳入 Git） |
| `frontend/vite.config.ts` | 前端构建和代理配置 |

### 端口配置

默认端口可在 `start.sh` 中修改：

- 后端：`8000`
- 前端：`3000`

## 常见问题

### 模型下载慢怎么办？

BGE-M3 模型托管在 HuggingFace，国内下载可能较慢。可以：

1. 使用镜像站：`export HF_ENDPOINT=https://hf-mirror.com`
2. 手动下载：`cd backend && python3.11 scripts/download_model.py`
3. 从其他机器拷贝模型文件到 `~/.cache/huggingface/hub/models--BAAI--bge-m3/`

### 端口被占用

```bash
# 查看占用端口的进程
lsof -i :8000
lsof -i :3000

# 终止占用进程
kill -9 <PID>

# 或使用 stop.sh 清理所有残留进程
./stop.sh
```

### Python 版本不对

系统需要 Python 3.10+，启动脚本会优先寻找 `python3.11`。如果找不到：

```bash
# macOS 安装 Python 3.11
brew install python@3.11

# 验证
python3.11 --version
```

### 前端依赖安装失败

```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

### Embedding 模型加载失败

- 确认磁盘空间充足（模型约 2.2GB）
- 确认 PyTorch 已安装：`python3.11 -c "import torch; print(torch.__version__)"`
- macOS Apple Silicon 需安装 nightly 版 PyTorch 以支持 MPS

### 如何查看日志

```bash
# 后端日志
tail -f logs/backend.log

# 前端日志
tail -f logs/frontend.log
```

## 版本历史

### v1.03 (2025-06-10)

- 整合知识图谱可视化模块（ReactFlow交互式图谱、实体提取、节点/关系CRUD）
- 整合智能问答模块（SSE流式输出、混合检索、多轮对话、Markdown渲染）
- 导航菜单优化（新增知识图谱和智能问答入口）
- "语义搜索"更名为"语义检索"

### v1.02 (2025-06-10)

- 全新仪表盘首页（图形化统计、组件状态监控、数据管道态势动画）
- 系统配置页面（Logo自定义、系统名称修改、LLM配置预留）
- 全站UI升级为毛玻璃+渐变色高级视觉风格
- 浏览器标签页标题与系统名称动态同步
- 导航栏重新排序优化

### v1.01 (2025-06-10)

- 支持中文知识库命名（ChromaDB名称自动映射）
- 文档批量删除功能
- OCR文字识别（支持扫描版PDF和图片）
- 图片文件上传支持（JPG/PNG/BMP/TIFF/WebP）
- 知识库分块大小可配置（精准/均衡/长上下文模式）
- 前端UI优化：切块模式场景注释、系统名称更新
- 修复：CORS端口配置、ChromaDB sparse查询兼容性、虚拟环境路径

### v1.00 (2025-06-09)

- 初始版本发布
- 完成核心 RAG 引擎
- 多格式文档解析（MD / PDF / DOCX / PPTX / TXT / CSV / JSON）
- BGE-M3 本地 Embedding（支持 MPS 加速）
- ChromaDB 向量存储
- FastAPI 完整 REST API
- React 可视化管理界面
- MCP Server 对接 Claude Code
- 一键启动 / 停止 / 重启脚本
