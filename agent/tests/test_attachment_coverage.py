"""Synthetic coverage/option regressions; no documents or downloaded fixtures."""

import io
import os

import pytest
from pydantic import ValidationError
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, FloatObject, NameObject, NumberObject

from attachments import reader
from attachments.ocr import LocalOcr, OcrUnavailable
from attachments.pdf_coverage import additional_ocr, raster_kind
from attachments.router import FileInput, run_reader
from contracts import AttachmentText
from test_attachment_ocr import NATIVE_AVAILABLE, FakeOcr, file, image_bytes


def synthetic_pdf(native="HEADER", scale=1000, nested=False, inline=False, cycle=False, pages=1):
    writer = PdfWriter()
    for _ in range(pages):
        page = writer.add_blank_page(width=1000, height=1000)
        font = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
        resources = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
        )
        escaped = native.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        contents = f"BT /F1 12 Tf 10 980 Td ({escaped}) Tj ET\n".encode()
        if scale:
            image = DecodedStreamObject()
            image.set_data(b"\xff" * 12)
            image.update(
                {
                    NameObject("/Type"): NameObject("/XObject"),
                    NameObject("/Subtype"): NameObject("/Image"),
                    NameObject("/Width"): NumberObject(2),
                    NameObject("/Height"): NumberObject(2),
                    NameObject("/ColorSpace"): NameObject("/DeviceRGB"),
                    NameObject("/BitsPerComponent"): NumberObject(8),
                }
            )
            objects = DictionaryObject({NameObject("/Im"): writer._add_object(image)})
            drawing = b"BI /W 2 /H 2 /CS /RGB /BPC 8 ID " + b"\xff" * 12 + b" EI\n" if inline else b"/Im Do\n"
            if nested or cycle:
                form = DecodedStreamObject()
                form.set_data(b"/Cycle Do\n" if cycle else drawing)
                form.update(
                    {
                        NameObject("/Subtype"): NameObject("/Form"),
                        NameObject("/Resources"): DictionaryObject({NameObject("/XObject"): objects}),
                        NameObject("/BBox"): ArrayObject(
                            [FloatObject(0), FloatObject(0), FloatObject(1), FloatObject(1)]
                        ),
                    }
                )
                reference = writer._add_object(form)
                objects[NameObject("/Cycle" if cycle else "/Form")] = reference
                drawing = b"/Cycle Do\n" if cycle else b"/Form Do\n"
            resources[NameObject("/XObject")] = objects
            contents += f"q {scale} 0 0 {scale} 0 0 cm\n".encode() + drawing + b"Q\n"
        stream = DecodedStreamObject()
        stream.set_data(contents)
        page[NameObject("/Resources")] = resources
        page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


@pytest.mark.parametrize("native", ["HEADER", "Long introduction " * 100])
@pytest.mark.parametrize("nested,inline", [(False, False), (True, False), (False, True), (True, True)])
def test_hybrid_scan_is_read_even_with_long_native_text(monkeypatch, native, nested, inline):
    class Ocr(FakeOcr):
        def read_pdf_page(self, payload, page):
            return native + "\nInvoice body 120 USD"

    monkeypatch.setattr(reader, "LocalOcr", Ocr)
    result = reader.extract(file("hybrid.pdf", synthetic_pdf(native, nested=nested, inline=inline)))
    assert "Invoice body 120 USD" in result["text"]
    assert result["text"].count(native.strip()) == 1
    unit = result["coverage"][0]
    assert unit["nativeStatus"] == "TEXT" and unit["rasterStatus"] == "LARGE"
    assert unit["ocrAttempted"] and unit["ocrCompleted"] and unit["ocrStatus"] == "READ"
    AttachmentText.model_validate(result)


@pytest.mark.parametrize("scale,reason", [(0, "TEXT_ONLY"), (40, "SMALL_RASTER")])
def test_native_text_and_small_logo_do_not_start_ocr(monkeypatch, scale, reason):
    def forbidden(*args):
        pytest.fail("Text-only/small-logo page must not initialize OCR")

    monkeypatch.setattr(reader, "LocalOcr", forbidden)
    result = reader.extract(file("text.pdf", synthetic_pdf("Invoice 120 USD", scale)))
    assert "Invoice 120 USD" in result["text"]
    assert result["coverage"][0]["reason"] == reason
    assert not result["coverage"][0]["ocrAttempted"]


def test_cycle_and_inspection_limit_are_unknown_without_decoding_images():
    page = PdfReader(io.BytesIO(synthetic_pdf(cycle=True))).pages[0]
    assert raster_kind(page) == "UNKNOWN"
    page = PdfReader(io.BytesIO(synthetic_pdf())).pages[0]
    stream = DecodedStreamObject()
    stream.set_data(b" " * 262_145)
    page[NameObject("/Contents")] = stream
    assert raster_kind(page) == "UNKNOWN"


