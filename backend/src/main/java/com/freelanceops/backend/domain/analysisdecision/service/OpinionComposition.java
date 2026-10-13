package com.freelanceops.backend.domain.analysisdecision.service;

import com.freelanceops.backend.domain.analysisdecision.dto.response.AnalysisDecisionResponse.OpinionSnapshot;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;

/** Deterministic public work-product assembly. This class never calls a model. */
public final class OpinionComposition {
    public static final int MAX_BODY_LENGTH = 100000;
    private OpinionComposition() { }

    public static List<String> warnings(List<OpinionSnapshot> opinions) {
        List<String> warnings = new ArrayList<>();
        if (opinions.size() > 1) warnings.add("서로 다른 범위의 의견을 함께 선택했습니다. 각 작업을 단순히 모두 수행하기로 합의한 것은 아닙니다. 중복·상충하는 범위와 공수는 직접 검토해 주세요.");
        var titles = new LinkedHashMap<String, List<String>>();
        for (var opinion : opinions) for (var item : opinion.draft().items()) {
            String normalized = Normalizer.normalize(item.title(), Normalizer.Form.NFKC)
                .toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
            titles.computeIfAbsent(normalized, key -> new ArrayList<>()).add(opinion.scenario());
        }
        titles.forEach((title, scenarios) -> {
            if (scenarios.size() > 1) warnings.add("중복 가능 작업: " + title + " (" + String.join(", ", scenarios) + "). 원본 항목과 각 공수는 삭제하거나 합산하지 않았습니다.");
        });
        return List.copyOf(warnings);
    }

    public static String compose(List<OpinionSnapshot> opinions, List<String> questions,
        List<String> warnings) {
        StringBuilder body = new StringBuilder("선택 의견 종합 초안 (정리)\n\n");
        body.append("하나의 프로젝트 분석에서 나온 계획 관점을 원본 순서로 모았습니다. ")
            .append("추가 AI 재분석이나 새 합의가 아닙니다. 범위·공수·근거·가정·열린 질문을 검토한 뒤 확정하세요.\n");
        if (!warnings.isEmpty()) {
            body.append("\n검토 주의사항\n");
            warnings.forEach(warning -> body.append("- ").append(warning).append('\n'));
        }
        for (var opinion : opinions) {
            var draft = opinion.draft();
            var perspective = draft.petPerspective();
            body.append("\n계획 관점: ").append(opinion.scenario()).append('\n')
                .append("의견 출처: ").append(opinion.opinionId()).append('\n')
                .append("제안: ").append(perspective.proposal()).append('\n')
                .append("이유: ").append(perspective.rationale()).append('\n')
                .append("함께 생각할 점: ").append(perspective.tradeoff()).append('\n');
            for (int index = 0; index < draft.items().size(); index++) {
                var item = draft.items().get(index);
                body.append("\n작업 ").append(index + 1).append(": ").append(item.title()).append('\n')
                    .append("내용: ").append(item.description() == null ? "" : item.description()).append('\n')
                    .append("예상 공수: ").append(item.quantity()).append(' ').append(item.unit()).append('\n')
                    .append("근거 종류: ").append(item.basis().type()).append('\n')
                    .append("근거/가정: ").append(item.basis().content()).append('\n');
                if (item.basis().sourceReference() != null) body.append("근거 참조: ").append(item.basis().sourceReference()).append('\n');
                if (item.basis().sourceTitle() != null) body.append("근거 제목: ").append(item.basis().sourceTitle()).append('\n');
            }
        }
        if (!questions.isEmpty()) {
            body.append("\n아직 확인할 질문 (확정으로 답변 처리되지 않습니다)\n");
            questions.forEach(question -> body.append("- ").append(question).append('\n'));
        }
        String result = body.toString().strip();
        if (result.length() > MAX_BODY_LENGTH) throw new IllegalArgumentException("선택 의견의 내용이 너무 깁니다. 일부 관점만 선택해 주세요. 원본은 자동으로 잘리지 않습니다.");
        return result;
    }

    public static String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
