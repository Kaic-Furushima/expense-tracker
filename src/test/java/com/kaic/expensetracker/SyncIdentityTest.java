package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.CategoryService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.TrashService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.*;

/** What the synchronization relies on: a stable uuid per row, a fresh updated_at on every change, tombstones. */
@SpringBootTest
class SyncIdentityTest {

    @Autowired private CategoryService categories;
    @Autowired private ExpenseService expenses;
    @Autowired private AccountService accounts;
    @Autowired private TrashService trash;
    @Autowired private JdbcTemplate jdbc;

    @BeforeEach
    @AfterEach
    void clean() {
        expenses.deleteAll();
        trash.empty();
    }

    private Expense spend(Category category) {
        Expense e = new Expense();
        e.setName("Gasto sync");
        e.setAmount(new BigDecimal("10.00"));
        e.setDate(LocalDate.of(2030, 6, 1));
        e.setType(TransactionType.EXPENSE);
        e.setAccount(accounts.defaultAccount());
        e.setCategory(category);
        return expenses.save(e);
    }

    @Test
    void newRowsGetAUuidThatNeverChanges() {
        Category c = categories.create("Sync uuid " + System.nanoTime(), null, null);
        String uuid = c.getUuid();
        assertNotNull(uuid);
        assertEquals(36, uuid.length());

        Category renamed = categories.update(c.getId(), c.getName() + " x", null, null, null);
        assertEquals(uuid, renamed.getUuid());
        assertNotNull(renamed.getUpdatedAt());
        categories.delete(c.getId());
    }

    @Test
    void deletingForGoodLeavesATombstone() {
        Category c = categories.create("Sync lapide " + System.nanoTime(), null, null);
        String uuid = c.getUuid();

        categories.delete(c.getId());

        assertEquals(1, jdbc.queryForObject(
                "select count(*) from sync_tombstones where table_name = 'categories' and uuid = ?", Integer.class, uuid));
    }

    @Test
    void deletingACategoryTouchesTheTransactionsItDetached() throws Exception {
        Category c = categories.create("Sync detach " + System.nanoTime(), null, null);
        Expense e = spend(c);
        LocalDateTime before = jdbc.queryForObject("select updated_at from expenses where id = ?", LocalDateTime.class, e.getId());
        Thread.sleep(20);

        categories.delete(c.getId());

        LocalDateTime after = jdbc.queryForObject("select updated_at from expenses where id = ?", LocalDateTime.class, e.getId());
        assertTrue(after.isAfter(before), "a categoria saiu do lançamento: o sync precisa enxergar a mudança");
    }

    @Test
    void trashingAndRestoringTouchTheRow() throws Exception {
        Expense e = spend(null);
        LocalDateTime created = jdbc.queryForObject("select updated_at from expenses where id = ?", LocalDateTime.class, e.getId());
        Thread.sleep(20);

        expenses.deleteById(e.getId());
        LocalDateTime trashed = jdbc.queryForObject("select updated_at from expenses where id = ?", LocalDateTime.class, e.getId());
        assertTrue(trashed.isAfter(created));

        Thread.sleep(20);
        trash.restore(TrashService.Kind.EXPENSE, e.getId());
        LocalDateTime restored = jdbc.queryForObject("select updated_at from expenses where id = ?", LocalDateTime.class, e.getId());
        assertTrue(restored.isAfter(trashed));
    }
}