def test_existing_ocr_layer_is_preserved_without_duplicate_evidence(monkeypatch):
    class Ocr(FakeOcr):
        def read_pdf_page(self, payload, page):
            return "Invoice total 120 USD"

    monkeypatch.setattr(reader, "LocalOcr", Ocr)
    result = reader.extract(file("searchable.pdf", synthetic_pdf("Invoice total 120 USD")))
    assert result["text"].rstrip() == "[Page 1]\nInvoice total 120 USD"
    assert result["coverage"][0]["reason"] == "DUPLICATE_ONLY"
    assert result["status"] == "PARTIAL"


def test_duplicate_removal_is_exact_prefix_only_and_preserves_repeated_numbers():
    assert additional_ocr("HEADER", "HEADER\n120 USD\n120 USD") == "120 USD\n120 USD"
    assert additional_ocr("120", "120\n120") == "120\n120"
    assert additional_ocr("Total 120 USD", "Total 121 USD") == "Total 121 USD"
    assert additional_ocr("HEADER", "Body\nHEADER") == "Body\nHEADER"
    assert additional_ocr("Account AB12", "Account AB12\nAccount AB12") == "Account AB12"


@pytest.mark.parametrize("failure", ["empty", "error", "language"])
def test_hybrid_failure_preserves_native_text(monkeypatch, failure):
    class Ocr(FakeOcr):
        def __init__(self, *args):
            if failure == "language":
                raise OcrUnavailable("The requested local OCR language pack is unavailable.", "LANGUAGE_UNAVAILABLE")

        def read_pdf_page(self, payload, page):
            if failure == "error":
                raise OcrUnavailable("A local OCR tool could not read the content.")
            return ""

    monkeypatch.setattr(reader, "LocalOcr", Ocr)
    result = reader.extract(file("hybrid.pdf", synthetic_pdf()))
    assert result["text"].rstrip() == "[Page 1]\nHEADER"
    unit = result["coverage"][0]
    assert unit["ocrStatus"] == {"empty": "EMPTY", "error": "FAILED", "language": "SKIPPED"}[failure]
    assert unit["ocrAttempted"] is (failure != "language")
    assert unit["ocrCompleted"] is (failure == "empty")
    AttachmentText.model_validate(result)


@pytest.mark.parametrize("budget", [False, True])
def test_one_shared_engine_and_second_failure_preserve_earlier_output(monkeypatch, budget):
    instances = []

    class Ocr(FakeOcr):
        def __init__(self, *args):
            instances.append(self)
            self.calls = 0

        def read_image(self, picture):
            self.calls += 1
            if self.calls == 2:
                raise OcrUnavailable(
                    "The local OCR time budget was reached."
                    if budget
                    else "A local OCR tool could not read the content.",
                    "BUDGET_EXHAUSTED" if budget else "TOOL_FAILED",
                )
            return f"Frame {self.calls}"

    monkeypatch.setattr(reader, "LocalOcr", Ocr)
    result = reader.extract(file("frames.gif", image_bytes("GIF", 3)))
    assert len(instances) == 1
    assert "Frame 1" in result["text"]
    assert result["coverage"][1]["ocrStatus"] == "FAILED"
    assert result["coverage"][2]["ocrStatus"] == ("SKIPPED" if budget else "READ")
    assert len(result["notice"]) <= 1000
    AttachmentText.model_validate(result)


