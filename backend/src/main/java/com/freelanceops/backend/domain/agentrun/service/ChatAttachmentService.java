package com.freelanceops.backend.domain.agentrun.service;

import com.freelanceops.backend.domain.agentrun.client.AttachmentReaderClient;
import com.freelanceops.backend.domain.agentrun.client.dto.request.InternalAgentRunRequest.TrustedRunContext;
import com.freelanceops.backend.domain.agentrun.dto.AttachmentText;
import com.freelanceops.backend.domain.agentrun.security.DelegationTokenIssuer;
import com.freelanceops.backend.domain.project.repository.ProjectRepository;
import com.freelanceops.backend.domain.workspace.policy.PermissionCode;
import com.freelanceops.backend.domain.workspace.repository.WorkspacePermissionReader;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.*;
import java.io.IOException;

@Service
public class ChatAttachmentService {
    public record Preview(UUID id, Instant expiresAt, AttachmentText extraction) { }
    private final WorkspacePermissionReader permissions;
    private final ProjectRepository projects;
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final AttachmentReaderClient reader;
    private final DelegationTokenIssuer tokens;
    public ChatAttachmentService(WorkspacePermissionReader permissions, ProjectRepository projects, JdbcTemplate jdbc,
                                 ObjectMapper mapper, AttachmentReaderClient reader, DelegationTokenIssuer tokens) {
        this.permissions = permissions; this.projects = projects; this.jdbc = jdbc;
        this.mapper = mapper; this.reader = reader; this.tokens = tokens;
    }

    private List<String> authorize(UUID user, UUID workspace, UUID project) {
        var membership = permissions.findActiveMembership(user, workspace)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!membership.permissions().containsAll(Set.of(PermissionCode.AGENT_RUN, PermissionCode.PROJECT_READ)))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        projects.findByIdAndWorkspaceIdForUpdate(project, workspace)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND)).requireNotDeleting();
        return membership.permissions().stream().map(PermissionCode::code).sorted().toList();
    }

    @Transactional
    public Preview upload(UUID user, UUID workspace, UUID project, MultipartFile file, String encoding, String delimiter) {
        return upload(user, workspace, project, file, encoding, delimiter, "mixed", "general");
    }

    @Transactional
    public Preview upload(UUID user, UUID workspace, UUID project, MultipartFile file, String encoding, String delimiter,
                          String ocrLanguage, String ocrLayout) {
        List<String> allowed = authorize(user, workspace, project);
        String name = file.getOriginalFilename();
        if (name == null || name.length() > 180 || name.chars().anyMatch(c -> c < 32 || c == 127 || c == 47 || c == 92 || c == 58)
            || !name.toLowerCase(Locale.ROOT).matches(".+\\.(txt|csv|pdf|jpg|jpeg|png|gif)"))
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT, "Invalid attachment filename or extension");
        if (file.isEmpty() || file.getSize() > 2097152)
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Files must be 1 byte to 2 MiB");
        if (!Set.of("auto", "utf-8", "utf-16", "cp949").contains(encoding)
            || !Set.of("auto", ",", ";", "\t", "|").contains(delimiter)
            || !Set.of("mixed", "ko", "en").contains(ocrLanguage) || !Set.of("general", "singleblock").contains(ocrLayout))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid attachment reading options");
        // Serialize the per-user staging quota across projects and application instances.
        jdbc.queryForList("SELECT id FROM app.user_account WHERE id = ? FOR UPDATE", user);
        jdbc.update("DELETE FROM app.chat_attachment WHERE owner_id = ? AND expires_at <= CURRENT_TIMESTAMP", user);
        Integer count = jdbc.queryForObject("SELECT count(*) FROM app.chat_attachment WHERE owner_id = ?", Integer.class, user);
        if (count != null && count >= 12) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Remove unused attachments first");
        UUID id = UUID.randomUUID();
        var context = new TrustedRunContext(id, id, id.toString(), workspace, project, user, allowed);
        AttachmentText extraction;
        try (var source = file.getInputStream()) {
            byte[] bytes = source.readNBytes(2097153);
            if (bytes.length != file.getSize()) throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE);
            extraction = reader.read(new AttachmentReaderClient.Input(context, new AttachmentReaderClient.FileInput(
                name, file.getContentType() == null ? "" : file.getContentType(), Base64.getEncoder().encodeToString(bytes), encoding, delimiter,
                ocrLanguage, ocrLayout)),
                tokens.issue(id, workspace, project, user, allowed));
        } catch (IOException | RestClientException error) {
            // Never expose parser exceptions, request contents, or internal response bodies.
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT,
                "File could not be read safely. Check format, encoding, delimiter, page/frame/size limits or retry later.");
        }
        if (extraction == null || !name.equals(extraction.name()) || !ocrLanguage.equals(extraction.ocrLanguage())
            || !ocrLayout.equals(extraction.ocrLayout())) throw new ResponseStatusException(HttpStatus.BAD_GATEWAY);
        Instant expires = Instant.now().plusSeconds(1800);
        jdbc.update("INSERT INTO app.chat_attachment(id, workspace_id, project_id, owner_id, payload, expires_at) VALUES (?, ?, ?, ?, ?::jsonb, ?)",
            id, workspace, project, user, mapper.writeValueAsString(extraction), java.sql.Timestamp.from(expires));
        return new Preview(id, expires, extraction);
    }

    @Transactional
    public void delete(UUID user, UUID workspace, UUID project, UUID id) {
        authorize(user, workspace, project);
        jdbc.update("DELETE FROM app.chat_attachment WHERE id = ? AND workspace_id = ? AND project_id = ? AND owner_id = ?", id, workspace, project, user);
    }

    /** Called after authorized START replay, inside the same transaction as the durable command. */
    public List<AttachmentText> resolve(UUID user, UUID workspace, UUID project, List<UUID> ids) {
        if (ids == null || ids.isEmpty()) return List.of();
        if (ids.size() > 6 || new HashSet<>(ids).size() != ids.size())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "At most six distinct attachments");
        List<AttachmentText> items = new ArrayList<>();
        for (UUID id : ids) {
            var rows = jdbc.queryForList("SELECT payload::text FROM app.chat_attachment WHERE id = ? AND workspace_id = ? AND project_id = ? AND owner_id = ? AND expires_at > CURRENT_TIMESTAMP", String.class, id, workspace, project, user);
            if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.GONE, "Attachment expired or unavailable; read the file again");
            items.add(mapper.readValue(rows.getFirst(), AttachmentText.class));
        }
        if (items.stream().mapToLong(AttachmentText::size).sum() > 8 * 1024 * 1024
            || items.stream().mapToInt(item -> item.text().codePointCount(0, item.text().length())).sum() > 40000)
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Total attachment extraction limit exceeded");
        return List.copyOf(items);
    }

    public void consume(UUID user, UUID workspace, UUID project, List<UUID> ids) {
        if (ids != null) for (UUID id : ids)
            jdbc.update("DELETE FROM app.chat_attachment WHERE id = ? AND workspace_id = ? AND project_id = ? AND owner_id = ?", id, workspace, project, user);
    }

    @Scheduled(fixedDelay = 60000)
    public void expire() { jdbc.update("DELETE FROM app.chat_attachment WHERE expires_at <= CURRENT_TIMESTAMP"); }
}
