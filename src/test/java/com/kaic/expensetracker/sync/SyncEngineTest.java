package com.kaic.expensetracker.sync;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Two computers (two databases) syncing through a hub in memory. */
class SyncEngineTest {

    private static final String PASSWORD = "senha-de-teste";
    private static final long T0 = LocalDateTime.of(2026, 5, 15, 12, 0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();

    /** One device: its own database, its own clock. */
    static class Device {
        final JdbcTemplate jdbc;
        final TransactionTemplate tx;
        long now = T0;
        SyncEngine engine;

        Device() {
            DriverManagerDataSource ds = new DriverManagerDataSource("jdbc:h2:mem:sync_" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1", "sa", "");
            Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();
            jdbc = new JdbcTemplate(ds);
            tx = new TransactionTemplate(new DataSourceTransactionManager(ds));
            // what the app creates on a fresh database
            // the migrations already create the payment methods and "Conta principal", each with a uuid of its own
            insert("categories", "name, icon, color", "'Mercado', null, null");
        }

        Device open(MemoryHub hub) {
            engine = SyncEngine.open(jdbc, tx, hub, PASSWORD, "default", Clock.fixed(Instant.ofEpochMilli(now), ZoneId.systemDefault()));
            return this;
        }

        /** Same engine, new clock reading. */
        Device at(MemoryHub hub, long ms) {
            now = ms;
            return open(hub);
        }

        void insert(String table, String columns, String values) {
            jdbc.update("insert into " + table + " (uuid, updated_at, " + columns + ") values ('" + UUID.randomUUID() + "', ?, " + values + ")",
                    Timestamp.valueOf(LocalDateTime.ofInstant(Instant.ofEpochMilli(now), ZoneId.systemDefault())));
        }

        long id(String table, String name) {
            return jdbc.queryForObject("select id from " + table + " where name = ?", Long.class, name);
        }

        long spend(String name, String amount, String... tags) {
            insert("expenses", "name, amount, date, type, status, account_id, category_id, created_at",
                    "'" + name + "', " + amount + ", date '2026-05-10', 'EXPENSE', 'PAID', " + id("accounts", "Conta principal")
                            + ", " + id("categories", "Mercado") + ", current_timestamp");
            long expense = id("expenses", name);
            for (String tag : tags) {
                if (jdbc.queryForObject("select count(*) from tags where name = ?", Integer.class, tag) == 0) insert("tags", "name", "'" + tag + "'");
                jdbc.update("insert into expense_tags (expense_id, tag_id) values (?, ?)", expense, id("tags", tag));
            }
            return expense;
        }

        List<String> names(String table) {
            return jdbc.queryForList("select name from " + table + " order by name", String.class);
        }

        List<String> uuids(String table) {
            return jdbc.queryForList("select uuid from " + table + " order by uuid", String.class);
        }

        List<String> tagsOf(String expense) {
            return jdbc.queryForList("select t.name from expense_tags et join tags t on t.id = et.tag_id join expenses e on e.id = et.expense_id "
                    + "where e.name = ? order by t.name", String.class, expense);
        }

        int count(String sql) {
            return jdbc.queryForObject(sql, Integer.class);
        }
    }

    private static void settle(MemoryHub hub, Device... devices) {
        for (int i = 0; i < 2; i++) for (Device d : devices) d.open(hub).engine.sync();
    }

    @Test
    void compatibleWithTheFormatTheJavaScriptSideWrites() {
        // produced by the phone's crypto.js: salt "0123456789abcdef", password "senha-comum", 1000 iterations
        SyncCrypto crypto = SyncCrypto.fromPassword("senha-comum", "MDEyMzQ1Njc4OWFiY2RlZg==", 1000);
        assertEquals("olá, é do JS", crypto.decrypt("v1.oDoEI/l1iM558dkT.FPaiu2CVMmESuyDvoVMs/iFrYRVuydeD4YSLtqSS"));
        assertTrue(crypto.verify("v1.rQ3Jcx6AED1i33il.okmQ2LnvPajtLeC/r+9gXcAP6DhQmKHAtlnTGzfjr7LJyYAt"));
        assertEquals("round trip", crypto.decrypt(crypto.encrypt("round trip")));
        SyncCrypto wrong = SyncCrypto.fromPassword("outra", "MDEyMzQ1Njc4OWFiY2RlZg==", 1000);
        assertThrows(IllegalArgumentException.class, () -> wrong.decrypt("v1.oDoEI/l1iM558dkT.FPaiu2CVMmESuyDvoVMs/iFrYRVuydeD4YSLtqSS"));
    }

    @Test
    void wrongPasswordDoesNotOpen() {
        MemoryHub hub = new MemoryHub();
        Device a = new Device().open(hub);
        assertNotNull(a.engine);
        Device b = new Device();
        assertThrows(IllegalArgumentException.class, () -> SyncEngine.open(b.jdbc, b.tx, hub, "errada", "default", Clock.systemDefaultZone()));
    }

    @Test
    void anExpenseArrivesWithItsCategoryAccountAndTags() {
        MemoryHub hub = new MemoryHub();
        Device a = new Device().open(hub);
        Device b = new Device().open(hub);
        a.spend("Pao", "12.34", "padaria", "cafe");
        settle(hub, a, b);

        assertEquals(1, b.count("select count(*) from expenses where name = 'Pao'"));
        assertEquals(List.of("cafe", "padaria"), b.tagsOf("Pao"));
        assertEquals(new java.math.BigDecimal("12.34"), b.jdbc.queryForObject("select amount from expenses where name = 'Pao'", java.math.BigDecimal.class));
        assertEquals("Conta principal", b.jdbc.queryForObject("select a.name from expenses e join accounts a on a.id = e.account_id", String.class));
    }

    @Test
    void whatTravelsIsCentsAndEncrypted() throws Exception {
        MemoryHub hub = new MemoryHub();
        Device a = new Device().open(hub);
        a.spend("Segredo do mercado", "12.34");
        a.engine.sync();

        String stored = hub.rows.values().toString();
        assertFalse(stored.contains("Segredo do mercado"));
        SyncCrypto crypto = SyncCrypto.fromPassword(PASSWORD, hub.vault.salt());
        SyncHub.Change expense = hub.rows.values().stream().filter(c -> c.table().equals("expenses")).findFirst().orElseThrow();
        Map<?, ?> payload = JsonMapper.builder().build().readValue(crypto.decrypt(expense.payload()), Map.class);
        assertEquals(1234, ((Number) payload.get("amount_cents")).intValue());
        assertEquals("2026-05-10", payload.get("date"));
        assertNotNull(payload.get("category_uuid"));
        assertNull(payload.get("account_id"), "ids nunca viajam");
    }

    @Test
    void defaultsCreatedOnEachDeviceBecomeOneThingWithTheSmallestUuid() {
        MemoryHub hub = new MemoryHub();
        Device a = new Device().open(hub);
        Device b = new Device().open(hub);
        assertNotEquals(a.uuids("categories"), b.uuids("categories"));
        settle(hub, a, b);

        assertEquals(a.uuids("categories"), b.uuids("categories"));
        assertEquals(a.uuids("accounts"), b.uuids("accounts"));
        assertEquals(1, a.count("select count(*) from accounts"));
        assertEquals(6, b.count("select count(*) from payment_methods"));
    }

    @Test
    void expensesOnTheDefaultAccountOfBothSidesShareOneAccount() {
        MemoryHub hub = new MemoryHub();
        Device a = new Device().open(hub);
        Device b = new Device().open(hub);
        a.spend("Do A", "1.00");
        b.spend("Do B", "2.00");
        settle(hub, a, b);
        for (Device d : List.of(a, b)) {
            assertEquals(List.of("Do A", "Do B"), d.names("expenses"));
            assertEquals(1, d.count("select count(distinct account_id) from expenses"));
            assertEquals(1, d.count("select count(*) from accounts"));
        }
    }

    @Test
    void theLatestEditWins() {
        MemoryHub hub = new MemoryHub();
        Device a = new Device().open(hub);
        Device b = new Device().open(hub);
        a.spend("Luz", "10.00");
        settle(hub, a, b);

        a.at(hub, T0 + 60_000);
        a.jdbc.update("update expenses set name = 'Luz do A', updated_at = ?", Timestamp.valueOf(SyncTables.fromMillis(T0 + 60_000)));
        b.at(hub, T0 + 120_000);
        b.jdbc.update("update expenses set name = 'Luz do B', updated_at = ?", Timestamp.valueOf(SyncTables.fromMillis(T0 + 120_000)));
        settle(hub, a, b);

        assertEquals(List.of("Luz do B"), a.names("expenses"));
        assertEquals(List.of("Luz do B"), b.names("expenses"));
    }

    @Test
    void changingOnlyTheTagsStillSyncs() {
        MemoryHub hub = new MemoryHub();
        Device a = new Device().open(hub);
        Device b = new Device().open(hub);
        a.spend("Taxa", "3.00", "x");
        settle(hub, a, b);

        // the tag set changes but the expense's updated_at does not move
        a.at(hub, T0 + 5_000);
        a.jdbc.update("delete from expense_tags");
        a.insert("tags", "name", "'y'");
        a.jdbc.update("insert into expense_tags (expense_id, tag_id) values (?, ?)", a.id("expenses", "Taxa"), a.id("tags", "y"));
        settle(hub, a, b);

        assertEquals(List.of("y"), b.tagsOf("Taxa"));
    }

    @Test
    void deletionsTravelAndAnOlderDeletionDoesNotKillANewerEdit() {
        MemoryHub hub = new MemoryHub();
        Device a = new Device().open(hub);
        Device b = new Device().open(hub);
        a.insert("categories", "name", "'Temporaria'");
        a.spend("Some", "1.00");
        settle(hub, a, b);

        // A deletes both (the application leaves a tombstone on a permanent delete)
        a.at(hub, T0 + 1_000);
        String expenseUuid = a.jdbc.queryForObject("select uuid from expenses where name = 'Some'", String.class);
        String categoryUuid = a.jdbc.queryForObject("select uuid from categories where name = 'Temporaria'", String.class);
        a.jdbc.update("delete from expenses where name = 'Some'");
        a.jdbc.update("delete from categories where name = 'Temporaria'");
        for (String[] t : new String[][]{{"expenses", expenseUuid}, {"categories", categoryUuid}}) {
            a.jdbc.update("insert into sync_tombstones (table_name, uuid, deleted_at) values (?, ?, ?)", t[0], t[1],
                    Timestamp.valueOf(SyncTables.fromMillis(T0 + 1_000)));
        }
        // B edited the category later than A deleted it
        b.at(hub, T0 + 9_000);
        b.jdbc.update("update categories set name = 'Temporaria editada', updated_at = ? where name = 'Temporaria'",
                Timestamp.valueOf(SyncTables.fromMillis(T0 + 9_000)));
        settle(hub, a, b);

        assertEquals(0, b.count("select count(*) from expenses"));
        assertEquals(0, a.count("select count(*) from expenses"));
        assertTrue(a.names("categories").contains("Temporaria editada"));
        assertTrue(b.names("categories").contains("Temporaria editada"));
    }

    @Test
    void noEchoAndOfflineLosesNothing() {
        MemoryHub hub = new MemoryHub();
        Device a = new Device().open(hub);
        Device b = new Device().open(hub);
        a.spend("Offline", "4.00");
        hub.failNext = new IllegalStateException("sem rede");
        assertThrows(IllegalStateException.class, () -> a.engine.sync());
        settle(hub, a, b);
        assertEquals(List.of("Offline"), b.names("expenses"));

        long seq = hub.seq;
        settle(hub, a, b);
        assertEquals(seq, hub.seq, "nothing new goes to the hub");
    }

    @Test
    void aChildThatArrivesBeforeItsParentWaits() {
        MemoryHub hub = new MemoryHub();
        Device b = new Device().open(hub);
        SyncCrypto crypto = SyncCrypto.fromPassword(PASSWORD, hub.vault.salt());
        hub.push("default", "outro", List.of(SyncHub.Change.outgoing("categories", "zzz-filha", T0 + 10, false, crypto.encrypt(
                "{\"name\":\"Filha\",\"icon\":null,\"color\":null,\"parent_uuid\":\"zzz-mae\"}"))));
        b.engine.sync();
        assertEquals(1, b.engine.pendingCount());
        assertFalse(b.names("categories").contains("Filha"));

        hub.push("default", "outro", List.of(SyncHub.Change.outgoing("categories", "zzz-mae", T0 + 20, false, crypto.encrypt(
                "{\"name\":\"Mae\",\"icon\":null,\"color\":null,\"parent_uuid\":null}"))));
        b.engine.sync();
        assertEquals(0, b.engine.pendingCount());
        assertEquals("Mae", b.jdbc.queryForObject("select p.name from categories c join categories p on p.id = c.parent_id where c.name = 'Filha'", String.class));
    }

    @Test
    void theSameBudgetMadeOnBothComputersBecomesOneAndTheLatestWins() {
        MemoryHub hub = new MemoryHub();
        Device a = new Device().open(hub);
        Device b = new Device().open(hub);
        a.insert("budgets", "category_id, from_month, amount", "(select id from categories where name = 'Mercado'), '2026-05', 100.00");
        b.now = T0 + 9_000; // newer
        b.insert("budgets", "category_id, from_month, amount", "(select id from categories where name = 'Mercado'), '2026-05', 200.00");
        a.insert("budgets", "category_id, from_month, amount", "null, '2026-05', 3000.00"); // the month's general limit
        b.insert("budgets", "category_id, from_month, amount", "null, '2026-05', 3500.00");
        b.insert("budgets", "category_id, from_month, amount", "(select id from categories where name = 'Mercado'), '2026-06', 50.00");
        settle(hub, a, b);

        for (Device d : List.of(a, b)) {
            assertEquals(3, d.count("select count(*) from budgets"), "one row per category and month");
            assertEquals(new java.math.BigDecimal("200.00"), d.jdbc.queryForObject(
                    "select amount from budgets where category_id is not null and from_month = '2026-05'", java.math.BigDecimal.class));
            assertEquals(new java.math.BigDecimal("3500.00"), d.jdbc.queryForObject(
                    "select amount from budgets where category_id is null", java.math.BigDecimal.class));
        }
        assertEquals(a.uuids("budgets"), b.uuids("budgets"));
    }

    @Test
    void attachmentsAboveThreeMegabytesStayOnThisComputer() {
        MemoryHub hub = new MemoryHub();
        Device a = new Device().open(hub);
        Device b = new Device().open(hub);
        long expense = a.spend("Com anexos", "1.00");
        for (Object[] f : new Object[][]{{"pequeno.png", 1024L}, {"no-limite.png", SyncEngine.MAX_SYNC_ATTACHMENT_BYTES}, {"grande.png", SyncEngine.MAX_SYNC_ATTACHMENT_BYTES + 1}}) {
            a.insert("attachments", "expense_id, file_name, content_type, size_bytes, data, created_at",
                    expense + ", '" + f[0] + "', 'image/png', " + f[1] + ", 'AAAA', current_timestamp");
        }
        settle(hub, a, b);

        assertEquals(List.of("no-limite.png", "pequeno.png"), b.jdbc.queryForList("select file_name from attachments order by file_name", String.class));
        assertEquals(3, a.count("select count(*) from attachments"), "the big one stays here");
    }

    @Test
    void manyBigAttachmentsGoInSeveralRequests() {
        MemoryHub hub = new MemoryHub();
        Device a = new Device().open(hub);
        Device b = new Device().open(hub);
        long expense = a.spend("Varios", "1.00");
        String big = "A".repeat(2 * 1024 * 1024);
        for (int i = 0; i < 5; i++) {
            a.insert("attachments", "expense_id, file_name, content_type, size_bytes, data, created_at",
                    expense + ", 'f" + i + ".png', 'image/png', " + (2 * 1024 * 1024) + ", '" + big + "', current_timestamp");
        }
        java.util.List<Integer> sizes = new java.util.ArrayList<>();
        MemoryHub counting = new MemoryHub() {
            @Override
            public int push(String profileId, String deviceId, List<Change> changes) {
                sizes.add(changes.stream().mapToInt(c -> c.payload() == null ? 0 : c.payload().length()).sum());
                return hub.push(profileId, deviceId, changes);
            }

            @Override
            public Vault getVault() { return hub.getVault(); }

            @Override
            public void setVault(Vault vault) { hub.setVault(vault); }

            @Override
            public List<Change> pull(String profileId, long afterSeq, int limit) { return hub.pull(profileId, afterSeq, limit); }
        };
        a.open(counting).engine.sync();
        b.open(hub).engine.sync();

        assertEquals(5, b.count("select count(*) from attachments"));
        assertTrue(sizes.stream().filter(n -> n > 0).count() > 2, "several requests");
        assertTrue(sizes.stream().allMatch(n -> n < 4L * 1024 * 1024 * 2), "none far above 4 MB");
    }
}
