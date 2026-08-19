#!/bin/bash
# 矩阵-知识库管理系统 .app 构建脚本

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="矩阵-知识库管理系统"
APP_PATH="$PROJECT_DIR/$APP_NAME.app"

echo "📦 构建 $APP_NAME.app..."
echo "   项目目录: $PROJECT_DIR"

# 1. 清理旧的 .app
if [[ -d "$APP_PATH" ]]; then
    echo "🗑  清理旧版本..."
    rm -rf "$APP_PATH"
fi

# 2. 创建目录结构
mkdir -p "$APP_PATH/Contents/MacOS"
mkdir -p "$APP_PATH/Contents/Resources"

# 3. 写入 Info.plist
cat > "$APP_PATH/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>矩阵-知识库管理系统</string>
    <key>CFBundleDisplayName</key>
    <string>矩阵-知识库管理系统</string>
    <key>CFBundleIdentifier</key>
    <string>com.rag.knowledge-base</string>
    <key>CFBundleVersion</key>
    <string>1.04</string>
    <key>CFBundleShortVersionString</key>
    <string>1.04</string>
    <key>CFBundleExecutable</key>
    <string>launch</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
EOF

# 4. 写入 Contents/MacOS/launch
cat > "$APP_PATH/Contents/MacOS/launch" << 'EOF'
#!/bin/bash
# 矩阵-知识库管理系统启动器

# 获取项目根目录（.app 所在的目录）
APP_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"

# macOS .app 启动时需要手动加载用户 shell 环境
if [[ -f "$HOME/.zprofile" ]]; then
    source "$HOME/.zprofile" 2>/dev/null
fi
if [[ -f "$HOME/.zshrc" ]]; then
    source "$HOME/.zshrc" 2>/dev/null
fi
# fallback: 补充常见 PATH
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/.local/bin"

# 查找 Python：优先使用 .venv
VENV_PYTHON="$APP_DIR/backend/.venv/bin/python"
if [[ -f "$VENV_PYTHON" ]]; then
    PYTHON="$VENV_PYTHON"
else
    PYTHON=$(command -v python3 2>/dev/null || echo "")
fi

if [[ -z "$PYTHON" ]]; then
    osascript -e 'display dialog "未找到 Python 环境，请确保 backend/.venv 存在或系统已安装 Python 3" buttons {"确定"} default button 1 with icon stop with title "矩阵-知识库管理系统"'
    exit 1
fi

# 执行 GUI 脚本
exec "$PYTHON" "$APP_DIR/launcher/launcher_gui.py"
EOF

# 5. 设置可执行权限
chmod +x "$APP_PATH/Contents/MacOS/launch"

echo "✅ 构建完成: $APP_PATH"
echo ""
echo "目录结构:"
find "$APP_PATH" -type f | sort
