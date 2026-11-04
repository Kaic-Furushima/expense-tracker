package com.kaic.expensetracker.sync;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.*;

/** The Supabase client against a small local HTTP server that answers like the real one. */
class SupabaseHubTest {

    private HttpServer server;
    private final List<String> requests = new ArrayList<>();
    private String url;
    private volatile boolean expired;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            String path = exchange.getRequestURI().toString();
            requests.add(exchange.getRequestMethod() + " " + path + " auth=" + exchange.getRequestHeaders().getFirst("Authorization")
                    + " key=" + exchange.getRequestHeaders().getFirst("apikey") + " body=" + body);
            String answer;
            int status = 200;
            if (path.startsWith("/auth/v1/token")) answer = "{\"access_token\":\"tok\",\"refresh_token\":\"ref\",\"expires_in\":3600}";
            else if (path.startsWith("/rest/v1/rpc/push_changes")) answer = "2";
            else if (path.startsWith("/rest/v1/vault")) answer = exchange.getRequestMethod().equals("GET") ? "[]" : "";
            else if (expired) {
                status = 401;
                answer = "{\"message\":\"JWT expired\"}";
            } else if (path.startsWith("/rest/v1/changes")) answer = "[{\"seq\":7,\"table_name\":\"tags\",\"row_uuid\":\"u1\",\"updated_at\":5,"
                    + "\"deleted\":false,\"payload\":\"v1.x.y\",\"device_id\":\"d\"},{\"seq\":8,\"table_name\":\"tags\",\"row_uuid\":\"u2\","
                    + "\"updated_at\":6,\"deleted\":true,\"payload\":null,\"device_id\":\"d\"}]";
            else {
                status = 401;
                answer = "{\"message\":\"JWT expired\"}";
            }
            byte[] bytes = answer.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
            if (bytes.length > 0) exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        url = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    @Test
    void signsInPushesAndPulls() {
        SupabaseHub hub = new SupabaseHub(url, "anon");
        assertFalse(hub.signedIn());
        hub.signIn("a@b.c", "pw");
        assertTrue(hub.signedIn());

        assertNull(hub.getVault());
        hub.setVault(new SyncHub.Vault("salt", "check"));
        assertEquals(2, hub.push("default", "dev", List.of(SyncHub.Change.outgoing("tags", "u1", 5, false, "v1.x.y"))));
        List<SyncHub.Change> pulled = hub.pull("default", 3, 200);

        assertEquals(2, pulled.size());
        assertEquals(new SyncHub.Change("tags", "u1", 5, false, "v1.x.y", 7, "d"), pulled.get(0));
        assertTrue(pulled.get(1).deleted());
        assertNull(pulled.get(1).payload());

        String push = requests.stream().filter(r -> r.contains("rpc/push_changes")).findFirst().orElseThrow();
        assertTrue(push.contains("auth=Bearer tok") && push.contains("key=anon"));
        assertTrue(push.contains("\"row_uuid\":\"u1\"") && push.contains("\"p_device\":\"dev\""));
        assertTrue(requests.get(requests.size() - 1).contains("profile_id=eq.default&seq=gt.3&order=seq.asc&limit=200"));
    }

    @Test
    void refreshesTheSessionNearExpiryAndReportsServerErrors() {
        AtomicLong clock = new AtomicLong(0);
        SupabaseHub hub = new SupabaseHub(url, "anon", null, null, clock::get);
        hub.signIn("a", "b");
        clock.set(3_600_000L - 30_000); // 30 s left: refresh first
        expired = true;
        IllegalStateException error = assertThrows(IllegalStateException.class, () -> hub.pull("default", 0, 1));
        assertEquals("JWT expired", error.getMessage());
        assertEquals(2, requests.stream().filter(r -> r.contains("/auth/v1/token")).count(), "signed in, then refreshed");
    }

    @Test
    void failsClearlyWithoutConnection() {
        server.stop(0);
        SupabaseHub hub = new SupabaseHub(url, "anon");
        assertThrows(IllegalStateException.class, () -> hub.signIn("a", "b"));
    }
}
