package com.freelanceops.backend.global.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class ApiRateLimitFilter extends OncePerRequestFilter {

    private static final long WINDOW_SECONDS = 60;

    private final boolean enabled;
    private final int authLimit;
    private final int proposalLimit;
    private final int agentLimit;
    private final int maxEntries;
    private final Clock clock;
    private final Map<String, WindowCounter> counters = new ConcurrentHashMap<>();

    @Autowired
    public ApiRateLimitFilter(
        @Value("${app.rate-limit.enabled:true}") boolean enabled,
        @Value("${app.rate-limit.auth-per-minute:20}") int authLimit,
        @Value("${app.rate-limit.public-proposal-per-minute:30}") int proposalLimit,
        @Value("${app.rate-limit.agent-per-minute:20}") int agentLimit,
        @Value("${app.rate-limit.max-entries:10000}") int maxEntries
    ) {
        this(enabled, authLimit, proposalLimit, agentLimit, maxEntries, Clock.systemUTC());
    }

    ApiRateLimitFilter(boolean enabled, int authLimit, int proposalLimit, int agentLimit, int maxEntries, Clock clock) {
        if (authLimit < 1 || proposalLimit < 1 || agentLimit < 1 || maxEntries < 100) {
            throw new IllegalArgumentException("rate limit configuration is invalid");
        }
        this.enabled = enabled;
        this.authLimit = authLimit;
        this.proposalLimit = proposalLimit;
        this.agentLimit = agentLimit;
        this.maxEntries = maxEntries;
        this.clock = clock;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !enabled || category(request) == null;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
        throws ServletException, IOException {
        Category category = category(request);
        if (category == null) {
            chain.doFilter(request, response);
            return;
        }

        long now = clock.instant().getEpochSecond();
        String key = category.name() + ':' + principalKey(request);
        WindowCounter counter = counters.computeIfAbsent(key, ignored -> new WindowCounter(now));
        if (!counter.tryAcquire(now, limit(category))) {
            response.setStatus(429);
            response.setHeader("Retry-After", Long.toString(counter.retryAfter(now)));
            response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
            response.getWriter().write("{\"type\":\"about:blank\",\"title\":\"Too Many Requests\","
                + "\"status\":429,\"code\":\"RATE_LIMIT_EXCEEDED\"}");
            return;
        }
        if (counters.size() > maxEntries) {
            counters.entrySet().removeIf(entry -> entry.getValue().expired(now));
        }
        chain.doFilter(request, response);
    }

    private int limit(Category category) {
        return switch (category) {
            case AUTH -> authLimit;
            case PUBLIC_PROPOSAL -> proposalLimit;
            case AGENT -> agentLimit;
        };
    }

    private static Category category(HttpServletRequest request) {
        if (!"POST".equalsIgnoreCase(request.getMethod())) {
            return null;
        }
        String path = request.getRequestURI();
        if (path.startsWith("/api/v2/auth/")) {
            return Category.AUTH;
        }
        if (path.startsWith("/api/v2/proposals/")) {
            return Category.PUBLIC_PROPOSAL;
        }
        if (path.startsWith("/api/v2/workspaces/") && path.contains("/agent-runs")) {
            return Category.AGENT;
        }
        return null;
    }

    private static String principalKey(HttpServletRequest request) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.isAuthenticated() && !"anonymousUser".equals(authentication.getName())) {
            return "user:" + authentication.getName();
        }
        String remoteAddress = request.getRemoteAddr();
        return "ip:" + (remoteAddress == null || remoteAddress.isBlank() ? "unknown" : remoteAddress);
    }

    private enum Category {
        AUTH,
        PUBLIC_PROPOSAL,
        AGENT
    }

    private static final class WindowCounter {
        private long startedAt;
        private int count;

        private WindowCounter(long startedAt) {
            this.startedAt = startedAt;
        }

        private synchronized boolean tryAcquire(long now, int limit) {
            resetIfExpired(now);
            if (count >= limit) {
                return false;
            }
            count++;
            return true;
        }

        private synchronized long retryAfter(long now) {
            return Math.max(1, WINDOW_SECONDS - (now - startedAt));
        }

        private synchronized boolean expired(long now) {
            return now - startedAt >= WINDOW_SECONDS;
        }

        private void resetIfExpired(long now) {
            if (now - startedAt >= WINDOW_SECONDS) {
                startedAt = now;
                count = 0;
            }
        }
    }
}
