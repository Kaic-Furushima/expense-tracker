package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.BudgetService;
import com.kaic.expensetracker.service.CategoryService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.TrashService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** Rules of the categories: unique names, and what deleting one does to its transactions and budgets (T1). */
@SpringBootTest
class CategoryRulesTest {

    @Autowired private CategoryService categories;
    @Autowired private BudgetService budgets;
    @Autowired private ExpenseService expenses;
    @Autowired private AccountService accounts;
    @Autowired private TrashService trash;

    /** The test database is shared and kept between runs: every category made here is removed afterwards. */
    private final List<Long> made = new ArrayList<>();

    @BeforeEach
    void setUp() {
        expenses.deleteAll();
        trash.empty();
    }

    @AfterEach
    void tearDown() {
        expenses.deleteAll();
        trash.empty();
        for (Long id : made) {
            if (categories.findById(id).isPresent()) {
                categories.delete(id);
            }
        }
    }

    private Category category(String name) {
        Category c = categories.create(name + " " + System.nanoTime(), null, null);
        made.add(c.getId());
        return c;
    }

    private Expense spend(Category category) {
        Expense e = new Expense();
        e.setName("Gasto");
        e.setAmount(new BigDecimal("20.00"));
        e.setDate(LocalDate.of(2030, 5, 10));
        e.setType(TransactionType.EXPENSE);
        e.setAccount(accounts.defaultAccount());
        e.setCategory(category);
        return expenses.save(e);
    }

    @Test
    void namesAreUniqueIgnoringCaseAndSpacesAround() {
        Category c = category("Regra Unica");
        ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> categories.create("  " + c.getName().toUpperCase() + " ", null, null));
        assertEquals(HttpStatus.CONFLICT, e.getStatusCode());
    }

    @Test
    void renamingToAnotherCategorysNameIsRefused() {
        Category a = category("Renomear A");
        Category b = category("Renomear B");
        ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> categories.update(b.getId(), a.getName().toLowerCase(), null, null, null));
        assertEquals(HttpStatus.CONFLICT, e.getStatusCode());
    }

    @Test
    void deletingACategoryRemovesItsBudgetAndKeepsItsTransactionsUncategorized() {
        Category c = category("Excluir com orçamento");
        budgets.set(c.getId(), YearMonth.of(2030, 5), new BigDecimal("100"), BudgetService.Scope.FROM_MONTH);
        assertTrue(budgets.findAll().stream().anyMatch(b -> b.getCategory().getId().equals(c.getId())));
        Expense kept = spend(c);

        categories.delete(c.getId());

        assertTrue(categories.findById(c.getId()).isEmpty());
        assertFalse(budgets.findAll().stream().anyMatch(b -> b.getCategory().getId().equals(c.getId())));
        assertNull(expenses.findById(kept.getId()).orElseThrow().getCategory(), "o lançamento continua, sem categoria");
    }
}
