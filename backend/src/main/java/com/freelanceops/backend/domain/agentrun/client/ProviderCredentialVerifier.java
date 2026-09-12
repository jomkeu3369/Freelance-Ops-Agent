package com.freelanceops.backend.domain.agentrun.client;

import com.freelanceops.backend.domain.agentrun.model.Provider;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;

@Component
public class ProviderCredentialVerifier {
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();

    public void verify(Provider provider, String model, String key) {
        String base = provider == Provider.OPENAI ? "https://api.openai.com/v1/models/" : "https://generativelanguage.googleapis.com/v1beta/models/";
        HttpRequest request = HttpRequest.newBuilder(URI.create(base + model)).timeout(Duration.ofSeconds(10))
            .header(provider == Provider.OPENAI ? "Authorization" : "x-goog-api-key", provider == Provider.OPENAI ? "Bearer " + key : key).GET().build();
        try {
            int status = client.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
            if (status != 200) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Could not verify API key and model access");
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Provider verification interrupted");
        } catch (java.io.IOException error) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Provider verification unavailable");
        }
    }
}
