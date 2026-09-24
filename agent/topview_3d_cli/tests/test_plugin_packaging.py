"""Plugin manifests, scripts/set_version.py and scripts/package-codex-plugin.mjs."""
from __future__ import annotations

import importlib.util
import json
import shutil
import struct
import subprocess
import zipfile
import zlib
from pathlib import Path

import pytest

from topview_3d_cli import __version__

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("set_version", ROOT / "scripts" / "set_version.py")
set_version = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(set_version)

MANIFESTS = [
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    ".cursor-plugin/plugin.json",
    ".agents/plugins/marketplace.json",
]
IGNORE = shutil.ignore_patterns(".DS_Store", "__pycache__")
VERSION_FILES = [
    "agent/topview_3d_cli/__init__.py",
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
    "README.md",
]


def test_manifests_parse_and_share_the_plugin_name():
    for rel in MANIFESTS:
        data = json.loads((ROOT / rel).read_text(encoding="utf-8"))
        names = [data["name"]] + [plugin["name"] for plugin in data.get("plugins", [])]
        assert set(names) == {"topview-3d-builder"}, rel
        assert "mcpServers" not in data and "apps" not in data, rel
    codex = json.loads((ROOT / ".codex-plugin/plugin.json").read_text(encoding="utf-8"))
    assert codex["interface"]["displayName"] == "Topview 3D Builder"
    assert codex["skills"] == "./skills/"
    assert codex["interface"]["capabilities"] == ["Read", "Write"]
    for key in ("composerIcon", "logo"):
        assert (ROOT / codex["interface"][key]).is_file()
    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    assert not [line for line in tracked.splitlines() if Path(line).name in {".mcp.json", ".app.json"}]


def test_versions_are_consistent():
    assert set_version.check(ROOT) == []
    assert set_version.current_versions(ROOT)[0] == ("agent/topview_3d_cli/__init__.py", __version__)


def _copy_version_sources(dest: Path) -> None:
    for rel in VERSION_FILES:
        (dest / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / rel, dest / rel)
    shutil.copytree(ROOT / "skills", dest / "skills", ignore=IGNORE)


def test_set_version_rewrites_only_version_fields(tmp_path):
    _copy_version_sources(tmp_path)
    before = {rel: (tmp_path / rel).read_text(encoding="utf-8") for rel in VERSION_FILES}
    changed = set_version.set_version(tmp_path, "0.2.0-rc.1")
    assert set_version.check(tmp_path) == []
    assert {"agent/topview_3d_cli/__init__.py", ".codex-plugin/plugin.json", "skills/topview-3d-cli/SKILL.md"} <= set(changed)
    for rel in VERSION_FILES[1:4]:
        after = (tmp_path / rel).read_text(encoding="utf-8")
        assert after == before[rel].replace(f'"version": "{__version__}"', '"version": "0.2.0-rc.1"', 1)
    assert f"topview-3d-cli=={__version__}" not in (tmp_path / "skills/topview-3d-cli/SKILL.md").read_text(encoding="utf-8")


def test_set_version_rejects_non_semver_and_check_reports_drift(tmp_path):
    _copy_version_sources(tmp_path)
    with pytest.raises(SystemExit, match="semantic version"):
        set_version.set_version(tmp_path, "1.0")
    manifest = tmp_path / ".cursor-plugin/plugin.json"
    manifest.write_text(manifest.read_text(encoding="utf-8").replace(__version__, "9.9.9", 1), encoding="utf-8")
    assert any(".cursor-plugin/plugin.json" in error for error in set_version.check(tmp_path))
    assert set_version.main(["--check", "--root", str(tmp_path)]) == 1


# —— packaging ——

needs_tools = pytest.mark.skipif(not (shutil.which("git") and shutil.which("node")), reason="needs git and node")


