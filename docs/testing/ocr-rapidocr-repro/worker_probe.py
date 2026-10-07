"""Candidate feasibility only; use the unchanged production native pipe guard."""
import io
import json
import resource
import sys
import time

started = time.monotonic()
resource.setrlimit(resource.RLIMIT_AS, (512 * 1024**2, 512 * 1024**2))
resource.setrlimit(resource.RLIMIT_CPU, (12, 12))
resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
result = {"success": False, "stage": "worker_import"}
try:
    sys.path.insert(0, "/app/src")
    from PIL import Image, ImageOps
    from attachments.ocr import run_native
    result["stage"] = "preprocess"
    with Image.open(io.BytesIO(sys.stdin.buffer.read())) as picture:
        with ImageOps.exif_transpose(picture) as oriented:
            oriented.thumbnail((2000, 2000))
            with oriented.convert("RGBA") as rgba, Image.new("RGBA", oriented.size, "white") as background:
                background.alpha_composite(rgba)
                with background.convert("RGB") as rgb:
                    stream = io.BytesIO(); rgb.save(stream, format="PNG")
    result["preprocess_including_import_sec"] = time.monotonic() - started
    result["stage"] = "native"
    before = time.monotonic()
    output = run_native([sys.executable, "-I", "/opt/feasibility/native_probe.py"], stream.getvalue(),
                        deadline=started + 8, max_output=160_000)
    result["native_wrapper_sec"] = time.monotonic() - before
    result["native"] = json.loads(output)
    result["success"] = result["native"]["success"]
except BaseException as error:
    result["error_type"] = type(error).__name__
    result["error"] = str(error)[:2000]
    result["reason"] = getattr(error, "reason", None)
finally:
    result["worker_wall_sec"] = time.monotonic() - started
    result["worker_peak_rss_kib"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    result["native_peak_rss_kib"] = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    result["limits"] = {n: resource.getrlimit(getattr(resource, n)) for n in ("RLIMIT_AS", "RLIMIT_CPU", "RLIMIT_FSIZE")}
    print(json.dumps(result, ensure_ascii=True))
