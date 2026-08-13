package com.freelanceops.backend.domain.workspace.policy;

import java.util.Collections;
import java.util.EnumSet;
import java.util.Set;

import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.AGENT_CANCEL;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.AGENT_RESPOND;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.AGENT_RUN;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.CLIENT_DELETE;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.CLIENT_READ;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.CLIENT_WRITE;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.DOCUMENT_DELETE;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.DOCUMENT_READ;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.DOCUMENT_WRITE;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.MEMBER_READ;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.OUTCOME_READ;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.OUTCOME_WRITE;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.PROJECT_DELETE;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.PROJECT_READ;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.PROJECT_WRITE;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.QUOTATION_APPROVE;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.QUOTATION_PUBLISH;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.QUOTATION_READ;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.QUOTATION_WRITE;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.ROLE_READ;
import static com.freelanceops.backend.domain.workspace.policy.PermissionCode.WORKSPACE_READ;

public enum SystemRole {
    OWNER(EnumSet.allOf(PermissionCode.class)),
    ADMIN(without(
        EnumSet.allOf(PermissionCode.class),
        PermissionCode.WORKSPACE_DELETE,
        PermissionCode.WORKSPACE_TRANSFER_OWNERSHIP,
        PermissionCode.DATA_DELETE
    )),
    MANAGER(EnumSet.of(
        WORKSPACE_READ,
        MEMBER_READ,
        ROLE_READ,
        CLIENT_READ,
        CLIENT_WRITE,
        CLIENT_DELETE,
        PROJECT_READ,
        PROJECT_WRITE,
        PROJECT_DELETE,
        DOCUMENT_READ,
        DOCUMENT_WRITE,
        DOCUMENT_DELETE,
        QUOTATION_READ,
        QUOTATION_WRITE,
        QUOTATION_APPROVE,
        QUOTATION_PUBLISH,
        AGENT_RUN,
        AGENT_RESPOND,
        AGENT_CANCEL,
        OUTCOME_READ,
        OUTCOME_WRITE
    )),
    ESTIMATOR(EnumSet.of(
        WORKSPACE_READ,
        CLIENT_READ,
        CLIENT_WRITE,
        PROJECT_READ,
        PROJECT_WRITE,
        DOCUMENT_READ,
        DOCUMENT_WRITE,
        DOCUMENT_DELETE,
        QUOTATION_READ,
        QUOTATION_WRITE,
        AGENT_RUN,
        AGENT_RESPOND,
        AGENT_CANCEL,
        OUTCOME_READ
    )),
    VIEWER(EnumSet.of(
        WORKSPACE_READ,
        CLIENT_READ,
        PROJECT_READ,
        DOCUMENT_READ,
        QUOTATION_READ,
        OUTCOME_READ
    ));

    private final Set<PermissionCode> permissions;

    SystemRole(Set<PermissionCode> permissions) {
        this.permissions = Collections.unmodifiableSet(EnumSet.copyOf(permissions));
    }

    public Set<PermissionCode> permissions() {
        return permissions;
    }

    private static Set<PermissionCode> without(EnumSet<PermissionCode> source, PermissionCode... excluded) {
        source.removeAll(Set.of(excluded));
        return source;
    }
}


