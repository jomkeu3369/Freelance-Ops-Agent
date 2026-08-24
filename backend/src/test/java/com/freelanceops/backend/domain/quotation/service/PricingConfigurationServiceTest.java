package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.quotation.dto.request.UpdateEstimationPolicyRequest;
import com.freelanceops.backend.domain.quotation.repository.EstimationPolicyRepository;
import com.freelanceops.backend.domain.quotation.repository.RateCardRepository;
import com.freelanceops.backend.domain.workspace.entity.WorkspaceEntity;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspaceRepository;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PricingConfigurationServiceTest {

    @Mock private RateCardRepository rateCardRepository;
    @Mock private EstimationPolicyRepository policyRepository;
    @Mock private WorkspaceAuthorizationService authorizationService;
    @Mock private WorkspaceRepository workspaceRepository;

    @Test
    void serializesInitialPolicyUpsertsOnTheWorkspaceRow() {
        UUID userId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        when(authorizationService.authorize(userId, workspaceId, PermissionCode.QUOTATION_WRITE))
            .thenReturn(AuthorizationDecision.ALLOWED);
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(
            WorkspaceEntity.active(workspaceId, "Workspace", "workspace", userId)
        ));
        when(policyRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        service().updatePolicy(userId, workspaceId, new UpdateEstimationPolicyRequest(
            new BigDecimal("0.1"), new BigDecimal("0.2"), new BigDecimal("0.3")
        ));

        verify(workspaceRepository).findByIdForUpdate(workspaceId);
        verify(policyRepository).save(any());
    }

    private PricingConfigurationService service() {
        return new PricingConfigurationService(
            rateCardRepository, policyRepository, authorizationService, workspaceRepository
        );
    }
}
