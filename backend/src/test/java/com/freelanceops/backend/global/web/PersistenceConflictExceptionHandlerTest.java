package com.freelanceops.backend.global.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.dao.CannotAcquireLockException;

class PersistenceConflictExceptionHandlerTest {

    @Test
    void databaseConcurrencyFailuresHaveAStableConflictContract() {
        var problem =
                new PersistenceConflictExceptionHandler()
                        .handleConcurrentModification(
                                new CannotAcquireLockException("lock timeout"));

        assertThat(problem.getStatus()).isEqualTo(409);
        assertThat(problem.getProperties()).containsEntry("code", "CONCURRENT_MODIFICATION");
    }
}
