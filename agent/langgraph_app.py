"""LangGraph CLI entrypoint for the flat ``src`` project layout."""

from __future__ import annotations

import sys
from importlib import import_module
from pathlib import Path

SRC_ROOT = Path(__file__).resolve().parent / "src"
src_path = str(SRC_ROOT)
if src_path not in sys.path:
    sys.path.insert(0, src_path)

supervisor_graph = import_module("graph.supervisor").graph
router_diagnostic_graph = import_module("graph.router").graph
operational_router_graph = import_module("graph.operational_router").graph


__all__ = ["operational_router_graph", "router_diagnostic_graph", "supervisor_graph"]
