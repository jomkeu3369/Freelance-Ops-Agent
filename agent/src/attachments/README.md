# Local attachment readers

The API validates delegated authority before it starts a private parser subprocess.
Original files and rasterized OCR images are passed in memory, not written to disk.
Extracted content is untrusted reference data and cannot authorize tools or actions.
No hosted OCR, paid model, embedding, or vision API is called by these readers.

## Free OCR deployment

The agent Dockerfile installs Poppler and Tesseract with English and Korean language
packs (`poppler-utils`, `tesseract-ocr`, `tesseract-ocr-eng`, `tesseract-ocr-kor`).
No Python OCR dependency is added. Non-container Linux development environments need
the same system packages. Missing tools/languages produce an explicit coverage
notice; text-layer PDF, TXT and CSV reading continue to work. OCR runs only in the
POSIX subprocess environment, where the worker and its native descendants can be
terminated together. Windows still supports the existing text readers and image
validation, with an OCR-unavailable notice.

## Coverage and limits

- JPG/PNG: local printed-text OCR, with image orientation and transparency handled
- GIF/animated PNG: validate all frames, then OCR up to three deterministic frames
  (first, middle, last), reporting the exact frame numbers and any omissions
- PDF: preserve extracted text layers and OCR up to three text-empty pages,
  reporting the exact page numbers. Images on pages that already contain a text
  layer are not separately OCR-read
- Tesseract uses only the installed `eng`/`kor` packs, and names the selected packs
  in every OCR coverage notice. It does not claim other language coverage
- OCR is always `PARTIAL` when text is found, or `UNSUPPORTED` when no text is
  obtained. OCR does not provide general image, chart, layout, handwriting, or
  animation understanding. The preview must be reviewed before sending
- Existing limits remain: 2 MiB/file, 40,000 output characters, 30 PDF pages,
  60 frames, 16 million pixels/frame, 32 million aggregate decoded frame pixels,
  two parser workers, 15-second request deadline, 512 MiB address-space limit,
  12 CPU seconds, and no filesystem writes for the worker
- OCR additionally scales each image/page to at most 2000 pixels per edge, limits
  each native command to 3 seconds and all OCR to 8 seconds, bounds pipe output,
  strips inherited credentials, and restricts native OCR to one OpenMP thread
- Overflow is rejected without truncation. OCR timeouts/tool failures preserve any
  already extracted text with explicit partial-coverage notices. Request timeout,
  cancellation, and abnormal worker exit terminate the whole POSIX process group

Run focused tests from `agent` with:

```sh
uv run --locked pytest tests/test_attachments.py tests/test_attachment_ocr.py
uv run --locked ruff check src/attachments tests/test_attachments.py tests/test_attachment_ocr.py
uv run --locked mypy --follow-imports=silent src/attachments
```

Native OCR smoke tests require installed Tesseract and Poppler. They generate
synthetic printed text in memory and cover PNG, JPG, animated GIF, and a scanned PDF
inside the actual resource-limited worker. Missing binaries explicitly skip these
smoke tests; they must run in a Linux deployment verification environment.

References: [Tesseract CLI](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html),
[Tesseract installation](https://tesseract-ocr.github.io/tessdoc/Installation.html),
[Poppler project](https://poppler.freedesktop.org/).
