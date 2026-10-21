package com.freelanceops.backend.domain.quotation.service;

import com.freelanceops.backend.domain.quotation.dto.request.MoveRateCardRequest;
import com.freelanceops.backend.domain.quotation.dto.request.UpsertRateCardFolderRequest;
import com.freelanceops.backend.domain.quotation.dto.response.RateCardFolderResponse;
import com.freelanceops.backend.domain.quotation.dto.response.RateCardResponse;
import com.freelanceops.backend.domain.quotation.entity.RateCardEntity;
import com.freelanceops.backend.domain.quotation.entity.RateCardFolderEntity;
import com.freelanceops.backend.domain.quotation.repository.RateCardFolderRepository;
import com.freelanceops.backend.domain.quotation.repository.RateCardRepository;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspaceRepository;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

@Service
public class RateCardFolderService {
    private static final int MAX_FOLDERS = 200;
    private static final int MAX_DEPTH = 8;

    private final RateCardFolderRepository folderRepository;
    private final RateCardRepository rateCardRepository;
    private final WorkspaceAuthorizationService authorizationService;
    private final WorkspaceRepository workspaceRepository;

    public RateCardFolderService(
            RateCardFolderRepository folderRepository,
            RateCardRepository rateCardRepository,
            WorkspaceAuthorizationService authorizationService,
            WorkspaceRepository workspaceRepository) {
        this.folderRepository = folderRepository;
        this.rateCardRepository = rateCardRepository;
        this.authorizationService = authorizationService;
        this.workspaceRepository = workspaceRepository;
    }

