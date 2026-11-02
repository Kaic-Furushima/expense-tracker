package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.BudgetService;
import com.kaic.expensetracker.service.CategoryService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.SummaryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.math.BigDecimal;
import java.time.YearMonth;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class SummaryServiceTest {

    private static final YearMonth MONTH = YearMonth.of(2026, 3);

    @Autowired private ExpenseService expenseService;
    @Autowired private AccountService accountService;
    @Autowired private CategoryService categoryService;
    @Autowired private BudgetService budgetService;
    @Autowired private SummaryService summaryService;

    @BeforeEach
    void setUp() {
        expenseService.deleteAll();
    }

    private Expense tx(String name, String amount, int day, TransactionType type, Category category) {
        Expense e = new Expense();
        e.setName(name);
        e.setAmount(new BigDecimal(amount));
        e.setDate(MONTH.atDay(day));
        e.setType(type);
        e.setCategory(category);
        e.setAccount(accountService.defaultAccount());
        return expenseService.save(e);
    }

    @Test
    void summarizesIncomeExpenseAndCategories() {
        Category food = categoryService.findOrCreate("Alimentação", "🍽️", "#E57373");
        tx("Salário", "3000.00", 5, TransactionType.INCOME, null);
        tx("Almoço", "40.00", 6, TransactionType.EXPENSE, food);
        tx("Jantar", "60.00", 7, TransactionType.EXPENSE, food);
        tx("Aporte", "100.00", 8, TransactionType.EXPENSE, null);
        Expense other = tx("Outro mês", "999.00", 1, TransactionType.EXPENSE, food);
        other.setDate(MONTH.plusMonths(1).atDay(1));
        expenseService.save(other);

        var summary = summaryService.summarize(MONTH);

        assertEquals(0, new BigDecimal("3000.00").compareTo(summary.income()));
        assertEquals(0, new BigDecimal("200.00").compareTo(summary.expense()));
        assertEquals(0, new BigDecimal("2800.00").compareTo(summary.balance()));
        assertEquals(2, summary.categories().size());
        var food0 = summary.categories().stream().filter(c -> c.categoryId() != null).findFirst().orElseThrow();
        assertEquals("Alimentação", food0.name());
        assertEquals(0, new BigDecimal("100.00").compareTo(food0.total()));
        assertEquals(6, summary.trend().size());
    }

    @Test
    void budgetShowsUpEvenWithoutSpending() {
        Category leisure = categoryService.findOrCreate("Lazer", "🎮", "#BA68C8");
        budgetService.upsert(leisure.getId(), new BigDecimal("300"));

        var summary = summaryService.summarize(MONTH);

        var entry = summary.categories().stream()
                .filter(c -> leisure.getId().equals(c.categoryId())).findFirst().orElseThrow();
        assertEquals(0, new BigDecimal("300").compareTo(entry.budget()));
        assertEquals(0, BigDecimal.ZERO.compareTo(entry.total()));
    }
}
