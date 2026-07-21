#!/data/data/com.termux/files/usr/bin/bash
#
# build-git-binary.sh
#
# 在 Termux 中编译 git 静态二进制，适用于 Android（arm64-v8a / armeabi-v7a / x86_64）。
# 编译产物会被复制到 mobile-app/assets/binaries/ 并更新 git-manifest.json 的 sha256。
#
# 使用方法：
#   1. 在 Android 设备上安装 Termux
#   2. 在 Termux 中执行：
#        pkg install git make autoconf automake libtool openssl-dev curl-dev zlib-dev
#        bash build-git-binary.sh
#   3. 脚本完成后，把 assets/binaries/ 目录同步到开发机
#
# 或者在 Linux 主机上用 Android NDK 交叉编译（脚本同样适用，需设置 NDK_ROOT 环境变量）。
#
# 输出：
#   - mobile-app/assets/binaries/git-{abi}（可执行二进制）
#   - 更新 mobile-app/assets/binaries/git-manifest.json 中的 sha256 字段

set -euo pipefail

# ---------- 配置 ----------

GIT_VERSION="2.43.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ASSETS_DIR="$REPO_ROOT/mobile-app/assets/binaries"
MANIFEST_FILE="$ASSETS_DIR/git-manifest.json"
BUILD_DIR="/tmp/spacecode-git-build"
JOBS=$(nproc 2>/dev/null || echo 4)

# ---------- 检测 ABI ----------

detect_abi() {
    local arch
    arch="$(uname -m 2>/dev/null || echo 'unknown')"
    case "$arch" in
        aarch64)  echo "arm64-v8a" ;;
        armv7l|armv8l) echo "armeabi-v7a" ;;
        x86_64)   echo "x86_64" ;;
        *)
            echo "ERROR: Unsupported architecture: $arch" >&2
            echo "Supported: aarch64 (arm64-v8a), armv7l (armeabi-v7a), x86_64" >&2
            exit 1
            ;;
    esac
}

ABI="$(detect_abi)"
echo "==> Detected ABI: $ABI"

# ---------- 安装依赖 ----------

install_deps() {
    echo "==> Installing build dependencies..."
    if command -v pkg >/dev/null 2>&1; then
        # Termux 环境
        pkg update -y
        pkg install -y git make autoconf automake libtool openssl-dev curl-dev zlib-dev gettext
    elif command -v apt >/dev/null 2>&1; then
        # Debian/Ubuntu Linux
        sudo apt update -y
        sudo apt install -y git make autoconf automake libtool libssl-dev libcurl4-openssl-dev zlib1g-dev gettext
    else
        echo "WARNING: Cannot auto-install dependencies. Please install manually." >&2
    fi
}

# ---------- 编译 git ----------

build_git() {
    echo "==> Building git $GIT_VERSION for $ABI..."

    mkdir -p "$BUILD_DIR"
    cd "$BUILD_DIR"

    # 下载源码（如果尚未下载）
    if [ ! -d "git-$GIT_VERSION" ]; then
        echo "==> Downloading git source..."
        curl -L "https://mirrors.edge.kernel.org/pub/software/scm/git/git-$GIT_VERSION.tar.xz" -o "git-$GIT_VERSION.tar.xz"
        tar xf "git-$GIT_VERSION.tar.xz"
    fi

    cd "git-$GIT_VERSION"

    # 配置：静态链接，禁用不需要的功能以减小体积
    echo "==> Configuring..."
    make clean 2>/dev/null || true
    make configure 2>/dev/null || true

    # Termux 环境下直接编译（native build）
    # 关键配置：
    # - --prefix=/usr/local（最终路径，不影响运行）
    # - NO_TCLTK=1：不编译 GUI
    # - NO_GETTEXT=1：不编译 gettext（减小体积）
    # - NO_INSTALL_HARDLINKS=1：用 copy 代替 hardlink（Android 文件系统兼容）
    # - CFLAGS=-Os：优化体积
    make configure || true

    ./configure \
        --prefix=/usr/local \
        --with-openssl \
        --with-curl \
        --with-zlib \
        CFLAGS="-Os -fPIC" \
        LDFLAGS="-s" \
        NO_TCLTK=1 \
        NO_GETTEXT=1 \
        NO_INSTALL_HARDLINKS=1 \
        NO_PERL=1 \
        NO_PYTHON=1 \
        NO_SVN_TESTS=1

    echo "==> Compiling (this may take several minutes)..."
    make -j"$JOBS" git

    echo "==> Build complete."
    ls -lh git
}

