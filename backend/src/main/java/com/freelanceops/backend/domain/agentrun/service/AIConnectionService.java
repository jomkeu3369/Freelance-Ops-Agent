package com.freelanceops.backend.domain.agentrun.service;
import com.freelanceops.backend.domain.agentrun.security.CredentialCipher;
import com.freelanceops.backend.domain.agentrun.client.ProviderCredentialVerifier;

import com.freelanceops.backend.domain.agentrun.model.Provider;
import com.freelanceops.backend.domain.workspace.policy.AuthorizationDecision;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.service.WorkspaceAuthorizationService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import java.time.Instant;
import java.util.*;

@Service
public class AIConnectionService {
    private final JdbcTemplate jdbc;
    private final CredentialCipher cipher;
    private final WorkspaceAuthorizationService authorization;
    private final ProviderCredentialVerifier verifier;
    private final Map<Provider, List<String>> models;

    public AIConnectionService(JdbcTemplate jdbc, CredentialCipher cipher, WorkspaceAuthorizationService authorization,
        ProviderCredentialVerifier verifier, @Value("${APP_BYOK_OPENAI_MODELS:gpt-5.6-luna,gpt-5.6-terra}") String openai,
        @Value("${APP_BYOK_GEMINI_MODELS:gemini-2.5-flash}") String gemini) {
        this.jdbc = jdbc;
        this.cipher = cipher;
        this.authorization = authorization;
        this.verifier = verifier;
        this.models = Map.of(Provider.OPENAI, parseModels(openai), Provider.GEMINI, parseModels(gemini));
    }

    public record Connection(UUID id, Provider provider, String model, String maskedKey, Instant updatedAt) {}
    public record Connections(boolean available, Map<Provider, List<String>> models, List<Connection> connections) {}

    public Connections list(UUID user, UUID workspace) {
        authorize(user, workspace);
        return new Connections(cipher.available(), models, jdbc.query(
            "SELECT id, provider, model, masked_key, updated_at FROM app.ai_connection WHERE workspace_id = ? AND user_id = ? ORDER BY provider",
            (row, n) -> new Connection(row.getObject("id", UUID.class), Provider.valueOf(row.getString("provider")), row.getString("model"), row.getString("masked_key"), row.getTimestamp("updated_at").toInstant()), workspace, user));
    }

    public Connection save(UUID user, UUID workspace, Provider provider, String model, String apiKey) {
        authorize(user, workspace);
        if (!cipher.available()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "AI connection storage unavailable");
        requireModel(provider, model);
        if (apiKey == null || apiKey.length() < 16 || apiKey.length() > 512 || !apiKey.matches("[!-~]+")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid API key format");
        }
        verifier.verify(provider, model, apiKey);
        // Keep the identifier stable on replacement. Concurrent first registrations fail safely.
        UUID id = jdbc.query("SELECT id FROM app.ai_connection WHERE workspace_id = ? AND user_id = ? AND provider = ?",
            (row, n) -> row.getObject("id", UUID.class), workspace, user, provider.name()).stream().findFirst().orElseGet(UUID::randomUUID);
        String encrypted = cipher.encrypt(apiKey, binding(id, workspace, user, provider));
        String masked = "••••" + apiKey.substring(apiKey.length() - 4);
        jdbc.update("""
            INSERT INTO app.ai_connection(id, workspace_id, user_id, provider, model, ciphertext, masked_key)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET model = EXCLUDED.model, ciphertext = EXCLUDED.ciphertext,
                masked_key = EXCLUDED.masked_key, updated_at = CURRENT_TIMESTAMP
            """, id, workspace, user, provider.name(), model, encrypted, masked);
        return list(user, workspace).connections().stream().filter(item -> item.id().equals(id)).findFirst().orElseThrow();
    }

    public void delete(UUID user, UUID workspace, UUID id) {
        authorize(user, workspace);
        if (jdbc.update("DELETE FROM app.ai_connection WHERE id = ? AND workspace_id = ? AND user_id = ?", id, workspace, user) != 1) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
    }

    public void validate(UUID user, UUID workspace, UUID id, Provider provider, String model) {
        if (id == null) return;
        authorize(user, workspace);
        requireModel(provider, model);
        if (!cipher.available()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "AI connection storage unavailable");
        Integer count = jdbc.queryForObject("SELECT count(*) FROM app.ai_connection WHERE id = ? AND workspace_id = ? AND user_id = ? AND provider = ? AND model = ?",
            Integer.class, id, workspace, user, provider.name(), model);
        if (count == null || count != 1) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "AI connection unavailable");
    }

    public String resolve(UUID user, UUID workspace, UUID id, Provider provider, String model) {
        validate(user, workspace, id, provider, model);
        List<String> values = jdbc.query("SELECT ciphertext FROM app.ai_connection WHERE id = ? AND workspace_id = ? AND user_id = ? AND provider = ? AND model = ?",
            (row, n) -> row.getString(1), id, workspace, user, provider.name(), model);
        if (values.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "AI connection unavailable");
        return cipher.decrypt(values.getFirst(), binding(id, workspace, user, provider));
    }

    public void authorize(UUID user, UUID workspace) {
        AuthorizationDecision decision = authorization.authorize(user, workspace, PermissionCode.AGENT_RUN);
        if (decision != AuthorizationDecision.ALLOWED) throw new ResponseStatusException(decision == AuthorizationDecision.NOT_FOUND ? HttpStatus.NOT_FOUND : HttpStatus.FORBIDDEN);
    }

    private void requireModel(Provider provider, String model) {
        if (!models.getOrDefault(provider, List.of()).contains(model)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unsupported connection model");
    }

    static String binding(UUID id, UUID workspace, UUID user, Provider provider) { return id + ":" + workspace + ":" + user + ":" + provider; }
    private static List<String> parseModels(String value) {
        return Arrays.stream(value.split(",")).map(String::trim).filter(model -> model.matches("[a-zA-Z0-9._-]{1,100}")).distinct().toList();
    }
}
