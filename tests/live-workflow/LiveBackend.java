import com.freelanceops.backend.BackendApplication;
import com.freelanceops.backend.domain.agentrun.client.AgentRunClient;
import com.freelanceops.backend.domain.agentrun.client.HttpAgentRunClient;
import com.freelanceops.backend.domain.agentrun.service.AgentRunGatewayService;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.util.Base64;
import org.springframework.boot.SpringApplication;

public final class LiveBackend {
    public static void main(String[] args) throws Exception {
        // Reuse the repository's existing, memory-only localhost test fixture.
        URI database = URI.create(System.getenv("DB_URL").substring(5));
        if (!"test".equalsIgnoreCase(System.getenv("APP_ENVIRONMENT"))
                || !"127.0.0.1".equals(database.getHost())
                || database.getPort() < 18200 || database.getPort() > 18249) {
            throw new IllegalStateException(
                    "Use an isolated localhost test database on the allocated port range");
        }
        Class<?> fixture = Class.forName("com.freelanceops.backend.integration.ConnectedWorkflowPostgresTest");
        var field = fixture.getDeclaredField("TEST_KEYS");
        field.setAccessible(true);
        KeyPair pair = (KeyPair) field.get(null);
        System.setProperty("server.address", "127.0.0.1");
        System.setProperty("agent.delegation.private-key", Base64.getEncoder().encodeToString(pair.getPrivate().getEncoded()));
        System.setProperty("agent.delegation.public-key", Base64.getEncoder().encodeToString(pair.getPublic().getEncoded()));
        // Only the public verification material crosses to the localhost Agent.
        Path publicKey = Path.of(args[0]);
        Files.createDirectories(publicKey.toAbsolutePath().getParent());
        Files.writeString(publicKey, "-----BEGIN PUBLIC KEY-----\n"
                + Base64.getMimeEncoder(64, new byte[]{10}).encodeToString(pair.getPublic().getEncoded())
                + "\n-----END PUBLIC KEY-----\n");
        var context = SpringApplication.run(BackendApplication.class);
        var client = context.getBean(AgentRunClient.class);
        if (!(client instanceof HttpAgentRunClient)) {
            throw new IllegalStateException("Live journey requires actual HTTP Agent client");
        }
        Files.writeString(publicKey.resolveSibling("real-components.json"),
                "{\"agentClient\":\"" + client.getClass().getName()
                + "\",\"gateway\":\"" + context.getBean(AgentRunGatewayService.class).getClass().getName()
                + "\",\"mockApi\":false}");
    }
}