# ---------- 复制产物 + 计算 SHA-256 ----------

package_binary() {
    echo "==> Packaging binary for $ABI..."

    mkdir -p "$ASSETS_DIR"

    local binary_name="git-$ABI"
    local binary_path="$ASSETS_DIR/$binary_name"
    cp "$BUILD_DIR/git-$GIT_VERSION/git" "$binary_path"

    # 设置可执行权限
    chmod 755 "$binary_path"

    # 计算 SHA-256
    local sha256
    sha256="$(sha256sum "$binary_path" | awk '{print $1}')"
    echo "==> SHA-256: $sha256"
    echo "==> Binary size: $(du -h "$binary_path" | awk '{print $1}')"

    # 输出 sha256 供更新 manifest 使用
    echo "$sha256" > "$BUILD_DIR/sha256-$ABI.txt"
}

# ---------- 更新 manifest ----------

update_manifest() {
    echo "==> Updating manifest..."

    if [ ! -f "$MANIFEST_FILE" ]; then
        echo "WARNING: Manifest file not found at $MANIFEST_FILE" >&2
        echo "Creating new manifest..."
        cat > "$MANIFEST_FILE" <<'EOF'
{
  "version": "GIT_VERSION_PLACEHOLDER",
  "description": "Pre-compiled git binary for Android (built via Termux)",
  "binaries": {}
}
EOF
    fi

    # 读取 SHA-256
    local sha256
    sha256="$(cat "$BUILD_DIR/sha256-$ABI.txt")"

    # 使用 python 或 sed 更新 manifest 中的 sha256 字段
    if command -v python3 >/dev/null 2>&1; then
        python3 - "$MANIFEST_FILE" "$ABI" "$sha256" "$GIT_VERSION" <<'PYEOF'
import json
import sys

manifest_path, abi, sha256, git_version = sys.argv[1:5]

with open(manifest_path, 'r', encoding='utf-8') as f:
    manifest = json.load(f)

manifest['version'] = git_version
manifest.setdefault('binaries', {})

# 保留现有的 asset 路径，仅更新 sha256
entry = manifest['binaries'].get(abi, {})
entry['asset'] = f'assets/binaries/git-{abi}'
entry['sha256'] = sha256
manifest['binaries'][abi] = entry

with open(manifest_path, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)
    f.write('\n')

print(f"==> Manifest updated: {abi} -> {sha256[:16]}...")
PYEOF
    else
        echo "WARNING: python3 not available, manifest not updated automatically." >&2
        echo "Please manually update $MANIFEST_FILE:" >&2
        echo "  binaries.$ABI.sha256 = $sha256"
    fi
}

# ---------- 主流程 ----------

main() {
    echo "================================================"
    echo " SpaceCode Git Binary Builder"
    echo " Git version: $GIT_VERSION"
    echo " Target ABI:  $ABI"
    echo " Output:      $ASSETS_DIR"
    echo "================================================"

    install_deps
    build_git
    package_binary
    update_manifest

    echo ""
    echo "==> Done! Binary: $ASSETS_DIR/git-$ABI"
    echo "==> Next steps:"
    echo "    1. If building for multiple ABIs, repeat on devices with different architectures"
    echo "    2. Sync assets/binaries/ directory to your development machine"
    echo "    3. Run: flutter build apk --release"
    echo "    4. Verify on device: the Agent should now have git_* tools available"
}

main "$@"
