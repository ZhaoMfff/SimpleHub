#!/usr/bin/env bash
set -Eeuo pipefail

REPO="${SIMPLEHUB_REPO:-jwy87/SimpleHub}"
VERSION="${SIMPLEHUB_VERSION:-latest}"
INSTALL_DIR="${SIMPLEHUB_INSTALL_DIR:-}"
SERVICE_NAME="${SIMPLEHUB_SERVICE_NAME:-simplehub}"
PORT="${SIMPLEHUB_PORT:-3000}"
RUN_USER="${SIMPLEHUB_USER:-}"
RUN_GROUP="${SIMPLEHUB_GROUP:-}"
TMP_DIR="$(mktemp -d)"

HAS_ROOT=""
if [ "$(id -u)" -eq 0 ]; then
  HAS_ROOT="1"
elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  HAS_ROOT="1"
fi

if [ -z "$INSTALL_DIR" ]; then
  if [ -n "$HAS_ROOT" ]; then
    INSTALL_DIR="/opt/simplehub"
  else
    INSTALL_DIR="${HOME}/simplehub"
  fi
fi

if [ -z "$RUN_USER" ]; then
  RUN_USER="$(id -un)"
fi
if [ -z "$RUN_GROUP" ]; then
  RUN_GROUP="$(id -gn)"
fi

run_as_installer() {
  if [ -n "$HAS_ROOT" ]; then
    as_root "$@"
  else
    "$@"
  fi
}

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

log() {
  printf '\033[1;32m[SimpleHub]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[SimpleHub]\033[0m %s\n' "$*"
}

fail() {
  printf '\033[1;31m[SimpleHub]\033[0m %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令: $1"
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    fail "需要 root 权限执行此操作，但当前没有 sudo"
  fi
}

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

random_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 18 | tr -d '=+/[:space:]' | cut -c1-16
  else
    head -c 18 /dev/urandom | base64 | tr -d '=+/[:space:]' | cut -c1-16
  fi
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) fail "暂不支持的架构: $(uname -m)，仅支持 x86_64 和 arm64" ;;
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
  if [ -f "$env_file" ]; then
    log "检测到已存在配置: $env_file，更新时保留"
    return
  fi

  local admin_password="${SIMPLEHUB_ADMIN_PASSWORD:-$(random_password)}"
  local admin_email="${SIMPLEHUB_ADMIN_EMAIL:-admin@example.com}"
  local jwt_secret="$(random_hex)"
  local encryption_key="$(random_hex)"

  local tmp_env="$TMP_DIR/simplehub.env"
  {
    printf 'NODE_ENV=production\n'
    printf 'PORT=%s\n' "$PORT"
    printf 'DATABASE_URL=file:%s/data/db.sqlite\n' "$INSTALL_DIR"
    printf 'JWT_SECRET=%s\n' "$jwt_secret"
    printf 'ENCRYPTION_KEY=%s\n' "$encryption_key"
    printf 'ADMIN_EMAIL=%s\n' "$admin_email"
    printf 'ADMIN_PASSWORD=%s\n' "$admin_password"
  } > "$tmp_env"
  run_as_installer cp "$tmp_env" "$env_file"
  run_as_installer chmod 600 "$env_file"
  log "已生成初始配置: $env_file"
  log "默认管理员账号: $admin_email"
  log "默认管理员密码: $admin_password"
}

ensure_user() {
  if [ -z "$HAS_ROOT" ]; then
    log "无 root 权限，跳过创建系统用户"
    return
  fi

  if id "$RUN_USER" >/dev/null 2>&1; then
    if ! getent group "$RUN_GROUP" >/dev/null 2>&1; then
      RUN_GROUP="$(id -gn "$RUN_USER")"
    fi
    return
  fi

  if command -v useradd >/dev/null 2>&1; then
    if ! getent group "$RUN_GROUP" >/dev/null 2>&1; then
      as_root groupadd --system "$RUN_GROUP"
    fi
    as_root useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin --gid "$RUN_GROUP" "$RUN_USER"
  elif command -v adduser >/dev/null 2>&1; then
    as_root adduser --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin --group "$RUN_USER"
    RUN_GROUP="$RUN_USER"
  else
    warn "未找到 useradd/adduser，将使用 root 运行 systemd 服务"
    RUN_USER="root"
    RUN_GROUP="root"
  fi
}

