package com.freelanceops.backend.domain.specification.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.util.Optional;
import java.util.UUID;

@Repository
public class SpecificationRequestRepository {
    private final JdbcTemplate jdbc;
    public SpecificationRequestRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Optional<SavedRequest> find(UUID workspaceId, UUID projectId, UUID requestId) {
        return jdbc.query("""
            SELECT operation_hash, specification_id FROM app.specification_request
            WHERE workspace_id = ? AND project_id = ? AND request_id = ?
            """, (row, index) -> new SavedRequest(row.getString(1), row.getObject(2, UUID.class)),
            workspaceId, projectId, requestId).stream().findFirst();
    }

    public void save(UUID workspaceId, UUID projectId, UUID requestId, String operationHash, UUID specificationId) {
        jdbc.update("""
            INSERT INTO app.specification_request(workspace_id, project_id, request_id, operation_hash, specification_id)
            VALUES (?, ?, ?, ?, ?)
            """, workspaceId, projectId, requestId, operationHash, specificationId);
    }
    public record SavedRequest(String operationHash, UUID specificationId) {}
}
