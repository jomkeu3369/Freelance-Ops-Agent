package com.freelanceops.backend.domain.specification.service;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.time.Instant;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SpecificationPdfRendererTest {
    private static final String HASH = "a123456789abcdef".repeat(4);
    private static final Instant CONFIRMED_AT = Instant.parse("2026-10-13T16:00:00.123456Z");
    private final SpecificationPdfRenderer renderer = new SpecificationPdfRenderer();

    @Test
    void producesSelectableKoreanWithImmutableMetadataAndAnEmbeddedFont() throws IOException {
        byte[] bytes = renderer.render("고객 관리 기능 명세서", 7,
            "요구사항: 고객 이름과 문의 내용을 저장합니다.\n검증 기준: 한글 검색을 지원합니다.", HASH, CONFIRMED_AT);

        assertThat(bytes).startsWith("%PDF-".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
        try (PDDocument pdf = Loader.loadPDF(bytes)) {
            assertThat(new PDFTextStripper().getText(pdf)).contains(
                "고객 관리 기능 명세서", "요구사항: 고객 이름과 문의 내용을 저장합니다.",
                "검증 기준: 한글 검색을 지원합니다.", "Immutable revision: 7",
                "Content SHA-256: " + HASH, "Confirmed at (UTC): " + CONFIRMED_AT,
                "Revision 7 | 1 / 1");
            assertThat(pdf.getDocumentInformation().getCustomMetadataValue("RevisionNumber")).isEqualTo("7");
            assertThat(pdf.getDocumentInformation().getCustomMetadataValue("ContentSHA256")).isEqualTo(HASH);
            assertThat(pdf.getDocumentInformation().getCustomMetadataValue("ConfirmedAt")).isEqualTo(CONFIRMED_AT.toString());
            var resources = pdf.getPage(0).getResources();
            for (COSName name : resources.getFontNames()) {
                assertThat(resources.getFont(name)).isInstanceOf(PDType0Font.class);
                assertThat(resources.getFont(name).isEmbedded()).isTrue();
            }
        }
    }

    @Test
    void treatsMarkupAndXssLookingContentAsLiteralTextWithoutExecutableObjects() throws IOException {
        String content = "<script>alert('고객')</script>\n<img src=x onerror=alert(1)>\n"
            + "<scope>&amp; \"quotation\"</scope>\njavascript:alert(1)\n**확정 범위**";
        try (PDDocument pdf = Loader.loadPDF(renderer.render("<title>명세</title>", 1, content, HASH, CONFIRMED_AT))) {
            String text = new PDFTextStripper().getText(pdf);
            assertThat(text).contains("<title>명세</title>", "<script>alert('고객')</script>",
                "<img src=x onerror=alert(1)>", "<scope>&amp; \"quotation\"</scope>",
                "javascript:alert(1)", "**확정 범위**");
            assertThat(pdf.getDocumentCatalog().getCOSObject().containsKey(COSName.OPEN_ACTION)).isFalse();
            assertThat(pdf.getDocumentCatalog().getCOSObject().containsKey(COSName.AA)).isFalse();
            assertThat(pdf.getDocumentCatalog().getNames()).isNull();
            for (var page : pdf.getPages()) {
                assertThat(page.getAnnotations()).isEmpty();
                assertThat(page.getCOSObject().containsKey(COSName.AA)).isFalse();
            }
        }
    }

    @Test
    void paginatesAndRetainsEveryRequirementIncludingTheFinalLine() throws IOException {
        String content = IntStream.range(0, 350)
            .mapToObj(index -> "요구사항 " + index + ": 기능 범위와 검증 기준을 기록합니다.\n")
            .collect(java.util.stream.Collectors.joining()) + "마지막 완료 기준";
        try (PDDocument pdf = Loader.loadPDF(renderer.render("상세 명세서", 3, content, HASH, CONFIRMED_AT))) {
            assertThat(pdf.getNumberOfPages()).isGreaterThan(5);
            String text = new PDFTextStripper().getText(pdf);
            for (int index = 0; index < 350; index++) {
                assertThat(text).containsOnlyOnce("요구사항 " + index + ": 기능 범위와 검증 기준을 기록합니다.");
            }
            assertThat(text).contains("마지막 완료 기준", "Revision 3 | " + pdf.getNumberOfPages() + " / " + pdf.getNumberOfPages());
        }
    }

    @Test
    void wrapsLongUnbrokenUnicodeWithoutDroppingOrSplittingSurrogatePairs() throws IOException {
        String content = "한글기능".repeat(1600) + "🧪".repeat(80) + "끝";
        try (PDDocument pdf = Loader.loadPDF(renderer.render("긴 문자열", 2,
            "BEGINBODY\n" + content + "\nENDBODY", HASH, CONFIRMED_AT))) {
            assertThat(pdf.getNumberOfPages()).isGreaterThan(3);
            String extracted = bodyText(new PDFTextStripper().getText(pdf));
            assertThat(extracted).isEqualTo("한글기능".repeat(1600) + "[U+1F9EA]".repeat(80) + "끝");
            assertThat(extracted).doesNotContain("[U+D83E]", "[U+DDEA]");
        }
    }

    @Test
    void visiblyReplacesUnsupportedControlAndFormattingCharactersAndNormalizesLineBreaks() throws IOException {
        String content = "시작\u0000\u0001\u007F\u202E\u200D\uD800🧪\uDBFF\uDFFF끝\r\n"
            + "두번째\r세번째\u2028네번째\u2029다섯번째\t탭";
        try (PDDocument pdf = Loader.loadPDF(renderer.render("명세\u0000🧪", 1, content, HASH, CONFIRMED_AT))) {
            String text = new PDFTextStripper().getText(pdf);
            assertThat(text).contains("명세[U+0000][U+1F9EA]",
                "시작[U+0000][U+0001][U+007F][U+202E][U+200D][U+D800][U+1F9EA][U+10FFFF]끝",
                "두번째", "세번째", "네번째", "다섯번째", "탭");
            assertThat(text).doesNotContain("\u0000", "\u0001", "\u007F", "\u202E", "\u200D", "\uD800", "🧪");
            assertThat(pdf.getDocumentInformation().getTitle()).isEqualTo("명세[U+0000][U+1F9EA]");
        }
    }

    @Test
    void producesTheSameBytesForTheSameImmutableRevision() {
        byte[] first = renderer.render("고객 명세서", 2, "범위와 기준\n가나다\u0000🧪", HASH, CONFIRMED_AT);
        byte[] second = renderer.render("고객 명세서", 2, "범위와 기준\n가나다\u0000🧪", HASH, CONFIRMED_AT);

        assertThat(second).isEqualTo(first);
        assertThat(renderer.render("고객 명세서", 3, "범위와 기준\n가나다\u0000🧪", HASH, CONFIRMED_AT))
            .isNotEqualTo(first);
    }

    @Test
    void rejectsMissingConfirmationMetadataRatherThanMakingAnApparentlyConfirmedDocument() {
        assertThatThrownBy(() -> renderer.render("명세서", 0, "범위", HASH, CONFIRMED_AT))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> renderer.render("명세서", 1, "범위", "invalid", CONFIRMED_AT))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> renderer.render("명세서", 1, "범위", HASH, null))
            .isInstanceOf(NullPointerException.class);
    }

    @Test
    void oversizedPageCountFailsExplicitlyWithoutReturningAPartialPdf() {
        assertThatThrownBy(() -> renderer.render("출력 한도", 1, "\n".repeat(6000) + "마지막", HASH, CONFIRMED_AT))
            .isInstanceOf(SpecificationPdfRenderer.PdfLimitExceededException.class);
    }

    private static String bodyText(String text) {
        return text.substring(text.indexOf("BEGINBODY") + "BEGINBODY".length(), text.indexOf("ENDBODY"))
            .replaceAll("Revision \\d+ \\| \\d+ / \\d+", "")
            .replaceAll("\\s+", "");
    }
}
