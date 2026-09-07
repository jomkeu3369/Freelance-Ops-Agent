package com.freelanceops.backend.global.health;

import org.junit.jupiter.api.Test;
import org.springframework.boot.health.contributor.Status;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DatabaseHealthIndicatorTest {

    @Test
    void validatesWithDeadlineAndReturnsConnectionToPool() throws SQLException {
        DataSource source = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        when(source.getConnection()).thenReturn(connection);
        when(connection.isValid(1)).thenReturn(true);

        assertThat(new DatabaseHealthIndicator(source).health().getStatus()).isEqualTo(Status.UP);
        verify(connection).isValid(1);
        verify(connection).close();
    }

    @Test
    void invalidConnectionIsDown() throws SQLException {
        DataSource source = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        when(source.getConnection()).thenReturn(connection);

        assertThat(new DatabaseHealthIndicator(source).health().getStatus()).isEqualTo(Status.DOWN);
        verify(connection).close();
    }

    @Test
    void acquisitionFailureDoesNotExposeCredentials() throws SQLException {
        DataSource source = mock(DataSource.class);
        when(source.getConnection()).thenThrow(new SQLException("private database connection details"));

        var health = new DatabaseHealthIndicator(source).health();
        assertThat(health.getStatus()).isEqualTo(Status.DOWN);
        assertThat(health.getDetails()).isEmpty();
    }
}
