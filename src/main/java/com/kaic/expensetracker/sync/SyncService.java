package com.kaic.expensetracker.sync;

import com.kaic.expensetracker.profile.ProfileContext;
import com.kaic.expensetracker.profile.ProfileService;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;

/**
 * Connection to the sync hub and the sync itself. The connection (project, account, sync password, login session) is
 * the person's, kept in {@link SyncConfigStore}; each sync first aligns the list of profiles with the other devices
 * ({@link ProfileRegistrySync}) and then syncs the data of every profile in use, one after the other. The screen is shared
 * with the phone app: same {@code /api/sync} routes.
 */
@Service
public class SyncService {

    private static final Logger log = LoggerFactory.getLogger(SyncService.class);
    private static final long DEBOUNCE_SECONDS = 8;
    private static final String OFFLINE = "Sem conexão com o servidor de sync. As alterações seguem quando a internet voltar.";

    /** What the sync screen shows; never carries a password or token. */
    public record Status(boolean available, boolean configured, boolean running, boolean central, String mode, String url,
                         String email, boolean autoSync, Long lastSyncAt, String lastError, int pending, int unsent,
                         int skippedAttachments) {
    }

    public record Connect(String url, String anonKey, String email, String password, String syncPassword, boolean createAccount,
                          boolean useCentral) {
    }

