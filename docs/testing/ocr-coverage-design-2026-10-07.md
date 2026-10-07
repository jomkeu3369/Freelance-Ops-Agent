# OCR coverage and explicit options, first implementation

Base: remote `main` `988d7581e857ec74c0415a269939a9681d8c920a`.
Branch: `codex/ocr-language-layout-coverage-20261007`.

The observed failure was a PDF containing a native HEADER over a scanned body:
the previous reader considered that page already read and skipped its body.
The implementation preserves native text, checks bounded painted raster placement,
and includes large/inconclusive raster pages in the existing three-unit OCR sample.
It also exposes explicit Korean/English/mixed and general/single-block options
through the UI, multipart controller, trusted reader request and stored extraction.

Default mixed/general maps to the previous production eng+kor/PSM 3. No engine
replacement, global PSM 6 switch, language-detection claim or external provider is
introduced. Structured coverage distinguishes attempt from successful completion,
including successful empty output. Native/earlier OCR text survives local failure.
Changing an option invalidates the preview receipt and confirmation; reading must
be repeated and confirmed. AbortSignal remains the sixth API argument.

Limits remain 2 MiB input, 16 MP/frame, 32 MP decoded aggregate, 30 PDF pages,
60 image frames, 2,000 px OCR edge, three OCR units, 40,000 output characters,
three seconds/native command, eight shared OCR seconds, 12 CPU seconds,
512 MiB worker address space, 15 seconds/API extraction and two workers. Originals
and rasterized images stay in memory. Overflow is rejected without truncation.

The raster threshold is a conservative heuristic, not proof of coverage. Inspection
byte/operator checks follow decompression/parsing, so they are traversal limits,
not strict preprocessing bounds. A whitespace-token preflight gate avoids a second
raster parse of excessively dense streams, but prior native-text parsing and
decompression remain protected by the unchanged worker limits. Small
rasters/annotations and unsampled units may contain unread text. Clipped and
overlapping raster bounding boxes can overestimate area. Existing searchable
scans may be OCR-read again; exact native prefixes are removed once and residual
OCR is explicitly marked as potentially overlapping, not corroborating evidence.
Amounts/identifiers are never fuzzy-deduplicated. There is no full-document OCR.

Historical JSON defaults and coordinated release/rollback limits are described in
`agent/src/attachments/README.md`. SQL, authentication, DB, paid API/cost settings,
login work, production main, PRs and deployment are outside this change.

Validation evidence is generated in the isolated task folder. The implementation
handoff will state passed/failed/not-run checks and distinguish production source
equivalence from an unknown deployed image digest. Synthetic input binaries and
raw evaluation documents are excluded from Git.
