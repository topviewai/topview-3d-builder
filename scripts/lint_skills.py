#!/usr/bin/env python3
"""Lint the agent skills under skills/.

Checks each skill directory for: a real (non-symlink) SKILL.md whose frontmatter holds exactly
``name`` and ``description``; the description length; banned wording; references that exist and
are all reachable from SKILL.md; pinned package versions that match the Python package; and every
``topview-3d-cli`` command (with its long options) quoted in code against the CLI's own parser; inline code
spans that a host's shell permission checker misreads (``!`` and ``>`` before a word). When run on the
repository's own ``skills/``, the plugin manifests are checked too (valid JSON, plugin name, skills
path, no apps or MCP servers).

Usage: python scripts/lint_skills.py [skills-dir]   (exit 1 when an error is found)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AGENT = ROOT / "agent"
DESCRIPTION_LIMIT = 1024
NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
FRONTMATTER_KEYS = {"name", "description"}

BANNED = [
    (re.compile(r"mcp__"), "MCP tool name"),
    (re.compile(r"\bclaude\b", re.I), "vendor-specific agent name"),
    (re.compile(r"https?://", re.I), "URL"),
    (re.compile(r"\b[\w-]+\.(?:topview\.ai|topview\.com)\b|\btopview\.(?:ai|com)\b", re.I), "internal domain"),
    (re.compile(r"topview(?!-3d-cli|-3d-builder|-3d\b|_3d_cli|3d(?:\b|_)| 3D Builder)", re.I), "product identity (only the package, command, data directory and variable names are allowed)"),
    (re.compile(r"\bcanvas\b", re.I), "product identity"),
    (re.compile(r"\b(?:api[ _-]?)?keys?\b", re.I), "key wording"),
    (re.compile(r"\b(?:secret|token|password|credential)s?\b", re.I), "credential wording"),
    (re.compile(r"\b(?:log[ -]?in|sign[ -]?in|accounts?)\b", re.I), "login / account wording"),
    (re.compile(r"登录|账号|帐号|密钥"), "login / account wording"),
    (re.compile(r"X-Amz-|Key-Pair-Id|Signature=", re.I), "signed-URL parameter"),
]

FENCE = re.compile(r"^```[^\n]*\n(.*?)^```", re.M | re.S)
INLINE = re.compile(r"`([^`\n]+)`")
LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
MD_NAME = re.compile(r"(?<![\w/.-])((?:references/)?[a-z0-9][a-z0-9-]*\.md)\b")
PIN = re.compile(r"topview-3d-cli(?:==|@)([0-9][0-9A-Za-z.+-]*[0-9A-Za-z])")
INVOCATION = re.compile(r"(?<![\w./-])topview-3d-cli(?:@[0-9][\w.+-]*)?(?![\w@=-])((?:[ \t]+[^\s|;&#)]+)*)")
WORD = re.compile(r"^[a-z][a-z-]*$")
INLINE_SHELL = [
    (re.compile(r"!"), "`!` (read as shell history expansion); use the word instead"),
    (re.compile(r">\w"), "`>` before a word (read as output redirection); rephrase"),
]
PLUGIN_NAME = "topview-3d-builder"
MANIFESTS = (
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    ".cursor-plugin/plugin.json",
    ".agents/plugins/marketplace.json",
)


def package_version() -> str:
    text = (AGENT / "topview_3d_cli" / "__init__.py").read_text(encoding="utf-8")
    match = re.search(r'^__version__\s*=\s*"([^"]+)"', text, re.M)
    if not match:
        raise SystemExit("cannot read __version__ from agent/topview_3d_cli/__init__.py")
    return match.group(1)


def cli_commands() -> dict[str, set[str]]:
    sys.path.insert(0, str(AGENT))
    try:
        from topview_3d_cli.local_cli import command_table
    except ImportError as exc:  # pragma: no cover - environment problem, not a lint finding
        raise SystemExit(f"cannot import the topview-3d-cli command ({exc}); run with the agent environment") from exc
    return command_table()


def parse_frontmatter(text: str) -> tuple[dict[str, str], str] | None:
    """A small YAML subset: ``key: value``, quoted values and ``>`` / ``|`` block scalars."""
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---\n", 4)
    if end < 0:
        return None
    lines = text[4:end].split("\n")
    fields: dict[str, str] = {}
    index = 0
    while index < len(lines):
        line = lines[index]
        index += 1
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not match:
            fields.setdefault("__invalid__", line)
            continue
        key, value = match.group(1), match.group(2).strip()
        if value in {">", "|", ">-", "|-"}:
            block = []
            while index < len(lines) and (not lines[index].strip() or lines[index].startswith((" ", "\t"))):
                block.append(lines[index].strip())
                index += 1
            value = (" " if value.startswith(">") else "\n").join(part for part in block if part)
        elif len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        fields[key] = value
    return fields, text[end + 5:]


def code_segments(text: str) -> list[tuple[int, str]]:
    """(line number, code) for every fenced-block line and inline code span."""
    segments: list[tuple[int, str]] = []
    covered: list[tuple[int, int]] = []
    for block in FENCE.finditer(text):
        covered.append(block.span())
        start = text.count("\n", 0, block.start(1)) + 1
        segments += [(start + offset, line) for offset, line in enumerate(block.group(1).split("\n"))]
    for span in INLINE.finditer(text):
        if not any(a <= span.start() < b for a, b in covered):
            segments.append((text.count("\n", 0, span.start()) + 1, span.group(1)))
    return segments


def check_inline_shell(rel: str, text: str, errors: list[str]) -> None:
    fenced = [block.span() for block in FENCE.finditer(text)]
    for span in INLINE.finditer(text):
        if any(a <= span.start() < b for a, b in fenced):
            continue
        for pattern, label in INLINE_SHELL:
            if pattern.search(span.group(1)):
                errors.append(f"{rel}:{text.count(chr(10), 0, span.start()) + 1}: inline code `{span.group(1)}` "
                              f"contains {label}")


def check_manifests(root: Path) -> list[str]:
    import json

    errors: list[str] = []
    for rel in MANIFESTS:
        path = root / rel
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            errors.append(f"{rel}: not readable JSON ({exc})")
            continue
        names = [data.get("name")] + [plugin.get("name") for plugin in data.get("plugins", [])]
        if set(names) != {PLUGIN_NAME}:
            errors.append(f"{rel}: plugin name must be {PLUGIN_NAME}, got {names}")
        if "skills" in data and data["skills"] != "./skills/":
            errors.append(f"{rel}: skills must be ./skills/")
        for key in ("apps", "mcpServers"):
            if key in data and not (rel == ".codex-plugin/plugin.json" and key == "mcpServers"):
                errors.append(f"{rel}: must not declare {key}")
        if rel == ".codex-plugin/plugin.json" and data.get("mcpServers") != "./.mcp.json":
            errors.append(f"{rel}: mcpServers must be ./.mcp.json")
    return errors


def check_commands(rel: str, text: str, commands: dict[str, set[str]], errors: list[str]) -> None:
    groups = {path.split(" ")[0] for path in commands if " " in path}
    known = set(commands) | groups
    for line_no, code in code_segments(text):
        for match in INVOCATION.finditer(code.replace("\\|", "|")):
            tokens = match.group(1).split()
            path: list[str] = []
            while tokens and WORD.match(tokens[0]) and " ".join([*path, tokens[0]]) in known:
                path.append(tokens.pop(0))
            command = " ".join(path)
            where = f"{rel}:{line_no}"
            word = tokens[0] if tokens and WORD.match(tokens[0]) else None
            if word and (not path or command in groups):
                errors.append(f"{where}: unknown command `topview-3d-cli {' '.join([*path, word])}`")
                continue
            if command in groups:
                errors.append(f"{where}: `topview-3d-cli {command}` needs a subcommand")
                continue
            for token in tokens:
                option = token.split("=", 1)[0]
                if option.startswith("--") and option not in commands[command]:
                    errors.append(f"{where}: `topview-3d-cli {command}` has no option {option}")


def lint_skill(skill: Path, commands: dict[str, set[str]], version: str) -> list[str]:
    errors: list[str] = []
    entry = skill / "SKILL.md"
    if skill.is_symlink() or not entry.is_file() or entry.is_symlink():
        return [f"{skill.name}: SKILL.md must be a regular file in a real directory"]
    text = entry.read_text(encoding="utf-8")
    parsed = parse_frontmatter(text)
    if parsed is None:
        errors.append(f"{skill.name}/SKILL.md: missing or unterminated frontmatter")
    else:
        fields, _ = parsed
        if set(fields) != FRONTMATTER_KEYS:
            errors.append(f"{skill.name}/SKILL.md: frontmatter keys must be exactly name and description, "
                          f"got {sorted(fields)}")
        name, description = fields.get("name", ""), fields.get("description", "")
        if name != skill.name or not NAME_PATTERN.match(name):
            errors.append(f"{skill.name}/SKILL.md: name must match the directory name ({name!r})")
        if not description:
            errors.append(f"{skill.name}/SKILL.md: description is empty")
        elif len(description) > DESCRIPTION_LIMIT:
            errors.append(f"{skill.name}/SKILL.md: description has {len(description)} characters "
                          f"(limit {DESCRIPTION_LIMIT})")

    references = skill / "references"
    if references.is_symlink():
        errors.append(f"{skill.name}/references must be a real directory")
    documents = [entry, *sorted(references.glob("*.md"))] if references.is_dir() else [entry]
    mentioned: set[Path] = set()
    for document in documents:
        rel = str(document.relative_to(skill.parent))
        if document.is_symlink():
            errors.append(f"{rel}: must not be a symlink")
        body = document.read_text(encoding="utf-8")
        for number, line in enumerate(body.split("\n"), 1):
            for pattern, label in BANNED:
                found = pattern.search(line)
                if found:
                    errors.append(f"{rel}:{number}: banned {label}: {found.group(0)!r}")
            for pin in PIN.findall(line):
                if pin != version:
                    errors.append(f"{rel}:{number}: topview-3d-cli pin {pin} does not match package version {version}")
        targets = [link for link in LINK.findall(body) if not link.startswith("#")]
        targets += MD_NAME.findall(body)
        for target in targets:
            resolved = (document.parent / target.split("#", 1)[0]).resolve()
            if not resolved.is_file() and document is not entry:
                resolved = (references / target).resolve()
            if not resolved.is_file():
                errors.append(f"{rel}: link target {target} does not exist")
            else:
                mentioned.add(resolved)
        check_commands(rel, body, commands, errors)
        check_inline_shell(rel, body, errors)
    for document in documents[1:]:
        if document.resolve() not in mentioned:
            errors.append(f"{document.relative_to(skill.parent)}: not referenced from any skill document")
    return errors


def main(argv: list[str]) -> int:
    root = Path(argv[1]).resolve() if len(argv) > 1 else ROOT / "skills"
    skills = sorted(path for path in root.iterdir() if path.is_dir() or path.is_symlink())
    if not skills:
        print(f"no skills found in {root}", file=sys.stderr)
        return 1
    commands, version = cli_commands(), package_version()
    errors = [error for skill in skills for error in lint_skill(skill, commands, version)]
    if root == ROOT / "skills":
        errors += check_manifests(ROOT)
    for error in errors:
        print(error, file=sys.stderr)
    print(f"{len(skills)} skill(s) checked, {len(errors)} error(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
