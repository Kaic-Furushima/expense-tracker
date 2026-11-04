package com.kaic.expensetracker.sync;

import com.kaic.expensetracker.sync.SyncHub.Change;
import com.kaic.expensetracker.sync.SyncHub.Vault;
import com.kaic.expensetracker.sync.SyncTables.Col;
import com.kaic.expensetracker.sync.SyncTables.Kind;
import com.kaic.expensetracker.sync.SyncTables.Table;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The computer's side of the sync; the phone has the same protocol in {@code sync/engine.js}.
 * <ul>
 *   <li>PUSH: a row is "changed" when the hash of its payload differs from the one recorded at the last push
 *       ({@code sync_sent}); deletions come from {@code sync_tombstones}. Each change is encrypted and sent; the hub
 *       keeps one row per record and only accepts a newer {@code updatedAt}.</li>
 *   <li>PULL: the hub returns what changed after this device's cursor. A change enters if it is newer than the local row
 *       ("the latest wins"); deletions follow the same rule. Foreign keys travel as uuids; when the parent has not
 *       arrived yet the change waits in {@code sync_pending}.</li>
 *   <li>If two devices created the same thing (same account name, same month budget...) with different uuids, the smallest
 *       uuid stays; the other becomes an alias ({@code sync_alias}) so children that cite it are redirected.</li>
 * </ul>
 * Works with plain JDBC on purpose: applying a remote change must not bump timestamps or leave tombstones.
 */
public class SyncEngine {

    private static final int PAGE = 200;
    private static final int PUSH_BATCH = 100;
    /** One request to the hub carries up to this much encrypted text (a single big change may exceed it a little). */
    private static final long PUSH_BATCH_BYTES = 4L * 1024 * 1024;
    /** Attachments above this (3 MB) stay on this computer: encrypted and in base64 they would pass 5 MB per change. The app accepts up to 5 MB. */
    public static final long MAX_SYNC_ATTACHMENT_BYTES = 3L * 1024 * 1024;
    private static final JsonMapper JSON = JsonMapper.builder().build();

    public record Result(int pulled, int pushed, int pending) {
    }

    private record Dirty(Table table, String uuid, String hash, long ms, boolean deleted, Map<String, Object> payload,
                         Long tombstoneId) {
        String key() {
            return table.name() + "|" + uuid;
        }
    }

    private record Outcome(String kind, String reason) {
        static final Outcome APPLIED = new Outcome("applied", null);
        static final Outcome SKIPPED = new Outcome("skipped", null);

        static Outcome pending(String reason) {
            return new Outcome("pending", reason);
        }

        boolean isPending() {
            return kind.equals("pending");
        }
    }

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final SyncHub hub;
    private final SyncCrypto crypto;
    private final String profileId;
    private final Clock clock;
    private Map<String, Dirty> dirty;
    private boolean sawChanges;

