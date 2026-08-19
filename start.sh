#!/bin/bash
# RAG知识库系统 - 一键启动脚本

set -euo pipefail

# ── 颜色定义 ──────────────────────────────────────────────────
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── 项目路径 ──────────────────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
PID_FILE="$PROJECT_DIR/.pids"
LOG_DIR="$PROJECT_DIR/logs"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

# ── 端口配置 ──────────────────────────────────────────────────
BACKEND_PORT=${BACKEND_PORT:-8000}
FRONTEND_PORT=${FRONTEND_PORT:-3000}

# ── Python路径（优先使用 .venv，其次 python3.11）──────────────────
VENV_PYTHON="$BACKEND_DIR/.venv/bin/python"
if [[ -f "$VENV_PYTHON" ]]; then
    PYTHON="$VENV_PYTHON"
else
    PYTHON=$(command -v python3.11 2>/dev/null || command -v python3 2>/dev/null || command -v python 2>/dev/null || echo "")
fi

# ── 辅助函数 ──────────────────────────────────────────────────

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()    { echo -e "${RED}[FAIL]${NC} $1"; }

check_port() {
    local port=$1
    if lsof -i ":$port" -sTCP:LISTEN -t &>/dev/null; then
        return 0  # 端口被占用
    else
        return 1  # 端口空闲
    fi
}

cleanup() {
    fail "启动过程中发生错误，正在清理..."
    if [[ -f "$PID_FILE" ]]; then
        while IFS=: read -r name pid; do
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
            fi
        done < "$PID_FILE"
        rm -f "$PID_FILE"
    fi
    exit 1
}

trap cleanup ERR

# ── 开场 ──────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   矩阵-知识库管理系统 v1.04              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── 1. 检查Python ─────────────────────────────────────────────
info "检查 Python 环境..."

if [[ -z "$PYTHON" ]]; then
    fail "未找到 Python，请安装 Python 3.10+ 或创建 .venv"
    exit 1
fi

