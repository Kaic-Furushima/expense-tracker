package com.kaic.expensetracker;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import static org.junit.jupiter.api.Assertions.*;

/** A database from before the split into expense and income categories (V16): income gets its own copy (V17). */
class CategoryKindMigrationTest {

    @Test
    void incomeThatUsedAnExpenseCategoryMovesToAnIncomeCopyOfIt() {
        DriverManagerDataSource ds = new DriverManagerDataSource(
                "jdbc:h2:mem:category_kind_" + System.nanoTime() + ";DB_CLOSE_DELAY=-1", "sa", "");
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").target("16").load().migrate();

        JdbcTemplate jdbc = new JdbcTemplate(ds);
        jdbc.update("insert into categories (name, uuid, updated_at) values ('Mistura', 'u1', current_timestamp), "
                + "('So despesa', 'u2', current_timestamp)");
        jdbc.update("insert into accounts (name, type, color, initial_balance, archived, uuid, updated_at) "
                + "values ('Conta', 'CHECKING', '#fff', 0, false, 'a1', current_timestamp)");
        jdbc.update("insert into expenses (name, amount, date, type, account_id, category_id, created_at, updated_at, uuid) "
                + "select 'Gasto', 10.00, date '2030-01-01', 'EXPENSE', (select min(id) from accounts), c.id, current_timestamp, current_timestamp, 'e1' "
                + "from categories c where c.name = 'Mistura'");
        jdbc.update("insert into expenses (name, amount, date, type, account_id, category_id, created_at, updated_at, uuid) "
                + "select 'Ganho', 50.00, date '2030-01-02', 'INCOME', (select min(id) from accounts), c.id, current_timestamp, current_timestamp, 'e2' "
                + "from categories c where c.name = 'Mistura'");

        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();

        assertEquals(2, jdbc.queryForObject("select count(*) from categories where name = 'Mistura'", Integer.class));
        assertEquals(1, jdbc.queryForObject("select count(*) from categories where name = 'So despesa'", Integer.class));
        assertEquals("EXPENSE", jdbc.queryForObject("select c.kind from expenses e join categories c on c.id = e.category_id "
                + "where e.name = 'Gasto'", String.class));
        assertEquals("INCOME", jdbc.queryForObject("select c.kind from expenses e join categories c on c.id = e.category_id "
                + "where e.name = 'Ganho'", String.class));
        assertEquals("EXPENSE", jdbc.queryForObject("select kind from categories where name = 'So despesa'", String.class));
        // the name is now unique per kind, not overall
        assertThrows(Exception.class, () -> jdbc.update("insert into categories (name, kind, uuid, updated_at) "
                + "values ('Mistura', 'INCOME', 'dup', current_timestamp)"));
        jdbc.update("insert into categories (name, kind, uuid, updated_at) values ('So despesa', 'INCOME', 'ok1', current_timestamp)");
    }
}
