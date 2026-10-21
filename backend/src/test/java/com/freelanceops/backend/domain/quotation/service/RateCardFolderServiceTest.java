package com.freelanceops.backend.domain.quotation.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.freelanceops.backend.domain.quotation.dto.request.MoveRateCardRequest;
import com.freelanceops.backend.domain.quotation.dto.request.UpsertRateCardFolderRequest;
import com.freelanceops.backend.domain.quotation.entity.RateCardEntity;
import com.freelanceops.backend.domain.quotation.entity.RateCardFolderEntity;
import com.freelanceops.backend.domain.quotation.repository.RateCardFolderRepository;
import com.freelanceops.backend.domain.quotation.repository.RateCardRepository;
import com.freelanceops.backend.domain.workspace.entity.WorkspaceEntity;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspaceRepository;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.IntStream;

@ExtendWith(MockitoExtension.class)
class RateCardFolderServiceTest {
    @Mock private RateCardFolderRepository folders;
    @Mock private RateCardRepository cards;
    @Mock private WorkspaceAuthorizationService authorization;
    @Mock private WorkspaceRepository workspaces;

    private final UUID user = UUID.randomUUID();
    private final UUID workspace = UUID.randomUUID();

    @Test
    void createsTrimmedRootAndNestedFoldersAfterLockingTheWorkspace() {
        allowWrite();
        UUID id = UUID.randomUUID();
        var parent = folder(UUID.randomUUID(), null, "Parent");
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(List.of(parent));
        when(folders.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));

        var result = service().upsertFolder(user, workspace, id, request("  Child  ", parent.id()));

