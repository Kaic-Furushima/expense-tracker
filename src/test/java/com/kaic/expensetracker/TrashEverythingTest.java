package com.kaic.expensetracker;

import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.DemoDataService;
import com.kaic.expensetracker.service.TrashService;
import com.kaic.expensetracker.service.TrashSnapshotService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.util.Map;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.*;

/**
 * "Limpar tudo": a full copy goes to the trash and the app is left as a new install; restoring the copy brings every
 * record back. Each test ends with the data back as it was, so the other tests are not affected.
 */
@SpringBootTest
class TrashEverythingTest {

    @Autowired private TrashSnapshotService snapshots;
    @Autowired private TrashService trash;
    @Autowired private DemoDataService demo;
    @Autowired private AccountService accountService;
    @Autowired private JdbcTemplate jdbc;

    private long count(String from) {
        Long n = jdbc.queryForObject("select count(*) from " + from, Long.class);
        return n == null ? 0 : n;
    }

    private Map<String, BigDecimal> balances() {
        Map<String, BigDecimal> out = new TreeMap<>();
        Map<Long, BigDecimal> byId = accountService.balances();
        accountService.findAll().forEach(a -> out.put(a.getName(), byId.get(a.getId())));
        return out;
    }

    private Long newestCopy() {
        return snapshots.list().get(0).id();
    }

    @Test
    void clearingEverythingLeavesANewInstallAndTheCopyRestoresAllOfIt() {
        demo.load();
        long expenses = count("expenses where deleted_at is null");
        long accounts = count("accounts");
        long categories = count("categories");
        long pots = count("pots");
        long recurring = count("recurring_payments");
        long budgets = count("budgets");
        long templates = count("expense_templates");
        long wishes = count("wish_items");
        long tags = count("tags");
        Map<String, BigDecimal> balances = balances();
        assertTrue(expenses > 100 && accounts >= 7 && pots >= 3, "the sample data is there");

        snapshots.trashEverything();

        assertEquals(1, count("accounts"));
        assertEquals("Conta principal", accountService.findAll().get(0).getName());
        assertEquals(0, count("expenses"));
        assertEquals(0, count("transfers") + count("budgets") + count("pots") + count("recurring_payments")
                + count("wish_items") + count("expense_templates") + count("tags"));
        assertEquals(6, count("payment_methods"));
        assertTrue(count("categories") >= 11, "the starter categories are back");
        var item = trash.list().stream().filter(i -> i.kind() == TrashService.Kind.EVERYTHING).findFirst().orElseThrow();
        assertEquals("Todos os dados", item.title());
        assertNull(item.amount());
        assertTrue(item.detail().contains(expenses + " lançamentos"), item.detail());

        // the app works from scratch
        assertDoesNotThrow(() -> accountService.defaultAccount());

        snapshots.restore(newestCopy());

        assertEquals(expenses, count("expenses where deleted_at is null"));
        assertEquals(accounts, count("accounts"));
        assertEquals(categories, count("categories"));
        assertEquals(pots, count("pots"));
        assertEquals(recurring, count("recurring_payments"));
        assertEquals(budgets, count("budgets"));
        assertEquals(templates, count("expense_templates"));
        assertEquals(wishes, count("wish_items"));
        assertEquals(tags, count("tags"));
        assertEquals(balances.keySet(), balances().keySet());
        balances.forEach((name, value) -> assertEquals(0, value.compareTo(balances().get(name)), name));
        assertTrue(snapshots.list().stream().noneMatch(s -> s.id().equals(item.id())), "the copy that was used is gone");
    }

    @Test
    void theCopyCanBeDeletedOnItsOwnAndTheTrashCanBeEmptied() {
        snapshots.trashEverything();
        Long id = newestCopy();
        trash.purge(TrashService.Kind.EVERYTHING, id);
        assertTrue(snapshots.list().stream().noneMatch(s -> s.id().equals(id)));
        assertThrows(ResponseStatusException.class, () -> trash.purge(TrashService.Kind.EVERYTHING, id));
        assertThrows(ResponseStatusException.class, () -> snapshots.restore(id));
        trash.empty();
        assertTrue(snapshots.list().isEmpty());
    }
}
