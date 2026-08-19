#!/bin/bash
# 矩阵-知识库管理系统 - 一键停止脚本

set -uo pipefail

# ── 颜色定义 ──────────────────────────────────────────────────
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── 项目路径 ──────────────────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$PROJECT_DIR/.pids"

# ── 端口配置（支持环境变量覆盖）──────────────────────────────
BACKEND_PORT=${BACKEND_PORT:-8000}
FRONTEND_PORT=${FRONTEND_PORT:-3000}

# ── 辅助函数 ──────────────────────────────────────────────────

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()    { echo -e "${RED}[FAIL]${NC} $1"; }

# ── 优雅终止进程 ──────────────────────────────────────────────
# 参数: $1=PID, $2=进程名称
graceful_kill() {
    local pid=$1
    local name=$2

    if ! kill -0 "$pid" 2>/dev/null; then
        warn "$name 进程 (PID: $pid) 已不存在"
        return 0
    fi

    info "发送 SIGTERM 到 $name (PID: $pid)..."
    kill -TERM "$pid" 2>/dev/null || true

    # 等待3秒
    local waited=0
    while [[ $waited -lt 3 ]]; do
        if ! kill -0 "$pid" 2>/dev/null; then
            success "$name 进程已终止"
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done

    # 3秒后仍未退出，发送 SIGKILL
    if kill -0 "$pid" 2>/dev/null; then
        warn "$name 进程未响应 SIGTERM，发送 SIGKILL..."
        kill -9 "$pid" 2>/dev/null || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            fail "无法终止 $name 进程 (PID: $pid)"
            return 1
        else
            success "$name 进程已强制终止"
        fi
    fi
    return 0
}

# ── 开场 ──────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}正在停止 矩阵-知识库管理系统...${NC}"
echo ""

STOPPED_ANY=false

# ── 1. 从 .pids 文件读取并终止 ───────────────────────────────
if [[ -f "$PID_FILE" ]]; then
    info "读取 PID 文件: $PID_FILE"
    while IFS=: read -r name pid; do
        if [[ -n "$pid" ]] && [[ "$pid" =~ ^[0-9]+$ ]]; then
            graceful_kill "$pid" "$name"
            STOPPED_ANY=true
        fi
    done < "$PID_FILE"

    # 清理 PID 文件
    rm -f "$PID_FILE"
    success "PID 文件已清理"
else
    warn "PID 文件不存在: $PID_FILE"
fi

# ── 2. 扫描残留进程 ──────────────────────────────────────────
info "扫描残留进程..."

# 查找 uvicorn 残留进程
UVICORN_PIDS=$(lsof -i ":$BACKEND_PORT" -sTCP:LISTEN -t 2>/dev/null || true)
if [[ -n "$UVICORN_PIDS" ]]; then
    warn "发现残留的后端进程 (端口 $BACKEND_PORT)"
    for pid in $UVICORN_PIDS; do
        info "终止残留后端进程 (PID: $pid)..."
        kill -TERM "$pid" 2>/dev/null || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
        fi
        STOPPED_ANY=true
    done
    success "残留后端进程已清理"
fi

# 查找 vite 残留进程（前端端口 3000）
VITE_PIDS=$(lsof -i ":$FRONTEND_PORT" -sTCP:LISTEN -t 2>/dev/null || true)
if [[ -n "$VITE_PIDS" ]]; then
    warn "发现残留的前端进程 (端口 $FRONTEND_PORT)"
    for pid in $VITE_PIDS; do
        info "终止残留前端进程 (PID: $pid)..."
        kill -TERM "$pid" 2>/dev/null || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
        fi
        STOPPED_ANY=true
    done
    success "残留前端进程已清理"
fi

# 也检查5173端口（Vite默认端口）
VITE5173_PIDS=$(lsof -i :5173 -sTCP:LISTEN -t 2>/dev/null || true)
if [[ -n "$VITE5173_PIDS" ]]; then
    warn "发现残留的前端进程 (端口 5173)"
    for pid in $VITE5173_PIDS; do
        info "终止残留前端进程 (PID: $pid)..."
        kill -TERM "$pid" 2>/dev/null || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
        fi
        STOPPED_ANY=true
    done
    success "残留前端进程已清理 (端口5173)"
fi

# ── 3. 结果 ───────────────────────────────────────────────────
if [[ "$STOPPED_ANY" == true ]]; then
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   矩阵-知识库管理系统已停止 ✅              ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
else
    echo ""
    warn "没有发现运行中的 矩阵-知识库管理系统进程"
fi
echo ""
