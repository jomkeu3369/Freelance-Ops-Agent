package com.freelanceops.backend.system;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/meta")
@Tag(name = "Service metadata", description = "Spring Boot 공개 API의 서비스 식별 정보")
public class ServiceMetadataController {

    @GetMapping
    @Operation(summary = "서비스 메타데이터 조회")
    @ApiResponse(responseCode = "200", description = "서비스 이름, 버전과 상태")
    @ApiResponse(responseCode = "401", description = "인증 정보가 없거나 유효하지 않음")
    ServiceMetadata getServiceMetadata() {
        return ServiceMetadata.current();
    }
}

