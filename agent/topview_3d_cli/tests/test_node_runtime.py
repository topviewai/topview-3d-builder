from __future__ import annotations

import os
import sys

import pytest

from topview_3d_cli import node_runtime
from topview_3d_cli.local_errors import LocalProjectError

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="fake node binaries are shell scripts")


def fake_node(directory, version):
    directory.mkdir(parents=True, exist_ok=True)
    node = directory / "node"
    node.write_text(f"#!/bin/sh\necho {version}\n", encoding="utf-8")
    node.chmod(0o755)
    return node


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setenv("NVM_DIR", str(tmp_path / "home" / ".nvm"))
    monkeypatch.delenv("TOPVIEW3D_NODE", raising=False)
    monkeypatch.delenv("FNM_DIR", raising=False)
    scan = node_runtime._installed_nodes
    # Ignore the machine's own Node installs (Homebrew, /usr/bin) so only the fakes count.
    monkeypatch.setattr(node_runtime, "_installed_nodes", lambda: [path for path in scan() if path.startswith(str(tmp_path))])
    node_runtime.choose_node.cache_clear()
    yield tmp_path
    node_runtime.choose_node.cache_clear()


def test_a_new_enough_node_on_path_wins(isolated, monkeypatch):
    first = fake_node(isolated / "bin", "v22.1.0")
    fake_node(isolated / "home" / ".nvm" / "versions" / "node" / "v24.0.0" / "bin", "v24.0.0")
    monkeypatch.setenv("PATH", str(first.parent))
    chosen = node_runtime.choose_node()
    assert chosen.path == str(first) and chosen.version == "v22.1.0"


def test_an_old_node_on_path_falls_back_to_the_newest_nvm_node(isolated, monkeypatch):
    old = fake_node(isolated / "bin", "v16.15.1")
    fake_node(isolated / "home" / ".nvm" / "versions" / "node" / "v20.9.0" / "bin", "v20.9.0")
    newest = fake_node(isolated / "home" / ".nvm" / "versions" / "node" / "v24.13.0" / "bin", "v24.13.0")
    monkeypatch.setenv("PATH", str(old.parent))
    chosen = node_runtime.choose_node()
    assert chosen.path == str(newest) and chosen.path_version == "v16.15.1"
    env = node_runtime.with_node_on_path({"PATH": os.pathsep.join([str(old.parent), "/usr/bin"])})
    assert env["PATH"].split(os.pathsep)[:2] == [str(newest.parent), str(old.parent)]


def test_only_an_old_node_is_node_too_old(isolated, monkeypatch):
    old = fake_node(isolated / "bin", "v16.15.1")
    monkeypatch.setenv("PATH", str(old.parent))
    with pytest.raises(LocalProjectError) as failure:
        node_runtime.choose_node()
    assert failure.value.code == "NODE_TOO_OLD" and "v16.15.1" in str(failure.value)


def test_topview3d_node_is_used_as_given(isolated, monkeypatch):
    fake_node(isolated / "bin", "v24.0.0")
    chosen_dir = fake_node(isolated / "pinned", "v20.6.0")
    monkeypatch.setenv("PATH", str(isolated / "bin"))
    monkeypatch.setenv("TOPVIEW3D_NODE", str(chosen_dir))
    assert node_runtime.choose_node().path == str(chosen_dir)
    monkeypatch.setenv("TOPVIEW3D_NODE", str(fake_node(isolated / "old", "v18.0.0")))
    node_runtime.choose_node.cache_clear()
    with pytest.raises(LocalProjectError) as failure:
        node_runtime.choose_node()
    assert failure.value.code == "NODE_TOO_OLD"
