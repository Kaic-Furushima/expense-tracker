package com.kaic.expensetracker.sync;

import com.kaic.expensetracker.profile.ProfileContext;
import com.kaic.expensetracker.profile.ProfileDataSource;
import com.kaic.expensetracker.profile.ProfileService;
import org.flywaydb.core.Flyway;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * A whole computer as the sync sees it: a main database plus profile databases in a temporary folder, a profile
 * list, the sync connection file and a {@link SyncService} that talks to a hub in memory.
 */
class PcDevice {

    final Path dir;
    final ProfileService profiles;
    final JdbcTemplate jdbc;
    final TransactionTemplate tx;
    final SyncConfigStore store;
    SyncService service;

    PcDevice() {
        try {
            dir = Files.createTempDirectory("pc-device-");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        DriverManagerDataSource main = new DriverManagerDataSource("jdbc:h2:mem:pc_" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1", "sa", "");
        Flyway.configure().dataSource(main).locations("classpath:db/migration").load().migrate();
        ProfileDataSource pds = new ProfileDataSource(main, dir);
        profiles = new ProfileService(pds);
        jdbc = new JdbcTemplate(pds);
        tx = new TransactionTemplate(new DataSourceTransactionManager(pds));
        store = new SyncConfigStore(dir.resolve("sync.json"));
    }

    PcDevice connectTo(MemoryHub hub) {
        service = new SyncService(jdbc, tx, profiles, store, cfg -> hub, "", "");
        return this;
    }

    SyncService.Connect login(String syncPassword, boolean create) {
        return new SyncService.Connect("https://x.supabase.co", "anon", "eu@exemplo.com", "senha-conta", syncPassword, create, false);
    }

    <T> T in(String profile, Supplier<T> action) {
        return ProfileContext.callAs(profile, action);
    }

    void insert(String profile, String table, String columns, String values) {
        in(profile, () -> jdbc.update("insert into " + table + " (uuid, updated_at, " + columns + ") values ('" + UUID.randomUUID()
                + "', current_timestamp, " + values + ")"));
    }

    void spend(String profile, String name, String amount) {
        insert(profile, "expenses", "name, amount, date, type, status, account_id, created_at",
                "'" + name + "', " + amount + ", date '2026-05-10', 'EXPENSE', 'PAID', (select min(id) from accounts), current_timestamp");
    }

    List<String> expenses(String profile) {
        return in(profile, () -> jdbc.queryForList("select name from expenses order by name", String.class));
    }

    int count(String profile, String sql) {
        return in(profile, () -> jdbc.queryForObject(sql, Integer.class));
    }

    String idByName(String name) {
        return profiles.list().stream().filter(p -> p.name().equals(name)).findFirst().orElseThrow().id();
    }

    Map<String, String> sync() {
        service.syncNow();
        return Map.of();
    }
}
