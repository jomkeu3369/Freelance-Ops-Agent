package com.freelanceops.backend.domain.analysisdecision.service;

import com.freelanceops.backend.domain.memory.dto.response.MemorySourceMessage;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Exact immutable source identities avoid treating a newer confirmation as old evidence. */
final class AnalysisSourceGuard {
    private AnalysisSourceGuard() { }

    static void requireCurrent(List<MemorySourceMessage> captured, List<MemorySourceMessage> current) {
        if (captured.isEmpty() || captured.stream().noneMatch(source -> "PROJECT_INPUT".equals(source.kind()))
            || !roots(captured).equals(roots(current))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                "분석 이후 원문·요구사항 확정·추가 답변이 변경되었습니다. 최신 출처로 프로젝트 전체 분석을 다시 실행해 주세요.");
        }
    }

    static long eventOrder(List<MemorySourceMessage> captured) {
        return captured.stream().filter(source -> !"RUN_INPUT".equals(source.kind()))
            .mapToLong(MemorySourceMessage::eventOrder).max().orElse(0);
    }

    private static Set<UUID> roots(List<MemorySourceMessage> sources) {
        return sources.stream().filter(source -> !"RUN_INPUT".equals(source.kind()))
            .map(MemorySourceMessage::id).collect(Collectors.toSet());
    }
}
