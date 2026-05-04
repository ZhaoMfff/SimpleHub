#!/usr/bin/env bash
set -Eeuo pipefail
# SimpleHub alwaysdata 专用安装脚本
# 无root | 端口8100 | 不依赖systemd
# 用法: bash <(curl -fsSL https://github.com/jwy87/SimpleHub/releases/latest/download/install-alwaysdata.sh)

REPO="${SIMPLEHUB_REPO:-jwy87/SimpleHub}"
VERSION="${SIMPLEHUB_VERSION:-latest}"
INSTALL_DIR="${SIMPLEHUB_INSTALL_DIR:-$HOME/simplehub}"
PORT="${SIMPLEHUB_PORT:-8100}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

log()  { printf '\033[1;32m[SimpleHub]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[SimpleHub]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[SimpleHub]\033[0m %s\n' "$*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || fail "缺少命令: $1"; }

random_hex() { openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
random_password() { openssl rand -base64 18 2>/dev/null | tr -d '=+/[:space:]' | cut -c1-16 || head -c 18 /dev/urandom | base64 | tr -d '=+/[:space:]' | cut -c1-16; }

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) fail "暂不支持的架构: $(uname -m)" ;;
  esac
}

release_url() {
  local asset="$1"
  if [ "$VERSION" = "latest" ]; then
    printf 'https://github.com/%s/releases/latest/download/%s' "$REPO" "$asset"
  else
    printf 'https://github.com/%s/releases/download/%s/%s' "$REPO" "$VERSION" "$asset"
  fi
}

write_env_if_missing() {
  local env_file="$INSTALL_DIR/.env"
  [ -f "$env_file" ] && { log "配置已存在: $env_file，保留"; return; }
  local pw="${SIMPLEHUB_ADMIN_PASSWORD:-$(random_password)}"
  local em="${SIMPLEHUB_ADMIN_EMAIL:-admin@example.com}"
  { printf 'NODE_ENV=production\nPORT=%s\nDATABASE_URL=file:%s/data/db.sqlite\nJWT_SECRET=%s\nENCRYPTION_KEY=%s\nADMIN_EMAIL=%s\nADMIN_PASSWORD=%s\n' \
    "$PORT" "$INSTALL_DIR" "$(random_hex)" "$(random_hex)" "$em" "$pw"; } > "$env_file"
  chmod 600 "$env_file"
  log "已生成配置: $env_file"
  log "管理员账号: $em"
  log "管理员密码: $pw"
}

write_start_script() {
  cat > "$INSTALL_DIR/start.sh" <<'SCRIPT'
#!/usr/bin/env sh
set -e
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$DIR/current"
while IFS='=' read -r k v; do
  case "$k" in ''|\#*) continue ;; *) export "$k=$v" ;; esac
done < "$DIR/.env"
exec "$DIR/current/bin/simplehub"
SCRIPT
  chmod +x "$INSTALL_DIR/start.sh"
  log "启动脚本: $INSTALL_DIR/start.sh"
}

main() {
  need_cmd uname; need_cmd tar; need_cmd curl
  [ "$(uname -s)" != "Linux" ] && fail "仅支持 Linux"

  local arch asset url sums_url release_dir version_label
  arch="$(detect_arch)"
  asset="simplehub-linux-${arch}.tar.gz"
  url="$(release_url "$asset")"
  sums_url="$(release_url "SHA256SUMS")"
  version_label="${VERSION#v}"
  [ "$VERSION" = "latest" ] && version_label="$(date +%Y%m%d%H%M%S)"
  release_dir="$INSTALL_DIR/releases/$version_label"

  log "仓库: $REPO  版本: $VERSION  架构: $arch  端口: $PORT"
  log "下载: $url"

  mkdir -p "$INSTALL_DIR/releases" "$INSTALL_DIR/data"
  curl -fL "$url" -o "$TMP_DIR/$asset"
  if command -v sha256sum >/dev/null 2>&1; then
    curl -fL "$sums_url" -o "$TMP_DIR/SHA256SUMS"
    (cd "$TMP_DIR" && grep "  $asset\$" SHA256SUMS | sha256sum -c -)
  else
    warn "跳过校验"
  fi
  tar -xzf "$TMP_DIR/$asset" -C "$TMP_DIR"

  rm -rf "$release_dir"
  mkdir -p "$release_dir"
  cp -a "$TMP_DIR/simplehub/." "$release_dir/"
  chmod +x "$release_dir/bin/simplehub"

  write_env_if_missing

  ln -sfn "$release_dir" "$INSTALL_DIR/current"
  ln -sfn "$INSTALL_DIR/.env" "$release_dir/.env"
  write_start_script

  log ""
  log "安装完成！数据目录: $INSTALL_DIR/data"
  log "配置文件: $INSTALL_DIR/.env"
  log ""
  log "========== alwaysdata 面板配置 =========="
  log ""
  log "方式一: User program"
  log "  命令: $INSTALL_DIR/start.sh"
  log "  工作目录: $INSTALL_DIR/current"
  log ""
  log "方式二: Node.js Site"
  log "  Node 路径: $INSTALL_DIR/current/node/bin/node"
  log "  入口文件: $INSTALL_DIR/current/scripts/start.js"
  log "  工作目录: $INSTALL_DIR/current"
  log "  环境变量文件: $INSTALL_DIR/.env"
  log ""
  log "端口: $PORT (在面板 Web > 端口中确认)"
  log "访问: http://你的alwaysdata站点:$PORT"
}

main "$@"
