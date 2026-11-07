package com.kaic.expensetracker.profile;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import javax.sql.DataSource;
import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/**
 * The profiles of the app (e.g. one per person) and the app-wide language. Each profile has its own database; the list
 * lives in {@code <data>/profiles.properties}. There is no login: anyone using the app can switch profiles.
 * <p>
 * Removing a profile first moves it to the profiles' trash (nothing is deleted); it can be restored from there or
 * deleted for good. For the sync every profile has a {@code syncId} (the same on every device; the main profile is
 * always {@code default}), the time of its last change and, when trashed, the time it was trashed.
 */
@Service
public class ProfileService {

    private static final Logger log = LoggerFactory.getLogger(ProfileService.class);

    public static final int MAX_PROFILES = 10;
    public static final int MAX_NAME = 40;
    public static final Set<String> LANGUAGES = Set.of("pt", "en", "es");
    /** What the hub calls the main profile (the phone's main profile too). */
    public static final String MAIN_SYNC_ID = "default";

    private static final Pattern ID = Pattern.compile("[a-z0-9]{1,16}");
    private static final Pattern SYNC_ID = Pattern.compile("[A-Za-z0-9-]{1,64}");

    public record Profile(String id, String name) {
    }

    public record TrashedProfile(String id, String name, long trashedAt) {
    }

    /** What the sync registry carries about a profile. {@code trashedAt} is null when the profile is in use. */
    public record RegistryEntry(String id, String syncId, String name, long updatedAt, Long trashedAt) {
    }

    /** A profile deleted for good here; the sync tells the other devices. */
    public record Purged(String syncId, long at) {
    }

    private final ProfileDataSource dataSource;
    private final Path file;
    private volatile String languageCache;

    public ProfileService(DataSource dataSource) {
        if (!(dataSource instanceof ProfileDataSource profileDataSource)) {
            throw new IllegalStateException("A fonte de dados dos perfis não foi configurada");
        }
        this.dataSource = profileDataSource;
        this.file = profileDataSource.folderOf(ProfileContext.MAIN).resolve("profiles.properties");
    }

    // ---- lists ----

    /** The profiles in use (not the ones in the trash). */
    public synchronized List<Profile> list() {
        Properties p = read();
        List<Profile> result = new ArrayList<>();
        result.add(new Profile(ProfileContext.MAIN, p.getProperty("name.main", "Principal")));
        for (String id : ids(p)) {
            if (p.getProperty("trashed." + id) == null) result.add(new Profile(id, p.getProperty("name." + id, id)));
        }
        return result;
    }

    public synchronized List<TrashedProfile> trashed() {
        Properties p = read();
        List<TrashedProfile> result = new ArrayList<>();
        for (String id : ids(p)) {
            String at = p.getProperty("trashed." + id);
            if (at != null) result.add(new TrashedProfile(id, p.getProperty("name." + id, id), Long.parseLong(at)));
        }
        return result;
    }

    /** A profile in use (the ones in the trash do not count: nobody can switch to them). */
    public synchronized boolean exists(String id) {
        if (id == null) return false;
        if (ProfileContext.MAIN.equals(id)) return true;
        Properties p = read();
        return ids(p).contains(id) && p.getProperty("trashed." + id) == null;
    }

    /** In use or in the trash. */
    public synchronized boolean existsAny(String id) {
        return id != null && (ProfileContext.MAIN.equals(id) || ids(read()).contains(id));
    }

    /** The profile used by requests that carry no (valid) cookie. */
    public synchronized String last() {
        String id = read().getProperty("last", ProfileContext.MAIN);
        return exists(id) ? id : ProfileContext.MAIN;
    }

    public String language() {
        String cached = languageCache;
        if (cached != null) {
            return cached;
        }
        synchronized (this) {
            String language = read().getProperty("language", "pt");
            languageCache = LANGUAGES.contains(language) ? language : "pt";
            return languageCache;
        }
    }

    public synchronized void setLanguage(String language) {
        if (language == null || !LANGUAGES.contains(language)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Idioma inválido.");
        }
        Properties p = read();
        p.setProperty("language", language);
        write(p);
        languageCache = language;
    }