install_systemd_service() {
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "未检测到 systemd，可手动运行: $INSTALL_DIR/current/bin/simplehub"
    return
  fi

  if [ -n "$HAS_ROOT" ]; then
    as_root tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<EOF
[Unit]
Description=SimpleHub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_GROUP
WorkingDirectory=$INSTALL_DIR/current
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$INSTALL_DIR/current/bin/simplehub
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    as_root systemctl daemon-reload
    as_root systemctl enable "$SERVICE_NAME" >/dev/null
  else
    mkdir -p "${HOME}/.config/systemd/user"
    cat > "${HOME}/.config/systemd/user/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=SimpleHub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/current
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$INSTALL_DIR/current/bin/simplehub
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable "$SERVICE_NAME" >/dev/null
    log "已创建用户级 systemd 服务: systemctl --user start $SERVICE_NAME"
  fi
}

main() {
  need_cmd uname
  need_cmd tar
  need_cmd curl

  if [ "$(uname -s)" != "Linux" ]; then
    fail "一键安装脚本仅支持 Linux"
  fi

  local arch asset url sums_url release_dir version_label
  arch="$(detect_arch)"
  asset="simplehub-linux-${arch}.tar.gz"
  url="$(release_url "$asset")"
  sums_url="$(release_url "SHA256SUMS")"
  version_label="${VERSION#v}"
  if [ "$VERSION" = "latest" ]; then
    version_label="$(date +%Y%m%d%H%M%S)"
  fi
  release_dir="$INSTALL_DIR/releases/$version_label"

  log "仓库: $REPO"
  log "版本: $VERSION"
  log "架构: $arch"
  log "下载: $url"

  run_as_installer mkdir -p "$INSTALL_DIR/releases" "$INSTALL_DIR/data"
  curl -fL "$url" -o "$TMP_DIR/$asset"
  if command -v sha256sum >/dev/null 2>&1; then
    curl -fL "$sums_url" -o "$TMP_DIR/SHA256SUMS"
    (cd "$TMP_DIR" && grep "  $asset\$" SHA256SUMS | sha256sum -c -)
  else
    warn "未检测到 sha256sum，跳过安装包完整性校验"
  fi
  tar -xzf "$TMP_DIR/$asset" -C "$TMP_DIR"

  run_as_installer rm -rf "$release_dir"
  run_as_installer mkdir -p "$release_dir"
  run_as_installer cp -a "$TMP_DIR/simplehub/." "$release_dir/"
  run_as_installer chmod +x "$release_dir/bin/simplehub"

  ensure_user
  write_env_if_missing

  run_as_installer ln -sfn "$release_dir" "$INSTALL_DIR/current"
  run_as_installer ln -sfn "$INSTALL_DIR/.env" "$release_dir/.env"
  if [ -n "$HAS_ROOT" ]; then
    as_root chown -R "$RUN_USER:$RUN_GROUP" "$INSTALL_DIR/data" "$INSTALL_DIR/.env" "$INSTALL_DIR/releases" || true
  fi

  install_systemd_service

  if command -v systemctl >/dev/null 2>&1; then
    if [ -n "$HAS_ROOT" ]; then
      as_root systemctl restart "$SERVICE_NAME"
      log "服务已启动: systemctl status $SERVICE_NAME"
    else
      systemctl --user restart "$SERVICE_NAME" 2>/dev/null || true
      log "用户级服务已启动: systemctl --user start $SERVICE_NAME"
    fi
  fi

  log "安装/更新完成。数据目录: $INSTALL_DIR/data"
  log "配置文件: $INSTALL_DIR/.env"
  log "访问地址: http://服务器IP:$PORT"
  if [ -z "$HAS_ROOT" ]; then
    log ""
    log "无 root 权限，systemd 用户服务已创建，可使用以下命令管理："
    log "  启动: systemctl --user start $SERVICE_NAME"
    log "  停止: systemctl --user stop $SERVICE_NAME"
    log "  状态: systemctl --user status $SERVICE_NAME"
    log "  日志: journalctl --user -u $SERVICE_NAME -f"
    log ""
    log "或直接前台运行:"
    log "  $INSTALL_DIR/current/bin/simplehub"
  fi
}

main "$@"
