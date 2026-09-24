#!/usr/bin/env bash
# Developer install of the topview-3d-cli command from this checkout (macOS/Linux). Safe to re-run.
# Users without a checkout install the wheel instead: `pipx install topview-3d-cli`.
#
#   scripts/install.sh [--dev] [--install-uv] [--skip-node] [--skip-browser]
#
#   --dev           install the whole editor workspace (studio app, test tooling) and pytest
#   --install-uv    if no Python >= 3.11 is found, install uv (https://astral.sh/uv) and use it
#   --skip-node     skip the Node/pnpm/builder steps
#   --skip-browser  skip the Playwright Chromium download
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT="$ROOT/agent"
EDITOR="$ROOT/editor"
VENV="$AGENT/.venv"
DEV=0 INSTALL_UV=0 SKIP_NODE=0 SKIP_BROWSER=0

for arg in "$@"; do
  case "$arg" in
    --dev) DEV=1 ;;
    --install-uv) INSTALL_UV=1 ;;
    --skip-node) SKIP_NODE=1 ;;
    --skip-browser) SKIP_BROWSER=1 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ -f "$AGENT/pyproject.toml" ] && [ -d "$EDITOR/packages/director-cli" ] \
  || die "run this script from a full scene3d-open-source checkout"

python_ok() { "$1" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; }

find_python() {
  local candidate
  for candidate in python3.13 python3.12 python3.11 python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && python_ok "$(command -v "$candidate")"; then
      command -v "$candidate"; return 0
    fi
  done
  return 1
}

find_uv() {
  if command -v uv >/dev/null 2>&1; then command -v uv; return 0; fi
  local candidate
  for candidate in "$HOME/.local/bin/uv" "$HOME/.cargo/bin/uv"; do
    [ -x "$candidate" ] && { echo "$candidate"; return 0; }
  done
  return 1
}

extras=()
if [ "$DEV" = 1 ]; then extras+=(test); fi
spec="$AGENT"
if [ "${#extras[@]}" -gt 0 ]; then spec="$AGENT[$(IFS=,; echo "${extras[*]}")]"; fi

step "Python environment ($VENV)"
if [ -x "$VENV/bin/python" ] && ! python_ok "$VENV/bin/python"; then
  echo "existing venv uses Python < 3.11; recreating it"
  rm -rf "$VENV"
fi
UV="$(find_uv || true)"
if [ -z "$UV" ] && ! find_python >/dev/null && [ ! -x "$VENV/bin/python" ]; then
  if [ "$INSTALL_UV" = 1 ]; then
    step "Installing uv"
    command -v curl >/dev/null 2>&1 || die "curl is required to install uv"
    curl -LsSf https://astral.sh/uv/install.sh | sh
    UV="$(find_uv)" || die "uv installed but not found; open a new shell and re-run"
  else
    cat >&2 <<'EOF'
error: Python 3.11 or newer was not found.
  Install it from https://www.python.org/downloads/ or with `brew install python@3.12`,
  or re-run with --install-uv to let uv (https://astral.sh/uv) provide Python.
EOF
    exit 1
  fi
fi
if [ -n "$UV" ]; then
  echo "using uv: $UV"
  [ -x "$VENV/bin/python" ] || "$UV" venv --python ">=3.11" "$VENV"
  "$UV" pip install --python "$VENV/bin/python" -e "$spec"
else
  if [ ! -x "$VENV/bin/python" ]; then
    PYTHON="$(find_python)"
    echo "using $PYTHON"
    "$PYTHON" -m venv "$VENV"
  fi
  "$VENV/bin/python" -m pip --version >/dev/null 2>&1 || "$VENV/bin/python" -m ensurepip --upgrade >/dev/null
  "$VENV/bin/python" -m pip install --disable-pip-version-check -q -e "$spec"
fi

if [ "$SKIP_NODE" = 0 ]; then
  step "Node.js and pnpm"
  command -v node >/dev/null 2>&1 || die "Node.js 20.6+ is required: https://nodejs.org/"
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>20||(a===20&&b>=6)?0:1)' \
    || die "Node.js $(node --version) is too old; install 20.6 or newer"
  if command -v pnpm >/dev/null 2>&1; then
    PNPM=(pnpm)
  elif command -v corepack >/dev/null 2>&1; then
    echo "pnpm not found; using it through corepack"
    PNPM=(corepack pnpm)
  else
    die "pnpm is required: run \`npm install -g pnpm\` or enable corepack"
  fi
  echo "node $(node --version), pnpm $("${PNPM[@]}" --version)"

  step "Editor dependencies"
  if [ "$DEV" = 1 ]; then
    "${PNPM[@]}" -C "$EDITOR" install --frozen-lockfile
  else
    "${PNPM[@]}" -C "$EDITOR" install --frozen-lockfile --filter "@topview/3d-director-cli..."
  fi

  step "Building @topview/3d-builder"
  "${PNPM[@]}" -C "$EDITOR" --filter @topview/3d-builder build

  if [ "$SKIP_BROWSER" = 0 ]; then
    step "Playwright Chromium"
    "$VENV/bin/topview-3d-cli" browser ensure >/dev/null
  fi
fi

step "topview-3d-cli doctor"
if "$VENV/bin/topview-3d-cli" doctor >/tmp/topview3d-doctor.$$ 2>&1; then
  echo "all checks passed"
  status=0
else
  cat /tmp/topview3d-doctor.$$
  status=1
fi
rm -f /tmp/topview3d-doctor.$$

cat <<EOF

topview-3d-cli is installed at $VENV/bin/topview-3d-cli
Add it to PATH for this shell with:  export PATH="$VENV/bin:\$PATH"
EOF
if [ "$status" = 1 ] && { [ "$SKIP_NODE" = 1 ] || [ "$SKIP_BROWSER" = 1 ]; }; then
  echo "(doctor failures are expected for skipped steps)"
fi
exit "$status"