PY_VERSION=$($PYTHON -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
PY_MINOR=$(echo "$PY_VERSION" | cut -d. -f2)

if [[ "$PY_MAJOR" -lt 3 ]] || [[ "$PY_MAJOR" -eq 3 && "$PY_MINOR" -lt 10 ]]; then
    fail "Python 版本过低: $PY_VERSION，需要 3.10+"
    exit 1
fi

success "Python $PY_VERSION (${PYTHON})"

# ── 2. 检查后端依赖 ───────────────────────────────────────────
info "检查后端依赖..."

if ! $PYTHON -c "import fastapi" 2>/dev/null; then
    warn "FastAPI 未安装，正在安装后端依赖..."
    cd "$BACKEND_DIR"
    $PYTHON -m pip install -r requirements.txt -q
    if [[ $? -ne 0 ]]; then
        fail "后端依赖安装失败，请手动运行: cd backend && pip install -r requirements.txt"
        exit 1
    fi
    success "后端依赖安装完成"
else
    success "后端依赖已就绪"
fi

# ── 3. 检查前端依赖 ───────────────────────────────────────────
info "检查前端环境..."

if ! command -v node &>/dev/null; then
    fail "未找到 Node.js，请安装 Node.js 18+"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
success "Node.js $(node -v)"

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    warn "node_modules 不存在，正在安装前端依赖..."
    cd "$FRONTEND_DIR"
    npm install
    if [[ $? -ne 0 ]]; then
        fail "前端依赖安装失败，请手动运行: cd frontend && npm install"
        exit 1
    fi
    success "前端依赖安装完成"
else
    success "前端依赖已就绪"
fi

# ── 4. 检查端口占用 ───────────────────────────────────────────
info "检查端口占用..."

if check_port "$BACKEND_PORT"; then
    fail "端口 $BACKEND_PORT 已被占用，请先停止占用该端口的进程"
    echo -e "  ${CYAN}提示: lsof -i :$BACKEND_PORT${NC}"
    exit 1
fi
success "端口 $BACKEND_PORT 可用"

if check_port "$FRONTEND_PORT"; then
    fail "端口 $FRONTEND_PORT 已被占用，请先停止占用该端口的进程"
    echo -e "  ${CYAN}提示: lsof -i :$FRONTEND_PORT${NC}"
    exit 1
fi
success "端口 $FRONTEND_PORT 可用"

# ── 5. 创建日志目录 ───────────────────────────────────────────
mkdir -p "$LOG_DIR"
> "$BACKEND_LOG"
> "$FRONTEND_LOG"

# ── 6. 启动后端 ───────────────────────────────────────────────
info "启动后端服务..."

cd "$BACKEND_DIR"
$PYTHON -m uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" >> "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

success "后端进程已启动 (PID: $BACKEND_PID)"

# ── 7. 启动前端 ───────────────────────────────────────────────
info "启动前端服务..."

cd "$FRONTEND_DIR"
npm run dev >> "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!

success "前端进程已启动 (PID: $FRONTEND_PID)"

# ── 8. 记录PID ────────────────────────────────────────────────
echo "backend:$BACKEND_PID" > "$PID_FILE"
echo "frontend:$FRONTEND_PID" >> "$PID_FILE"

# ── 9. 等待后端就绪 ───────────────────────────────────────────
info "等待后端服务就绪..."

MAX_WAIT=60
WAITED=0
HEALTH_OK=false

while [[ $WAITED -lt $MAX_WAIT ]]; do
    if curl -s "http://localhost:$BACKEND_PORT/health" > /dev/null 2>&1; then
        HEALTH_OK=true
        break
    fi
    # 检查进程是否还活着
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
        fail "后端进程异常退出！"
        echo -e "  ${CYAN}查看日志: tail -50 $BACKEND_LOG${NC}"
        tail -20 "$BACKEND_LOG"
        cleanup
    fi
    sleep 2
    WAITED=$((WAITED + 2))
    echo -ne "\r${BLUE}[INFO]${NC} 等待后端就绪... ${WAITED}s / ${MAX_WAIT}s"
done
echo ""

if [[ "$HEALTH_OK" != true ]]; then
    fail "后端服务在 ${MAX_WAIT}s 内未就绪"
    echo -e "  ${CYAN}查看日志: tail -50 $BACKEND_LOG${NC}"
    tail -20 "$BACKEND_LOG"
    cleanup
fi

success "后端服务已就绪 (http://localhost:$BACKEND_PORT)"

# ── 10. 等待前端就绪 ─────────────────────────────────────────
info "等待前端服务就绪..."

WAITED=0
FRONTEND_OK=false

while [[ $WAITED -lt 30 ]]; do
    if check_port "$FRONTEND_PORT"; then
        FRONTEND_OK=true
        break
    fi
    # 检查进程是否还活着
    if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
        fail "前端进程异常退出！"
        echo -e "  ${CYAN}查看日志: tail -50 $FRONTEND_LOG${NC}"
        tail -20 "$FRONTEND_LOG"
        cleanup
    fi
    sleep 2
    WAITED=$((WAITED + 2))
    echo -ne "\r${BLUE}[INFO]${NC} 等待前端就绪... ${WAITED}s / 30s"
done
echo ""

if [[ "$FRONTEND_OK" != true ]]; then
    warn "前端服务可能未完全就绪，请稍后手动访问"
fi

# ── 11. 启动成功 ──────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔═════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║        🎉 矩阵-知识库管理系统启动成功！              ║${NC}"
echo -e "${GREEN}╠═════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  前端地址: ${CYAN}http://localhost:$FRONTEND_PORT${NC}                    ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  后端地址: ${CYAN}http://localhost:$BACKEND_PORT${NC}                    ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  API文档:  ${CYAN}http://localhost:$BACKEND_PORT/docs${NC}                 ${GREEN}║${NC}"
echo -e "${GREEN}╠═════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  停止服务: ${CYAN}./stop.sh${NC}                              ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  重启服务: ${CYAN}./restart.sh${NC}                          ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  后端日志: ${CYAN}tail -f $BACKEND_LOG${NC}    ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  前端日志: ${CYAN}tail -f $FRONTEND_LOG${NC}    ${GREEN}║${NC}"
echo -e "${GREEN}╚═════════════════════════════════════════════════════╝${NC}"
echo ""
