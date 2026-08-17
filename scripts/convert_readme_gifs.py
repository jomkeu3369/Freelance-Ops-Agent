from __future__ import annotations

import argparse
import os
import subprocess
from pathlib import Path

import imageio_ffmpeg


VIDEO_TARGETS = {
    "고객정보입력.mp4": "client-profile.gif",
    "프로젝트입력.mp4": "project-intake.gif",
    "프로젝트분석.mp4": "ai-analysis.gif",
    "프로젝트사람평가.mp4": "human-review.gif",
    "프로젝트결과검토.mp4": "proposal-review.gif"
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert product recordings into README-friendly GIF files."
    )
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=Path.home() / "Desktop"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("docs/assets/readme")
    )
    parser.add_argument(
        "--width",
        type=int,
        default=960
    )
    parser.add_argument(
        "--fps",
        type=int,
        default=20
    )
    return parser.parse_args()


def convert_video(input_path: Path, output_path: Path, width: int, fps: int) -> None:
    ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
    temporary_path = output_path.with_suffix(".tmp.gif")
    filter_value = (
        f"fps={fps},scale={width}:-2:flags=lanczos,split[video][palette_source];"
        "[palette_source]palettegen=max_colors=256:stats_mode=diff[palette];"
        "[video][palette]paletteuse=dither=none:diff_mode=rectangle"
    )
    command = [
        ffmpeg_path,
        "-y",
        "-loglevel",
        "error",
        "-i",
        str(input_path),
        "-filter_complex",
        filter_value,
        "-loop",
        "0",
        str(temporary_path)
    ]

    try:
        subprocess.run(
            command,
            check=True
        )
        os.replace(
            temporary_path,
            output_path
        )
    finally:
        temporary_path.unlink(
            missing_ok=True
        )


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(
        parents=True,
        exist_ok=True
    )

    missing_sources = [
        args.source_dir / source_name
        for source_name in VIDEO_TARGETS
        if not (args.source_dir / source_name).is_file()
    ]
    if missing_sources:
        missing_list = "\n".join(str(path) for path in missing_sources)
        raise FileNotFoundError(f"Missing source videos:\n{missing_list}")

    for source_name, target_name in VIDEO_TARGETS.items():
        input_path = args.source_dir / source_name
        output_path = args.output_dir / target_name
        print(f"Converting {input_path.name} -> {output_path}")
        convert_video(
            input_path,
            output_path,
            args.width,
            args.fps
        )


if __name__ == "__main__":
    main()
