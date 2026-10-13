package com.freelanceops.backend.domain.specification.service;

import org.apache.pdfbox.cos.COSArray;
import org.apache.pdfbox.cos.COSString;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDDocumentInformation;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.springframework.stereotype.Component;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/** Local, literal-text PDF export of one immutable confirmed specification. */
@Component
public class SpecificationPdfRenderer {
    private static final String FONT_RESOURCE = "/fonts/Pretendard-Regular.ttf";
    private static final int MAX_PAGES = 100;
    private static final float MARGIN = 48;
    private static final float CONTENT_BOTTOM = 58;
    private static final float CONTENT_WIDTH = PDRectangle.A4.getWidth() - 2 * MARGIN;
    private static final Color INK = new Color(28, 35, 46);
    private static final Color MUTED = new Color(88, 99, 113);

    public byte[] render(String title, int revisionNumber, String confirmedContent,
                         String contentSha256, Instant confirmedAt) {
        Objects.requireNonNull(title, "title");
        Objects.requireNonNull(confirmedContent, "confirmedContent");
        Objects.requireNonNull(contentSha256, "contentSha256");
        Objects.requireNonNull(confirmedAt, "confirmedAt");
        if (revisionNumber < 1 || !contentSha256.matches("[a-fA-F0-9]{64}")) {
            throw new IllegalArgumentException("A confirmed revision and SHA-256 are required");
        }

        try (PDDocument document = new PDDocument(); InputStream fontInput = fontInput()) {
            PDType0Font font = PDType0Font.load(document, fontInput, true);
            TextEncoding encoding = new TextEncoding(font);
            String safeTitle = encoding.safeText(title);
            String safeContent = encoding.safeText(confirmedContent);
            configureMetadata(document, safeTitle, revisionNumber, confirmedContent,
                contentSha256, confirmedAt);

            try (Layout layout = new Layout(document, font, encoding)) {
                layout.text("확정 명세서", 9, MUTED);
                layout.gap(6);
                layout.text(safeTitle, 18, INK);
                layout.gap(8);
                layout.text("Immutable revision: " + revisionNumber, 9, MUTED);
                layout.text("Content SHA-256: " + contentSha256, 9, MUTED);
                layout.text("Confirmed at (UTC): " + confirmedAt, 9, MUTED);
                layout.text("Unsupported characters appear as [U+XXXX].", 8, MUTED);
                layout.gap(18);
                layout.text(safeContent, 11, INK);
            }
            addPageNumbers(document, font, revisionNumber);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            document.save(output);
            return output.toByteArray();
        } catch (IOException exception) {
            // Never put the customer's specification into an error message or log.
            throw new UncheckedIOException("Unable to render specification PDF", exception);
        }
    }

    private static InputStream fontInput() throws IOException {
        InputStream input = SpecificationPdfRenderer.class.getResourceAsStream(FONT_RESOURCE);
        if (input == null) {
            throw new IOException("Bundled specification PDF font is missing");
        }
        return input;
    }

