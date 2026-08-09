package com.freelanceops.backend.workspace.domain;

import java.util.Arrays;

public enum PermissionCode {
    WORKSPACE_READ("workspace.read"),
    WORKSPACE_UPDATE("workspace.update"),
    WORKSPACE_DELETE("workspace.delete"),
    WORKSPACE_TRANSFER_OWNERSHIP("workspace.transfer_ownership"),
    MEMBER_READ("member.read"),
    MEMBER_MANAGE("member.manage"),
    ROLE_READ("role.read"),
    ROLE_MANAGE("role.manage"),
    CLIENT_READ("client.read"),
    CLIENT_WRITE("client.write"),
    CLIENT_DELETE("client.delete"),
    PROJECT_READ("project.read"),
    PROJECT_WRITE("project.write"),
    PROJECT_DELETE("project.delete"),
    DOCUMENT_READ("document.read"),
    DOCUMENT_WRITE("document.write"),
    DOCUMENT_DELETE("document.delete"),
    QUOTATION_READ("quotation.read"),
    QUOTATION_WRITE("quotation.write"),
    QUOTATION_APPROVE("quotation.approve"),
    QUOTATION_PUBLISH("quotation.publish"),
    AGENT_RUN("agent.run"),
    AGENT_RESPOND("agent.respond"),
    AGENT_CANCEL("agent.cancel"),
    OUTCOME_READ("outcome.read"),
    OUTCOME_WRITE("outcome.write"),
    INTEGRATION_READ("integration.read"),
    INTEGRATION_MANAGE("integration.manage"),
    AUDIT_READ("audit.read"),
    DATA_EXPORT("data.export"),
    DATA_DELETE("data.delete");

    private final String code;

    PermissionCode(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static PermissionCode fromCode(String code) {
        return Arrays.stream(values())
            .filter(permission -> permission.code.equals(code))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("Unknown permission code: " + code));
    }
}
