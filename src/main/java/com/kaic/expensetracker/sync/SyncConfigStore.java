package com.kaic.expensetracker.sync;

import com.kaic.expensetracker.profile.ProfileContext;
import com.kaic.expensetracker.profile.ProfileService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The sync connection (project, account, sync password, login session) belongs to the person, not to one profile, so it
 * lives in {@code <data>/sync.json} next to the profiles' list. Backups never carry it.
 */
@Component
public class SyncConfigStore {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final Path file;

    @Autowired
    public SyncConfigStore(ProfileService profiles) {
        this(profiles.folderOf(ProfileContext.MAIN).resolve("sync.json"));
    }

    SyncConfigStore(Path file) {
        this.file = file;
    }

    public synchronized Map<String, Object> read() {
        if (!Files.isRegularFile(file)) return new LinkedHashMap<>();
        try {
            @SuppressWarnings("unchecked") Map<String, Object> map = JSON.readValue(Files.readString(file, StandardCharsets.UTF_8), Map.class);
            return map == null ? new LinkedHashMap<>() : new LinkedHashMap<>(map);
        } catch (RuntimeException | IOException e) {
            return new LinkedHashMap<>();
        }
    }

    public synchronized Object get(String key) {
        return read().get(key);
    }

    @SuppressWarnings("unchecked")
    public synchronized Map<String, Object> getMap(String key) {
        Object v = read().get(key);
        return v instanceof Map<?, ?> m ? new LinkedHashMap<>((Map<String, Object>) m) : null;
    }

    public synchronized void put(String key, Object value) {
        Map<String, Object> all = read();
        if (value == null) all.remove(key); else all.put(key, value);
        try {
            Files.createDirectories(file.getParent());
            Files.writeString(file, JSON.writeValueAsString(all), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("Não foi possível salvar a configuração do sync", e);
        }
    }

    public synchronized void clear(String... keys) {
        for (String key : keys) put(key, null);
    }
}
