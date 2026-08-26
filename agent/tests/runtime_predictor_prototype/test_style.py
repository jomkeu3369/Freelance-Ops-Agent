from __future__ import annotations

import ast
import io
import tokenize
from pathlib import Path


STYLE_PATHS = (Path(__file__).with_name("prototype.py"), Path(__file__).with_name("plot_experiment.py"), Path(__file__).with_name("plot_ema_experiment.py"), Path(__file__).with_name("plot_gated_ema_experiment.py"), Path(__file__).with_name("plot_online_learning_experiment.py"), Path(__file__).with_name("scheduler_simulation.py"), Path(__file__).with_name("scheduler_evaluation.py"), Path(__file__).with_name("plot_scheduler_simulation.py"), Path(__file__).with_name("plot_scheduler_evaluation.py"), Path(__file__).with_name("streamlit_scheduler_simulation.py"))


def _trailing_comma_lines(path: Path) -> list[int]:
    source = path.read_text(encoding="utf-8")
    ignored = {tokenize.ENCODING, tokenize.ENDMARKER, tokenize.INDENT, tokenize.DEDENT, tokenize.NEWLINE, tokenize.NL, tokenize.COMMENT}
    previous: tokenize.TokenInfo | None = None
    violations: list[int] = []
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type in ignored:
            continue
        if token.string in (")", "]", "}") and previous is not None and previous.string == ",":
            violations.append(previous.start[0])
        previous = token
    return violations


def test_function_arguments_and_calls_use_horizontal_layout() -> None:
    multiline_calls: list[tuple[str, int]] = []
    multiline_definitions: list[tuple[str, int]] = []
    for path in STYLE_PATHS:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        multiline_calls.extend((path.name, node.lineno) for node in ast.walk(tree) if isinstance(node, ast.Call) and node.end_lineno != node.lineno)
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            arguments = [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]
            if node.args.vararg is not None:
                arguments.append(node.args.vararg)
            if node.args.kwarg is not None:
                arguments.append(node.args.kwarg)
            if any(argument.lineno != node.lineno for argument in arguments):
                multiline_definitions.append((path.name, node.lineno))

    assert multiline_calls == []
    assert multiline_definitions == []


def test_closing_delimiters_have_no_trailing_comma() -> None:
    violations = {path.name: lines for path in STYLE_PATHS if (lines := _trailing_comma_lines(path))}

    assert violations == {}
