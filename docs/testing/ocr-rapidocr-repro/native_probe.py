"""Offline, cold detection/classification/Korean recognition under inherited limits."""
import json
import os
import resource
import sys
import time

started = time.perf_counter()
# The production native runner strips the outer environment; set single-thread
# numerical-library options before their first import inside this candidate CLI.
for key in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[key] = "1"
result = {"success": False, "stage": "import", "process_started_sec": started}
try:
    from rapidocr import EngineType, LangDet, LangRec, ModelType, OCRVersion, RapidOCR
    import cv2
    cv2.setNumThreads(1)
    result["imports_sec"] = time.perf_counter() - started
    result["stage"] = "engine_init"
    before = time.perf_counter()
    engine = RapidOCR(params={
        "Global.log_level": "critical", "Global.max_side_len": 2000,
        "Global.model_root_dir": "/opt/rapidmodels",
        "EngineConfig.onnxruntime.intra_op_num_threads": 1,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
        "EngineConfig.onnxruntime.enable_cpu_mem_arena": False,
        "EngineConfig.onnxruntime.use_cuda": False,
        "Det.engine_type": EngineType.ONNXRUNTIME, "Det.lang_type": LangDet.CH,
        "Det.model_type": ModelType.MOBILE, "Det.ocr_version": OCRVersion.PPOCRV5,
        "Det.model_path": "/opt/rapidmodels/ch_PP-OCRv5_det_mobile.onnx",
        "Cls.engine_type": EngineType.ONNXRUNTIME, "Cls.lang_type": LangDet.CH,
        "Cls.model_type": ModelType.MOBILE, "Cls.ocr_version": OCRVersion.PPOCRV5,
        "Cls.model_path": "/opt/rapidmodels/ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx",
        "Rec.engine_type": EngineType.ONNXRUNTIME, "Rec.lang_type": LangRec.KOREAN,
        "Rec.model_type": ModelType.MOBILE, "Rec.ocr_version": OCRVersion.PPOCRV5,
        "Rec.model_path": "/opt/rapidmodels/korean_PP-OCRv5_rec_mobile.onnx",
        "Rec.rec_batch_num": 1, "Cls.cls_batch_num": 1,
    })
    result["engine_init_sec"] = time.perf_counter() - before
    result["providers"] = {name: getattr(engine, name).session.session.get_providers() for name in ("text_det", "text_cls", "text_rec")}
    result["stage"] = "ocr"
    before = time.perf_counter()
    output = engine(sys.stdin.buffer.read())
    result["ocr_sec"] = time.perf_counter() - before
    result["prediction"] = "\n".join(output.txts or ())
    if not result["prediction"]:
        raise ValueError("EMPTY_RESULT")
    result["success"] = True
except BaseException as error:
    result["error_type"] = type(error).__name__
    result["error"] = str(error)[:2000]
finally:
    result["cold_native_sec"] = time.perf_counter() - started
    result["peak_rss_kib"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    result["limits"] = {n: resource.getrlimit(getattr(resource, n)) for n in ("RLIMIT_AS", "RLIMIT_CPU", "RLIMIT_FSIZE")}
    print(json.dumps(result, ensure_ascii=True))