    public SyncEngine(JdbcTemplate jdbc, TransactionTemplate tx, SyncHub hub, SyncCrypto crypto, String profileId, Clock clock) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.hub = hub;
        this.crypto = crypto;
        this.profileId = profileId;
        this.clock = clock;
    }

    /** Opens the sync with the sync password: the first device creates the vault on the hub, the others check the password. */
    public static SyncCrypto openCrypto(SyncHub hub, String password) {
        Vault vault = hub.getVault();
        if (vault == null) {
            String salt = SyncCrypto.newSalt();
            SyncCrypto crypto = SyncCrypto.fromPassword(password, salt);
            hub.setVault(new Vault(salt, crypto.makeCheck()));
            return crypto;
        }
        SyncCrypto crypto = SyncCrypto.fromPassword(password, vault.salt());
        if (!crypto.verify(vault.check())) throw new IllegalArgumentException("Senha de sync incorreta.");
        return crypto;
    }

    public static SyncEngine open(JdbcTemplate jdbc, TransactionTemplate tx, SyncHub hub, String password, String profileId,
                                  Clock clock) {
        return new SyncEngine(jdbc, tx, hub, openCrypto(hub, password), profileId, clock);
    }

    // ---- local state ----

    private String state(String key) {
        List<String> found = jdbc.queryForList("select state_value from sync_state where state_key = ?", String.class, key);
        return found.isEmpty() ? null : found.get(0);
    }

    private void setState(String key, String value) {
        jdbc.update("merge into sync_state (state_key, state_value) key (state_key) values (?, ?)", key, value);
    }

    public String deviceId() {
        String id = state("device");
        if (id == null) {
            id = UUID.randomUUID().toString();
            setState("device", id);
        }
        return id;
    }

    private long cursor() {
        String value = state("cursor:" + profileId);
        return value == null ? 0 : Long.parseLong(value);
    }

    public int pendingCount() {
        return jdbc.queryForObject("select count(*) from sync_pending", Integer.class);
    }

    /** After restoring a backup (or when in doubt): send everything again and read everything again. */
    public void fullResync() {
        tx.executeWithoutResult(s -> {
            jdbc.update("delete from sync_sent");
            setState("cursor:" + profileId, "0");
        });
    }

    /**
     * Makes the hub (and so every other device) equal to what is here, whatever it held: after restoring a backup over a
     * profile. Every local row becomes "the newest", whatever the hub has that is not here is deleted, and the hub's old
     * state is not applied back. This cannot be undone on the other devices.
     */
    public synchronized void forceOverwrite() {
        // what the hub has: its newest version and what is alive there (a version dated in the future must lose too)
        java.util.Map<String, Long> alive = new HashMap<>();
        long newest = 0;
        long cursor = 0;
        while (true) {
            List<Change> page = hub.pull(profileId, cursor, PAGE);
            for (Change c : page) {
                newest = Math.max(newest, c.updatedAt());
                if (!c.deleted()) alive.put(c.table() + "|" + c.uuid(), c.updatedAt());
            }
            if (!page.isEmpty()) cursor = page.get(page.size() - 1).seq();
            if (page.size() < PAGE) break;
        }
        long ms = Math.max(SyncTables.toMillis(LocalDateTime.now(clock)), newest + 1);
        LocalDateTime stamp = SyncTables.fromMillis(ms);

        // every local row becomes "the newest"; nothing sent, waiting or aliased before is trusted any more
        tx.executeWithoutResult(s -> {
            for (Table t : SyncTables.ALL) jdbc.update("update " + t.name() + " set updated_at = ?", Timestamp.valueOf(stamp));
            jdbc.update("delete from sync_sent");
            jdbc.update("delete from sync_pending");
            jdbc.update("delete from sync_alias");
            jdbc.update("delete from sync_tombstones");
        });
        // what the hub has alive that no longer exists here is deleted there too
        for (Table t : SyncTables.ALL) {
            jdbc.query("select uuid from " + t.name(), rs -> {
                alive.remove(t.name() + "|" + rs.getString(1));
            });
        }
        List<Change> deletes = new ArrayList<>();
        for (String key : alive.keySet()) {
            int bar = key.indexOf('|');
            deletes.add(Change.outgoing(key.substring(0, bar), key.substring(bar + 1), ms, true, null));
        }
        for (int from = 0; from < deletes.size(); from += PUSH_BATCH) {
            hub.push(profileId, deviceId(), deletes.subList(from, Math.min(deletes.size(), from + PUSH_BATCH)));
        }
        setState("cursor:" + profileId, "0");
        sync();
    }

    // ---- full cycle ----

    /** Reads what changed there, then sends what changed here. */
    public synchronized Result sync() {
        dirty = scan();
        try {
            sawChanges = false;
            int pulled = pull();
            // applying remote changes can renumber uuids (adopted twins): rebuild what is left to send
            if (sawChanges) dirty = scan();
            int pushed = push();
            return new Result(pulled, pushed, pendingCount());
        } finally {
            dirty = null;
        }
    }

    // ---- PUSH ----

    /** Finds what changed here since the last push. A row whose content changed without its updated_at moving is touched. */
    private Map<String, Dirty> scan() {
        Map<String, Dirty> out = new LinkedHashMap<>();
        Map<String, String[]> sent = new HashMap<>();
        jdbc.query("select table_name, uuid, content_hash, updated_ms from sync_sent",
                rs -> {
                    sent.put(rs.getString(1) + "|" + rs.getString(2), new String[]{rs.getString(3), rs.getString(4)});
                });
        Lookups lookups = new Lookups();
        LocalDateTime now = LocalDateTime.now(clock);
        for (Table t : SyncTables.ALL) {
            for (Map<String, Object> row : jdbc.queryForList("select " + selectColumns(t, false) + " from " + t.name())) {
                String uuid = (String) row.get("uuid");
                if (t.name().equals("attachments") && ((Number) row.get("size_bytes")).longValue() > MAX_SYNC_ATTACHMENT_BYTES) continue;
                Map<String, Object> payload = payload(t, row, lookups);
                String hash = hash(payload);
                String[] was = sent.get(t.name() + "|" + uuid);
                if (was != null && was[0].equals(hash)) continue;
                long ms = SyncTables.toMillis(SyncTables.asLocalDateTime(row.get("updated_at")));
                if (was != null && ms <= Long.parseLong(was[1])) {
                    ms = SyncTables.toMillis(now);
                    jdbc.update("update " + t.name() + " set updated_at = ? where uuid = ?", Timestamp.valueOf(now), uuid);
                }
                Dirty d = new Dirty(t, uuid, hash, ms, false, payload, null);
                out.put(d.key(), d);
            }
        }
        for (Map<String, Object> g : jdbc.queryForList("select id, table_name, uuid, deleted_at from sync_tombstones")) {
            Table t = SyncTables.ALL.stream().filter(x -> x.name().equals(g.get("table_name"))).findFirst().orElse(null);
            if (t == null) continue;
            long ms = SyncTables.toMillis(SyncTables.asLocalDateTime(g.get("deleted_at")));
            Dirty d = new Dirty(t, (String) g.get("uuid"), null, ms, true, null, ((Number) g.get("id")).longValue());
            out.put(d.key(), d);
        }
        return out;
    }

    private int push() {
        List<Dirty> todo = new ArrayList<>(dirty != null ? dirty.values() : scan().values());
        int sent = 0;
        int from = 0;
        while (from < todo.size()) {
            List<Change> changes = new ArrayList<>();
            List<Dirty> batch = new ArrayList<>();
            long bytes = 0;
            while (from < todo.size() && batch.size() < PUSH_BATCH && bytes < PUSH_BATCH_BYTES) {
                Dirty d = todo.get(from++);
                batch.add(d);
                if (d.deleted()) {
                    changes.add(Change.outgoing(d.table().name(), d.uuid(), d.ms(), true, null));
                    continue;
                }
                Map<String, Object> payload = new LinkedHashMap<>(d.payload());
                if (d.table().name().equals("attachments")) {
                    payload.put("data", jdbc.queryForObject("select data from attachments where uuid = ?", String.class, d.uuid()));
                }
                String encrypted = crypto.encrypt(JSON.writeValueAsString(payload));
                bytes += encrypted.length();
                changes.add(Change.outgoing(d.table().name(), d.uuid(), d.ms(), false, encrypted));
            }
            hub.push(profileId, deviceId(), changes);
            tx.executeWithoutResult(s -> {
                for (Dirty d : batch) {
                    if (d.deleted()) {
                        jdbc.update("delete from sync_tombstones where id = ?", d.tombstoneId());
                        jdbc.update("delete from sync_sent where table_name = ? and uuid = ?", d.table().name(), d.uuid());
                    } else {
                        recordSent(d.table().name(), d.uuid(), d.hash(), d.ms());
                    }
                }
            });
            sent += batch.size();
        }
        return sent;
    }

    private void recordSent(String table, String uuid, String hash, long ms) {
        jdbc.update("merge into sync_sent (table_name, uuid, content_hash, updated_ms) key (table_name, uuid) values (?, ?, ?, ?)",
                table, uuid, hash, ms);
    }

    // ---- payload ----

    /** id -> uuid per table, and the tags of each expense, loaded once per scan. */
    private final class Lookups {
        private final Map<String, Map<Long, String>> uuids = new HashMap<>();
        private Map<Long, List<String>> tags;

        String uuid(String table, Long id) {
            if (id == null) return null;
            return uuids.computeIfAbsent(table, t -> {
                Map<Long, String> map = new HashMap<>();
                jdbc.query("select id, uuid from " + t, rs -> {
                    map.put(rs.getLong(1), rs.getString(2));
                });
                return map;
            }).get(id);
        }

        List<String> tagsOf(Long expenseId) {
            if (tags == null) {
                tags = new HashMap<>();
                jdbc.query("select et.expense_id, t.uuid from expense_tags et join tags t on t.id = et.tag_id order by t.uuid", rs -> {
                    tags.computeIfAbsent(rs.getLong(1), k -> new ArrayList<>()).add(rs.getString(2));
                });
            }
            return tags.getOrDefault(expenseId, List.of());
        }
    }

    private static String selectColumns(Table t, boolean withData) {
        List<String> cols = new ArrayList<>(List.of("id", "uuid", "updated_at"));
        for (Col c : t.cols()) {
            if (t.name().equals("attachments") && c.wire().equals("data") && !withData) continue;
            cols.add(c.column());
        }
        return String.join(", ", cols);
    }

    private Map<String, Object> payload(Table t, Map<String, Object> row, Lookups lookups) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Col c : t.cols()) {
            if (t.name().equals("attachments") && c.wire().equals("data") && !row.containsKey("data")) continue;
            Object value = row.get(c.column());
            if (c.kind() == Kind.FK) {
                out.put(c.payloadName(), lookups.uuid(c.target(), value == null ? null : ((Number) value).longValue()));
            } else if (t.name().equals("expenses") && c.wire().equals("type") && value == null) {
                out.put(c.wire(), "EXPENSE"); // older rows have no type: they are expenses
            } else {
                out.put(c.wire(), SyncTables.toWire(c, value));
            }
        }
        if (t.tags()) out.put("tag_uuids", lookups.tagsOf(((Number) row.get("id")).longValue()));
        return out;
    }

    private static String hash(Map<String, Object> payload) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(JSON.writeValueAsString(payload).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Records the current content of a row as already in sync (right after applying a remote change). */
    private void markInSync(Table t, String uuid, long ms) {
        List<Map<String, Object>> rows = jdbc.queryForList("select " + selectColumns(t, false) + " from " + t.name() + " where uuid = ?", uuid);
        if (rows.isEmpty()) return;
        recordSent(t.name(), uuid, hash(payload(t, rows.get(0), new Lookups())), ms);
        if (dirty != null) dirty.remove(t.name() + "|" + uuid);
    }

    // ---- PULL ----

    private int pull() {
        String mine = deviceId();
        int applied = 0;
        long cursor = cursor();
        while (true) {
            List<Change> page = hub.pull(profileId, cursor, PAGE);
            List<Change> incoming = new ArrayList<>();
            for (Change raw : page) {
                if (mine.equals(raw.deviceId())) continue; // sent by this very device
                incoming.add(new Change(raw.table(), raw.uuid(), raw.updatedAt(), raw.deleted(),
                        raw.deleted() ? null : crypto.decrypt(raw.payload()), raw.seq(), raw.deviceId()));
            }
            if (!incoming.isEmpty()) sawChanges = true;
            if (!page.isEmpty()) cursor = page.get(page.size() - 1).seq();
            applied += applyBatch(incoming);
            if (!page.isEmpty()) setState("cursor:" + profileId, Long.toString(cursor));
            if (page.size() < PAGE) return applied;
        }
    }

    /** Applies a batch (plus whatever was pending) in one transaction. Returns how many changes altered data. */
    private int applyBatch(List<Change> incoming) {
        Integer changed = tx.execute(status -> {
            Map<String, Change> byKey = new LinkedHashMap<>();
            for (Map<String, Object> p : jdbc.queryForList("select table_name, uuid, change_json from sync_pending")) {
                Change c = readChange(p.get("change_json").toString());
                byKey.put(c.table() + "|" + c.uuid(), c);
            }
            for (Change c : incoming) byKey.put(c.table() + "|" + c.uuid(), c);

            int count = 0;
            List<Change> queue = new ArrayList<>(byKey.values().stream().filter(c -> !c.deleted()).toList());
            queue.sort((a, b) -> Integer.compare(SyncTables.order(a.table()), SyncTables.order(b.table())));
            Map<String, String> reasons = new HashMap<>();
            for (boolean progress = true; progress && !queue.isEmpty(); ) {
                progress = false;
                List<Change> next = new ArrayList<>();
                for (Change c : queue) {
                    Outcome o = applyUpsert(c);
                    if (o.isPending()) {
                        next.add(c);
                        reasons.put(c.table() + "|" + c.uuid(), o.reason());
                    } else {
                        clearPending(c);
                        if (o == Outcome.APPLIED) count++;
                        progress = true;
                    }
                }
                queue = next;
            }
            for (Change c : queue) savePending(c, reasons.get(c.table() + "|" + c.uuid()));

            List<Change> deletes = new ArrayList<>(byKey.values().stream().filter(Change::deleted).toList());
            deletes.sort((a, b) -> Integer.compare(SyncTables.order(b.table()), SyncTables.order(a.table())));
            for (Change c : deletes) {
                Outcome o = applyDelete(c);
                if (o.isPending()) {
                    savePending(c, o.reason());
                } else {
                    clearPending(c);
                    if (o == Outcome.APPLIED) count++;
                }
            }
            return count;
        });
        return changed == null ? 0 : changed;
    }

    private Change readChange(String json) {
        Map<?, ?> m = JSON.readValue(json, Map.class);
        return new Change((String) m.get("table"), (String) m.get("uuid"), ((Number) m.get("updatedAt")).longValue(),
                Boolean.TRUE.equals(m.get("deleted")), (String) m.get("payload"), 0, null);
    }

    private void savePending(Change c, String reason) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("table", c.table());
        m.put("uuid", c.uuid());
        m.put("updatedAt", c.updatedAt());
        m.put("deleted", c.deleted());
        m.put("payload", c.payload());
        jdbc.update("merge into sync_pending (table_name, uuid, change_json, reason) key (table_name, uuid) values (?, ?, ?, ?)",
                c.table(), c.uuid(), JSON.writeValueAsString(m), reason == null ? null : reason.substring(0, Math.min(500, reason.length())));
    }

    private void clearPending(Change c) {
        jdbc.update("delete from sync_pending where table_name = ? and uuid = ?", c.table(), c.uuid());
    }

    // ---- applying one change ----

    private String resolveAlias(String table, String uuid) {
        String current = uuid;
        for (int i = 0; i < 10; i++) {
            List<String> next = jdbc.queryForList("select to_uuid from sync_alias where table_name = ? and from_uuid = ?", String.class, table, current);
            if (next.isEmpty()) break;
            current = next.get(0);
        }
        return current;
    }

    private Long idOf(String table, String uuid) {
        List<Long> ids = jdbc.queryForList("select id from " + table + " where uuid = ?", Long.class, resolveAlias(table, uuid));
        return ids.isEmpty() ? null : ids.get(0);
    }

    private Map<String, Object> find(Table t, String uuid) {
        List<Map<String, Object>> rows = jdbc.queryForList("select " + selectColumns(t, false) + " from " + t.name() + " where uuid = ?", uuid);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private Outcome applyUpsert(Change c) {
        Table t = SyncTables.byName(c.table());
        Map<?, ?> payload = JSON.readValue(c.payload(), Map.class);

        Map<String, Object> values = new LinkedHashMap<>();
        for (Col col : t.cols()) {
            if (col.kind() == Kind.FK) {
                Object ref = payload.get(col.payloadName());
                if (ref == null) {
                    values.put(col.column(), null);
                    continue;
                }
                Long id = idOf(col.target(), ref.toString());
                if (id == null) return Outcome.pending("Falta uma linha da qual esta depende.");
                values.put(col.column(), id);
            } else {
                Object wire = payload.get(col.wire());
                // "kind": a device whose app does not separate expense and income categories yet sends none
                values.put(col.column(), wire == null && col.column().equals("kind") ? "EXPENSE" : SyncTables.fromWire(col, wire));
            }
        }
        List<Long> tagIds = null;
        if (t.tags()) {
            tagIds = new ArrayList<>();
            Object list = payload.get("tag_uuids");
            if (list instanceof List<?> uuids) {
                for (Object u : uuids) {
                    Long id = idOf("tags", u.toString());
                    if (id == null) return Outcome.pending("Falta uma etiqueta da qual esta depende.");
                    tagIds.add(id);
                }
            }
        }

        try {
            String uuid = resolveAlias(c.table(), c.uuid());
            Map<String, Object> local = find(t, uuid);

            if (local == null) {
                Map<String, Object> twin = findTwin(t, values);
                if (twin != null) {
                    String twinUuid = (String) twin.get("uuid");
                    if (c.uuid().compareTo(twinUuid) > 0) { // the other device will adopt ours
                        jdbc.update("merge into sync_alias (table_name, from_uuid, to_uuid) key (table_name, from_uuid) values (?, ?, ?)", c.table(), c.uuid(), twinUuid);
                        return Outcome.SKIPPED;
                    }
                    // ours is the bigger one: adopt the other device's uuid
                    jdbc.update("update " + c.table() + " set uuid = ? where id = ?", c.uuid(), twin.get("id"));
                    jdbc.update("merge into sync_alias (table_name, from_uuid, to_uuid) key (table_name, from_uuid) values (?, ?, ?)", c.table(), twinUuid, c.uuid());
                    jdbc.update("delete from sync_sent where table_name = ? and uuid = ?", c.table(), twinUuid);
                    if (dirty != null) dirty.remove(c.table() + "|" + twinUuid);
                    uuid = c.uuid();
                    local = new org.springframework.util.LinkedCaseInsensitiveMap<>();
                    local.putAll(twin);
                    local.put("uuid", uuid);
                    // the content stays as ours until compared below; make sure it goes out under the new uuid
                    if (c.updatedAt() <= millisOf(local)) return queueLocal(t, uuid, local);
                }
            }

            if (local != null) {
                if (c.updatedAt() <= millisOf(local)) return Outcome.SKIPPED; // ours is newer: it goes out with the push
                List<String> sets = new ArrayList<>();
                List<Object> args = new ArrayList<>();
                for (Map.Entry<String, Object> e : values.entrySet()) {
                    sets.add(e.getKey() + " = ?");
                    args.add(e.getValue());
                }
                sets.add("updated_at = ?");
                args.add(Timestamp.valueOf(SyncTables.fromMillis(c.updatedAt())));
                args.add(local.get("id"));
                jdbc.update("update " + c.table() + " set " + String.join(", ", sets) + " where id = ?", args.toArray());
                if (tagIds != null) setTags(((Number) local.get("id")).longValue(), tagIds);
                markInSync(t, uuid, c.updatedAt());
                return Outcome.APPLIED;
            }

            // not here: if it was deleted here after this version, it stays deleted
            List<Timestamp> gone = jdbc.queryForList("select deleted_at from sync_tombstones where table_name = ? and uuid = ?", Timestamp.class, c.table(), uuid);
            if (!gone.isEmpty() && SyncTables.toMillis(gone.get(0).toLocalDateTime()) >= c.updatedAt()) return Outcome.SKIPPED;
            List<String> columns = new ArrayList<>(values.keySet());
            List<Object> args = new ArrayList<>();
            args.add(uuid);
            args.addAll(values.values());
            args.add(Timestamp.valueOf(SyncTables.fromMillis(c.updatedAt())));
            jdbc.update("insert into " + c.table() + " (uuid, " + String.join(", ", columns) + ", updated_at) values (?, "
                    + String.join(", ", columns.stream().map(x -> "?").toList()) + ", ?)", args.toArray());
            jdbc.update("delete from sync_tombstones where table_name = ? and uuid = ?", c.table(), uuid);
            if (tagIds != null) setTags(idOf(c.table(), uuid), tagIds);
            markInSync(t, uuid, c.updatedAt());
            return Outcome.APPLIED;
        } catch (DataAccessException e) {
            return Outcome.pending(rootMessage(e));
        }
    }

    /** The local row is the newer one after adopting a uuid: it must be sent (under the new uuid). */
    private Outcome queueLocal(Table t, String uuid, Map<String, Object> local) {
        if (dirty != null) {
            Map<String, Object> payload = payload(t, local, new Lookups());
            Dirty d = new Dirty(t, uuid, hash(payload), millisOf(local), false, payload, null);
            dirty.put(d.key(), d);
        }
        return Outcome.SKIPPED;
    }

    private Outcome applyDelete(Change c) {
        Table t = SyncTables.byName(c.table());
        String uuid = resolveAlias(c.table(), c.uuid());
        Map<String, Object> local = find(t, uuid);
        if (local == null) return Outcome.SKIPPED;
        if (c.updatedAt() <= millisOf(local)) return Outcome.SKIPPED;
        try {
            if (c.table().equals("expenses")) jdbc.update("delete from expense_tags where expense_id = ?", local.get("id"));
            jdbc.update("delete from " + c.table() + " where id = ?", local.get("id"));
        } catch (DataAccessException e) {
            return Outcome.pending(rootMessage(e));
        }
        jdbc.update("delete from sync_sent where table_name = ? and uuid = ?", c.table(), uuid);
        if (dirty != null) dirty.remove(c.table() + "|" + uuid);
        return Outcome.APPLIED;
    }

    private static long millisOf(Map<String, Object> row) {
        return SyncTables.toMillis(SyncTables.asLocalDateTime(row.get("updated_at")));
    }

    private void setTags(long expenseId, List<Long> tagIds) {
        jdbc.update("delete from expense_tags where expense_id = ?", expenseId);
        for (Long id : new java.util.LinkedHashSet<>(tagIds)) {
            jdbc.update("insert into expense_tags (expense_id, tag_id) values (?, ?)", expenseId, id);
        }
    }

    /** A local row that is "the same thing" as the received one but has another uuid (see {@link Table#natural()}). */
    private Map<String, Object> findTwin(Table t, Map<String, Object> values) {
        if (t.natural() == null) return null;
        if (t.naturalWhen() != null && values.get(t.col(t.naturalWhen()).column()) == null) return null;
        List<String> conditions = new ArrayList<>();
        List<Object> args = new ArrayList<>();
        for (String wire : t.natural()) {
            Col col = t.col(wire);
            if (wire.equals("name")) conditions.add("lower(" + col.column() + ") = lower(?)");
            else if (col.kind() == Kind.TEXT) conditions.add("coalesce(" + col.column() + ", '') = coalesce(?, '')");
            else conditions.add("coalesce(" + col.column() + ", -1) = coalesce(?, -1)");
            args.add(values.get(col.column()));
        }
        List<Map<String, Object>> rows = jdbc.queryForList("select " + selectColumns(t, false) + " from " + t.name()
                + " where " + String.join(" and ", conditions), args.toArray());
        return rows.isEmpty() ? null : rows.get(0);
    }

    private static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null) t = t.getCause();
        return t.getMessage() == null ? e.getClass().getSimpleName() : t.getMessage();
    }
}
