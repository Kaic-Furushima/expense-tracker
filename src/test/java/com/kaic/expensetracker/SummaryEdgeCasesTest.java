package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.ExpenseStatus;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.repository.BudgetRepository;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.CategoryService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.SummaryService;
import com.kaic.expensetracker.service.SummaryService.MonthSummary;
import com.kaic.expensetracker.service.TrashService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** Edge cases of the monthly summary: empty months, missing categories, the year turn and pending transactions (T5). */
@SpringBootTest
class SummaryEdgeCasesTest {

    @Autowired private SummaryService summary;
    @Autowired private ExpenseService expenses;
    @Autowired private AccountService accounts;
    @Autowired private TrashService trash;
    @Autowired private BudgetRepository budgetRepository;

    @BeforeEach
    void setUp() {
        expenses.deleteAll();
        trash.empty();
    }

    @AfterEach
    void tearDown() {
        expenses.deleteAll();
        trash.empty();
        budgetRepository.deleteAll();
    }

    private Expense add(String amount, LocalDate date, Category category, ExpenseStatus status, TransactionType type) {
        Expense e = new Expense();
        e.setName("Lançamento " + amount);
        e.setAmount(new BigDecimal(amount));
        e.setDate(date);
        e.setType(type);
        e.setStatus(status);
        e.setAccount(accounts.defaultAccount());
        e.setCategory(category);
        return expenses.save(e);
    }

    private Expense spend(String amount, LocalDate date) {
        return add(amount, date, null, ExpenseStatus.PAID, TransactionType.EXPENSE);
    }

    private static void assertMoney(String expected, BigDecimal actual) {
        assertEquals(0, new BigDecimal(expected).compareTo(actual), () -> "esperado " + expected + ", veio " + actual);
    }

    @Test
    void anEmptyMonthIsAllZeros() {
        MonthSummary s = summary.summarize(YearMonth.of(2031, 3));

        assertMoney("0", s.income());
        assertMoney("0", s.expense());
        assertMoney("0", s.balance());
        assertMoney("0", s.previousExpense());
        assertTrue(s.categories().stream().allMatch(c -> c.total().signum() == 0));
        assertEquals(6, s.trend().size());
        assertTrue(s.trend().stream().allMatch(t -> t.income().signum() == 0 && t.expense().signum() == 0));
    }

    @Test
    void thePreviousMonthIsZeroWhenItHadNothing() {
        spend("40", LocalDate.of(2031, 3, 5));

        assertMoney("0", summary.summarize(YearMonth.of(2031, 3)).previousExpense());
    }

    @Test
    void spendingWithoutACategoryShowsUpAsNoCategory() {
        spend("20", LocalDate.of(2031, 4, 2));

        MonthSummary s = summary.summarize(YearMonth.of(2031, 4));

        SummaryService.CategoryTotal none = s.categories().stream()
                .filter(c -> c.categoryId() == null).findFirst().orElseThrow();
        assertEquals("Sem categoria", none.name());
        assertMoney("20", none.total());
        assertEquals(1, none.count());
    }

    @Test
    void theTrendAndThePreviousMonthCrossTheYearEnd() {
        spend("50", LocalDate.of(2030, 12, 15));

        MonthSummary s = summary.summarize(YearMonth.of(2031, 1));

        assertMoney("50", s.previousExpense());
        List<String> months = s.trend().stream().map(SummaryService.MonthTotal::month).toList();
        assertEquals(List.of("2030-08", "2030-09", "2030-10", "2030-11", "2030-12", "2031-01"), months);
        assertMoney("50", s.trend().get(4).expense());
    }

    @Test
    void pendingTransactionsAreForecastButNotCountedAsSpent() {
        spend("10", LocalDate.of(2031, 5, 3));
        add("30", LocalDate.of(2031, 5, 20), null, ExpenseStatus.PENDING, TransactionType.EXPENSE);

        MonthSummary s = summary.summarize(YearMonth.of(2031, 5));

        assertMoney("10", s.expense());
        assertMoney("-10", s.balance());
        assertMoney("30", s.pendingExpense());
        assertMoney("-40", s.projectedBalance());
    }

    @Test
    void incomeCountsOnItsOwnSideOfTheBalance() {
        add("100", LocalDate.of(2031, 6, 1), null, ExpenseStatus.PAID, TransactionType.INCOME);
        spend("35", LocalDate.of(2031, 6, 9));

        MonthSummary s = summary.summarize(YearMonth.of(2031, 6));

        assertMoney("100", s.income());
        assertMoney("35", s.expense());
        assertMoney("65", s.balance());
    }
}
