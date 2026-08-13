package com.freelanceops.backend.domain.identity.service;

import com.freelanceops.backend.domain.identity.dto.request.LoginRequest;
import com.freelanceops.backend.domain.identity.dto.request.RegisterRequest;
import com.freelanceops.backend.domain.identity.dto.response.AuthTokenResponse;
import com.freelanceops.backend.domain.identity.dto.response.MeResponse;
import com.freelanceops.backend.domain.identity.dto.response.WorkspaceAccessResponse;
import com.freelanceops.backend.domain.identity.entity.RefreshTokenEntity;
import com.freelanceops.backend.domain.identity.entity.UserAccountEntity;
import com.freelanceops.backend.domain.identity.repository.RefreshTokenRepository;
import com.freelanceops.backend.domain.identity.repository.UserAccountRepository;
import com.freelanceops.backend.domain.identity.service.AuthTokenService.IssuedAccessToken;
import com.freelanceops.backend.domain.identity.service.AuthTokenService.IssuedRefreshToken;
import com.freelanceops.backend.domain.workspace.entity.WorkspaceEntity;
import com.freelanceops.backend.domain.workspace.entity.WorkspaceMemberEntity;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspaceMemberRepository;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import com.freelanceops.backend.domain.workspace.repository.WorkspaceRepository;
import com.freelanceops.backend.domain.workspace.service.WorkspaceProvisioningResult;
import com.freelanceops.backend.domain.workspace.service.WorkspaceProvisioningService;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Comparator;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Service
public class AuthService {

    private final UserAccountRepository userRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final WorkspaceMemberRepository workspaceMemberRepository;
    private final WorkspaceRepository workspaceRepository;
    private final WorkspacePermissionReader permissionReader;
    private final WorkspaceProvisioningService provisioningService;
    private final PasswordEncoder passwordEncoder;
    private final AuthTokenService tokenService;
    private final String dummyPasswordHash;

    public AuthService(
        UserAccountRepository userRepository,
        RefreshTokenRepository refreshTokenRepository,
        WorkspaceMemberRepository workspaceMemberRepository,
        WorkspaceRepository workspaceRepository,
        WorkspacePermissionReader permissionReader,
        WorkspaceProvisioningService provisioningService,
        PasswordEncoder passwordEncoder,
        AuthTokenService tokenService
    ) {
        this.userRepository = userRepository;
        this.refreshTokenRepository = refreshTokenRepository;
        this.workspaceMemberRepository = workspaceMemberRepository;
        this.workspaceRepository = workspaceRepository;
        this.permissionReader = permissionReader;
        this.provisioningService = provisioningService;
        this.passwordEncoder = passwordEncoder;
        this.tokenService = tokenService;
        this.dummyPasswordHash = passwordEncoder.encode("timing-only-password-value");
    }

    @Transactional
    public AuthTokenResponse register(RegisterRequest request) {
        String email = normalizeEmail(request.email());
        if (userRepository.existsByEmailIgnoreCase(email)) {
            throw new IdentityException(HttpStatus.CONFLICT, "EMAIL_ALREADY_REGISTERED");
        }
        UUID userId = UUID.randomUUID();
        Instant now = tokenService.now();
        UserAccountEntity user = UserAccountEntity.registerLocal(
            userId,
            email,
            request.displayName().trim(),
            passwordEncoder.encode(request.password()),
            now
        );
        try {
            userRepository.saveAndFlush(user);
            WorkspaceProvisioningResult workspace = provisioningService.create(
                userId,
                request.workspaceName().trim(),
                "workspace-" + UUID.randomUUID().toString().substring(0, 12)
            );
            return issueSession(user, workspace.workspaceId());
        } catch (DataIntegrityViolationException error) {
            throw new IdentityException(HttpStatus.CONFLICT, "IDENTITY_ALREADY_EXISTS");
        }
    }

    @Transactional
    public AuthTokenResponse login(LoginRequest request) {
        UserAccountEntity user = userRepository.findByEmailIgnoreCase(normalizeEmail(request.email())).orElse(null);
        String storedHash = user == null || user.passwordHash() == null ? dummyPasswordHash : user.passwordHash();
        boolean passwordMatches = passwordEncoder.matches(request.password(), storedHash);
        if (user == null || !passwordMatches || !"ACTIVE".equals(user.status())) {
            throw new IdentityException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS");
        }
        return issueSession(user, firstActiveWorkspaceId(user.id()));
    }

