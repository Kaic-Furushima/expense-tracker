package com.kaic.expensetracker.sync;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.LongSupplier;

/** The hub on Supabase (Postgres + e-mail login); the schema is in {@code static/sync/supabase-hub.sql}. Same calls as the phone's client. */
public class SupabaseHub implements SyncHub {

    /** The login session; keep it between runs so the user does not have to sign in again. */
    public record Session(String accessToken, String refreshToken, long expiresAtMillis) {
    }

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final String url;
    private final String anonKey;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();
    private final LongSupplier now;
    private final java.util.function.Consumer<Session> onSession;
    private Session session;

    public SupabaseHub(String url, String anonKey, Session session, java.util.function.Consumer<Session> onSession, LongSupplier now) {
        this.url = url.replaceAll("/+$", "");
        this.anonKey = anonKey;
        this.session = session;
        this.onSession = onSession == null ? s -> { } : onSession;
        this.now = now == null ? System::currentTimeMillis : now;
    }

    public SupabaseHub(String url, String anonKey) {
        this(url, anonKey, null, null, null);
    }

    public void signIn(String email, String password) {
        token("password", Map.of("email", email, "password", password));
    }

    /** Creates the account; when the project does not ask for e-mail confirmation the person is signed in right away. */
    public void signUp(String email, String password) {
        JsonNode node = send("/auth/v1/signup", "POST", JSON.writeValueAsString(Map.of("email", email, "password", password)), null, null);
        if (!node.path("access_token").asString().isBlank()) {
            long expiresIn = node.path("expires_in").asLong(3600);
            session = new Session(node.path("access_token").asString(), node.path("refresh_token").asString(), now.getAsLong() + expiresIn * 1000);
            onSession.accept(session);
        }
    }

    public boolean signedIn() {
        return session != null && session.refreshToken() != null;
    }

    private void token(String grant, Map<String, String> body) {
        JsonNode node = send("/auth/v1/token?grant_type=" + grant, "POST", JSON.writeValueAsString(body), null, null);
        long expiresIn = node.path("expires_in").asLong(3600);
        session = new Session(node.path("access_token").asString(), node.path("refresh_token").asString(), now.getAsLong() + expiresIn * 1000);
        onSession.accept(session);
    }

    private String bearer() {
        if (!signedIn()) throw new IllegalStateException("Entre na conta do sync.");
        if (session.expiresAtMillis() - now.getAsLong() < 60_000) token("refresh_token", Map.of("refresh_token", session.refreshToken()));
        return session.accessToken();
    }

    private JsonNode rest(String path, String method, Object body, Map<String, String> headers) {
        return send("/rest/v1/" + path, method, body == null ? null : JSON.writeValueAsString(body), bearer(), headers);
    }

    private JsonNode send(String path, String method, String body, String bearer, Map<String, String> headers) {
        HttpRequest.Builder req = HttpRequest.newBuilder(URI.create(url + path)).timeout(Duration.ofSeconds(60))
                .header("Content-Type", "application/json").header("apikey", anonKey);
        if (bearer != null) req.header("Authorization", "Bearer " + bearer);
        if (headers != null) headers.forEach(req::header);
        req.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        try {
            HttpResponse<String> res = http.send(req.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            JsonNode data = res.body() == null || res.body().isBlank() ? JSON.nullNode() : JSON.readTree(res.body());
            if (res.statusCode() >= 300) {
                String message = firstText(data, "error_description", "msg", "message");
                throw new IllegalStateException(message != null ? message : "Servidor de sync respondeu " + res.statusCode() + ".");
            }
            return data;
        } catch (IOException e) {
            throw new IllegalStateException("Sem conexão com o servidor de sync.", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Sincronização interrompida.", e);
        }
    }

    private static String firstText(JsonNode node, String... names) {
        for (String name : names) {
            JsonNode value = node.path(name);
            if (value.isString() && !value.asString().isBlank()) return value.asString();
        }
        return null;
    }

    @Override
    public Vault getVault() {
        JsonNode rows = rest("vault?select=salt,check_value", "GET", null, null);
        if (!rows.isArray() || rows.isEmpty()) return null;
        return new Vault(rows.get(0).path("salt").asString(), rows.get(0).path("check_value").asString());
    }

    @Override
    public void setVault(Vault vault) {
        rest("vault", "POST", Map.of("salt", vault.salt(), "check_value", vault.check()), Map.of("Prefer", "return=minimal"));
    }

    @Override
    public int push(String profileId, String deviceId, List<Change> changes) {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Change c : changes) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("table_name", c.table());
            row.put("row_uuid", c.uuid());
            row.put("updated_at", c.updatedAt());
            row.put("deleted", c.deleted());
            row.put("payload", c.deleted() ? null : c.payload());
            rows.add(row);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("p_profile", profileId);
        body.put("p_device", deviceId);
        body.put("p_changes", rows);
        return rest("rpc/push_changes", "POST", body, null).asInt(0);
    }

    @Override
    public List<Change> pull(String profileId, long afterSeq, int limit) {
        String query = "changes?select=seq,table_name,row_uuid,updated_at,deleted,payload,device_id&profile_id=eq."
                + URLEncoder.encode(profileId, StandardCharsets.UTF_8) + "&seq=gt." + afterSeq + "&order=seq.asc&limit=" + limit;
        JsonNode rows = rest(query, "GET", null, null);
        List<Change> out = new ArrayList<>();
        for (JsonNode r : rows) {
            out.add(new Change(r.path("table_name").asString(), r.path("row_uuid").asString(), r.path("updated_at").asLong(),
                    r.path("deleted").asBoolean(false), r.path("payload").isNull() ? null : r.path("payload").asString(),
                    r.path("seq").asLong(), r.path("device_id").asString()));
        }
        return out;
    }
}
