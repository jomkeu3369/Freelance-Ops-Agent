from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

from .cli_arguments import _parser as _parser
from .cli_commands import run_local_command, run_paid_command
from .config import load_config


def main() -> None:
    load_dotenv()
    args = _parser().parse_args()
    config = load_config(args.config)
    os.environ["LANGSMITH_PROJECT"] = str(config.langsmith_project)
    output_dir = Path(args.output_dir).resolve()
    if not run_local_command(args, config, output_dir):
        run_paid_command(args, config, output_dir)


if __name__ == "__main__":
    main()
