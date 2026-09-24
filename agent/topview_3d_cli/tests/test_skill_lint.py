"""scripts/lint_skills.py: the shipped skill passes and every rule catches its violation."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from topview_3d_cli import __version__
from topview_3d_cli.local_cli import command_table

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("lint_skills", ROOT / "scripts" / "lint_skills.py")
lint = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lint)


def test_shipped_skills_pass():
    assert lint.main(["lint_skills.py", str(ROOT / "skills")]) == 0


def test_command_table_matches_parser():
    table = command_table()
    assert {"project init", "node batch", "inspect views", "renders show", "doctor", "browser ensure"} <= set(table)
    assert "--dry-run" in table["node batch"] and "--primary" in table["inspect views"]
    assert table[""] == {"--version"}
    assert "pose" not in table


def _skill(tmp_path: Path, body: str, frontmatter: str | None = None, references: dict[str, str] | None = None) -> Path:
    skill = tmp_path / "demo"
    (skill / "references").mkdir(parents=True)
    head = frontmatter if frontmatter is not None else "name: demo\ndescription: Use when testing the lint."
    (skill / "SKILL.md").write_text(f"---\n{head}\n---\n\n{body}\n", encoding="utf-8")
    for name, text in (references or {}).items():
        (skill / "references" / name).write_text(text, encoding="utf-8")
    return skill


def _errors(skill: Path) -> list[str]:
    return lint.lint_skill(skill, command_table(), __version__)


def test_clean_skill_passes(tmp_path):
    skill = _skill(tmp_path, "Run `topview-3d-cli doctor --json`, then read `references/setup.md`.\n\n"
                   f"```bash\nuvx --from topview-3d-cli=={__version__} topview-3d-cli project init <dir>\n"
                   "topview-3d-cli node batch <dir> changes.json --dry-run\n```",
                   references={"setup.md": "See `layout.md`? No: only `topview-3d-cli renders show <dir> --frame 0`."})
    assert [e for e in _errors(skill) if "layout.md" not in e] == []


@pytest.mark.parametrize(("frontmatter", "expected"), [
    ("name: demo", "description is empty"),
    ("name: demo\ndescription: x\nlicense: MIT", "exactly name and description"),
    ("name: other\ndescription: x", "name must match"),
    ("name: demo\ndescription: " + "x" * 1025, "1025 characters"),
])
def test_frontmatter_rules(tmp_path, frontmatter, expected):
    assert any(expected in error for error in _errors(_skill(tmp_path, "Body.", frontmatter)))


def test_block_scalar_description(tmp_path):
    skill = _skill(tmp_path, "Body.", "name: demo\ndescription: >\n  Use when\n  testing.")
    assert _errors(skill) == []


@pytest.mark.parametrize(("line", "label"), [
    ("Call mcp__scene3d__get_director_document.", "MCP tool name"),
    ("Ask Claude to look.", "vendor-specific"),
    ("Open https://example.com/docs.", "URL"),
    ("Publish it to the Canvas.", "product identity"),
    ("The Topview editor.", "product identity"),
    ("Paste your API key here.", "key wording"),
    ("Log in first.", "login"),
    ("请先登录账号。", "login"),
    ("?" + "X-Amz" + "-Credential=abc", "signed-URL"),
])
def test_banned_wording(tmp_path, line, label):
    assert any(label in error for error in _errors(_skill(tmp_path, line)))


def test_package_name_and_keyframes_are_allowed(tmp_path):
    skill = _skill(tmp_path, f"Install topview-3d-cli=={__version__}; keyframes and keywords are fine.")
    assert _errors(skill) == []


def test_version_pin_must_match(tmp_path):
    errors = _errors(_skill(tmp_path, "`uvx topview-3d-cli@9.9.9 doctor`"))
    assert any("does not match package version" in error for error in errors)


@pytest.mark.parametrize(("code", "expected"), [
    ("topview-3d-cli node frobnicate <dir>", "unknown command `topview-3d-cli node frobnicate`"),
    ("topview-3d-cli teleport <dir>", "unknown command `topview-3d-cli teleport`"),
    ("topview-3d-cli render <dir> --bogus", "has no option --bogus"),
    ("topview-3d-cli pose", "needs a subcommand"),
])
def test_commands_are_checked(tmp_path, code, expected):
    for body in (f"Run `{code}`.", f"```bash\n{code}\n```"):
        assert any(expected in error for error in _errors(_skill(tmp_path / str(len(body)), body)))


def test_prose_and_paths_are_not_commands(tmp_path):
    body = "topview-3d-cli resolves assets itself; files live in `.topview-3d/renders/` and `<dir>/.topview-3d/`."
    assert _errors(_skill(tmp_path, body)) == []


def test_links_and_orphans(tmp_path):
    skill = _skill(tmp_path, "Read `references/missing.md` and [x](references/gone.md).",
                   references={"orphan.md": "Nobody links here."})
    errors = _errors(skill)
    assert any("references/missing.md does not exist" in error for error in errors)
    assert any("references/gone.md does not exist" in error for error in errors)
    assert any("orphan.md: not referenced" in error for error in errors)


def test_symlinked_references_rejected(tmp_path):
    real = tmp_path / "elsewhere"
    real.mkdir()
    (real / "a.md").write_text("A.", encoding="utf-8")
    skill = _skill(tmp_path, "Read `references/a.md`.")
    (skill / "references").rmdir()
    (skill / "references").symlink_to(real, target_is_directory=True)
    assert any("real directory" in error for error in _errors(skill))


def test_inline_shell_patterns(tmp_path):
    errors = _errors(_skill(tmp_path, "Keep `!important` and `<id>_1` out; `a > b` and `<dir>` are fine.\n\n"
                            "```bash\necho hi > out.txt\n```"))
    assert len([e for e in errors if "inline code" in e]) == 2
    assert any("`!important`" in e and "history expansion" in e for e in errors)
    assert any("`<id>_1`" in e and "output redirection" in e for e in errors)


def test_manifests_are_checked(tmp_path):
    assert lint.check_manifests(ROOT) == []
    for rel in lint.MANIFESTS:
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_text((ROOT / rel).read_text(encoding="utf-8"), encoding="utf-8")
    (tmp_path / ".cursor-plugin/plugin.json").write_text('{"name": "other", "mcpServers": {}}', encoding="utf-8")
    (tmp_path / ".claude-plugin/plugin.json").write_text("{", encoding="utf-8")
    errors = lint.check_manifests(tmp_path)
    assert any(".cursor-plugin/plugin.json: plugin name" in e for e in errors)
    assert any(".cursor-plugin/plugin.json: must not declare mcpServers" in e for e in errors)
    assert any(".claude-plugin/plugin.json: not readable JSON" in e for e in errors)


def test_uvx_at_version_form_is_checked(tmp_path):
    ok = _errors(_skill(tmp_path / "ok", f"Run `uvx topview-3d-cli@{__version__} doctor --json`."))
    assert ok == []
    errors = _errors(_skill(tmp_path / "bad", "Run `uvx topview-3d-cli@9.9.9 teleport <dir>`."))
    assert any("pin 9.9.9 does not match" in error for error in errors)
    assert any("unknown command `topview-3d-cli teleport`" in error for error in errors)
