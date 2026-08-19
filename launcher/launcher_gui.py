#!/usr/bin/env python3
"""
矩阵-知识库管理系统 - macOS 可视化启动器
使用 tkinter 实现，提供启动/停止/重启服务、状态监控、日志查看等功能。
背景为矩阵字符雨动效，营造科幻氛围。
"""

import os
import random
import re
import select
import socket
import subprocess
import sys
import threading
import time
import webbrowser
import tkinter as tk
from tkinter import ttk
from pathlib import Path

# ── 项目路径推算 ──────────────────────────────────────────────────
# launcher_gui.py 位于 launcher/ 目录下，parent 即为项目根目录
PROJECT_DIR = Path(__file__).resolve().parent.parent
START_SH = PROJECT_DIR / "start.sh"
STOP_SH = PROJECT_DIR / "stop.sh"
RESTART_SH = PROJECT_DIR / "restart.sh"
BACKEND_LOG = PROJECT_DIR / "logs" / "backend.log"
FRONTEND_LOG = PROJECT_DIR / "logs" / "frontend.log"

BACKEND_PORT_DEFAULT = 8000
FRONTEND_PORT_DEFAULT = 3000
STATUS_CHECK_INTERVAL = 3000  # 3 秒

# ── 矩阵字符雨配置 ──────────────────────────────────────────────
MATRIX_CHARS = (
    "亻氵木火土金石矢禾竹糸虫"
    "0123456789"
    "+-=|<>{}[]"
)
MATRIX_BG = "#050a0f"
MATRIX_COLORS = [
    "#00ffd5", "#00ddbb", "#00bb99", "#009977",
    "#007755", "#005544", "#004433", "#003322",
]
MATRIX_FONT_SIZE = 14
MATRIX_FONT = ("Menlo", MATRIX_FONT_SIZE)
MATRIX_CHAR_H = 18
MATRIX_FPS_MS = 40  # ~25fps

# ── 按钮使用 tkinter/macOS 默认风格，不再自定义配色 ────────────────


# ── 工具函数 ──────────────────────────────────────────────────────

def check_port(port: int) -> bool:
    """检测端口是否在监听（同时尝试 IPv4 和 IPv6）"""
    for host in ("127.0.0.1", "::1"):
        try:
            with socket.socket(
                socket.AF_INET if host == "127.0.0.1" else socket.AF_INET6,
                socket.SOCK_STREAM,
            ) as sock:
                sock.settimeout(1)
                if sock.connect_ex((host, port)) == 0:
                    return True
        except (OSError, socket.error):
            continue
    return False


def read_log_tail(path: Path, lines: int = 100) -> str:
    """读取日志文件尾部指定行数"""
    if not path.exists():
        return f"(日志文件不存在: {path})"
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
            return "".join(all_lines[-lines:])
    except Exception as e:
        return f"(读取日志出错: {e})"


# ── 主窗口 ────────────────────────────────────────────────────────

