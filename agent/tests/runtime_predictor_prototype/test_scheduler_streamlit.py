from __future__ import annotations

from pathlib import Path

from streamlit.testing.v1 import AppTest


def test_scheduler_streamlit_app_renders_without_exception() -> None:
    app_path = Path(__file__).with_name("streamlit_scheduler_simulation.py")
    app = AppTest.from_file(str(app_path)).run(timeout=120)
    assert not app.exception
    assert app.title[0].value == "Runtime-aware multi-workspace Scheduler Lab"
    assert len(app.metric) == 5
