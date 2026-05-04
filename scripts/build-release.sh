#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-}"
NODE_VERSION="${NODE_VERSION:-20.18.1}"
OUT_DIR="$ROOT_DIR/dist/release"
WORK_DIR="$ROOT_DIR/dist/release-work"

if [ -z "$VERSION" ]; then
  VERSION="$(node -p "require('$ROOT_DIR/server/package.json').version")"
fi
VERSION="${VERSION#v}"

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR" "$OUT_DIR"
rm -f "$OUT_DIR"/simplehub-linux-*.tar.gz "$OUT_DIR"/SHA256SUMS

(
  cd "$ROOT_DIR/web"
  npm ci --no-audit --no-fund
  npm run build
)

(
  cd "$ROOT_DIR/server"
  npm ci --no-audit --no-fund
  npx prisma generate
  npm prune --production
)

make_package() {
  local arch="$1"
  local node_arch="$2"
  local package_dir="$WORK_DIR/simplehub"
  local node_name="node-v${NODE_VERSION}-linux-${node_arch}"
  local node_archive="${node_name}.tar.xz"
  local node_url="https://nodejs.org/dist/v${NODE_VERSION}/${node_archive}"

  rm -rf "$package_dir" "$WORK_DIR/$node_name"
  mkdir -p "$package_dir/bin" "$package_dir/node" "$package_dir/web"

  if [ ! -f "$WORK_DIR/$node_archive" ]; then
    curl -fsSL "$node_url" -o "$WORK_DIR/$node_archive"
  fi

  tar -xJf "$WORK_DIR/$node_archive" -C "$WORK_DIR"
  cp -a "$WORK_DIR/$node_name/." "$package_dir/node/"

  cp -a "$ROOT_DIR/server/package.json" "$package_dir/package.json"
  cp -a "$ROOT_DIR/server/package-lock.json" "$package_dir/package-lock.json"
  cp -a "$ROOT_DIR/server/node_modules" "$package_dir/node_modules"
  cp -a "$ROOT_DIR/server/prisma" "$package_dir/prisma"
  cp -a "$ROOT_DIR/server/scripts" "$package_dir/scripts"
  cp -a "$ROOT_DIR/server/src" "$package_dir/src"
  cp -a "$ROOT_DIR/web/dist" "$package_dir/web/dist"
  cp -a "$ROOT_DIR/LICENSE" "$package_dir/LICENSE"
  printf '%s\n' "$VERSION" > "$package_dir/VERSION"

  cat > "$package_dir/bin/simplehub" <<'SH'
#!/usr/bin/env sh
set -eu
APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export PATH="$APP_DIR/node/bin:$PATH"
cd "$APP_DIR"
exec "$APP_DIR/node/bin/node" "$APP_DIR/scripts/start.js"
SH
  chmod +x "$package_dir/bin/simplehub"

  tar -C "$WORK_DIR" -czf "$OUT_DIR/simplehub-linux-${arch}.tar.gz" simplehub
}

make_package x64 x64
make_package arm64 arm64

(
  cd "$OUT_DIR"
  sha256sum simplehub-linux-*.tar.gz > SHA256SUMS
)
