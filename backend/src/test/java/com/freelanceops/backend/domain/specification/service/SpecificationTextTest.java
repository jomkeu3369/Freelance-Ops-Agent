package com.freelanceops.backend.domain.specification.service;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.assertj.core.api.Assertions.*;

class SpecificationTextTest {
    @Test void projectionPreservesWhitespaceAndSurrogatePairsExactly() {
        String content = " ".repeat(5) + "한글".repeat(8996) + "🚀" + "\n\t literal <script>x</script>  ";
        var chunks = SpecificationText.chunks(content);
        assertThat(chunks).hasSize(2);
        assertThat(chunks.stream().map(SpecificationText.Chunk::content).collect(java.util.stream.Collectors.joining())).isEqualTo(content);
        for (var chunk : chunks) {
            assertThat(content.substring(chunk.startOffset(), chunk.endOffset())).isEqualTo(chunk.content());
            assertThat(Character.isHighSurrogate(chunk.content().charAt(chunk.content().length() - 1))).isFalse();
            assertThat(Character.isLowSurrogate(chunk.content().charAt(0))).isFalse();
        }
    }
    @Test void hashingDoesNotTrimOrInventContent() {
        assertThat(SpecificationText.hash("scope ")).isNotEqualTo(SpecificationText.hash("scope"));
        assertThat(SpecificationText.hash("한글")).hasSize(64).matches("[a-f0-9]{64}");
    }
    @Test void unsafeUnicodeIsRejectedInsteadOfChangingTheConfirmedText() {
        for (String content : new String[]{"scope\u0000", "scope\u202E.pdf", "scope\uD800", "scope\uDC00"}) {
            assertThatThrownBy(() -> SpecificationText.validate("제목", content)).isInstanceOf(ResponseStatusException.class);
        }
        assertThatCode(() -> SpecificationText.validate("제목 🚀", "한글\n\t<script>alert(1)</script> & 🚀")).doesNotThrowAnyException();
    }
    @Test void excessiveBlankLinesAreRejectedWithoutTruncation() {
        assertThatThrownBy(() -> SpecificationText.validate("제목", "scope" + "\n".repeat(4001)))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("4,000");
    }
    @Test void windowsLineBreaksCountOnceWithoutRewritingTheSource() {
        String content = "scope" + "\r\n".repeat(4000);
        assertThatCode(() -> SpecificationText.validate("제목", content)).doesNotThrowAnyException();
        assertThat(SpecificationText.chunks(content).stream().map(SpecificationText.Chunk::content)
            .collect(java.util.stream.Collectors.joining())).isEqualTo(content);
        assertThatThrownBy(() -> SpecificationText.validate("제목", content + "\r\n"))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("4,000");
    }
    @Test void downloadFilenameIsBoundedAndHeaderSafe() {
        assertThat(SpecificationText.downloadName("한글 / 이름\\test\r\n\". ", 7)).isEqualTo("한글 _ 이름_test___-v7.pdf");
        assertThat(SpecificationText.downloadName("한".repeat(79) + "🚀", 1)).doesNotContain("\uD83D").endsWith("-v1.pdf");
        assertThat(SpecificationText.downloadName("...", 2)).isEqualTo("명세서-v2.pdf");
    }
}