    public synchronized void select(String id) {
        if (!exists(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Perfil não encontrado.");
        }
        Properties p = read();
        p.setProperty("last", id);
        write(p);
    }

    // ---- create / rename / trash / delete ----

    public synchronized Profile create(String rawName) {
        String name = cleanName(rawName);
        Properties p = read();
        if (inUse(p) >= MAX_PROFILES) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Limite de " + MAX_PROFILES + " perfis atingido.");
        }
        requireFreeName(name, null);
        return add(p, UUID.randomUUID().toString().replace("-", "").substring(0, 8), UUID.randomUUID().toString(), name, null,
                System.currentTimeMillis());
    }

    private Profile add(Properties p, String id, String syncId, String name, Long trashedAt, long updatedAt) {
        dataSource.forProfile(id); // creates the database and brings it up to date before the profile is listed
        List<String> all = new ArrayList<>(ids(p));
        all.add(id);
        p.setProperty("ids", String.join(",", all));
        p.setProperty("name." + id, name);
        p.setProperty("sync." + id, syncId);
        p.setProperty("updated." + id, Long.toString(updatedAt));
        if (trashedAt != null) p.setProperty("trashed." + id, Long.toString(trashedAt));
        write(p);
        return new Profile(id, name);
    }

    public synchronized Profile rename(String id, String rawName) {
        if (!existsAny(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Perfil não encontrado.");
        }
        String name = cleanName(rawName);
        requireFreeName(name, id);
        Properties p = read();
        p.setProperty("name." + id, name);
        touch(p, id);
        write(p);
        return new Profile(id, name);
    }

    /** Moves a profile to the trash: it disappears from the app but nothing is deleted, and it can be restored. */
    public synchronized void remove(String id) {
        if (ProfileContext.MAIN.equals(id)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O perfil principal não pode ser removido.");
        }
        if (!exists(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Perfil não encontrado.");
        }
        Properties p = read();
        p.setProperty("trashed." + id, Long.toString(System.currentTimeMillis()));
        touch(p, id);
        if (id.equals(p.getProperty("last"))) {
            p.setProperty("last", ProfileContext.MAIN);
        }
        write(p);
    }

    /** Takes a profile out of the trash (its name gets a number if another profile took it meanwhile). */
    public synchronized Profile restore(String id) {
        Properties p = read();
        if (!ids(p).contains(id) || p.getProperty("trashed." + id) == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Perfil não encontrado na lixeira.");
        }
        p.setProperty("name." + id, freeName(p.getProperty("name." + id, id), id));
        p.remove("trashed." + id);
        touch(p, id);
        write(p);
        return new Profile(id, p.getProperty("name." + id));
    }

    /**
     * Deletes a profile that is in the trash for good. Its data is not erased: the folder is renamed to
     * {@code <id>.removido-<date>} so it can still be recovered by hand. The sync tells the other devices.
     */
    public synchronized void purge(String id) {
        Properties p = read();
        if (!ids(p).contains(id) || p.getProperty("trashed." + id) == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Só dá para excluir de vez um perfil que está na lixeira.");
        }
        String syncId = syncIdIn(p, id);
        drop(p, id);
        addPurged(p, syncId, System.currentTimeMillis());
        write(p);
        archiveFolder(id);
    }

    private void drop(Properties p, String id) {
        List<String> all = new ArrayList<>(ids(p));
        all.remove(id);
        p.setProperty("ids", String.join(",", all));
        for (String key : new String[]{"name.", "sync.", "updated.", "trashed.", "sent."}) p.remove(key + id);
        if (id.equals(p.getProperty("last"))) {
            p.setProperty("last", ProfileContext.MAIN);
        }
    }

    private void archiveFolder(String id) {
        dataSource.close(id);
        Path folder = dataSource.folderOf(id);
        try {
            if (Files.isDirectory(folder)) {
                Files.move(folder, folder.resolveSibling(id + ".removido-"
                        + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMddHHmmss"))));
            }
        } catch (IOException e) {
            throw new IllegalStateException("O perfil foi removido, mas a pasta dele não pôde ser renomeada", e);
        }
    }

    // ---- sync registry ----

    /** The identity of a profile on the hub (the main profile is always {@code default}). */
    public synchronized String syncIdOf(String id) {
        if (ProfileContext.MAIN.equals(id)) return MAIN_SYNC_ID;
        Properties p = read();
        if (!ids(p).contains(id)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Perfil não encontrado.");
        String existing = p.getProperty("sync." + id);
        if (existing != null) return existing;
        String made = UUID.randomUUID().toString(); // profiles made before the sync existed
        p.setProperty("sync." + id, made);
        write(p);
        return made;
    }

    /** Every known profile, the trashed ones too, with what the registry carries. */
    public synchronized List<RegistryEntry> registry() {
        Properties p = read();
        List<RegistryEntry> out = new ArrayList<>();
        out.add(new RegistryEntry(ProfileContext.MAIN, MAIN_SYNC_ID, p.getProperty("name.main", "Principal"),
                longOf(p, "updated.main", 0), null));
        for (String id : ids(p)) {
            String at = p.getProperty("trashed." + id);
            out.add(new RegistryEntry(id, syncIdIn(p, id), p.getProperty("name." + id, id), longOf(p, "updated." + id, 0),
                    at == null ? null : Long.parseLong(at)));
        }
        return out;
    }

    public synchronized long registrySentAt(String id) {
        return longOf(read(), "sent." + id, -1);
    }

    public synchronized void markRegistrySent(String id, long updatedAt) {
        Properties p = read();
        p.setProperty("sent." + id, Long.toString(updatedAt));
        write(p);
    }

    public synchronized List<Purged> purged() {
        List<Purged> out = new ArrayList<>();
        for (String item : read().getProperty("purged", "").split(",")) {
            String[] parts = item.trim().split("@");
            if (parts.length == 2 && SYNC_ID.matcher(parts[0]).matches()) out.add(new Purged(parts[0], Long.parseLong(parts[1])));
        }
        return out;
    }

    public synchronized void forgetPurged(String syncId) {
        Properties p = read();
        List<Purged> keep = purged().stream().filter(x -> !x.syncId().equals(syncId)).toList();
        p.setProperty("purged", String.join(",", keep.stream().map(x -> x.syncId() + "@" + x.at()).toList()));
        write(p);
    }

    public synchronized String idOfSync(String syncId) {
        if (MAIN_SYNC_ID.equals(syncId)) return ProfileContext.MAIN;
        Properties p = read();
        for (String id : ids(p)) if (syncId.equals(p.getProperty("sync." + id))) return id;
        return null;
    }

    /** A profile another device made: created here with the same identity (its data comes with the next data sync). */
    public synchronized Profile createFromRemote(String syncId, String name, Long trashedAt, long updatedAt) {
        if (!SYNC_ID.matcher(syncId).matches()) throw new IllegalArgumentException("Identificador de perfil inválido.");
        Properties p = read();
        if (inUse(p) >= MAX_PROFILES) throw new IllegalStateException("Limite de " + MAX_PROFILES + " perfis atingido.");
        Profile made = add(p, UUID.randomUUID().toString().replace("-", "").substring(0, 8), syncId, freeName(cleanName(name), null),
                trashedAt, updatedAt);
        Properties after = read();
        after.setProperty("sent." + made.id(), Long.toString(updatedAt)); // it came from the hub: nothing to send back
        write(after);
        return made;
    }

    /** What another device changed about a profile (name, trash). The time it carries becomes ours, so it is not sent back. */
    public synchronized void updateFromRemote(String id, String name, Long trashedAt, long updatedAt) {
        Properties p = read();
        p.setProperty("name." + id, freeName(cleanName(name), id));
        if (trashedAt == null) p.remove("trashed." + id); else p.setProperty("trashed." + id, Long.toString(trashedAt));
        if (trashedAt != null && id.equals(p.getProperty("last"))) p.setProperty("last", ProfileContext.MAIN);
        p.setProperty("updated." + id, Long.toString(updatedAt));
        p.setProperty("sent." + id, Long.toString(updatedAt));
        write(p);
    }

    /** Another device deleted the profile for good: the same here (the data folder is kept aside, as usual). */
    public synchronized void purgeFromRemote(String id) {
        Properties p = read();
        if (!ids(p).contains(id)) return;
        drop(p, id);
        write(p);
        archiveFolder(id);
    }

    /** Runs {@code action} once for every profile in use (background jobs). A failure in one does not stop the others. */
    public void forEach(Consumer<Profile> action) {
        for (Profile profile : list()) {
            try {
                ProfileContext.runAs(profile.id(), () -> action.accept(profile));
            } catch (RuntimeException e) {
                log.warn("Falha no perfil {}", profile.id(), e);
            }
        }
    }

    public Path folderOf(String id) {
        return dataSource.folderOf(id);
    }

    /** Brings the current profile's database up to the current schema (after restoring an older backup). */
    public void migrateCurrent() {
        ProfileDataSource.migrate(dataSource.forProfile(ProfileContext.current()));
    }

    @PreDestroy
    void shutdown() {
        dataSource.closeAll();
    }

    // ---- util ----

    /** How many profiles count against the limit: the main one and the ones not in the trash. */
    private static int inUse(Properties p) {
        return 1 + (int) ids(p).stream().filter(id -> p.getProperty("trashed." + id) == null).count();
    }

    private void touch(Properties p, String id) {
        p.setProperty("updated." + id, Long.toString(System.currentTimeMillis()));
    }

    private static void addPurged(Properties p, String syncId, long at) {
        String old = p.getProperty("purged", "");
        p.setProperty("purged", (old.isBlank() ? "" : old + ",") + syncId + "@" + at);
    }

    private static String syncIdIn(Properties p, String id) {
        String s = p.getProperty("sync." + id);
        return s != null ? s : "legacy-" + id; // read-only fallback; syncIdOf() writes a real one
    }

    private static long longOf(Properties p, String key, long fallback) {
        String v = p.getProperty(key);
        return v == null ? fallback : Long.parseLong(v);
    }

    private void requireFreeName(String name, String exceptId) {
        for (Profile profile : list()) {
            if (!profile.id().equals(exceptId) && profile.name().equalsIgnoreCase(name)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Já existe um perfil com esse nome.");
            }
        }
    }

    /** {@code name}, or "name (2)", "name (3)"… when another profile in use already has it. */
    private String freeName(String name, String exceptId) {
        String candidate = name;
        for (int n = 2; ; n++) {
            final String c = candidate;
            if (list().stream().noneMatch(x -> !x.id().equals(exceptId) && x.name().equalsIgnoreCase(c))) return candidate;
            String suffix = " (" + n + ")";
            candidate = name.substring(0, Math.min(name.length(), MAX_NAME - suffix.length())) + suffix;
        }
    }

    private static String cleanName(String raw) {
        String name = raw == null ? "" : raw.trim().replaceAll("\\s+", " ");
        if (name.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Dê um nome ao perfil.");
        }
        if (name.length() > MAX_NAME) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O nome pode ter no máximo " + MAX_NAME + " caracteres.");
        }
        return name;
    }

    private static List<String> ids(Properties p) {
        return Arrays.stream(p.getProperty("ids", "").split(","))
                .map(String::trim).filter(s -> ID.matcher(s).matches() && !ProfileContext.MAIN.equals(s)).toList();
    }

    private Properties read() {
        Properties p = new Properties();
        if (Files.isRegularFile(file)) {
            try (Reader in = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
                p.load(in);
            } catch (IOException e) {
                throw new IllegalStateException("Não foi possível ler a lista de perfis", e);
            }
        }
        return p;
    }

    private void write(Properties p) {
        try {
            Files.createDirectories(file.getParent());
            try (Writer out = Files.newBufferedWriter(file, StandardCharsets.UTF_8)) {
                p.store(out, "Pocketful - perfis");
            }
        } catch (IOException e) {
            throw new IllegalStateException("Não foi possível salvar a lista de perfis", e);
        }
    }
}
