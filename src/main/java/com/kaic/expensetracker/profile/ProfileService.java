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
 */
@Service
public class ProfileService {

    private static final Logger log = LoggerFactory.getLogger(ProfileService.class);

    public static final int MAX_PROFILES = 10;
    public static final int MAX_NAME = 40;
    public static final Set<String> LANGUAGES = Set.of("pt", "en", "es");

    private static final Pattern ID = Pattern.compile("[a-z0-9]{1,16}");

    public record Profile(String id, String name) {
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

    public synchronized List<Profile> list() {
        Properties p = read();
        List<Profile> result = new ArrayList<>();
        result.add(new Profile(ProfileContext.MAIN, p.getProperty("name.main", "Principal")));
        for (String id : ids(p)) {
            result.add(new Profile(id, p.getProperty("name." + id, id)));
        }
        return result;
    }

    public synchronized boolean exists(String id) {
        return id != null && (ProfileContext.MAIN.equals(id) || ids(read()).contains(id));
    }

    /** The profile used by requests that carry no (valid) cookie. */
    public synchronized String last() {
        String id = read().getProperty("last", ProfileContext.MAIN);
        return exists(id) ? id : ProfileContext.MAIN;
    }

    public boolean canCreate() {
        return dataSource.supportsProfiles();
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

    public synchronized Profile create(String rawName) {
        if (!canCreate()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Vários perfis só funcionam com o banco embutido (H2).");
        }
        String name = cleanName(rawName);
        Properties p = read();
        if (ids(p).size() + 1 >= MAX_PROFILES) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Limite de " + MAX_PROFILES + " perfis atingido.");
        }
        requireFreeName(name, null);
        String id = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        dataSource.forProfile(id); // creates the database and brings it up to date before the profile is listed
        List<String> all = new ArrayList<>(ids(p));
        all.add(id);
        p.setProperty("ids", String.join(",", all));
        p.setProperty("name." + id, name);
        write(p);
        return new Profile(id, name);
    }

    public synchronized Profile rename(String id, String rawName) {
        if (!exists(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Perfil não encontrado.");
        }
        String name = cleanName(rawName);
        requireFreeName(name, id);
        Properties p = read();
        p.setProperty("name." + id, name);
        write(p);
        return new Profile(id, name);
    }

    /**
     * Removes a profile from the app. Its data is not deleted: the folder is renamed to {@code <id>.removido-<date>}
     * so it can still be recovered by hand.
     */
    public synchronized void remove(String id) {
        if (ProfileContext.MAIN.equals(id)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O perfil principal não pode ser removido.");
        }
        if (!exists(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Perfil não encontrado.");
        }
        Properties p = read();
        List<String> all = new ArrayList<>(ids(p));
        all.remove(id);
        p.setProperty("ids", String.join(",", all));
        p.remove("name." + id);
        if (id.equals(p.getProperty("last"))) {
            p.setProperty("last", ProfileContext.MAIN);
        }
        write(p);
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

    /** Runs {@code action} once for every profile (background jobs). A failure in one does not stop the others. */
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

    private void requireFreeName(String name, String exceptId) {
        for (Profile profile : list()) {
            if (!profile.id().equals(exceptId) && profile.name().equalsIgnoreCase(name)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Já existe um perfil com esse nome.");
            }
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
                p.store(out, "Expense Tracker - perfis");
            }
        } catch (IOException e) {
            throw new IllegalStateException("Não foi possível salvar a lista de perfis", e);
        }
    }
}