    @Transactional(noRollbackFor = IdentityException.class)
    public AuthTokenResponse refresh(String rawRefreshToken) {
        RefreshTokenEntity current = refreshTokenRepository.findByTokenHash(tokenService.hash(rawRefreshToken))
            .orElseThrow(() -> new IdentityException(HttpStatus.UNAUTHORIZED, "INVALID_REFRESH_TOKEN"));
        Instant now = tokenService.now();
        if (current.replacedByTokenId() != null) {
            revokeCompromisedFamily(current, now);
            throw new IdentityException(HttpStatus.UNAUTHORIZED, "INVALID_REFRESH_TOKEN");
        }
        if (!current.isUsableAt(now)) {
            throw new IdentityException(HttpStatus.UNAUTHORIZED, "INVALID_REFRESH_TOKEN");
        }
        UserAccountEntity user = userRepository.findById(current.userId())
            .filter(candidate -> "ACTIVE".equals(candidate.status()))
            .orElseThrow(() -> new IdentityException(HttpStatus.UNAUTHORIZED, "INVALID_REFRESH_TOKEN"));
        UUID replacementId = UUID.randomUUID();
        AuthTokenResponse response = issueSession(
            user, firstActiveWorkspaceId(user.id()), replacementId, current.familyId(), current.id()
        );
        current.rotateTo(replacementId, now);
        refreshTokenRepository.save(current);
        return response;
    }

    @Transactional
    public void logout(String rawRefreshToken) {
        refreshTokenRepository.findByTokenHash(tokenService.hash(rawRefreshToken))
            .ifPresent(token -> {
                token.revoke(tokenService.now());
                refreshTokenRepository.save(token);
            });
    }

    @Transactional(readOnly = true)
    public MeResponse me(UUID userId) {
        UserAccountEntity user = userRepository.findById(userId)
            .orElseThrow(() -> new IdentityException(HttpStatus.UNAUTHORIZED, "USER_NOT_FOUND"));
        List<WorkspaceAccessResponse> workspaces = workspaceMemberRepository
            .findAllByUserIdAndStatusOrderByJoinedAtAsc(userId, "ACTIVE")
            .stream()
            .map(membership -> workspaceAccess(userId, membership))
            .toList();
        return new MeResponse(user.id(), user.email(), user.displayName(), user.status(), workspaces);
    }

    private AuthTokenResponse issueSession(UserAccountEntity user, UUID workspaceId) {
        UUID tokenId = UUID.randomUUID();
        return issueSession(user, workspaceId, tokenId, tokenId, null);
    }

    private AuthTokenResponse issueSession(UserAccountEntity user, UUID workspaceId, UUID tokenId, UUID familyId, UUID parentTokenId) {
        IssuedAccessToken accessToken = tokenService.issueAccessToken(user);
        IssuedRefreshToken refreshToken = tokenService.issueRefreshToken();
        refreshTokenRepository.save(new RefreshTokenEntity(
            tokenId,
            user.id(),
            refreshToken.hash(),
            familyId,
            parentTokenId,
            refreshToken.expiresAt(),
            tokenService.now()
        ));
        return new AuthTokenResponse(
            user.id(),
            workspaceId,
            accessToken.value(),
            accessToken.expiresAt(),
            refreshToken.value(),
            refreshToken.expiresAt(),
            "Bearer"
        );
    }

    private void revokeCompromisedFamily(RefreshTokenEntity reused, Instant now) {
        List<RefreshTokenEntity> family = new ArrayList<>(refreshTokenRepository.findAllByFamilyId(reused.familyId()));
        if (family.stream().noneMatch(token -> token.id().equals(reused.id()))) family.add(reused);
        family.forEach(token -> {
            if (token.id().equals(reused.id())) token.markReuseDetected(now);
            else token.revoke(now, "REUSE_DETECTED");
        });
        refreshTokenRepository.saveAll(family);
    }

    private WorkspaceAccessResponse workspaceAccess(UUID userId, WorkspaceMemberEntity membership) {
        WorkspaceEntity workspace = workspaceRepository.findById(membership.workspaceId())
            .orElseThrow(() -> new IllegalStateException("active membership references a missing workspace"));
        List<String> permissions = permissionReader.findActiveMembership(userId, workspace.id())
            .orElseThrow(() -> new IllegalStateException("active membership permissions are unavailable"))
            .permissions()
            .stream()
            .sorted(Comparator.comparing(PermissionCode::code))
            .map(PermissionCode::code)
            .toList();
        return new WorkspaceAccessResponse(workspace.id(), workspace.name(), workspace.slug(), permissions);
    }

    private UUID firstActiveWorkspaceId(UUID userId) {
        return workspaceMemberRepository.findAllByUserIdAndStatusOrderByJoinedAtAsc(userId, "ACTIVE")
            .stream()
            .findFirst()
            .map(WorkspaceMemberEntity::workspaceId)
            .orElse(null);
    }

    private static String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}
