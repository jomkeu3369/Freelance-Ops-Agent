package com.freelanceops.backend.domain.identity.service;

import com.freelanceops.backend.domain.identity.dto.request.LoginRequest;
import com.freelanceops.backend.domain.identity.dto.request.RegisterRequest;
import com.freelanceops.backend.domain.identity.dto.response.AuthTokenResponse;
import com.freelanceops.backend.domain.identity.entity.RefreshTokenEntity;
import com.freelanceops.backend.domain.identity.entity.UserAccountEntity;
import com.freelanceops.backend.domain.identity.repository.RefreshTokenRepository;
import com.freelanceops.backend.domain.identity.repository.UserAccountRepository;
import com.freelanceops.backend.domain.workspace.repository.WorkspaceMemberRepository;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import com.freelanceops.backend.domain.workspace.repository.WorkspaceRepository;
import com.freelanceops.backend.domain.workspace.service.WorkspaceProvisioningResult;
import com.freelanceops.backend.domain.workspace.service.WorkspaceProvisioningService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-13T12:00:00Z");

    @Mock
    private UserAccountRepository userRepository;
    @Mock
    private RefreshTokenRepository refreshTokenRepository;
    @Mock
    private WorkspaceMemberRepository workspaceMemberRepository;
    @Mock
    private WorkspaceRepository workspaceRepository;
    @Mock
    private WorkspacePermissionReader permissionReader;
    @Mock
    private WorkspaceProvisioningService provisioningService;
    @Mock
    private AuthTokenService tokenService;

    private PasswordEncoder passwordEncoder;
    private AuthService service;

    @BeforeEach
    void setUp() {
        passwordEncoder = new BCryptPasswordEncoder(4);
        service = new AuthService(
            userRepository,
            refreshTokenRepository,
            workspaceMemberRepository,
            workspaceRepository,
            permissionReader,
            provisioningService,
            passwordEncoder,
            tokenService
        );
    }

    @Test
    void registrationHashesPasswordCreatesOwnerWorkspaceAndSession() {
        UUID workspaceId = UUID.randomUUID();
        when(userRepository.existsByEmailIgnoreCase("member@example.com")).thenReturn(false);
        when(userRepository.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(provisioningService.create(any(), anyString(), anyString()))
            .thenReturn(new WorkspaceProvisioningResult(workspaceId, UUID.randomUUID()));
        stubTokens();

        AuthTokenResponse response = service.register(new RegisterRequest(
            " Member@Example.com ",
            "correct horse battery staple",
            "Member",
            "Member Workspace"
        ));

        ArgumentCaptor<UserAccountEntity> userCaptor = ArgumentCaptor.forClass(UserAccountEntity.class);
        verify(userRepository).saveAndFlush(userCaptor.capture());
        assertThat(userCaptor.getValue().email()).isEqualTo("member@example.com");
        assertThat(userCaptor.getValue().passwordHash()).isNotEqualTo("correct horse battery staple");
        assertThat(passwordEncoder.matches("correct horse battery staple", userCaptor.getValue().passwordHash())).isTrue();
        assertThat(response.workspaceId()).isEqualTo(workspaceId);
        assertThat(response.tokenType()).isEqualTo("Bearer");
    }

    @Test
    void loginDoesNotRevealWhetherEmailOrPasswordWasWrong() {
        when(userRepository.findByEmailIgnoreCase("unknown@example.com")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.login(new LoginRequest("unknown@example.com", "wrong-password")))
            .isInstanceOfSatisfying(IdentityException.class, error -> {
                assertThat(error.status()).isEqualTo(HttpStatus.UNAUTHORIZED);
                assertThat(error.code()).isEqualTo("INVALID_CREDENTIALS");
            });
        verify(refreshTokenRepository, never()).save(any());
    }

    @Test
    void refreshRotatesTokenAndRejectsReplay() {
        UUID userId = UUID.randomUUID();
        UserAccountEntity user = UserAccountEntity.registerLocal(
            userId,
            "member@example.com",
            "Member",
            passwordEncoder.encode("correct horse battery staple"),
            NOW
        );
        RefreshTokenEntity current = new RefreshTokenEntity(UUID.randomUUID(), userId, "old-hash", NOW.plusSeconds(60), NOW);
        when(tokenService.hash("old-token")).thenReturn("old-hash");
        when(tokenService.now()).thenReturn(NOW);
        when(refreshTokenRepository.findByTokenHash("old-hash")).thenReturn(Optional.of(current));
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(workspaceMemberRepository.findAllByUserIdAndStatusOrderByJoinedAtAsc(userId, "ACTIVE"))
            .thenReturn(List.of());
        stubTokens();

        service.refresh("old-token");

        assertThat(current.isUsableAt(NOW)).isFalse();
        assertThat(current.revokeReason()).isEqualTo("ROTATED");
        assertThat(current.replacedByTokenId()).isNotNull();
        assertThatThrownBy(() -> service.refresh("old-token"))
            .isInstanceOfSatisfying(IdentityException.class, error ->
                assertThat(error.code()).isEqualTo("INVALID_REFRESH_TOKEN"));
        assertThat(current.reuseDetectedAt()).isEqualTo(NOW);
        assertThat(current.revokeReason()).isEqualTo("REUSE_DETECTED");
    }

    @Test
    void replayOfRotatedTokenRevokesEveryTokenInItsFamily() {
        UUID userId = UUID.randomUUID();
        UUID familyId = UUID.randomUUID();
        RefreshTokenEntity reused = new RefreshTokenEntity(
            UUID.randomUUID(), userId, "old-hash", familyId, null, NOW.plusSeconds(3600), NOW.minusSeconds(60)
        );
        RefreshTokenEntity successor = new RefreshTokenEntity(
            UUID.randomUUID(), userId, "new-hash", familyId, reused.id(), NOW.plusSeconds(3600), NOW
        );
        reused.rotateTo(successor.id(), NOW.minusSeconds(30));
        when(tokenService.hash("stolen-old-token")).thenReturn("old-hash");
        when(tokenService.now()).thenReturn(NOW);
        when(refreshTokenRepository.findByTokenHash("old-hash")).thenReturn(Optional.of(reused));
        when(refreshTokenRepository.findAllByFamilyId(familyId)).thenReturn(List.of(reused, successor));

        assertThatThrownBy(() -> service.refresh("stolen-old-token"))
            .isInstanceOfSatisfying(IdentityException.class, error -> {
                assertThat(error.status()).isEqualTo(HttpStatus.UNAUTHORIZED);
                assertThat(error.code()).isEqualTo("INVALID_REFRESH_TOKEN");
            });

        assertThat(reused.reuseDetectedAt()).isEqualTo(NOW);
        assertThat(successor.isUsableAt(NOW)).isFalse();
        assertThat(successor.revokeReason()).isEqualTo("REUSE_DETECTED");
        verify(refreshTokenRepository).saveAll(List.of(reused, successor));
        verifyNoInteractions(userRepository);
    }

    private void stubTokens() {
        when(tokenService.now()).thenReturn(NOW);
        when(tokenService.issueAccessToken(any())).thenReturn(
            new AuthTokenService.IssuedAccessToken("access-token", NOW.plusSeconds(900))
        );
        when(tokenService.issueRefreshToken()).thenReturn(
            new AuthTokenService.IssuedRefreshToken("refresh-token", "refresh-hash", NOW.plusSeconds(3600))
        );
    }
}
