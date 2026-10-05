package com.freelanceops.backend.domain.agentrun.dto;

import java.util.List;

/** Version-pinned prompt choices only: never tools, permissions or prices. */
public record SkillSelection(String mode, List<String> manualIds, List<String> excludedIds, String catalogVersion) {
    public SkillSelection {
        mode = mode == null ? "AUTO" : mode;
        manualIds = manualIds == null ? List.of() : List.copyOf(manualIds);
        excludedIds = excludedIds == null ? List.of() : List.copyOf(excludedIds);
        catalogVersion = catalogVersion == null ? "1.0.0" : catalogVersion;
        if (!(mode.equals("AUTO") || mode.equals("MANUAL")) || !catalogVersion.equals("1.0.0")
            || manualIds.size() > 3 || excludedIds.size() > 60
            || manualIds.stream().distinct().count() != manualIds.size()
            || excludedIds.stream().distinct().count() != excludedIds.size()
            || !BuiltinSkillIds.ALL.containsAll(manualIds) || !BuiltinSkillIds.ALL.containsAll(excludedIds)) {
            throw new IllegalArgumentException("Invalid built-in skill selection");
        }
    }
    public boolean isDefault() { return mode.equals("AUTO") && manualIds.isEmpty() && excludedIds.isEmpty(); }
}
