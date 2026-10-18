from __future__ import annotations

import ast
import io
import tokenize
from pathlib import Path

STYLE_PATHS = sorted(
    path for path in Path(__file__).parent.glob("*.py") if not path.name.startswith("test_")
)


def test_function_definitions_use_horizontal_layout() -> None:
    violations = []
    for path in STYLE_PATHS:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
                continue
            arguments = [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]
            if node.args.vararg is not None:
                arguments.append(node.args.vararg)
            if node.args.kwarg is not None:
                arguments.append(node.args.kwarg)
            if any(argument.lineno != node.lineno for argument in arguments):
                violations.append((path.name, node.lineno))
    assert violations == []


def test_function_calls_have_no_trailing_comma() -> None:
    violations = []
    ignored = {tokenize.NL, tokenize.NEWLINE, tokenize.COMMENT, tokenize.ENDMARKER}
    for path in STYLE_PATHS:
        source = path.read_text(encoding="utf-8")
        for node in ast.walk(ast.parse(source)):
            if not isinstance(node, ast.Call):
                continue
            fragment = ast.get_source_segment(source, node)
            tokens = [
                token
                for token in tokenize.generate_tokens(io.StringIO(fragment).readline)
                if token.type not in ignored
            ]
            if len(tokens) > 1 and tokens[-2].string == ",":
                violations.append((path.name, node.lineno))
    assert violations == []
