from __future__ import annotations

import tomllib
from pathlib import Path

AGENT = Path(__file__).resolve().parents[2]
REPO = AGENT.parent


def test_licence_copies_match_their_sources():
    assert (AGENT / "LICENSE").read_bytes() == (REPO / "LICENSE").read_bytes()
    assert (AGENT / "NOTICE").read_bytes() == (REPO / "NOTICE").read_bytes()
    assert (AGENT / "LICENSE-ASSETS").read_bytes() == (REPO / "builtin-assets" / "LICENSE").read_bytes()


def test_distribution_declares_both_licences():
    project = tomllib.loads((AGENT / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    assert project["license"] == "Apache-2.0 AND CC-BY-4.0"
    assert project["license-files"] == ["LICENSE", "LICENSE-ASSETS", "NOTICE"]
    assert (REPO / "builtin-assets" / "LICENSE").read_text(encoding="utf-8").startswith("Attribution 4.0 International")
    assert "© Topview, CC BY 4.0" in (REPO / "builtin-assets" / "NOTICE").read_text(encoding="utf-8")