def _png(width: int, height: int) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    raw = b"".join(b"\0" + b"\0\0\0" * width for _ in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def _plugin_repo(tmp_path: Path, icon: bytes | None = None, logo: bytes | None = None, todo: bool = False) -> Path:
    repo = tmp_path / "repo"
    (repo / "scripts").mkdir(parents=True)
    shutil.copy2(ROOT / "scripts" / "package-codex-plugin.mjs", repo / "scripts")
    shutil.copytree(ROOT / ".codex-plugin", repo / ".codex-plugin", ignore=IGNORE)
    if todo:
        manifest_path = repo / ".codex-plugin" / "plugin.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["interface"]["privacyPolicyURL"] = "TODO"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    shutil.copytree(ROOT / "skills", repo / "skills", ignore=IGNORE)
    (repo / "assets").mkdir()
    (repo / "assets" / "README.md").write_text("images\n", encoding="utf-8")
    (repo / "README.md").write_text("not packaged\n", encoding="utf-8")
    if icon is not None:
        (repo / "assets" / "icon.png").write_bytes(icon)
    if logo is not None:
        (repo / "assets" / "logo.png").write_bytes(logo)
    git = ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false"]
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run(git + ["-C", str(repo), "add", "-A"], check=True)
    subprocess.run(git + ["-C", str(repo), "commit", "-qm", "plugin"], check=True)
    return repo


def _package(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", "scripts/package-codex-plugin.mjs", *args], cwd=repo, capture_output=True, text=True, check=False
    )


@needs_tools
def test_package_builds_zip_with_only_plugin_files(tmp_path):
    repo = _plugin_repo(tmp_path, icon=_png(64, 64), logo=_png(128, 128))
    result = _package(repo, "--release")
    assert result.returncode == 0, result.stderr
    assert "TODO placeholders" not in result.stderr
    with zipfile.ZipFile(repo / "dist" / "topview-3d-builder-plugin.zip") as archive:
        names = [name for name in archive.namelist() if not name.endswith("/")]
    assert all(name.startswith("topview-3d-builder/") for name in names)
    tops = {name.split("/")[1] for name in names}
    assert tops == {".codex-plugin", "assets", "skills"}
    assert "topview-3d-builder/assets/README.md" not in names
    assert {"topview-3d-builder/assets/icon.png", "topview-3d-builder/assets/logo.png"} <= set(names)
    assert "topview-3d-builder/skills/topview-3d-cli/SKILL.md" in names


@needs_tools
def test_package_release_mode_rejects_todo_placeholders(tmp_path):
    repo = _plugin_repo(tmp_path, icon=_png(64, 64), logo=_png(64, 64), todo=True)
    draft = _package(repo)
    assert draft.returncode == 0, draft.stderr
    assert "plugin.json still has TODO placeholders: interface.privacyPolicyURL" in draft.stderr
    shutil.rmtree(repo / "dist")
    result = _package(repo, "--release")
    assert result.returncode == 1
    assert "TODO placeholders" in result.stderr and not (repo / "dist").exists()


@needs_tools
def test_package_names_missing_and_bad_images(tmp_path):
    repo = _plugin_repo(tmp_path, icon=_png(64, 32), logo=None)
    result = _package(repo)
    assert result.returncode == 1
    assert "assets/logo.png is missing from HEAD" in result.stderr
    assert "64x32; it must be square" in result.stderr
    small = _plugin_repo(tmp_path / "small", icon=_png(16, 16), logo=b"not a png")
    result = _package(small)
    assert "16px wide; it must be 48-4096px" in result.stderr
    assert "assets/logo.png is not a PNG" in result.stderr


@needs_tools
def test_package_rejects_bad_skill_layout(tmp_path):
    repo = _plugin_repo(tmp_path, icon=_png(64, 64), logo=_png(64, 64))
    (repo / "skills" / ".hidden").mkdir()
    (repo / "skills" / ".hidden" / "SKILL.md").write_text("---\nname: .hidden\ndescription: x\n---\n", encoding="utf-8")
    (repo / "skills" / "topview-3d-cli" / "link.md").symlink_to("SKILL.md")
    long_name = "x" * 60
    (repo / "skills" / long_name).mkdir()
    (repo / "skills" / long_name / "SKILL.md").write_text(
        f"---\nname: {long_name}\ndescription: {'d' * 1100}\n---\n", encoding="utf-8"
    )
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True)
    subprocess.run(
        ["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "bad"],
        check=True,
    )
    result = _package(repo)
    assert result.returncode == 1
    assert "must not start with" in result.stderr
    assert "symlinks are not allowed" in result.stderr
    assert "the limit is 64" in result.stderr
    assert "the limit is 1024" in result.stderr
