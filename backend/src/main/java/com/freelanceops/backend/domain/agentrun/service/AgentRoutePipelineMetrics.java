package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.model.RouteCollectionStatus;
import com.freelanceops.backend.domain.agentrun.repository.AgentRouteCollectionRepository;
import com.freelanceops.backend.domain.agentrun.repository.AgentRouteObservationRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

@Service
@ConditionalOnProperty(name = "agent.route-observation-collection-enabled", havingValue = "true")
public class AgentRoutePipelineMetrics {
    private static final Logger log = LoggerFactory.getLogger(AgentRoutePipelineMetrics.class);
    private final AgentRouteCollectionRepository collectionRepository;
    private final AgentRouteObservationRepository observationRepository;
    private final Counter collectionBatches;
    private final Counter collectionRetries;
    private final Counter observationsCaptured;
    private final Counter reviewClaims;
    private final Counter reviewVotes;
    private final Counter reviewsCompleted;
    private final Timer snapshotLatency;
    private final AtomicLong collectionBacklog = new AtomicLong();
    private final AtomicLong reviewBacklog = new AtomicLong();
    private final AtomicLong oldestCollectionLagSeconds = new AtomicLong();
    private final AtomicLong oldestReviewAgeSeconds = new AtomicLong();

    public AgentRoutePipelineMetrics(MeterRegistry registry,
                                     AgentRouteCollectionRepository collectionRepository,
                                     AgentRouteObservationRepository observationRepository) {
        this.collectionRepository = collectionRepository;
        this.observationRepository = observationRepository;
        collectionBatches = registry.counter("freelance_ops.route.collection.batches");
        collectionRetries = registry.counter("freelance_ops.route.collection.retries");
        observationsCaptured = registry.counter("freelance_ops.route.observations.captured");
        reviewClaims = registry.counter("freelance_ops.route.review.claims");
        reviewVotes = registry.counter("freelance_ops.route.review.votes");
        reviewsCompleted = registry.counter("freelance_ops.route.review.completed");
        snapshotLatency = registry.timer("freelance_ops.route.collection.snapshot.latency");
        Gauge.builder("freelance_ops.route.collection.backlog", collectionBacklog, AtomicLong::get)
            .register(registry);
        Gauge.builder("freelance_ops.route.review.backlog", reviewBacklog, AtomicLong::get)
            .register(registry);
        Gauge.builder("freelance_ops.route.collection.oldest.lag.seconds", oldestCollectionLagSeconds,
            AtomicLong::get).register(registry);
        Gauge.builder("freelance_ops.route.review.oldest.age.seconds", oldestReviewAgeSeconds,
            AtomicLong::get).register(registry);
    }

    @Scheduled(fixedDelayString = "${agent.route-observation-metrics-refresh-ms:15000}")
    public void refresh() {
        Instant now = Instant.now();
        try {
            collectionBacklog.set(collectionRepository.countByStatusNot(RouteCollectionStatus.COMPLETED));
            reviewBacklog.set(observationRepository.countByReviewedAtIsNull());
            oldestCollectionLagSeconds.set(ageSeconds(collectionRepository.oldestIncompleteAvailableAt(), now));
            oldestReviewAgeSeconds.set(ageSeconds(observationRepository.oldestUnreviewedOccurredAt(), now));
        } catch (RuntimeException error) {
            log.debug("Route pipeline metric refresh deferred", error);
        }
    }

    public void recordCollection(int observations, long elapsedNanos) {
        collectionBatches.increment();
        observationsCaptured.increment(observations);
        snapshotLatency.record(elapsedNanos, TimeUnit.NANOSECONDS);
    }

    public void recordRetry(long elapsedNanos) {
        collectionRetries.increment();
        snapshotLatency.record(elapsedNanos, TimeUnit.NANOSECONDS);
    }

    public void recordClaims(int count) {
        reviewClaims.increment(count);
    }

    public void recordReviewCompleted() {
        reviewsCompleted.increment();
    }

    public void recordReviewVote() {
        reviewVotes.increment();
    }

    private static long ageSeconds(Optional<Instant> oldest, Instant now) {
        return oldest.map(value -> Math.max(0, Duration.between(value, now).toSeconds())).orElse(0L);
    }
}
