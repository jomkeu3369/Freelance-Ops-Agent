package com.freelanceops.backend.domain.agentrun.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Component
public class AgentRouteReviewPolicy {
    private static final Set<String> RISK_ROUTES = Set.of("REACT_AGENT", "HUMAN_REQUIRED");
    private final int naturalDualPercent;
    private final int naturalSeniorAuditPercent;

    public AgentRouteReviewPolicy(@Value("${agent.route-review-natural-dual-percent:50}") int naturalDualPercent,
                                  @Value("${agent.route-review-natural-senior-audit-percent:5}") int naturalSeniorAuditPercent) {
        if (naturalDualPercent < 0 || naturalDualPercent > 100) {
            throw new IllegalArgumentException("natural dual-review percent must be 0-100");
        }
        if (naturalSeniorAuditPercent < 0 || naturalSeniorAuditPercent > 100) {
            throw new IllegalArgumentException("natural senior-audit percent must be 0-100");
        }
        this.naturalDualPercent = naturalDualPercent;
        this.naturalSeniorAuditPercent = naturalSeniorAuditPercent;
    }

    public int reviewTarget(UUID observationId, Map<String, Object> routeData) {
        Object route = routeData.get("route");
        Object shadowRoute = routeData.get("shadowSuggestedRoute");
        boolean risk = route instanceof String name && RISK_ROUTES.contains(name);
        boolean disagreement = shadowRoute instanceof String shadow && !shadow.equals(route);
        boolean naturalDual = Math.floorMod(observationId.hashCode(), 100) < naturalDualPercent;
        if (risk || disagreement) return 3;
        if (!naturalDual) return 1;
        int seniorBucket = Math.floorMod(31 * observationId.hashCode() + 17, 100);
        return seniorBucket < naturalSeniorAuditPercent ? 3 : 2;
    }
}
