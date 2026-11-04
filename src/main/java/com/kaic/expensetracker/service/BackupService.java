package com.kaic.expensetracker.service;

import com.kaic.expensetracker.profile.ProfileContext;
import com.kaic.expensetracker.profile.ProfileService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Backups of the whole database as one plain-text SQL script (H2's {@code SCRIPT}), kept in {@code <data>/backups}.
 * Restoring replaces everything with the script's content, after saving a safety copy of the current data.
 * Only available with the built-in H2 database.
 */
@Service
public class BackupService {

    private static final Logger log = LoggerFactory.getLogger(BackupService.class);
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");
    private static final String AUTOMATIC_SUFFIX = "-auto.sql";
    private static final Pattern NAME = Pattern.compile("backup-\\d{8}-\\d{6}(-antes-de-restaurar|-auto)?\\.sql");
    /** Manual copies (and the safety copies made before a restore) kept per profile. */
    private static final int KEEP = 30;
    /** Automatic copies kept per profile: the newest seven, so they never push out the manual ones. */
    private static final int KEEP_AUTOMATIC = 7;
    private static final Duration EVERY_AUTOMATIC = Duration.ofHours(24);
    /** Statements a restore script may not contain: they would run code or reach outside the database. */
    private static final Pattern FORBIDDEN = Pattern.compile(
            "^\\s*(create\\s+(or\\s+replace\\s+)?(force\\s+)?(alias|trigger|aggregate|linked\\s+table)|call\\s|runscript|script\\s"
                    + "|csvwrite|shutdown|set\\s+(trace|file_lock))", Pattern.CASE_INSENSITIVE);
    private static final Pattern USER_STATEMENT = Pattern.compile("^\\s*(create|alter|drop)\\s+user\\b", Pattern.CASE_INSENSITIVE);

    public record BackupInfo(String name, long sizeBytes, Instant createdAt) {
    }

    private final JdbcTemplate jdbc;
    private final ProfileService profiles;
    private final SettingsService settings;

    public BackupService(JdbcTemplate jdbc, ProfileService profiles, SettingsService settings) {
        this.jdbc = jdbc;
        this.profiles = profiles;
        this.settings = settings;
    }

    /** Each profile keeps its backups next to its own database. */
    private Path folder() {
        return profiles.folderOf(ProfileContext.current()).toAbsolutePath().normalize().resolve("backups");
    }

    public synchronized BackupInfo create() {
        return write("backup-" + LocalDateTime.now().format(STAMP) + ".sql");
    }

    /**
     * Copies the database at most once a day, while the "automatic backup" setting is on (it is off by default).
     * Called for each profile by {@link BackgroundSync}, so the first copy of the day is made soon after the app opens.
     */
    public synchronized void automaticIfDue() {
        if (!settings.autoBackup()) {
            return;
        }
        Instant last = list().stream().filter(BackupService::isAutomatic)
                .map(BackupInfo::createdAt).max(Comparator.naturalOrder()).orElse(Instant.EPOCH);
        if (Instant.now().isBefore(last.plus(EVERY_AUTOMATIC))) {
            return;
        }
        write("backup-" + LocalDateTime.now().format(STAMP) + AUTOMATIC_SUFFIX);
    }

    public List<BackupInfo> list() {
        if (!Files.isDirectory(folder())) {
            return List.of();
        }
        try (Stream<Path> files = Files.list(folder())) {
            return files.filter(p -> NAME.matcher(p.getFileName().toString()).matches())
                    .map(BackupService::info)
                    .sorted(Comparator.comparing(BackupInfo::createdAt).reversed().thenComparing(BackupInfo::name, Comparator.reverseOrder()))
                    .toList();
        } catch (IOException e) {
            throw new IllegalStateException("Não foi possível listar os backups", e);
        }
    }

    public String read(String name) {
        try {
            return Files.readString(resolve(name), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Backup não encontrado: " + name);
        }
    }

    public void delete(String name) {
        try {
            Files.deleteIfExists(resolve(name));
        } catch (IOException e) {
            throw new IllegalStateException("Não foi possível excluir o backup", e);
        }
    }

    /** Restores one of the saved backups. */
    public synchronized void restoreSaved(String name) {
        restoreScript(read(name));
    }

    /** Restores from the text of a backup file the user picked. */
    public synchronized void restoreContent(String content) {
        restoreScript(content);
    }

    private void restoreScript(String script) {
        String clean = sanitize(script);
        BackupInfo safety = write("backup-" + LocalDateTime.now().format(STAMP) + "-antes-de-restaurar.sql");
        Path temp = folder().resolve("restore.tmp");
        try {
            Files.writeString(temp, clean, StandardCharsets.UTF_8);
            runScript(temp);
        } catch (RuntimeException | IOException e) {
            log.error("Restauracao falhou; voltando ao estado anterior", e);
            try {
                runScript(folder().resolve(safety.name()));
            } catch (RuntimeException rollback) {
                log.error("Nao foi possivel voltar ao estado anterior; os dados estao em {}", safety.name(), rollback);
            }
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Não foi possível restaurar: o arquivo não parece um backup válido deste aplicativo. Seus dados foram mantidos.");
        } finally {
            try {
                Files.deleteIfExists(temp);
            } catch (IOException ignored) {
                // a leftover temp file is harmless
            }
        }
        profiles.migrateCurrent(); // a backup from an older version is brought up to date
    }

    private void runScript(Path file) {
        String quoted = file.toString().replace('\\', '/').replace("'", "''");
        jdbc.execute("DROP ALL OBJECTS");
        jdbc.execute("RUNSCRIPT FROM '" + quoted + "' CHARSET 'UTF-8'");
    }

    /** Rejects scripts that do anything but rebuild data, and drops user statements (they could lock the app out). */
    static String sanitize(String script) {
        String text = script == null ? "" : script.replace("﻿", "");
        String lower = text.toLowerCase();
        if (!lower.contains("expenses") || !lower.contains("accounts") || !lower.contains("create")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Este arquivo não parece um backup deste aplicativo.");
        }
        StringBuilder out = new StringBuilder();
        for (String line : text.split("\\R", -1)) {
            if (FORBIDDEN.matcher(line).find()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "O arquivo contém comandos não permitidos e não foi restaurado.");
            }
            if (!USER_STATEMENT.matcher(line).find()) {
                out.append(line).append('\n');
            }
        }
        return out.toString();
    }

    private BackupInfo write(String name) {
        try {
            Files.createDirectories(folder());
            Path file = folder().resolve(name);
            jdbc.execute("SCRIPT TO '" + file.toString().replace('\\', '/').replace("'", "''") + "'");
            prune();
            return info(file);
        } catch (IOException e) {
            throw new IllegalStateException("Não foi possível criar o backup", e);
        }
    }

    /** Keeps the newest copies of each kind; the list is already sorted newest first. */
    private void prune() {
        List<BackupInfo> all = list();
        keepNewest(all.stream().filter(b -> !isAutomatic(b)).toList(), KEEP);
        keepNewest(all.stream().filter(BackupService::isAutomatic).toList(), KEEP_AUTOMATIC);
    }

    private void keepNewest(List<BackupInfo> newestFirst, int keep) {
        for (int i = keep; i < newestFirst.size(); i++) {
            delete(newestFirst.get(i).name());
        }
    }

    private static boolean isAutomatic(BackupInfo backup) {
        return backup.name().endsWith(AUTOMATIC_SUFFIX);
    }

    private Path resolve(String name) {
        if (name == null || !NAME.matcher(name).matches()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Backup não encontrado: " + name);
        }
        return folder().resolve(name);
    }

    private static BackupInfo info(Path file) {
        try {
            return new BackupInfo(file.getFileName().toString(), Files.size(file), Files.getLastModifiedTime(file).toInstant());
        } catch (IOException e) {
            throw new IllegalStateException("Não foi possível ler o backup " + file, e);
        }
    }
}
