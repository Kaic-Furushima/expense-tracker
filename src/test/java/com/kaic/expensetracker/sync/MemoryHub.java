package com.kaic.expensetracker.sync;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** The hub in memory (same rules as static/sync/supabase-hub.sql): one row per record, only a newer updatedAt is accepted. */
class MemoryHub implements SyncHub {

    Vault vault;
    final Map<String, Change> rows = new HashMap<>();
    long seq = 0;
    RuntimeException failNext;

    @Override
    public Vault getVault() {
        check();
        return vault;
    }

    @Override
    public void setVault(Vault vault) {
        check();
        this.vault = vault;
    }

    @Override
    public int push(String profileId, String deviceId, List<Change> changes) {
        check();
        int accepted = 0;
        for (Change c : changes) {
            String key = profileId + "|" + c.table() + "|" + c.uuid();
            Change old = rows.get(key);
            if (old != null && c.updatedAt() <= old.updatedAt()) continue;
            rows.put(key, new Change(c.table(), c.uuid(), c.updatedAt(), c.deleted(), c.deleted() ? null : c.payload(), ++seq, deviceId));
            accepted++;
        }
        return accepted;
    }

    @Override
    public List<Change> pull(String profileId, long afterSeq, int limit) {
        check();
        List<Change> out = new ArrayList<>();
        rows.forEach((k, v) -> {
            if (k.startsWith(profileId + "|") && v.seq() > afterSeq) out.add(v);
        });
        out.sort((a, b) -> Long.compare(a.seq(), b.seq()));
        return out.subList(0, Math.min(limit, out.size()));
    }

    private void check() {
        if (failNext != null) {
            RuntimeException e = failNext;
            failNext = null;
            throw e;
        }
    }
}