    private static void configureMetadata(PDDocument document, String title, int revisionNumber,
                                          String content, String hash, Instant confirmedAt) {
        PDDocumentInformation information = document.getDocumentInformation();
        information.setTitle(title);
        information.setCreator("Freelance Ops Agent");
        information.setSubject("Confirmed specification, immutable revision " + revisionNumber);
        information.setCustomMetadataValue("RevisionNumber", Integer.toString(revisionNumber));
        information.setCustomMetadataValue("ContentSHA256", hash);
        information.setCustomMetadataValue("ConfirmedAt", confirmedAt.toString());
        GregorianCalendar date = GregorianCalendar.from(ZonedDateTime.ofInstant(confirmedAt, ZoneOffset.UTC));
        information.setCreationDate(date);
        information.setModificationDate(date);

        // PDFBox otherwise generates the trailer ID from the current clock. Fix all
        // variable metadata to the immutable inputs so the same revision is reproducible.
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (String input : new String[]{title, Integer.toString(revisionNumber), content, hash, confirmedAt.toString()}) {
                byte[] bytes = input.getBytes(StandardCharsets.UTF_8);
                digest.update(Integer.toString(bytes.length).getBytes(StandardCharsets.US_ASCII));
                digest.update((byte) ':');
                digest.update(bytes);
            }
            COSArray id = new COSArray();
            byte[] value = digest.digest();
            id.add(new COSString(value));
            id.add(new COSString(value));
            document.getDocument().setDocumentID(id);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private static void addPageNumbers(PDDocument document, PDType0Font font, int revisionNumber) throws IOException {
        int total = document.getNumberOfPages();
        for (int index = 0; index < total; index++) {
            try (PDPageContentStream stream = new PDPageContentStream(document, document.getPage(index),
                PDPageContentStream.AppendMode.APPEND, true, true)) {
                stream.setStrokingColor(new Color(214, 219, 226));
                stream.setLineWidth(0.5f);
                stream.moveTo(MARGIN, 43);
                stream.lineTo(PDRectangle.A4.getWidth() - MARGIN, 43);
                stream.stroke();
                stream.beginText();
                stream.setFont(font, 8);
                stream.setNonStrokingColor(MUTED);
                stream.newLineAtOffset(MARGIN, 29);
                stream.showText("Revision " + revisionNumber + " | " + (index + 1) + " / " + total);
                stream.endText();
            }
        }
    }

    public static final class PdfLimitExceededException extends RuntimeException {
        public PdfLimitExceededException() { super("specification PDF exceeds the 100-page export limit"); }
    }

    private static final class TextEncoding {
        private final PDType0Font font;
        private final Map<Integer, String> replacements = new HashMap<>();
        private final Map<Integer, Float> widths = new HashMap<>();

        private TextEncoding(PDType0Font font) {
            this.font = font;
        }

        private String safeText(String text) throws IOException {
            String normalized = text.replace("\r\n", "\n").replace('\r', '\n')
                .replace('\u2028', '\n').replace('\u2029', '\n');
            StringBuilder result = new StringBuilder(normalized.length());
            for (int offset = 0; offset < normalized.length();) {
                int codePoint = normalized.codePointAt(offset);
                offset += Character.charCount(codePoint);
                if (codePoint == '\n') {
                    result.append('\n');
                } else if (codePoint == '\t') {
                    result.append("    ");
                } else {
                    String replacement = replacements.get(codePoint);
                    if (replacement == null) {
                        replacement = replacement(codePoint);
                        replacements.put(codePoint, replacement);
                    }
                    result.append(replacement);
                }
            }
            return result.toString();
        }

        private String replacement(int codePoint) throws IOException {
            String character = new String(Character.toChars(codePoint));
            int type = Character.getType(codePoint);
            if (!Character.isISOControl(codePoint) && type != Character.FORMAT && type != Character.SURROGATE) {
                try {
                    font.encode(character);
                    return character;
                } catch (IllegalArgumentException unsupportedGlyph) {
                    // An explicit, printable representation preserves unsupported content.
                }
            }
            return String.format(Locale.ROOT, "[U+%04X]", codePoint);
        }

        private float width(int codePoint, float fontSize) throws IOException {
            Float width = widths.get(codePoint);
            if (width == null) {
                width = font.getStringWidth(new String(Character.toChars(codePoint)));
                widths.put(codePoint, width);
            }
            return width * fontSize / 1000;
        }

        private float width(String text, float fontSize) throws IOException {
            float total = 0;
            for (int offset = 0; offset < text.length();) {
                int codePoint = text.codePointAt(offset);
                total += width(codePoint, fontSize);
                offset += Character.charCount(codePoint);
            }
            return total;
        }
    }

    /** Metric-based wrapping, including long unbroken Korean/Unicode strings. */
    private static final class Layout implements AutoCloseable {
        private final PDDocument document;
        private final PDType0Font font;
        private final TextEncoding encoding;
        private PDPageContentStream stream;
        private float baseline;

        private Layout(PDDocument document, PDType0Font font, TextEncoding encoding) {
            this.document = document;
            this.font = font;
            this.encoding = encoding;
        }

        private void text(String text, float fontSize, Color color) throws IOException {
            // Keep empty lines, including trailing ones. Oversized exports fail explicitly; no content is truncated.
            for (String paragraph : text.split("\n", -1)) {
                StringBuilder line = new StringBuilder();
                float lineWidth = 0;
                int lastSpace = -1;
                for (int offset = 0; offset < paragraph.length();) {
                    int codePoint = paragraph.codePointAt(offset);
                    float characterWidth = encoding.width(codePoint, fontSize);
                    while (!line.isEmpty() && lineWidth + characterWidth > CONTENT_WIDTH) {
                        if (lastSpace > 0) {
                            drawLine(line.substring(0, lastSpace), fontSize, color);
                            line = new StringBuilder(line.substring(lastSpace));
                            lineWidth = encoding.width(line.toString(), fontSize);
                        } else {
                            drawLine(line.toString(), fontSize, color);
                            line.setLength(0);
                            lineWidth = 0;
                        }
                        lastSpace = -1;
                    }
                    line.appendCodePoint(codePoint);
                    lineWidth += characterWidth;
                    if (codePoint == ' ') {
                        lastSpace = line.length();
                    }
                    offset += Character.charCount(codePoint);
                }
                drawLine(line.toString(), fontSize, color);
            }
        }

        private void gap(float amount) {
            baseline -= amount;
        }

        private void drawLine(String text, float fontSize, Color color) throws IOException {
            if (stream == null || baseline < CONTENT_BOTTOM + fontSize) {
                if (stream != null) {
                    stream.close();
                }
                if (document.getNumberOfPages() >= MAX_PAGES) throw new PdfLimitExceededException();
                PDPage page = new PDPage(PDRectangle.A4);
                document.addPage(page);
                stream = new PDPageContentStream(document, page);
                baseline = PDRectangle.A4.getHeight() - MARGIN;
            }
            if (!text.isEmpty()) {
                stream.beginText();
                stream.setFont(font, fontSize);
                stream.setNonStrokingColor(color);
                stream.newLineAtOffset(MARGIN, baseline);
                stream.showText(text);
                stream.endText();
            }
            baseline -= fontSize * 1.55f;
        }

        @Override
        public void close() throws IOException {
            if (stream != null) {
                stream.close();
            }
        }
    }
}
