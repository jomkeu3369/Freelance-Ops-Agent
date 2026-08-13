package com.freelanceops.backend.internaltool.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

@Component
public class DelegationTokenFilter extends OncePerRequestFilter {

    public static final String PRINCIPAL_ATTRIBUTE = "internalToolDelegationPrincipal";
    private final DelegationTokenVerifier verifier;

    public DelegationTokenFilter(DelegationTokenVerifier verifier) {
        this.verifier = verifier;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/internal/v1/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain) throws ServletException, IOException {
        try {
            String authorization = request.getHeader("Authorization");
            if (authorization == null || !authorization.startsWith("Bearer ")) {
                throw new DelegationTokenException("bearer delegation token is required");
            }
            DelegationPrincipal principal = verifier.verify(authorization.substring(7));
            String runIdHeader = request.getHeader("X-Run-Id");
            if (runIdHeader == null) {
                throw new DelegationTokenException("run id header is required");
            }
            UUID runId = UUID.fromString(runIdHeader);
            if (!principal.runId().equals(runId)) {
                throw new DelegationTokenException("run binding does not match");
            }
            request.setAttribute(PRINCIPAL_ATTRIBUTE, principal);
            filterChain.doFilter(request, response);
        } catch (DelegationTokenException | IllegalArgumentException error) {
            writeUnauthorized(response);
        }
    }

    private void writeUnauthorized(HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.getWriter().write("{\"type\":\"about:blank\",\"title\":\"Unauthorized\",\"status\":401,"
            + "\"detail\":\"The delegation token is invalid or is not bound to this run.\","
            + "\"code\":\"DELEGATION_TOKEN_INVALID\"}");
    }
}