        assertThat(result.name()).isEqualTo("Child");
        assertThat(result.parentId()).isEqualTo(parent.id());
        assertThat(result.workspaceId()).isEqualTo(workspace);
        verify(workspaces).findByIdForUpdate(workspace);
        verify(folders).saveAndFlush(any());
    }

    @Test
    void anEditCannotRecreateAFolderDeletedByAnotherClient() {
        allowWrite();
        UUID id = UUID.randomUUID();

        assertStatus(409, () -> service().upsertFolder(user, workspace, id,
                new UpsertRateCardFolderRequest("Stale rename", null, 0L)));

        verify(folders, never()).saveAndFlush(any());
    }

    @Test
    void aStaleVersionCannotOverwriteAnotherClientsFolderChange() {
        allowWrite();
        var current = folder(UUID.randomUUID(), null, "Other clients rename");
        when(folders.findById(current.id())).thenReturn(Optional.of(current));

        assertStatus(409, () -> service().upsertFolder(user, workspace, current.id(),
                new UpsertRateCardFolderRequest("Stale rename", null, 1L)));

        verify(folders, never()).saveAndFlush(any());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void anUnversionedEditCannotRenameOrMoveAnExistingFolder(boolean moving) {
        allowWrite();
        var current = folder(UUID.randomUUID(), null, "Original");
        when(folders.findById(current.id())).thenReturn(Optional.of(current));

        assertReason("folder changed; reload and try again", () -> service().upsertFolder(
                user, workspace, current.id(), request(moving ? current.name() : "Overwritten", moving ? UUID.randomUUID() : null)));

        assertThat(current.name()).isEqualTo("Original");
        assertThat(current.parentId()).isNull();
        verify(folders, never()).findTop201ByWorkspaceIdOrderByNameAscIdAsc(any());
        verify(folders, never()).saveAndFlush(any());
    }

    @Test
    void anIdenticalEditRetrySucceedsEvenAfterTheVersionAdvanced() {
        allowWrite();
        var current = folder(UUID.randomUUID(), null, "Saved rename");
        when(folders.findById(current.id())).thenReturn(Optional.of(current));
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(List.of(current));

        assertThat(service().upsertFolder(user, workspace, current.id(),
                new UpsertRateCardFolderRequest("Saved rename", null, 1L)).name()).isEqualTo("Saved rename");

        verify(folders, never()).saveAndFlush(any());
    }

    @Test
    void repeatingAnIdenticalPutDoesNotInsertOrAdvanceTheRevision() {
        allowWrite();
        var folder = folder(UUID.randomUUID(), null, "Existing");
        when(folders.findById(folder.id())).thenReturn(Optional.of(folder));
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(List.of(folder));

        var response = service().upsertFolder(user, workspace, folder.id(), request("Existing", null));

        assertThat(response.id()).isEqualTo(folder.id());
        assertThat(response.version()).isZero();
        verify(folders, never()).saveAndFlush(any());
    }

    @Test
    void rejectsMovingAnAncestorBelowItsGrandchild() {
        allowWrite();
        var root = folder(UUID.randomUUID(), null, "Root");
        var child = folder(UUID.randomUUID(), root.id(), "Child");
        var leaf = folder(UUID.randomUUID(), child.id(), "Leaf");
        when(folders.findById(root.id())).thenReturn(Optional.of(root));
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(List.of(root, child, leaf));

        assertReason("a folder cannot be moved into itself or its descendants",
                () -> service().upsertFolder(user, workspace, root.id(), request("Root", leaf.id(), root.version())));

        verify(folders, never()).saveAndFlush(any());
    }

    @Test
    void rejectsItsOwnIdAsParentEvenDuringCreation() {
        allowWrite();
        UUID id = UUID.randomUUID();
        assertStatus(409, () -> service().upsertFolder(user, workspace, id, request("Self", id)));
        verify(folders, never()).saveAndFlush(any());
    }

    @Test
    void rejectsUnknownOrForeignParentsWithoutSaving() {
        allowWrite();
        assertStatus(404, () -> service().upsertFolder(user, workspace, UUID.randomUUID(), request("Child", UUID.randomUUID())));
        verify(folders, never()).saveAndFlush(any());
    }

    @Test
    void foreignFolderIdsCannotBeOverwrittenByUpsert() {
        allowWrite();
        UUID id = UUID.randomUUID();
        var foreign = new RateCardFolderEntity(id, UUID.randomUUID(), null, "Private", user, Instant.now());
        when(folders.findById(id)).thenReturn(Optional.of(foreign));
        assertStatus(404, () -> service().upsertFolder(user, workspace, id, request("Overwrite", null)));
        verify(folders, never()).saveAndFlush(any());
    }

    @Test
    void duplicateSiblingNamesIgnoreCaseButDifferentParentsMayReuseThem() {
        allowWrite();
        var root = folder(UUID.randomUUID(), null, "Services");
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(List.of(root));
        assertStatus(409, () -> service().upsertFolder(user, workspace, UUID.randomUUID(), request("services", null)));

        when(folders.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
        var nested = service().upsertFolder(user, workspace, UUID.randomUUID(), request("Services", root.id()));
        assertThat(nested.parentId()).isEqualTo(root.id());
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"   ", "Line\nBreak", "Tab\tName"})
    void rejectsBlankOrControlCharacterNames(String name) {
        allowWrite();
        assertStatus(400, () -> service().upsertFolder(user, workspace, UUID.randomUUID(), request(name, null)));
        verifyNoInteractions(folders, cards);
    }

    @Test
    void rejectsNamesLongerThanTheStoredLimit() {
        allowWrite();
        assertStatus(400, () -> service().upsertFolder(user, workspace, UUID.randomUUID(), request("x".repeat(121), null)));
    }

    @Test
    void readingRequiresQuotationReadAndReturnsOnlyTheRequestedWorkspace() {
        when(authorization.authorize(user, workspace, PermissionCode.QUOTATION_READ)).thenReturn(AuthorizationDecision.ALLOWED);
        var folder = folder(UUID.randomUUID(), null, "Visible");
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(List.of(folder));
        assertThat(service().listFolders(user, workspace)).extracting(item -> item.id()).containsExactly(folder.id());
        verifyNoInteractions(cards, workspaces);
    }

    @Test
    void everyMutationChecksWritePermissionBeforeReadingOrLocking() {
        when(authorization.authorize(user, workspace, PermissionCode.QUOTATION_WRITE)).thenReturn(AuthorizationDecision.FORBIDDEN);
        UUID id = UUID.randomUUID();
        assertStatus(403, () -> service().upsertFolder(user, workspace, id, request("Denied", null)));
        assertStatus(403, () -> service().deleteFolder(user, workspace, id));
        assertStatus(403, () -> service().moveRateCard(user, workspace, id, new MoveRateCardRequest(null)));
        verifyNoInteractions(folders, cards, workspaces);
    }

    @Test
    void absentMembershipDoesNotDiscloseWorkspaceContents() {
        when(authorization.authorize(user, workspace, PermissionCode.QUOTATION_READ)).thenReturn(AuthorizationDecision.NOT_FOUND);
        assertStatus(404, () -> service().listFolders(user, workspace));
        verifyNoInteractions(folders, cards, workspaces);
    }

    @Test
    void onlyEmptyFoldersCanBeDeletedIncludingInactiveRateCards() {
        allowWrite();
        var folder = folder(UUID.randomUUID(), null, "Occupied");
        when(folders.findByIdAndWorkspaceId(folder.id(), workspace)).thenReturn(Optional.of(folder));
        when(folders.existsByWorkspaceIdAndParentId(workspace, folder.id())).thenReturn(true, false);
        assertStatus(409, () -> service().deleteFolder(user, workspace, folder.id()));
        when(cards.existsByWorkspaceIdAndFolderId(workspace, folder.id())).thenReturn(true);
        assertStatus(409, () -> service().deleteFolder(user, workspace, folder.id()));
        verify(folders, never()).delete(any());
    }

    @Test
    void anEmptyFolderIsDeletedAndFlushed() {
        allowWrite();
        var folder = folder(UUID.randomUUID(), null, "Empty");
        when(folders.findByIdAndWorkspaceId(folder.id(), workspace)).thenReturn(Optional.of(folder));
        service().deleteFolder(user, workspace, folder.id());
        verify(folders).delete(folder);
        verify(folders).flush();
    }

    @Test
    void movingAnInactiveRatePreservesItsIdentityMoneyAndStatus() {
        allowWrite();
        var folder = folder(UUID.randomUUID(), null, "Target");
        var card = card(UUID.randomUUID());
        card.update("Stored", "DAY", new BigDecimal("400.25"), new BigDecimal("50.00"), "USD", false, Instant.now());
        when(cards.findByIdAndWorkspaceId(card.id(), workspace)).thenReturn(Optional.of(card));
        when(folders.findByIdAndWorkspaceId(folder.id(), workspace)).thenReturn(Optional.of(folder));
        when(cards.saveAndFlush(card)).thenReturn(card);

        var result = service().moveRateCard(user, workspace, card.id(), new MoveRateCardRequest(folder.id()));

        assertThat(result.id()).isEqualTo(card.id());
        assertThat(result.folderId()).isEqualTo(folder.id());
        assertThat(result.rate()).isEqualByComparingTo("400.25");
        assertThat(result.minimumAmount()).isEqualByComparingTo("50.00");
        assertThat(result.currency()).isEqualTo("USD");
        assertThat(result.unit().name()).isEqualTo("DAY");
        assertThat(result.active()).isFalse();
    }

    @Test
    void repeatingAnUnclassifiedMoveDoesNotAdvanceTheRevision() {
        allowWrite();
        var card = card(UUID.randomUUID());
        when(cards.findByIdAndWorkspaceId(card.id(), workspace)).thenReturn(Optional.of(card));
        assertThat(service().moveRateCard(user, workspace, card.id(), new MoveRateCardRequest(null)).folderId()).isNull();
        verify(cards, never()).saveAndFlush(any());
    }

    @Test
    void movingToAnUnknownOrForeignFolderCannotChangeTheCard() {
        allowWrite();
        var card = card(UUID.randomUUID());
        when(cards.findByIdAndWorkspaceId(card.id(), workspace)).thenReturn(Optional.of(card));
        assertStatus(404, () -> service().moveRateCard(user, workspace, card.id(), new MoveRateCardRequest(UUID.randomUUID())));
        assertThat(card.folderId()).isNull();
        verify(cards, never()).saveAndFlush(any());
    }

    @Test
    void aNewFolderCanFillTheLastAvailableSlot() {
        allowWrite();
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(roots(199));
        when(folders.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
        assertThat(service().upsertFolder(user, workspace, UUID.randomUUID(), request("Last", null)).name()).isEqualTo("Last");
        var order = inOrder(workspaces, folders);
        order.verify(workspaces).findByIdForUpdate(workspace);
        order.verify(folders).findById(any());
        order.verify(folders).findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace);
        order.verify(folders).saveAndFlush(any());
    }

    @Test
    void creationAtTheQuotaCannotWriteAnotherFolder() {
        allowWrite();
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(roots(200));
        assertReason("a workspace can contain at most 200 rate-card folders",
                () -> service().upsertFolder(user, workspace, UUID.randomUUID(), request("Overflow", null)));
        verify(folders, never()).saveAndFlush(any());
    }

    @Test
    void identicalRetriesAtTheQuotaDoNotWriteOrAdvanceTheRevision() {
        allowWrite();
        var existing = roots(200);
        var current = existing.getFirst();
        when(folders.findById(current.id())).thenReturn(Optional.of(current));
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(existing);
        var result = service().upsertFolder(user, workspace, current.id(), request(current.name(), null));
        assertThat(result.version()).isZero();
        assertThat(result.id()).isEqualTo(current.id());
        verify(folders, never()).saveAndFlush(any());
    }

    @Test
    void existingFoldersCanStillBeRenamedAndMovedAtTheQuota() {
        allowWrite();
        var existing = roots(200);
        var current = existing.getFirst();
        var parent = existing.getLast();
        when(folders.findById(current.id())).thenReturn(Optional.of(current));
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(existing);
        when(folders.saveAndFlush(current)).thenReturn(current);
        var result = service().upsertFolder(user, workspace, current.id(), request("Renamed", parent.id(), current.version()));
        assertThat(result.name()).isEqualTo("Renamed");
        assertThat(result.parentId()).isEqualTo(parent.id());
    }

    @Test
    void legacyOverflowCannotReturnAPartialListOrPermitFurtherUpserts() {
        allowWrite();
        when(authorization.authorize(user, workspace, PermissionCode.QUOTATION_READ)).thenReturn(AuthorizationDecision.ALLOWED);
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(roots(201));
        assertReason("a workspace can contain at most 200 rate-card folders", () -> service().listFolders(user, workspace));
        assertReason("a workspace can contain at most 200 rate-card folders",
                () -> service().upsertFolder(user, workspace, UUID.randomUUID(), request("Overflow", null)));
        verify(folders, never()).saveAndFlush(any());
    }

    @Test
    void aWorkspaceAtTheQuotaStillReturnsTheCompleteList() {
        when(authorization.authorize(user, workspace, PermissionCode.QUOTATION_READ)).thenReturn(AuthorizationDecision.ALLOWED);
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(roots(200));
        assertThat(service().listFolders(user, workspace)).hasSize(200);
    }

    @Test
    void aNewLeafAtTheEighthLevelIsAllowed() {
        allowWrite();
        var ancestors = chain(7);
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(ancestors);
        when(folders.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
        var result = service().upsertFolder(user, workspace, UUID.randomUUID(), request("Eighth", ancestors.getLast().id()));
        assertThat(result.parentId()).isEqualTo(ancestors.getLast().id());
    }

    @Test
    void aNinthLevelLeafIsRejectedBeforeSaving() {
        allowWrite();
        var ancestors = chain(8);
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(ancestors);
        assertReason("rate-card folders can be nested at most 8 levels",
                () -> service().upsertFolder(user, workspace, UUID.randomUUID(), request("Ninth", ancestors.getLast().id())));
        verify(folders, never()).saveAndFlush(any());
    }

    @Test
    void movingASubtreeChecksItsDeepestDescendantAtTheNewLocation() {
        allowWrite();
        var existing = new ArrayList<>(chain(7));
        var moving = folder(UUID.randomUUID(), null, "Moving");
        var child = folder(UUID.randomUUID(), moving.id(), "Child");
        existing.add(moving);
        existing.add(child);
        when(folders.findById(moving.id())).thenReturn(Optional.of(moving));
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(existing);
        assertReason("rate-card folders can be nested at most 8 levels",
                () -> service().upsertFolder(user, workspace, moving.id(), request("Moving", existing.get(6).id(), moving.version())));
        assertThat(moving.parentId()).isNull();
        verify(folders, never()).saveAndFlush(any());
    }

    @Test
    void movingASubtreeWhoseDeepestDescendantWillBeAtLevelEightIsAllowed() {
        allowWrite();
        var existing = new ArrayList<>(chain(6));
        var moving = folder(UUID.randomUUID(), null, "Moving");
        existing.add(moving);
        existing.add(folder(UUID.randomUUID(), moving.id(), "Child"));
        when(folders.findById(moving.id())).thenReturn(Optional.of(moving));
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(existing);
        when(folders.saveAndFlush(moving)).thenReturn(moving);
        assertThat(service().upsertFolder(user, workspace, moving.id(), request("Moving", existing.get(5).id(), moving.version())).parentId()).isEqualTo(existing.get(5).id());
    }

    @Test
    void repeatingAnEighthLevelPutRemainsIdempotent() {
        allowWrite();
        var existing = chain(8);
        var leaf = existing.getLast();
        when(folders.findById(leaf.id())).thenReturn(Optional.of(leaf));
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(existing);
        assertThat(service().upsertFolder(user, workspace, leaf.id(), request(leaf.name(), leaf.parentId())).version()).isZero();
        verify(folders, never()).saveAndFlush(any());
    }

    @Test
    void anOversizedLegacySubtreeCanBeMovedBackWithinTheDepthLimit() {
        allowWrite();
        var existing = chain(9);
        var moving = existing.get(1);
        when(folders.findById(moving.id())).thenReturn(Optional.of(moving));
        when(folders.findTop201ByWorkspaceIdOrderByNameAscIdAsc(workspace)).thenReturn(existing);
        when(folders.saveAndFlush(moving)).thenReturn(moving);
        assertThat(service().upsertFolder(user, workspace, moving.id(), request(moving.name(), null, moving.version())).parentId()).isNull();
    }

    private List<RateCardFolderEntity> roots(int count) {
        return IntStream.range(0, count).mapToObj(index -> folder(UUID.randomUUID(), null, "Root " + index)).toList();
    }

    private List<RateCardFolderEntity> chain(int depth) {
        List<RateCardFolderEntity> result = new ArrayList<>();
        for (int index = 0; index < depth; index++) {
            UUID parent = result.isEmpty() ? null : result.getLast().id();
            result.add(folder(UUID.randomUUID(), parent, "Level " + index));
        }
        return result;
    }

    private static void assertReason(String reason, Runnable operation) {
        assertThatThrownBy(operation::run).isInstanceOfSatisfying(ResponseStatusException.class, error -> {
            assertThat(error.getStatusCode().value()).isEqualTo(409);
            assertThat(error.getReason()).isEqualTo(reason);
        });
    }

    private void allowWrite() {
        when(authorization.authorize(user, workspace, PermissionCode.QUOTATION_WRITE)).thenReturn(AuthorizationDecision.ALLOWED);
        when(workspaces.findByIdForUpdate(workspace)).thenReturn(Optional.of(WorkspaceEntity.active(workspace, "Test", "test", user)));
    }

    private RateCardFolderService service() {
        return new RateCardFolderService(folders, cards, authorization, workspaces);
    }

    private RateCardFolderEntity folder(UUID id, UUID parentId, String name) {
        return new RateCardFolderEntity(id, workspace, parentId, name, user, Instant.now());
    }

    private RateCardEntity card(UUID id) {
        return new RateCardEntity(id, workspace, "Stored", "HOUR", BigDecimal.ONE, BigDecimal.ZERO, "KRW", user, Instant.now());
    }

    private static UpsertRateCardFolderRequest request(String name, UUID parentId) {
        return new UpsertRateCardFolderRequest(name, parentId, null);
    }

    private static UpsertRateCardFolderRequest request(String name, UUID parentId, long expectedVersion) {
        return new UpsertRateCardFolderRequest(name, parentId, expectedVersion);
    }

    private static void assertStatus(int status, Runnable operation) {
        assertThatThrownBy(operation::run)
                .isInstanceOfSatisfying(ResponseStatusException.class, error -> assertThat(error.getStatusCode().value()).isEqualTo(status));
    }
}
