package com.kaic.expensetracker.model;

import com.kaic.expensetracker.sync.SyncTombstones;
import jakarta.persistence.Column;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.PostRemove;
import jakarta.persistence.PrePersist;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * What every synchronized row has: a {@code uuid} (the same on every device, unlike the numeric id) and the time of
 * its last change. Deleting a row for good leaves a tombstone so the other devices can delete it too.
 */
@MappedSuperclass
@EntityListeners(SyncEntity.Listener.class)
@Getter
@Setter
public abstract class SyncEntity {

    @Column(name = "uuid", nullable = false, updatable = false, length = 36)
    private String uuid;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public static class Listener {

        @PrePersist
        void ensureUuid(SyncEntity entity) {
            if (entity.uuid == null) entity.uuid = UUID.randomUUID().toString();
        }

        @PostRemove
        void leaveTombstone(SyncEntity entity) {
            SyncTombstones.record(entity);
        }
    }
}