@pytest.mark.parametrize("kind,count", [("pdf", 30), ("gif", 60)])
def test_all_units_have_explicit_coverage_and_sampling_is_still_three(monkeypatch, kind, count):
    monkeypatch.setattr(reader, "LocalOcr", FakeOcr)
    payload = synthetic_pdf("HEADER", pages=count) if kind == "pdf" else image_bytes("GIF", count)
    result = reader.extract(file(f"many.{kind}", payload))
    assert len(result["coverage"]) == count
    assert [unit["index"] for unit in result["coverage"] if unit["ocrAttempted"]] == [1, (count - 1) // 2 + 1, count]
    assert sum(unit["reason"] == "SAMPLED_OUT" for unit in result["coverage"]) == count - 3
    assert len(result["notice"]) <= 1000
    AttachmentText.model_validate(result)


@pytest.mark.parametrize(
    "field,value",
    [
        ("ocrLanguage", "eng"),
        ("ocrLanguage", "en --psm 6"),
        ("ocrLayout", "6"),
        ("ocrLayout", "auto"),
        ("ocrLanguage", None),
        ("ocrLanguage", []),
    ],
)
def test_disallowed_options_are_rejected_before_tools(field, value):
    data = {**file("x.png", image_bytes()), field: value}
    with pytest.raises(ValidationError):
        FileInput.model_validate(data)
    with pytest.raises(ValueError, match="OCR_OPTIONS_UNSUPPORTED"):
        reader.extract(data)


def test_old_json_has_defaults_and_new_json_round_trips():
    old = reader.extract(file("old.txt", b"text"))
    for key in ("ocrLanguage", "ocrLayout", "coverage"):
        del old[key]
    restored = AttachmentText.model_validate(old)
    assert restored.ocr_language == "mixed" and restored.ocr_layout == "general" and restored.coverage == []
    assert FileInput.model_validate(file("old.txt", b"text")).ocr_layout == "general"


@pytest.mark.skipif(os.name != "posix", reason="Native tools are Linux-only")
@pytest.mark.parametrize("language,packs", [("en", "eng"), ("ko", "kor"), ("mixed", "eng+kor")])
@pytest.mark.parametrize("layout,psm", [("general", "3"), ("singleblock", "6")])
def test_explicit_options_map_to_fixed_arguments(monkeypatch, language, packs, layout, psm):
    calls = []
    monkeypatch.setattr("attachments.ocr.shutil.which", lambda command: "/usr/bin/tesseract")

    def native(arguments, payload, **options):
        calls.append(arguments)
        return b"eng\nkor\n" if "--list-langs" in arguments else b"text"

    monkeypatch.setattr("attachments.ocr.run_native", native)
    engine = LocalOcr(language, layout)
    from PIL import Image

    with Image.new("RGB", (100, 100)) as picture:
        engine.read_image(picture)
    assert calls[-1] == ["/usr/bin/tesseract", "stdin", "stdout", "-l", packs, "--psm", psm]


@pytest.mark.skipif(os.name != "posix", reason="Native tools are Linux-only")
def test_requested_missing_pack_does_not_fall_back(monkeypatch):
    monkeypatch.setattr("attachments.ocr.shutil.which", lambda command: "/usr/bin/tesseract")
    monkeypatch.setattr("attachments.ocr.run_native", lambda *args, **kwargs: b"eng\n")
    with pytest.raises(OcrUnavailable, match="requested") as error:
        LocalOcr("ko")
    assert error.value.reason == "LANGUAGE_UNAVAILABLE"
    with pytest.raises(OcrUnavailable):
        LocalOcr()


async def test_worker_rejects_option_error_with_fixed_code():
    data = file("x.txt", b"text")
    data["ocrLanguage"] = "bad"
    # Bypass only the parent model in this adversarial test of the worker boundary.
    result = await run_reader(
        FileInput.model_construct(
            **{"name": "x.txt", "media_type": "", "base64": data["base64"], "ocr_language": "bad"}
        )
    )
    assert result == {"error": "OCR_OPTIONS_UNSUPPORTED"}


def inspection_limit_pdf(operators=False):
    writer = PdfWriter()
    page = writer.add_page(PdfReader(io.BytesIO(synthetic_pdf(scale=0))).pages[0])
    content = page.get_contents().get_data()
    stream = DecodedStreamObject()
    stream.set_data(content + (b"q Q " * 60_000 if operators else b" " * 262_145))
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def test_dense_stream_gate_avoids_raster_parser(monkeypatch):
    from pypdf.generic import ContentStream

    page = PdfReader(io.BytesIO(inspection_limit_pdf(True))).pages[0]

    def forbidden(self):
        pytest.fail("Dense stream must not be parsed again for raster inspection")

    monkeypatch.setattr(ContentStream, "operations", property(forbidden))
    assert raster_kind(page) == "UNKNOWN"


@pytest.mark.parametrize("operators", [False, True])
def test_inspection_limits_preserve_native_text_on_failed_ocr(monkeypatch, operators):
    class Ocr(FakeOcr):
        def read_pdf_page(self, payload, page):
            raise OcrUnavailable("A local OCR tool could not read the content.")

    monkeypatch.setattr(reader, "LocalOcr", Ocr)
    result = reader.extract(file("metadata.pdf", inspection_limit_pdf(operators)))
    assert result["text"].rstrip() == "[Page 1]\nHEADER"
    assert result["coverage"][0]["rasterStatus"] == "UNKNOWN"
    assert result["coverage"][0]["nativeStatus"] == "TEXT"
    assert result["coverage"][0]["ocrStatus"] == "FAILED"
    AttachmentText.model_validate(result)


@pytest.mark.skipif(not NATIVE_AVAILABLE, reason="Requires production Linux OCR tools")
async def test_dense_metadata_preserves_native_text_in_actual_limited_worker():
    result = await run_reader(FileInput.model_validate(file("metadata.pdf", inspection_limit_pdf(True))))
    assert result["status"] == "PARTIAL", result
    assert "HEADER" in result["text"]
    assert result["coverage"][0]["rasterStatus"] == "UNKNOWN"
    assert result["coverage"][0]["nativeStatus"] == "TEXT"
    AttachmentText.model_validate(result)
