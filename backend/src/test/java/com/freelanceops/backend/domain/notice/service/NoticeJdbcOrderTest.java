package com.freelanceops.backend.domain.notice.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.freelanceops.backend.domain.notice.dto.response.NoticeCampaignResponse;
import com.freelanceops.backend.domain.notice.repository.JdbcNoticeRepository;
import com.freelanceops.backend.global.mail.OperationalMailTransport;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

class NoticeJdbcOrderTest {
    private static final Instant NOW = Instant.parse("2026-10-06T00:00:00Z");
    private final UUID actor = UUID.randomUUID();
    private final UUID campaignId = UUID.randomUUID();
    private final UUID recipient = UUID.randomUUID();
    private final List<String> calls = new ArrayList<>();
    private final List<Object[]> queueBindings = new ArrayList<>();

    @Test
    void dispatchLocksGrantCampaignDeliveryAndRecipientBeforeSendingAndRecording() {
        var mail =
                mock(
                        OperationalMailTransport.class,
                        invocation -> {
                            if (invocation.getMethod().getName().equals("ready")) return true;
                            calls.add("send");
                            return OperationalMailTransport.Result.ACCEPTED;
                        });
        var service =
                new NoticeService(
                        repository(campaign("QUEUED")),
                        mail,
                        200,
                        true,
                        Clock.fixed(NOW, java.time.ZoneOffset.UTC));

        assertThat(service.dispatchNext(actor, campaignId).status()).isEqualTo("ACCEPTED");

        assertThat(calls)
                .containsExactly(
                        "lock grant",
                        "lock campaign",
                        "read counts",
                        "read campaign",
                        "lock delivery",
                        "lock recipient",
                        "send",
                        "record delivery",
                        "audit",
                        "complete campaign");
    }

    @Test
    void queueingRetainsSeparateClockReadsForNextAttemptAndUpdatedAt() {
        Clock clock = mock(Clock.class);
        AtomicInteger ticks = new AtomicInteger();
        when(clock.instant()).thenAnswer(invocation -> NOW.plusSeconds(ticks.incrementAndGet()));
        var service =
                new NoticeService(
                        repository(campaign("DRAFT")),
                        mock(OperationalMailTransport.class),
                        200,
                        true,
                        clock);
        String hash = NoticeIntegrity.hash(List.of(recipient.toString(), "recipient@example.test"));

        service.confirm(actor, campaignId, "content", hash, 1, "QUEUE_OPERATIONAL_NOTICE");

        assertThat(queueBindings).hasSize(1);
        Object[] args = queueBindings.getFirst();
        assertThat(((Timestamp) args[2]).toInstant())
                .isEqualTo(((Timestamp) args[1]).toInstant().plusSeconds(1));
        assertThat(calls)
                .containsSubsequence(
                        "lock grant",
                        "lock campaign",
                        "read campaign",
                "read tester",
                        "read recipients",
                        "queue campaign",
                        "queue deliveries",
                        "audit");
    }

    private NoticeCampaignResponse campaign(String status) {
        return new NoticeCampaignResponse(
                campaignId,
                UUID.randomUUID(),
                "Title",
                "Body",
                "v1",
                status,
                "content",
                NoticeIntegrity.hash(List.of(recipient.toString(), "recipient@example.test")),
                1,
                "ACCEPTED",
                NOW,
                Map.of());
    }

    private JdbcNoticeRepository repository(NoticeCampaignResponse campaign) {
        JdbcTemplate jdbc =
                mock(
                        JdbcTemplate.class,
                        invocation -> {
                            String sql = invocation.getArgument(0);
                            if (sql.contains("capability='NOTICES_ADMIN'")) {
                                assertThat(sql).contains("FOR SHARE");
                                calls.add("lock grant");
                                return List.of(actor);
                            }
                            if (sql.startsWith("SELECT id FROM app.notice_campaign")) {
                                assertThat(sql).contains("FOR UPDATE");
                                calls.add("lock campaign");
                                return List.of(campaignId);
                            }
                            if (sql.startsWith("SELECT status,COUNT(*)")) {
                                calls.add("read counts");
                                return null;
                            }
                            if (sql.startsWith("SELECT * FROM app.notice_campaign")) {
                                calls.add("read campaign");
                                return campaign;
                            }
                            if (sql.contains("SELECT id,user_id,recipient_email,attempts")) {
                                assertThat(sql).contains("FOR UPDATE SKIP LOCKED");
                                calls.add("lock delivery");
                                return List.of(
                                        new JdbcNoticeRepository.Delivery(
                                                UUID.randomUUID(),
                                                recipient,
                                                "recipient@example.test",
                                                0));
                            }
                            if (sql.startsWith("SELECT id FROM app.user_account")) {
                                assertThat(sql).contains("FOR SHARE");
                                calls.add("lock recipient");
                                return List.of(recipient);
                            }
                            if (sql.startsWith("SELECT test_by")) {
                calls.add("read tester");
                                return actor;
                            }
                            if (sql.startsWith("SELECT user_id,recipient_email")) {
                                calls.add("read recipients");
                                return List.of(
                                        new JdbcNoticeRepository.Recipient(
                                                recipient, "recipient@example.test"));
                            }
                            if (sql.startsWith("UPDATE app.notice_campaign SET status='QUEUED'"))
                                calls.add("queue campaign");
                            else if (sql.startsWith(
                                    "UPDATE app.notice_delivery SET status='QUEUED'")) {
                                calls.add("queue deliveries");
                                queueBindings.add(invocation.getArguments());
                            } else if (sql.startsWith("UPDATE app.notice_delivery SET status=?"))
                                calls.add("record delivery");
                            else if (sql.startsWith("INSERT INTO app.notice_admin_audit"))
                                calls.add("audit");
                            else if (sql.contains("SET status='COMPLETED'"))
                                calls.add("complete campaign");
                            else throw new AssertionError(sql);
                            return 1;
                        });
        return new JdbcNoticeRepository(jdbc);
    }
}
