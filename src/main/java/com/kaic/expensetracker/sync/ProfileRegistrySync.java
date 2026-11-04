package com.kaic.expensetracker.sync;

import com.kaic.expensetracker.profile.ProfileContext;
import com.kaic.expensetracker.profile.ProfileService;
import com.kaic.expensetracker.profile.ProfileService.Purged;
import com.kaic.expensetracker.profile.ProfileService.RegistryEntry;
import com.kaic.expensetracker.sync.SyncHub.Change;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.LongConsumer;
import java.util.function.LongSupplier;

/**
 * Keeps the list of profiles the same on every device: a profile made on one device appears on the others, a rename or a
 * move to the trash goes along, and a profile deleted for good is deleted everywhere. It uses the hub's "profile"
 * {@code _registry} with one row per profile (its sync id), carrying the name and when it was trashed, encrypted like
 * everything else. The latest change wins. The profiles' data is synced separately, one profile at a time.
 */
public class ProfileRegistrySync {

    static final String HUB_PROFILE = "_registry";
    static final String TABLE = "profiles";
    private static final int PAGE = 200;
    private static final Logger log = LoggerFactory.getLogger(ProfileRegistrySync.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final SyncHub hub;
    private final SyncCrypto crypto;
    private final ProfileService profiles;
    private final LongSupplier cursor;
    private final LongConsumer saveCursor;
    private final String deviceId;

    public ProfileRegistrySync(SyncHub hub, SyncCrypto crypto, ProfileService profiles, LongSupplier cursor,
                               LongConsumer saveCursor, String deviceId) {
        this.hub = hub;
        this.crypto = crypto;
        this.profiles = profiles;
        this.cursor = cursor;
        this.saveCursor = saveCursor;
        this.deviceId = deviceId;
    }

    /** Reads what the other devices did with the profiles, then sends what was done here. */
    public void sync() {
        pull();
        push();
    }

    private void pull() {
        long at = cursor.getAsLong();
        while (true) {
            List<Change> page = hub.pull(HUB_PROFILE, at, PAGE);
            for (Change c : page) {
                if (deviceId.equals(c.deviceId()) || !TABLE.equals(c.table())) continue;
                try {
                    apply(c);
                } catch (RuntimeException e) {
                    log.warn("Não foi possível aplicar o perfil {} vindo do sync", c.uuid(), e);
                }
            }
            if (!page.isEmpty()) at = page.get(page.size() - 1).seq();
            if (page.size() < PAGE) break;
        }
        saveCursor.accept(at);
    }

    private void apply(Change c) {
        String id = profiles.idOfSync(c.uuid());
        if (c.deleted()) { // deleted for good somewhere else
            if (id != null && !ProfileContext.MAIN.equals(id)) profiles.purgeFromRemote(id);
            return;
        }
        Map<?, ?> payload = JSON.readValue(crypto.decrypt(c.payload()), Map.class);
        String name = String.valueOf(payload.get("name"));
        Long trashedAt = payload.get("trashedAt") == null ? null : ((Number) payload.get("trashedAt")).longValue();
        if (id == null) {
            boolean purgedHere = profiles.purged().stream().anyMatch(p -> p.syncId().equals(c.uuid()) && p.at() >= c.updatedAt());
            if (!purgedHere) profiles.createFromRemote(c.uuid(), name, trashedAt, c.updatedAt());
            return;
        }
        RegistryEntry mine = profiles.registry().stream().filter(r -> r.id().equals(id)).findFirst().orElseThrow();
        if (c.updatedAt() > mine.updatedAt()) {
            profiles.updateFromRemote(id, name, ProfileContext.MAIN.equals(id) ? null : trashedAt, c.updatedAt());
        }
    }

    private void push() {
        List<Change> changes = new ArrayList<>();
        List<RegistryEntry> sent = new ArrayList<>();
        for (RegistryEntry e : profiles.registry()) {
            if (e.updatedAt() <= profiles.registrySentAt(e.id())) continue; // nothing new (the main profile starts at 0)
            if (ProfileContext.MAIN.equals(e.id()) && e.updatedAt() == 0) continue;
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("name", e.name());
            payload.put("trashedAt", e.trashedAt());
            changes.add(Change.outgoing(TABLE, e.syncId(), e.updatedAt(), false, crypto.encrypt(JSON.writeValueAsString(payload))));
            sent.add(e);
        }
        List<Purged> purged = profiles.purged();
        for (Purged p : purged) changes.add(Change.outgoing(TABLE, p.syncId(), p.at(), true, null));
        if (changes.isEmpty()) return;
        hub.push(HUB_PROFILE, deviceId, changes);
        for (RegistryEntry e : sent) profiles.markRegistrySent(e.id(), e.updatedAt());
        for (Purged p : purged) profiles.forgetPurged(p.syncId());
    }
}
