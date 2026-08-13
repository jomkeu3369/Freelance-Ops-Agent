package com.freelanceops.backend.domain.workspace.policy;

import org.junit.jupiter.api.Test;

import java.util.EnumSet;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class SystemRoleTest {

    @Test
    void ownerHasEveryPermission() {
        assertThat(SystemRole.OWNER.permissions()).containsExactlyInAnyOrder(PermissionCode.values());
    }

    @Test
    void adminCannotDeleteOrTransferWorkspaceOrPermanentlyDeleteData() {
        EnumSet<PermissionCode> expected = EnumSet.allOf(PermissionCode.class);
        expected.removeAll(Set.of(
            PermissionCode.WORKSPACE_DELETE,
            PermissionCode.WORKSPACE_TRANSFER_OWNERSHIP,
            PermissionCode.DATA_DELETE
        ));

        assertThat(SystemRole.ADMIN.permissions()).containsExactlyInAnyOrderElementsOf(expected);
    }

    @Test
    void managerMatchesBusinessManagementMatrix() {
        assertThat(SystemRole.MANAGER.permissions()).containsExactlyInAnyOrder(
            PermissionCode.WORKSPACE_READ,
            PermissionCode.MEMBER_READ,
            PermissionCode.ROLE_READ,
            PermissionCode.CLIENT_READ,
            PermissionCode.CLIENT_WRITE,
            PermissionCode.CLIENT_DELETE,
            PermissionCode.PROJECT_READ,
            PermissionCode.PROJECT_WRITE,
            PermissionCode.PROJECT_DELETE,
            PermissionCode.DOCUMENT_READ,
            PermissionCode.DOCUMENT_WRITE,
            PermissionCode.DOCUMENT_DELETE,
            PermissionCode.QUOTATION_READ,
            PermissionCode.QUOTATION_WRITE,
            PermissionCode.QUOTATION_APPROVE,
            PermissionCode.QUOTATION_PUBLISH,
            PermissionCode.AGENT_RUN,
            PermissionCode.AGENT_RESPOND,
            PermissionCode.AGENT_CANCEL,
            PermissionCode.OUTCOME_READ,
            PermissionCode.OUTCOME_WRITE
        );
    }

    @Test
    void estimatorCanDraftButCannotApproveOrPublishQuotation() {
        assertThat(SystemRole.ESTIMATOR.permissions()).containsExactlyInAnyOrder(
            PermissionCode.WORKSPACE_READ,
            PermissionCode.CLIENT_READ,
            PermissionCode.CLIENT_WRITE,
            PermissionCode.PROJECT_READ,
            PermissionCode.PROJECT_WRITE,
            PermissionCode.DOCUMENT_READ,
            PermissionCode.DOCUMENT_WRITE,
            PermissionCode.DOCUMENT_DELETE,
            PermissionCode.QUOTATION_READ,
            PermissionCode.QUOTATION_WRITE,
            PermissionCode.AGENT_RUN,
            PermissionCode.AGENT_RESPOND,
            PermissionCode.AGENT_CANCEL,
            PermissionCode.OUTCOME_READ
        );
    }

    @Test
    void viewerIsReadOnly() {
        assertThat(SystemRole.VIEWER.permissions()).containsExactlyInAnyOrder(
            PermissionCode.WORKSPACE_READ,
            PermissionCode.CLIENT_READ,
            PermissionCode.PROJECT_READ,
            PermissionCode.DOCUMENT_READ,
            PermissionCode.QUOTATION_READ,
            PermissionCode.OUTCOME_READ
        );
    }
}


