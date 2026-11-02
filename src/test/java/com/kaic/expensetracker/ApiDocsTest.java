package com.kaic.expensetracker;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static org.junit.jupiter.api.Assertions.*;

/** The API documentation (Q2): served as OpenAPI JSON, and it describes the endpoints the app uses. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ApiDocsTest {

    @LocalServerPort private int port;

    @Test
    void theOpenApiDocumentDescribesTheExpenseEndpoints() throws Exception {
        HttpResponse<String> response = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/v3/api-docs")).GET().build(),
                HttpResponse.BodyHandlers.ofString());

        assertEquals(200, response.statusCode());
        assertTrue(response.body().contains("\"openapi\""));
        assertTrue(response.body().contains("/expenses"), "a lista de lançamentos está documentada");
        assertTrue(response.body().contains("/api/summary"), "o resumo está documentado");
    }
}