    // the default server of this build (application.properties); empty = everyone uses their own project
    private final String centralUrl;
    private final String centralKey;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final ProfileService profiles;
    private final SyncConfigStore store;
    private final Function<Map<String, Object>, SyncHub> hubFactory;
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "sync");
        t.setDaemon(true);
        return t;
    });
    private ScheduledFuture<?> pendingRun;
    private volatile boolean running;
    private SyncHub hub;
    private SyncCrypto crypto;
    private final Map<String, SyncEngine> engines = new HashMap<>();

    @Autowired
    public SyncService(JdbcTemplate jdbc, PlatformTransactionManager transactions, ProfileService profiles, SyncConfigStore store,
                       @Value("${sync.hub.url:}") String centralUrl, @Value("${sync.hub.anon-key:}") String centralKey) {
        this(jdbc, new TransactionTemplate(transactions), profiles, store, null, centralUrl, centralKey);
    }

    /** {@code hubFactory} (tests): config map -> hub; the default talks to Supabase. */
    SyncService(JdbcTemplate jdbc, TransactionTemplate tx, ProfileService profiles, SyncConfigStore store,
                Function<Map<String, Object>, SyncHub> hubFactory, String centralUrl, String centralKey) {
        this.centralUrl = centralUrl == null ? "" : centralUrl.trim();
        this.centralKey = centralKey == null ? "" : centralKey.trim();
        this.jdbc = jdbc;
        this.tx = tx;
        this.profiles = profiles;
        this.store = store;
        this.hubFactory = hubFactory != null ? hubFactory : this::supabase;
    }

    // ---- state ----

    private Map<String, Object> config() {
        return store.getMap("cfg");
    }

    public Status status() {
        Map<String, Object> cfg = config();
        Map<String, Object> last = store.getMap("last");
        Number at = last == null ? null : (Number) last.get("at");
        boolean central = cfg != null && Boolean.TRUE.equals(cfg.get("central"));
        return new Status(true, cfg != null, running, hasCentral(), cfg == null ? null : central ? "central" : "own",
                cfg == null || central ? null : (String) cfg.get("url"), cfg == null ? null : (String) cfg.get("email"),
                cfg == null || !Boolean.FALSE.equals(cfg.get("autoSync")), at == null ? null : at.longValue(),
                last == null ? null : (String) last.get("error"),
                jdbc.queryForObject("select count(*) from sync_pending", Integer.class), 0,
                jdbc.queryForObject("select count(*) from attachments where size_bytes > ?", Integer.class,
                        SyncEngine.MAX_SYNC_ATTACHMENT_BYTES));
    }

    // ---- connect / disconnect ----

    public synchronized Status connect(Connect c) {
        if (c.useCentral() && !hasCentral()) {
            throw new IllegalArgumentException("Este aplicativo não tem um servidor padrão: use o seu próprio projeto.");
        }
        if (c.useCentral()) {
            c = new Connect(centralUrl, centralKey, c.email(), c.password(), c.syncPassword(), c.createAccount(), true);
        }
        if (blank(c.url()) || blank(c.anonKey()) || blank(c.email()) || blank(c.password()) || blank(c.syncPassword())) {
            throw new IllegalArgumentException("Preencha todos os campos.");
        }
        if (c.syncPassword().length() < 8) throw new IllegalArgumentException("A senha de sincronização precisa ter pelo menos 8 caracteres.");

        Map<String, Object> cfg = new LinkedHashMap<>();
        cfg.put("url", c.url().trim());
        cfg.put("anonKey", c.anonKey().trim());
        cfg.put("email", c.email().trim());
        cfg.put("syncPassword", c.syncPassword());
        cfg.put("autoSync", true);
        cfg.put("central", c.useCentral());
        try {
            SyncHub opened = hubFactory.apply(cfg);
            if (opened instanceof SupabaseHub supabase) {
                if (c.createAccount()) supabase.signUp(cfg.get("email").toString(), c.password());
                if (!supabase.signedIn()) supabase.signIn(cfg.get("email").toString(), c.password());
            }
            crypto = SyncEngine.openCrypto(opened, c.syncPassword());
            hub = opened;
            engines.clear();
        } catch (RuntimeException e) {
            hub = null;
            crypto = null;
            throw new IllegalArgumentException(friendly(e), e);
        }
        store.put("cfg", cfg);
        return syncNow();
    }

    public synchronized Status disconnect() {
        hub = null;
        crypto = null;
        engines.clear();
        store.clear("cfg", "last", "session", "registryCursor");
        return status();
    }

    public Status setAuto(boolean enabled) {
        Map<String, Object> cfg = requireConfig();
        cfg.put("autoSync", enabled);
        store.put("cfg", cfg);
        return status();
    }

    // ---- sync ----

    /** Aligns the list of profiles with the other devices, then syncs the data of every profile in use. */
    public synchronized Status syncNow() {
        Map<String, Object> cfg = requireConfig();
        if (running) return status();
        running = true;
        try {
            open(cfg);
            new ProfileRegistrySync(hub, crypto, profiles, () -> longOf(store.get("registryCursor")),
                    v -> store.put("registryCursor", v), deviceId()).sync();
            String firstError = null;
            for (ProfileService.Profile p : profiles.list()) {
                try {
                    ProfileContext.runAs(p.id(), () -> engineFor(p.id()).sync());
                } catch (RuntimeException e) {
                    log.warn("Falha ao sincronizar o perfil {}", p.name(), e);
                    if (firstError == null) firstError = friendly(e);
                }
            }
            if (firstError != null) throw new IllegalStateException(firstError);
            store.put("last", Map.of("at", System.currentTimeMillis()));
        } catch (RuntimeException e) {
            log.warn("Falha ao sincronizar", e);
            Map<String, Object> previous = store.getMap("last");
            Map<String, Object> failed = new LinkedHashMap<>();
            failed.put("at", previous == null ? null : previous.get("at"));
            failed.put("error", friendly(e));
            store.put("last", failed);
            if (String.valueOf(e.getMessage()).contains("incorret")) {
                hub = null;
                crypto = null;
                engines.clear();
            }
        } finally {
            running = false;
        }
        return status();
    }

    /**
     * After a backup was restored over a profile: makes the cloud (and so the other devices) equal to it, deleting there
     * what the backup does not have. No-op when sync is not connected.
     */
    public synchronized void forceOverwrite(String profileId) {
        Map<String, Object> cfg = config();
        if (cfg == null) return;
        open(cfg);
        ProfileContext.runAs(profileId, () -> engineFor(profileId).forceOverwrite());
        store.put("last", Map.of("at", System.currentTimeMillis()));
    }

    public boolean connected() {
        return config() != null;
    }

    /** For the automatic triggers: syncs when connected and turned on; never throws. */
    public void maybeSync() {
        try {
            Map<String, Object> cfg = config();
            if (cfg != null && !Boolean.FALSE.equals(cfg.get("autoSync")) && !running) syncNow();
        } catch (RuntimeException e) {
            log.warn("Sincronização automática falhou", e);
        }
    }

    /** Called after something was saved: groups several saves in a row into one sync a few seconds later. */
    public synchronized void notifyChange() {
        if (scheduler.isShutdown()) return;
        if (pendingRun != null) pendingRun.cancel(false);
        pendingRun = scheduler.schedule(this::maybeSync, DEBOUNCE_SECONDS, TimeUnit.SECONDS);
    }

    @PreDestroy
    void stop() {
        scheduler.shutdownNow();
    }

    // ---- util ----

    private void open(Map<String, Object> cfg) {
        if (hub != null && crypto != null) return;
        SyncHub opened = hubFactory.apply(cfg);
        crypto = SyncEngine.openCrypto(opened, (String) cfg.get("syncPassword"));
        hub = opened;
        engines.clear();
    }

    /** One engine per profile, talking to the hub under the profile's sync id. */
    private SyncEngine engineFor(String profileId) {
        return engines.computeIfAbsent(profileId,
                id -> new SyncEngine(jdbc, tx, hub, crypto, profiles.syncIdOf(id), Clock.systemDefaultZone()));
    }

    private String deviceId() {
        Object id = store.get("device");
        if (id != null) return id.toString();
        String made = UUID.randomUUID().toString();
        store.put("device", made);
        return made;
    }

    private static long longOf(Object v) {
        return v instanceof Number n ? n.longValue() : 0;
    }

    private SyncHub supabase(Map<String, Object> cfg) {
        Map<String, Object> saved = store.getMap("session");
        SupabaseHub.Session session = saved == null ? null : new SupabaseHub.Session((String) saved.get("accessToken"),
                (String) saved.get("refreshToken"), longOf(saved.get("expiresAtMillis")));
        return new SupabaseHub((String) cfg.get("url"), (String) cfg.get("anonKey"), session,
                s -> store.put("session", Map.of("accessToken", s.accessToken(), "refreshToken", s.refreshToken(), "expiresAtMillis", s.expiresAtMillis())),
                null);
    }

    private boolean hasCentral() {
        return !centralUrl.isBlank() && !centralKey.isBlank();
    }

    private Map<String, Object> requireConfig() {
        Map<String, Object> cfg = config();
        if (cfg == null) throw new IllegalStateException("Conecte este aparelho ao sync primeiro.");
        return cfg;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    private static String friendly(Throwable e) {
        String message = String.valueOf(e.getMessage());
        if (e.getCause() instanceof java.io.IOException || message.startsWith("Sem conexão")) return OFFLINE;
        if (message.toLowerCase().contains("invalid login credentials")) return "E-mail ou senha da conta incorretos.";
        if (message.toLowerCase().contains("already registered")) return "Este e-mail já tem conta: desmarque “Criar a conta agora” e entre.";
        return message;
    }
}
