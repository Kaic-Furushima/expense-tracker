package com.kaic.expensetracker.sync;

import com.kaic.expensetracker.model.SyncEntity;
import jakarta.persistence.Table;
import org.hibernate.Hibernate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/**
 * Remembers rows that were deleted for good, so a sync can tell the other devices. The JPA entity listener that calls
 * {@link #record} is created by Hibernate, outside Spring, so the template is handed over through a static field.
 * The insert runs on the transaction's own connection: if the delete is rolled back, so is the tombstone.
 */
@Component
public class SyncTombstones {

    private static volatile JdbcTemplate jdbc;

    public SyncTombstones(JdbcTemplate jdbc) {
        SyncTombstones.jdbc = jdbc;
    }

    public static void record(SyncEntity entity) {
        JdbcTemplate template = jdbc;
        if (template == null || entity.getUuid() == null) return;
        Table table = Hibernate.getClass(entity).getAnnotation(Table.class);
        if (table == null) return;
        template.update("merge into sync_tombstones (table_name, uuid, deleted_at) key (table_name, uuid) values (?, ?, ?)",
                table.name(), entity.getUuid(), LocalDateTime.now());
    }
}