class LauncherGUI:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("矩阵-知识库管理系统")
        self.root.resizable(False, False)

        # 深色主题背景
        bg_color = MATRIX_BG
        self.root.configure(bg=bg_color)
        self._bg = bg_color

        # 居中显示 480x600
        win_w, win_h = 480, 600
        screen_w = self.root.winfo_screenwidth()
        screen_h = self.root.winfo_screenheight()
        x = (screen_w - win_w) // 2
        y = (screen_h - win_h) // 2
        self.root.geometry(f"{win_w}x{win_h}+{x}+{y}")

        # 按钮执行锁
        self._executing = False
        # 当前正在运行的子进程（用于中途终止）
        self._current_proc = None

        # 端口配置（实例变量，可由用户修改）
        self._backend_port = BACKEND_PORT_DEFAULT
        self._frontend_port = FRONTEND_PORT_DEFAULT

        # 矩阵雨列数据
        self._matrix_columns = {}
        self._canvas = None

        # 先构建 Canvas 背景，再构建 UI 控件
        self._build_matrix_canvas()
        self._build_ui()
        self._schedule_status_check()

        # 延迟启动动画：确保 mainloop 已运行、窗口完全渲染后再操作 Canvas
        # 避免在 __init__ 中直接调用导致 TclError 闪退
        self.root.after(150, self._start_matrix_animation)

    # ── 矩阵字符雨 ──────────────────────────────────────────────

    def _build_matrix_canvas(self):
        """创建全屏背景 Canvas，置于窗口最底层"""
        self._canvas = tk.Canvas(
            self.root,
            bg=MATRIX_BG,
            highlightthickness=0,
            bd=0,
        )
        self._canvas.place(relx=0, rely=0, relwidth=1, relheight=1)
        # Canvas 重写了 lower()，需要用父类 Widget 的 lower 以避免 TclError
        tk.Widget.lower(self._canvas)

    def _start_matrix_animation(self):
        """延迟启动矩阵字符雨动画（确保窗口已完全渲染）"""
        try:
            self._init_matrix_columns()
            self._animate_matrix()
        except Exception:
            pass  # 动画初始化失败不应导致主程序闪退

    def _init_matrix_columns(self):
        """根据窗口宽度初始化字符雨列"""
        canvas_w = self._canvas.winfo_width()
        if canvas_w <= 1:
            canvas_w = 480
        num_cols = max(canvas_w // MATRIX_FONT_SIZE, 1)
        self._matrix_columns = {}
        for i in range(num_cols):
            x = i * MATRIX_FONT_SIZE + MATRIX_FONT_SIZE // 2
            speed = random.randint(1, 3)
            head_y = random.randint(-20, 0)
            trail_len = random.randint(8, 20)
            self._matrix_columns[i] = {
                "x": x,
                "speed": speed,
                "head_y": head_y,
                "trail_len": trail_len,
            }

    def _animate_matrix(self):
        """每帧更新矩阵字符雨"""
        # 检查窗口是否仍存在
        try:
            if not self.root.winfo_exists():
                return
        except tk.TclError:
            return

        try:
            canvas = self._canvas
            canvas.delete("matrix")

            canvas_h = canvas.winfo_height()
            if canvas_h <= 1:
                canvas_h = 600

            for col in self._matrix_columns.values():
                # 推进头部位置
                col["head_y"] += col["speed"]

                # 头部超出屏幕则重置
                if col["head_y"] * MATRIX_CHAR_H > canvas_h + col["trail_len"] * MATRIX_CHAR_H:
                    col["head_y"] = random.randint(-15, -3)
                    col["speed"] = random.randint(1, 3)
                    col["trail_len"] = random.randint(8, 20)

                # 绘制拖尾（从亮到暗）
                for j in range(col["trail_len"]):
                    y_pos = col["head_y"] - j
                    pixel_y = y_pos * MATRIX_CHAR_H
                    if pixel_y < -MATRIX_CHAR_H or pixel_y > canvas_h + MATRIX_CHAR_H:
                        continue
                    char = random.choice(MATRIX_CHARS)
                    color = MATRIX_COLORS[min(j, len(MATRIX_COLORS) - 1)]
                    canvas.create_text(
                        col["x"], pixel_y,
                        text=char, fill=color,
                        font=MATRIX_FONT, anchor="center",
                        tags="matrix",
                    )

                # 头部字符最亮（白色高光）
                head_pixel_y = col["head_y"] * MATRIX_CHAR_H
                if -MATRIX_CHAR_H <= head_pixel_y <= canvas_h + MATRIX_CHAR_H:
                    canvas.create_text(
                        col["x"], head_pixel_y,
                        text=random.choice(MATRIX_CHARS),
                        fill="#ffffff",
                        font=MATRIX_FONT, anchor="center",
                        tags="matrix",
                    )

            # 无需每帧调用 canvas.lower()，创建时已设置层级
            self.root.after(MATRIX_FPS_MS, self._animate_matrix)
        except tk.TclError:
            return  # 窗口已销毁，停止动画
        except Exception:
            # 其他异常不崩溃，尝试继续下一帧
            try:
                self.root.after(MATRIX_FPS_MS, self._animate_matrix)
            except Exception:
                pass

    # ── UI 构建 ───────────────────────────────────────────────────

    def _build_ui(self):
        bg = self._bg

        # ── 顶部标题区 ────────────────────────────────────────────
        title_frame = tk.Frame(self.root, bg=bg)
        title_frame.pack(fill="x", pady=(20, 5))

        tk.Label(
            title_frame, text="矩阵-知识库管理系统",
            font=("PingFang SC", 22, "bold"),
            bg=bg, fg="#00ffd5",
        ).pack()

        tk.Label(
            title_frame, text="Matrix Knowledge Base System v1.04",
            font=("PingFang SC", 10),
            bg=bg, fg="#009977",
        ).pack(pady=(2, 0))

        # ── 中部状态面板 ──────────────────────────────────────────
        status_frame = tk.LabelFrame(
            self.root, text="  服务状态  ",
            font=("PingFang SC", 11, "bold"),
            bg=bg, fg="#00ddbb",
            padx=15, pady=10,
            bd=1, relief="groove",
        )
        status_frame.pack(fill="x", padx=20, pady=(10, 5))

        self._backend_status_var = tk.StringVar(value="🔴  检测中...")
        self._frontend_status_var = tk.StringVar(value="🔴  检测中...")

        tk.Label(
            status_frame, textvariable=self._backend_status_var,
            font=("PingFang SC", 11), bg=bg, fg="#ccffee", anchor="w",
        ).pack(fill="x", pady=3)

        tk.Label(
            status_frame, textvariable=self._frontend_status_var,
            font=("PingFang SC", 11), bg=bg, fg="#ccffee", anchor="w",
        ).pack(fill="x", pady=3)

        # ── 端口配置区 ──────────────────────────────────────────
        port_frame = tk.LabelFrame(
            self.root, text="  端口配置  ",
            font=("PingFang SC", 11, "bold"),
            bg=bg, fg="#00ddbb",
            padx=15, pady=8,
            bd=1, relief="groove",
        )
        port_frame.pack(fill="x", padx=20, pady=(5, 5))

        port_inner = tk.Frame(port_frame, bg=bg)
        port_inner.pack(fill="x")
        port_inner.columnconfigure(0, weight=1)
        port_inner.columnconfigure(1, weight=1)

        # 后端端口
        be_frame = tk.Frame(port_inner, bg=bg)
        be_frame.grid(row=0, column=0, sticky="w", padx=(0, 10))
        tk.Label(
            be_frame, text="后端端口:",
            font=("PingFang SC", 10), bg=bg, fg="#88ccbb",
        ).pack(side="left")
        self._backend_port_entry = tk.Entry(
            be_frame, width=6,
            font=("Menlo", 10),
            justify="center",
            relief="solid", bd=1,
            bg="#0a1a1f", fg="#00ffd5",
            insertbackground="#00ffd5",
        )
        self._backend_port_entry.insert(0, str(self._backend_port))
        self._backend_port_entry.pack(side="left", padx=(4, 0))

        # 前端端口
        fe_frame = tk.Frame(port_inner, bg=bg)
        fe_frame.grid(row=0, column=1, sticky="w")
        tk.Label(
            fe_frame, text="前端端口:",
            font=("PingFang SC", 10), bg=bg, fg="#88ccbb",
        ).pack(side="left")
        self._frontend_port_entry = tk.Entry(
            fe_frame, width=6,
            font=("Menlo", 10),
            justify="center",
            relief="solid", bd=1,
            bg="#0a1a1f", fg="#00ffd5",
            insertbackground="#00ffd5",
        )
        self._frontend_port_entry.insert(0, str(self._frontend_port))
        self._frontend_port_entry.pack(side="left", padx=(4, 0))

        # ── 底部按钮区 ────────────────────────────────────────────
        btn_frame = tk.Frame(self.root, bg=bg)
        btn_frame.pack(fill="x", padx=20, pady=(10, 5))

        btn_cfg = {
            "font": ("PingFang SC", 11, "bold"),
            "width": 13,
            "height": 1,
            "cursor": "hand2",
        }

        self._btn_start = tk.Button(
            btn_frame, text="▶  启动服务",
            command=self._on_start, **btn_cfg,
        )
        self._btn_start.grid(row=0, column=0, padx=5, pady=4)

        self._btn_stop = tk.Button(
            btn_frame, text="■  停止服务",
            command=self._on_stop, **btn_cfg,
        )
        self._btn_stop.grid(row=0, column=1, padx=5, pady=4)

        self._btn_restart = tk.Button(
            btn_frame, text="↻  重启服务",
            command=self._on_restart, **btn_cfg,
        )
        self._btn_restart.grid(row=1, column=0, padx=5, pady=4)

        self._btn_browser = tk.Button(
            btn_frame, text="🌐  打开浏览器",
            command=self._on_open_browser, **btn_cfg,
        )
        self._btn_browser.grid(row=1, column=1, padx=5, pady=4)

        self._btn_log = tk.Button(
            btn_frame, text="📋  查看日志",
            command=self._on_view_logs, **btn_cfg,
        )
        self._btn_log.grid(row=2, column=0, columnspan=2, padx=5, pady=4, sticky="ew")

        btn_frame.columnconfigure(0, weight=1)
        btn_frame.columnconfigure(1, weight=1)

        # ── 底部输出区 ────────────────────────────────────────────
        output_frame = tk.LabelFrame(
            self.root, text="  执行输出  ",
            font=("PingFang SC", 10, "bold"),
            bg=bg, fg="#00ddbb",
            padx=5, pady=5,
            bd=1, relief="groove",
        )
        output_frame.pack(fill="both", expand=True, padx=20, pady=(5, 15))

        self._output_text = tk.Text(
            output_frame, height=8,
            font=("Menlo", 9),
            bg="#0a1520", fg="#00ddbb",
            insertbackground="#00ffd5",
            selectbackground="#005544",
            wrap="word",
            state="disabled",
            relief="flat",
            bd=0,
        )
        scrollbar = ttk.Scrollbar(output_frame, command=self._output_text.yview)
        self._output_text.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self._output_text.pack(fill="both", expand=True)

    # ── 状态检测 ──────────────────────────────────────────────────

    def _schedule_status_check(self):
        """定时刷新服务状态"""
        self._update_status()
        self.root.after(STATUS_CHECK_INTERVAL, self._schedule_status_check)

    def _read_port_values(self):
        """从 Entry 读取端口值，更新实例变量"""
        try:
            val = int(self._backend_port_entry.get())
            if 1 <= val <= 65535:
                self._backend_port = val
        except (ValueError, tk.TclError):
            pass
        try:
            val = int(self._frontend_port_entry.get())
            if 1 <= val <= 65535:
                self._frontend_port = val
        except (ValueError, tk.TclError):
            pass

    def _update_status(self):
        """检测端口并更新状态标签与按钮状态"""
        self._read_port_values()
        bp = self._backend_port
        fp = self._frontend_port
        if check_port(bp):
            self._backend_status_var.set(f"🟢  后端服务运行中    端口 {bp}")
        else:
            self._backend_status_var.set(f"🔴  后端服务已停止    端口 {bp}")

        if check_port(fp):
            self._frontend_status_var.set(f"🟢  前端服务运行中    端口 {fp}")
        else:
            self._frontend_status_var.set(f"🔴  前端服务已停止    端口 {fp}")

        # 操作进行中不更新按钮状态，保持全部禁用
        if not self._executing:
            self._update_button_states()

    # ── 输出区操作 ────────────────────────────────────────────────

    def _append_output(self, text: str):
        """向输出区追加文本（线程安全）"""
        def _do():
            self._output_text.configure(state="normal")
            self._output_text.insert("end", text)
            self._output_text.see("end")
            self._output_text.configure(state="disabled")
        try:
            self.root.after(0, _do)
        except (tk.TclError, RuntimeError):
            pass  # 主线程不在主循环或窗口已销毁，忽略

    # ── 按钮启用/禁用 ────────────────────────────────────────────

    @staticmethod
    def _safe_btn_config(btn, **kwargs):
        """安全配置按钮属性，捕获 macOS Tk 不支持的属性导致的异常"""
        try:
            btn.configure(**kwargs)
        except (tk.TclError, RuntimeError):
            # macOS 上某些 Tk 版本不支持部分属性，
            # 或主线程不在主循环中时可能抛出 RuntimeError，
            # 降级为只设置 state
            safe_keys = {"state"}
            safe_kwargs = {k: v for k, v in kwargs.items() if k in safe_keys}
            if safe_kwargs:
                try:
                    btn.configure(**safe_kwargs)
                except (tk.TclError, RuntimeError):
                    pass  # 最后兜底：忽略配置失败，避免崩溃

    def _disable_all_buttons(self):
        """操作进行中时禁用所有服务按钮，防止重复操作"""
        for btn in (self._btn_start, self._btn_stop, self._btn_restart):
            self._safe_btn_config(btn, state=tk.DISABLED)

    def _update_button_states(self):
        """根据服务运行状态更新按钮可用性"""
        self._read_port_values()
        backend_running = check_port(self._backend_port)
        frontend_running = check_port(self._frontend_port)
        service_running = backend_running or frontend_running

        if service_running:
            self._safe_btn_config(self._btn_start, state=tk.DISABLED)
            self._safe_btn_config(self._btn_stop, state=tk.NORMAL)
            self._safe_btn_config(self._btn_restart, state=tk.NORMAL)
        else:
            self._safe_btn_config(self._btn_start, state=tk.NORMAL)
            self._safe_btn_config(self._btn_stop, state=tk.DISABLED)
            self._safe_btn_config(self._btn_restart, state=tk.DISABLED)

    # ── 脚本执行 ─────────────────────────────────────────────────

    def _run_script(self, script_path: Path, label: str, auto_open_browser: bool = False):
        """在子线程中执行 shell 脚本"""
        if self._executing:
            return
        self._read_port_values()
        self._executing = True
        self._disable_all_buttons()
        self._append_output(f"\n{'─' * 40}\n▶ 执行: {label}\n{'─' * 40}\n")

        def _worker():
            try:
                # macOS .app 启动时 PATH 可能不完整，补充常见路径
                env = os.environ.copy()
                env["TERM"] = "dumb"
                current_path = env.get("PATH", "")
                for p in [
                    "/usr/local/bin",
                    "/opt/homebrew/bin",
                    "/opt/homebrew/sbin",
                    os.path.expanduser("~/.local/bin"),
                ]:
                    if p not in current_path:
                        current_path = f"{current_path}:{p}"
                env["PATH"] = current_path
                # 传递端口配置给子脚本
                env["BACKEND_PORT"] = str(self._backend_port)
                env["FRONTEND_PORT"] = str(self._frontend_port)

                proc = subprocess.Popen(
                    ["bash", str(script_path)],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    cwd=str(PROJECT_DIR),
                    env=env,
                )
                self._current_proc = proc

                # 按字符读取，避免 \r 无 \n 时 readline 长时间阻塞
                buffer = ""
                timeout_seconds = 120
                elapsed = 0.0
                chunk_interval = 0.1  # 每次读一个字符的超时
                while True:
                    # 非阻塞式读取：用 select 检测是否有数据
                    ready, _, _ = select.select([proc.stdout], [], [], chunk_interval)
                    if ready:
                        chunk = proc.stdout.read(1)
                        if not chunk:
                            break
                        char = chunk.decode("utf-8", errors="replace")
                        if char == '\n':
                            clean = re.sub(r"\x1b\[[0-9;]*m", "", buffer)
                            if clean.strip():
                                self._append_output(clean + "\n")
                            buffer = ""
                            elapsed = 0.0
                        elif char == '\r':
                            # \r 表示进度更新，覆盖当前行
                            clean = re.sub(r"\x1b\[[0-9;]*m", "", buffer)
                            if clean.strip():
                                self._append_output(clean + "\n")
                            buffer = ""
                            elapsed = 0.0
                        else:
                            buffer += char
                    else:
                        # 没有数据可读，累加超时计时
                        elapsed += chunk_interval

                    # 检查进程是否已结束
                    if proc.poll() is not None:
                        # 读取剩余输出
                        remaining = proc.stdout.read()
                        if remaining:
                            buffer += remaining.decode("utf-8", errors="replace")
                        break

                    # 超时保护
                    if elapsed >= timeout_seconds:
                        self._append_output("\n⏱ 执行超时，强制终止进程...\n")
                        proc.terminate()
                        try:
                            proc.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            proc.kill()
                        break

                # 处理剩余 buffer
                if buffer.strip():
                    clean = re.sub(r"\x1b\[[0-9;]*m", "", buffer)
                    self._append_output(clean + "\n")

                proc.wait()
                rc = proc.returncode
                self._append_output(
                    f"\n✅ {label} 完成 (退出码: {rc})\n"
                    if rc == 0
                    else f"\n❌ {label} 失败 (退出码: {rc})\n"
                )

                # 自动打开浏览器逻辑
                if auto_open_browser and rc == 0:
                    self._append_output("🌐 正在打开浏览器...\n")
                    # 等待最多 10 秒直到前后端端口都就绪
                    for i in range(10):
                        if check_port(self._backend_port) and check_port(self._frontend_port):
                            break
                        time.sleep(1)
                    else:
                        # 即使未完全就绪也尝试打开
                        pass
                    webbrowser.open(f"http://localhost:{self._frontend_port}")
            except Exception as e:
                try:
                    self._append_output(f"\n❌ 执行出错: {e}\n")
                except (tk.TclError, RuntimeError):
                    pass  # 主线程不可用，忽略输出
            finally:
                self._current_proc = None
                self._executing = False
                try:
                    self.root.after(0, lambda: self._update_button_states())
                except (tk.TclError, RuntimeError):
                    pass  # 主线程不在主循环或窗口已销毁，忽略

        threading.Thread(target=_worker, daemon=True).start()

    # ── 按钮回调 ─────────────────────────────────────────────────

    def _on_start(self):
        self._run_script(START_SH, "启动服务", auto_open_browser=True)

    def _on_stop(self):
        if self._executing and self._current_proc is not None:
            # 正在执行脚本期间点击停止：先终止当前进程
            self._append_output("\n⏹ 用户中断，终止当前进程...\n")
            try:
                self._current_proc.terminate()
                self._current_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._current_proc.kill()
            except Exception:
                pass
            self._current_proc = None
            self._executing = False
            # 再执行 stop.sh
            self._run_script(STOP_SH, "停止服务")
        else:
            self._run_script(STOP_SH, "停止服务")

    def _on_restart(self):
        self._run_script(RESTART_SH, "重启服务")

    def _on_open_browser(self):
        self._read_port_values()
        webbrowser.open(f"http://localhost:{self._frontend_port}")

    def _on_view_logs(self):
        """打开日志查看窗口"""
        LogViewerWindow(self.root, self._bg)


# ── 日志查看窗口 ──────────────────────────────────────────────────

class LogViewerWindow:
    def __init__(self, parent: tk.Tk, bg_color: str):
        self._bg = bg_color
        self._win = tk.Toplevel(parent)
        self._win.title("日志查看")
        self._win.geometry("700x500")
        self._win.configure(bg=bg_color)

        # Notebook (Tab)
        style = ttk.Style()
        style.configure("TNotebook", background=bg_color)
        style.configure("TNotebook.Tab", font=("PingFang SC", 10), padding=[12, 4])

        notebook = ttk.Notebook(self._win)
        notebook.pack(fill="both", expand=True, padx=10, pady=10)

        self._backend_text = self._create_log_tab(notebook, "后端日志 (backend.log)")
        self._frontend_text = self._create_log_tab(notebook, "前端日志 (frontend.log)")

        # 底部刷新按钮
        btn_frame = tk.Frame(self._win, bg=bg_color)
        btn_frame.pack(fill="x", padx=10, pady=(0, 10))

        tk.Button(
            btn_frame, text="↻  刷新日志",
            font=("PingFang SC", 10),
            cursor="hand2",
            command=self._refresh_logs,
        ).pack(side="right")

        self._refresh_logs()
        # 自动刷新每 5 秒
        self._auto_refresh()

    def _create_log_tab(self, notebook: ttk.Notebook, title: str) -> tk.Text:
        frame = tk.Frame(notebook, bg="#0a1520")
        notebook.add(frame, text=f"  {title}  ")

        text_widget = tk.Text(
            frame, font=("Menlo", 9),
            bg="#0a1520", fg="#00ddbb",
            insertbackground="#00ffd5",
            selectbackground="#005544",
            wrap="none",
            state="disabled",
            relief="flat", bd=0,
        )
        y_scroll = ttk.Scrollbar(frame, orient="vertical", command=text_widget.yview)
        x_scroll = ttk.Scrollbar(frame, orient="horizontal", command=text_widget.xview)
        text_widget.configure(yscrollcommand=y_scroll.set, xscrollcommand=x_scroll.set)

        y_scroll.pack(side="right", fill="y")
        x_scroll.pack(side="bottom", fill="x")
        text_widget.pack(fill="both", expand=True)

        return text_widget

    def _refresh_logs(self):
        """刷新两个日志 Tab 的内容"""
        backend_content = read_log_tail(BACKEND_LOG, 100)
        frontend_content = read_log_tail(FRONTEND_LOG, 100)

        for text_widget, content in [
            (self._backend_text, backend_content),
            (self._frontend_text, frontend_content),
        ]:
            text_widget.configure(state="normal")
            text_widget.delete("1.0", "end")
            text_widget.insert("1.0", content)
            text_widget.see("end")
            text_widget.configure(state="disabled")

    def _auto_refresh(self):
        """自动刷新日志（仅当窗口仍存在时）"""
        try:
            if self._win.winfo_exists():
                self._refresh_logs()
                self._win.after(5000, self._auto_refresh)
        except tk.TclError:
            pass  # 窗口已关闭


# ── 入口 ──────────────────────────────────────────────────────────

def main():
    root = tk.Tk()
    # macOS 上使窗口显示在最前面
    try:
        root.tk.call("tk", "mac", "UseThemedWindow", root, 1)
    except tk.TclError:
        pass

    app = LauncherGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
