package com.kaic.expensetracker.sync;

import java.util.List;

/** The server side of the sync (a Supabase project in production). Same contract as the phone's hub clients. */
public interface SyncHub {

    /** One row's latest version: {@code payload} is encrypted (null when {@code deleted}); {@code updatedAt} is UTC millis. */
    record Change(String table, String uuid, long updatedAt, boolean deleted, String payload, long seq, String deviceId) {
        public static Change outgoing(String table, String uuid, long updatedAt, boolean deleted, String payload) {
            return new Change(table, uuid, updatedAt, deleted, payload, 0, null);
        }
    }

    /** The key check kept on the hub: the salt for the password, and an encrypted known text to verify it. */
    record Vault(String salt, String check) {
    }

    /** @return null when the account has no vault yet */
    Vault getVault();

    void setVault(Vault vault);

    /** Stores the versions that are newer than what the hub has; returns how many were accepted. */
    int push(String profileId, String deviceId, List<Change> changes);

    /** What changed after {@code afterSeq}, oldest first. */
    List<Change> pull(String profileId, long afterSeq, int limit);
}
