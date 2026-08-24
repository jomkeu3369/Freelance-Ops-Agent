package com.freelanceops.backend.global.web;

import org.junit.jupiter.api.Test;
import org.springframework.dao.CannotAcquireLockException;

import static org.assertj.core.api.Assertions.assertThat;

class PersistenceConflictExceptionHandlerTest {

    @Test
    void databaseConcurrencyFailuresHaveAStableConflictContract() {
        var problem = new PersistenceConflictExceptionHandler()
            .handleConcurrentModification(new CannotAcquireLockException("lock timeout"));

        assertThat(problem.getStatus()).isEqualTo(409);
        assertThat(problem.getProperties()).containsEntry("code", "CONCURRENT_MODIFICATION");
    }
}
