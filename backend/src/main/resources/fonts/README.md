# Specification PDF font

`Pretendard-Regular.ttf` is the unmodified static alternative TrueType font from
the existing frontend `pretendard` npm package, version 1.3.9:
`dist/public/static/alternative/Pretendard-Regular.ttf`.

- Upstream: https://github.com/orioncactus/pretendard
- Copyright (c) 2021, Kil Hyung-jin
- Reserved Font Name: Pretendard
- License: SIL Open Font License 1.1, retained in `OFL.txt`
- SHA-256: `6d0af5258997aec7354a6e340fc2325ba321c410ca48b3af858c8c3d6e92a324`

The backend bundles the font so PDF generation does not depend on system fonts,
frontend installation, external requests, or paid AI. PDFBox embeds only the
glyphs used in each PDF. Unsupported glyphs and unsafe control/format characters
are represented visibly as `[U+XXXX]` (or a longer Unicode code point), instead
of silently dropping content or failing the complete download. CRLF/CR and
Unicode line/paragraph separators become line breaks; tabs become four spaces.
All input is rendered as plain literal text, never parsed as HTML or Markdown.