    @Transactional(readOnly = true)
    public List<RateCardFolderResponse> listFolders(UUID userId, UUID workspaceId) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_READ);
        return boundedFolders(workspaceId).stream()
                .map(RateCardFolderService::response)
                .toList();
    }

    @Transactional
    public RateCardFolderResponse upsertFolder(
            UUID userId, UUID workspaceId, UUID folderId, UpsertRateCardFolderRequest request) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_WRITE);
        // 서로 다른 폴더를 동시에 이동해도 같은 작업 공간의 그래프 변경은 직렬화한다.
        lockWorkspace(workspaceId);
        String name = normalizedName(request.name());
        RateCardFolderEntity current = folderRepository.findById(folderId).orElse(null);
        if (current != null && !current.workspaceId().equals(workspaceId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        if (request.expectedVersion() != null
                && (current == null
                        || (current.version() != request.expectedVersion()
                                && (!current.name().equals(name)
                                        || !Objects.equals(current.parentId(), request.parentId()))))) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "folder changed; reload and try again");
        }
        List<RateCardFolderEntity> folders = boundedFolders(workspaceId);
        if (current == null && folders.size() >= MAX_FOLDERS) {
            throw folderLimit();
        }
        validateParent(folderId, request.parentId(), folders);
        if (folders.stream()
                .anyMatch(
                        folder ->
                                !folder.id().equals(folderId)
                                        && Objects.equals(folder.parentId(), request.parentId())
                                        && folder.name().equalsIgnoreCase(name))) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "a folder with this name already exists in the parent folder");
        }
        if (current != null
                && current.name().equals(name)
                && Objects.equals(current.parentId(), request.parentId())) {
            return response(current);
        }
        Instant now = Instant.now();
        RateCardFolderEntity folder =
                current == null
                        ? new RateCardFolderEntity(
                                folderId, workspaceId, request.parentId(), name, userId, now)
                        : current;
        if (current != null) folder.update(name, request.parentId(), now);
        try {
            // version은 flush 이후의 값으로 응답한다. 같은 PUT의 재시도는 새 폴더를 만들지 않는다.
            return response(folderRepository.saveAndFlush(folder));
        } catch (DataIntegrityViolationException error) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "folder changed; reload and try again", error);
        }
    }

    @Transactional
    public void deleteFolder(UUID userId, UUID workspaceId, UUID folderId) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_WRITE);
        lockWorkspace(workspaceId);
        RateCardFolderEntity folder = folder(workspaceId, folderId);
        if (folderRepository.existsByWorkspaceIdAndParentId(workspaceId, folderId)
                || rateCardRepository.existsByWorkspaceIdAndFolderId(workspaceId, folderId)) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "only empty folders can be deleted");
        }
        folderRepository.delete(folder);
        folderRepository.flush();
    }

    @Transactional
    public RateCardResponse moveRateCard(
            UUID userId, UUID workspaceId, UUID rateCardId, MoveRateCardRequest request) {
        authorize(userId, workspaceId, PermissionCode.QUOTATION_WRITE);
        lockWorkspace(workspaceId);
        RateCardEntity card =
                rateCardRepository
                        .findByIdAndWorkspaceId(rateCardId, workspaceId)
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (request.folderId() != null) folder(workspaceId, request.folderId());
        if (Objects.equals(card.folderId(), request.folderId())) {
            return PricingConfigurationService.response(card);
        }
        card.moveToFolder(request.folderId(), Instant.now());
        return PricingConfigurationService.response(rateCardRepository.saveAndFlush(card));
    }

    private static String normalizedName(String value) {
        String name = value == null ? "" : value.trim();
        if (name.isBlank()
                || name.length() > 120
                || name.codePoints().anyMatch(Character::isISOControl)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "folder name must contain between 1 and 120 printable characters");
        }
        return name;
    }

    private static void validateParent(
            UUID folderId, UUID parentId, List<RateCardFolderEntity> folders) {
        Map<UUID, RateCardFolderEntity> byId = new HashMap<>();
        Map<UUID, List<UUID>> children = new HashMap<>();
        folders.forEach(
                folder -> {
                    byId.put(folder.id(), folder);
                    if (folder.parentId() != null) {
                        children.computeIfAbsent(folder.parentId(), ignored -> new ArrayList<>())
                                .add(folder.id());
                    }
                });
        HashSet<UUID> visited = new HashSet<>();
        UUID ancestor = parentId;
        int parentDepth = 0;
        while (ancestor != null) {
            if (ancestor.equals(folderId) || !visited.add(ancestor)) {
                throw new ResponseStatusException(
                        HttpStatus.CONFLICT,
                        "a folder cannot be moved into itself or its descendants");
            }
            RateCardFolderEntity parent = byId.get(ancestor);
            if (parent == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
            if (++parentDepth >= MAX_DEPTH) throw depthLimit();
            ancestor = parent.parentId();
        }
        // 이동할 폴더의 자손도 새 위치에서 최대 깊이를 넘지 않아야 한다.
        visited.clear();
        ArrayDeque<FolderDepth> pending = new ArrayDeque<>();
        pending.add(new FolderDepth(folderId, parentDepth + 1));
        while (!pending.isEmpty()) {
            FolderDepth current = pending.remove();
            if (current.depth() > MAX_DEPTH) throw depthLimit();
            if (!visited.add(current.id())) {
                throw new ResponseStatusException(
                        HttpStatus.CONFLICT,
                        "a folder cannot be moved into itself or its descendants");
            }
            for (UUID child : children.getOrDefault(current.id(), List.of())) {
                pending.add(new FolderDepth(child, current.depth() + 1));
            }
        }
    }

    private List<RateCardFolderEntity> boundedFolders(UUID workspaceId) {
        // 초과 데이터도 정렬 인덱스에서 201개까지만 읽고 부분 목록 대신 충돌을 반환한다.
        List<RateCardFolderEntity> folders =
                folderRepository.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspaceId);
        if (folders.size() > MAX_FOLDERS) throw folderLimit();
        return folders;
    }

    private static ResponseStatusException folderLimit() {
        return new ResponseStatusException(
                HttpStatus.CONFLICT, "a workspace can contain at most 200 rate-card folders");
    }

    private static ResponseStatusException depthLimit() {
        return new ResponseStatusException(
                HttpStatus.CONFLICT, "rate-card folders can be nested at most 8 levels");
    }

    private RateCardFolderEntity folder(UUID workspaceId, UUID folderId) {
        return folderRepository
                .findByIdAndWorkspaceId(folderId, workspaceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    private void authorize(UUID userId, UUID workspaceId, PermissionCode permission) {
        AuthorizationDecision decision =
                authorizationService.authorize(userId, workspaceId, permission);
        if (decision == AuthorizationDecision.NOT_FOUND)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        if (decision == AuthorizationDecision.FORBIDDEN)
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    private void lockWorkspace(UUID workspaceId) {
        if (workspaceRepository.findByIdForUpdate(workspaceId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
    }

    private static RateCardFolderResponse response(RateCardFolderEntity folder) {
        return new RateCardFolderResponse(
                folder.id(), folder.workspaceId(), folder.parentId(), folder.name(), folder.version());
    }

    private record FolderDepth(UUID id, int depth) {}
}
