package com.kaic.expensetracker;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** A database that already has data (schema V13) gets a distinct uuid and an updated_at on every row (V14). */
class SyncMigrationTest {

    private static final List<String> TABLES = List.of("categories", "payment_methods", "accounts", "expenses", "tags",
            "budgets", "transfers", "recurring_payments", "recurring_occurrences", "pots", "wish_items", "pot_entries",
            "expense_templates", "attachments");

    @Test
    void upgradingFromV13FillsEveryRowWithADistinctUuid() {
        DriverManagerDataSource ds = new DriverManagerDataSource(
                "jdbc:h2:mem:sync_migration_" + System.nanoTime() + ";DB_CLOSE_DELAY=-1", "sa", "");
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").target("13").load().migrate();

        JdbcTemplate jdbc = new JdbcTemplate(ds);
        jdbc.update("insert into categories (name) values ('Mercado'), ('Lazer')");
        jdbc.update("insert into accounts (name, type, color, initial_balance, archived) values ('Extra', 'CHECKING', '#fff', 0, false)");
        jdbc.update("insert into expenses (name, amount, date, account_id, created_at, updated_at) "
                + "select 'Pao', 5.00, date '2030-01-01', min(id), current_timestamp, current_timestamp from accounts");

        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();

        for (String table : TABLES) {
            int rows = jdbc.queryForObject("select count(*) from " + table, Integer.class);
            assertEquals(rows, jdbc.queryForObject(
                    "select count(distinct uuid) from " + table + " where length(uuid) = 36", Integer.class),
                    table + ": cada linha precisa de um uuid próprio");
            assertEquals(0, jdbc.queryForObject("select count(*) from " + table + " where updated_at is null",
                    Integer.class), table);
        }
        assertTrue(jdbc.queryForObject("select count(*) from categories", Integer.class) >= 2);
        assertEquals(1, jdbc.queryForObject("select count(*) from expenses where name = 'Pao'", Integer.class));
    }
}
