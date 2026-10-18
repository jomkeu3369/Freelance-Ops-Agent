from pathlib import Path
from types import SimpleNamespace

import pytest

from routing_benchmark import cli_commands


@pytest.mark.parametrize("command", ["generate-training-data", "route-ab", "judge-ab", "all"])
def test_paid_commands_require_explicit_confirmation(command: str, tmp_path: Path, monkeypatch) -> None:
    def unexpected_call(*args, **kwargs):
        pytest.fail("확인 없이 유료 실행 함수를 호출했습니다.")

    for name in ("generate_training_data", "run_router_ab", "run_judges"):
        monkeypatch.setattr(cli_commands, name, unexpected_call)
    args = SimpleNamespace(command=command, confirm_paid_api=False)
    with pytest.raises(SystemExit, match="--confirm-paid-api"):
        cli_commands.run_paid_command(args, None, tmp_path)


def test_simulation_dispatch_preserves_output_seed_and_trials(tmp_path: Path, monkeypatch, capsys) -> None:
    received = []

    def simulate(output_dir, trials, seed):
        received.append((output_dir, trials, seed))
        return [output_dir / "result.json"]

    monkeypatch.setitem(cli_commands.SIMULATION_COMMANDS, "review-canary-power", simulate)
    args = SimpleNamespace(command="review-canary-power", trials=17, seed=42)
    assert cli_commands.run_local_command(args, None, tmp_path)
    assert received == [(tmp_path, 17, 42)]
    assert str(tmp_path / "result.json") in capsys.readouterr().out
