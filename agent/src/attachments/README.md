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
- PDF: preserve extracted text layers and OCR up to three candidate pages. A page
  is a candidate when its text is empty, large painted rasters cover at least 25%
  of its media box, or bounded raster inspection is inconclusive. This includes
  scanned bodies below native titles and long native introductions
- Raster inspection reads placement metadata/content operators, not image pixels.
  Nested painted Forms and inline images are included. Limits are 8 nested levels,
  64 Form visits, 5,000 operators, 256 KiB per content stream and 1 MiB inspected
  stream data per page. Cycles/limits are `UNKNOWN`, never proof of no scan
- This area heuristic can miss small scans, annotations and clipping/overlap cases.
  Those limitations and the unchanged three-unit sampling are explicit. It does
  not provide full-document or visual coverage
- Whole-page OCR is labelled separately from native text. Only an exact native
  prefix is removed once (whitespace may differ); fuzzy matching and numeric-only
  removal are forbidden. Remaining OCR may overlap native text and is not
  independent corroboration. Existing native text survives empty/failed OCR
- `ocrLanguage`: `mixed` (default `eng+kor`), `ko` (`kor`), `en` (`eng`).
  `ocrLayout`: `general` (default PSM 3), `singleblock` (PSM 6). All arguments are
  fixed mappings; there is no language detection, arbitrary CLI argument or
  silent fallback when a requested pack is missing
- Structured `coverage` has one ordered entry per PDF page/image frame, separating
  native text/raster status, OCR attempt, completion, empty result, failure and
  skip reason. An empty successful OCR call is completed; a failed call is only
  attempted. Initialization failure does not claim any page/frame was attempted
- A single LocalOcr instance shares its eight-second initialization/raster/OCR
  deadline across the attachment. Command/tool failures preserve prior output;
  an exhausted budget marks remaining selected units skipped
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

Also run `tests/test_attachment_coverage.py` for hybrid PDF, metadata bounds,
option mapping, missing packs, partial failure, 30-page/60-frame sampling and
historical JSON compatibility regressions.

## Contract and rollout compatibility

Missing OCR option/coverage fields in historical extraction JSON default to
`mixed`, `general`, and `[]` in Python and Java. Empty coverage means unavailable
historical metadata, not complete reading. New fields are optional in OpenAPI/TS.
Python still rejects unknown fields (`extra=forbid`). This is an additive stored
data migration, with no SQL change, but old running Agent processes cannot accept
new OCR request fields. Coordinate the Agent/backend contract update before
enabling the new frontend; do not route new requests/runs to old Agent instances.
The backend rejects a response whose echoed options differ from the request.
Rollback to old strict readers requires draining new staging entries and avoiding
replaying new START payloads into old readers, or a compatible rollback build.
No production rollout is performed by this implementation task.

Native OCR smoke tests require installed Tesseract and Poppler. They generate
synthetic printed text in memory and cover PNG, JPG, animated GIF, and a scanned PDF
inside the actual resource-limited worker. Missing binaries explicitly skip these
smoke tests; they must run in a Linux deployment verification environment.

References: [Tesseract CLI](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html),
[Tesseract installation](https://tesseract-ocr.github.io/tessdoc/Installation.html),
[Poppler project](https://poppler.freedesktop.org/).
