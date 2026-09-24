from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from topview_3d_cli import local_cli, runtime as runtime_module
from topview_3d_cli.local_errors import LocalProjectError
from topview_3d_cli.runtime import PLAYWRIGHT_VERSION, node_env, runtime, user_cache_dir


def _fake_staged(root: Path) -> Path:
    director_cli = root / "director-cli"
    director_cli.mkdir(parents=True)
    (director_cli / "cli.mjs").write_text("", encoding="utf-8")
    (root / "runtime.json").write_text(json.dumps({"builderVersion": "9.9.9"}), encoding="utf-8")
    return root


@pytest.fixture
def packaged(tmp_path, monkeypatch):
    staged = _fake_staged(tmp_path / "_runtime")
    monkeypatch.setattr(runtime_module, "STAGED_ROOT", staged)
    monkeypatch.setattr(runtime_module, "REPO_ROOT", tmp_path / "no-checkout")
    monkeypatch.setenv("TOPVIEW3D_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.delenv("TOPVIEW3D_RUNTIME", raising=False)
    return tmp_path


@pytest.mark.parametrize(("platform", "env", "expected"), [
    ("darwin", {}, "{home}/Library/Caches/topview-3d-cli"),
    ("linux", {}, "{home}/.cache/topview-3d-cli"),
    ("linux", {"XDG_CACHE_HOME": "/xdg"}, "/xdg/topview-3d-cli"),
    ("win32", {"LOCALAPPDATA": "/local"}, "/local/topview-3d-cli/Cache"),
    ("win32", {}, "{home}/AppData/Local/topview-3d-cli/Cache"),
])
def test_user_cache_dir_per_platform(monkeypatch, tmp_path, platform, env, expected):
    monkeypatch.setattr(runtime_module.sys, "platform", platform)
    monkeypatch.setattr(runtime_module.Path, "home", staticmethod(lambda: tmp_path))
    for name in ("TOPVIEW3D_CACHE_DIR", "XDG_CACHE_HOME", "LOCALAPPDATA"):
        monkeypatch.delenv(name, raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    assert user_cache_dir().as_posix() == expected.format(home=tmp_path.as_posix())


def test_cache_dir_override(monkeypatch, tmp_path):
    monkeypatch.setenv("TOPVIEW3D_CACHE_DIR", str(tmp_path / "custom"))
    assert user_cache_dir() == tmp_path / "custom"


def test_checkout_is_the_workspace_runtime(monkeypatch):
    monkeypatch.delenv("TOPVIEW3D_RUNTIME", raising=False)
    current = runtime()
    assert current.mode == "workspace"
    assert current.node_prefix == current.director_cli
    assert "TOPVIEW3D_NODE_PREFIX" not in node_env(current)


def test_packaged_runtime_without_checkout(packaged):
    current = runtime()
    assert current.mode == "packaged"
    assert current.node_prefix == packaged / "cache" / "node" / local_cli.CLI_VERSION
    assert node_env(current)["TOPVIEW3D_NODE_PREFIX"] == str(current.node_prefix)
    assert runtime_module.builder_version() == "9.9.9"


def test_forced_mode(monkeypatch, packaged):
    monkeypatch.setenv("TOPVIEW3D_RUNTIME", "workspace")
    with pytest.raises(LocalProjectError) as missing:
        runtime()
    assert missing.value.code == "RUNTIME_MISSING"
    monkeypatch.setenv("TOPVIEW3D_RUNTIME", "bogus")
    with pytest.raises(LocalProjectError) as invalid:
        runtime()
    assert invalid.value.code == "RUNTIME_MISSING"


def test_browser_ensure_installs_playwright_into_the_cache(monkeypatch, packaged):
    calls = []

    def fake_run(args, **kwargs):
        calls.append((args, kwargs))
        if "install" in args:
            package = Path(args[args.index("--prefix") + 1]) / "node_modules" / "playwright" / "package.json"
            package.parent.mkdir(parents=True)
            package.write_text(json.dumps({"version": PLAYWRIGHT_VERSION}), encoding="utf-8")
            return subprocess.CompletedProcess(args, 0, "", "")
        return subprocess.CompletedProcess(args, 0, '{"ok": true, "browser": "chromium"}\n', "")

    monkeypatch.setattr(local_cli.shutil, "which", lambda name: f"/bin/{name}")
    monkeypatch.setattr(local_cli.subprocess, "run", fake_run)
    result = local_cli.browser_ensure(with_deps=False)
    prefix = packaged / "cache" / "node" / local_cli.CLI_VERSION
    assert result == {"ok": True, "runtime": "packaged", "nodePrefix": str(prefix),
                      "playwright": PLAYWRIGHT_VERSION, "browser": {"ok": True, "browser": "chromium"}}
    npm_args, _ = calls[0]
    assert npm_args[:4] == ["/bin/npm", "install", "--prefix", str(prefix)]
    assert f"playwright@{PLAYWRIGHT_VERSION}" in npm_args
    node_args, node_kwargs = calls[1]
    assert node_args == ["/bin/node", "cli.mjs", "browser", "ensure"]
    assert node_kwargs["env"]["TOPVIEW3D_NODE_PREFIX"] == str(prefix)

    calls.clear()
    local_cli.browser_ensure(with_deps=True)
    assert [args[-1] for args, _ in calls] == ["--with-deps"]


def test_browser_ensure_reports_missing_npm(monkeypatch, packaged):
    monkeypatch.setattr(local_cli.shutil, "which", lambda name: None if name == "npm" else f"/bin/{name}")
    with pytest.raises(LocalProjectError) as missing:
        local_cli.browser_ensure(with_deps=False)
    assert missing.value.code == "NPM_UNAVAILABLE"
