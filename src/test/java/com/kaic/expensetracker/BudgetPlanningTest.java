package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.repository.BudgetRepository;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.BudgetService;
import com.kaic.expensetracker.service.CategoryService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.SettingsService;
import com.kaic.expensetracker.service.SummaryService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.YearMonth;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class BudgetPlanningTest {

    @Autowired private BudgetService budgetService;
    @Autowired private BudgetRepository budgetRepository;
    @Autowired private CategoryService categoryService;
    @Autowired private ExpenseService expenseService;
    @Autowired private AccountService accountService;
    @Autowired private SettingsService settings;
    @Autowired private SummaryService summaryService;

    private Category food;

    @BeforeEach
    void setUp() {
        expenseService.deleteAll();
        budgetRepository.deleteAll();
        settings.setBudgetRollover(false);
        food = categoryService.findOrCreate("Orcamento comida", null, "#E57373");
    }

    @AfterEach
    void tearDown() {
        expenseService.deleteAll();
        budgetRepository.deleteAll();
        settings.setBudgetRollover(false);
    }

    private BigDecimal limit(Long categoryId, YearMonth month) {
        return budgetService.book().base(categoryId, month).orElse(null);
    }

    private void spend(Category category, YearMonth month, String amount) {
        Expense e = new Expense();
        e.setName("gasto");
        e.setAmount(new BigDecimal(amount));
        e.setDate(month.atDay(5));
        e.setCategory(category);
        e.setAccount(accountService.defaultAccount());
        expenseService.save(e);
    }

    @Test
    void changingALaterMonthNeverRewritesThePast() {
        budgetService.set(food.getId(), YearMonth.of(2026, 1), new BigDecimal("500"), BudgetService.Scope.FROM_MONTH);
        budgetService.set(food.getId(), YearMonth.of(2026, 6), new BigDecimal("700"), BudgetService.Scope.FROM_MONTH);

        assertEquals(new BigDecimal("500.00"), limit(food.getId(), YearMonth.of(2026, 5)));
        assertEquals(new BigDecimal("700.00"), limit(food.getId(), YearMonth.of(2026, 6)));
        assertEquals(new BigDecimal("700.00"), limit(food.getId(), YearMonth.of(2027, 3)));
        assertNull(limit(food.getId(), YearMonth.of(2025, 12))); // before it existed
    }

    @Test
    void aLimitForOnlyOneMonthReturnsToTheOldOneAfterwards() {
        budgetService.set(food.getId(), YearMonth.of(2026, 1), new BigDecimal("700"), BudgetService.Scope.FROM_MONTH);
        budgetService.set(food.getId(), YearMonth.of(2026, 8), new BigDecimal("800"), BudgetService.Scope.ONLY_MONTH);

        assertEquals(new BigDecimal("700.00"), limit(food.getId(), YearMonth.of(2026, 7)));
        assertEquals(new BigDecimal("800.00"), limit(food.getId(), YearMonth.of(2026, 8)));
        assertEquals(new BigDecimal("700.00"), limit(food.getId(), YearMonth.of(2026, 9)));
    }

    @Test
    void removingFromAMonthKeepsTheEarlierOnes() {
        budgetService.set(food.getId(), YearMonth.of(2026, 1), new BigDecimal("700"), BudgetService.Scope.FROM_MONTH);
        budgetService.remove(food.getId(), YearMonth.of(2026, 10));

        assertEquals(new BigDecimal("700.00"), limit(food.getId(), YearMonth.of(2026, 9)));
        assertNull(limit(food.getId(), YearMonth.of(2026, 10)));
        assertNull(limit(food.getId(), YearMonth.of(2027, 1)));
    }

    @Test
    void theOverallMonthlyLimitWorksTheSameWay() {
        budgetService.set(null, YearMonth.of(2026, 3), new BigDecimal("3000"), BudgetService.Scope.FROM_MONTH);
        spend(food, YearMonth.of(2026, 3), "450.00");

        var summary = summaryService.summarize(YearMonth.of(2026, 3));
        assertEquals(new BigDecimal("3000.00"), summary.totalBudget());
        assertEquals(0, new BigDecimal("450.00").compareTo(summary.totalSpent()));
        assertNull(summaryService.summarize(YearMonth.of(2026, 2)).totalBudget());
    }

    @Test
    void leftoverIsCarriedToTheNextMonthWhenTheRolloverIsOn() {
        YearMonth now = YearMonth.now();
        budgetService.set(food.getId(), now.minusMonths(4), new BigDecimal("500"), BudgetService.Scope.FROM_MONTH);
        spend(food, now.minusMonths(2), "300.00"); // 200 left over
        spend(food, now.minusMonths(1), "600.00"); // limit 700 -> 100 left over

        // off: every month is just its own limit
        var off = summaryService.summarize(now).categories().stream().filter(c -> food.getId().equals(c.categoryId())).findFirst().orElseThrow();
        assertEquals(new BigDecimal("500.00"), off.budget());
        assertEquals(0, off.carry().signum());

        settings.setBudgetRollover(true);
        settings.setString(SettingsService.BUDGET_ROLLOVER_FROM, now.minusMonths(2).toString());
        var on = summaryService.summarize(now).categories().stream().filter(c -> food.getId().equals(c.categoryId())).findFirst().orElseThrow();
        assertEquals(0, new BigDecimal("100.00").compareTo(on.carry()));
        assertEquals(0, new BigDecimal("600.00").compareTo(on.budget()));
        assertEquals(new BigDecimal("500.00"), on.budgetBase());
    }

    @Test
    void anOverspentMonthReducesTheNextOne() {
        YearMonth now = YearMonth.now();
        budgetService.set(food.getId(), now.minusMonths(3), new BigDecimal("500"), BudgetService.Scope.FROM_MONTH);
        spend(food, now.minusMonths(1), "650.00"); // 150 over
        settings.setBudgetRollover(true);
        settings.setString(SettingsService.BUDGET_ROLLOVER_FROM, now.minusMonths(1).toString());

        var cat = summaryService.summarize(now).categories().stream().filter(c -> food.getId().equals(c.categoryId())).findFirst().orElseThrow();
        assertEquals(0, new BigDecimal("-150.00").compareTo(cat.carry()));
        assertEquals(0, new BigDecimal("350.00").compareTo(cat.budget()));
    }

    @Test
    void theRolloverOnlyStartsCountingFromTheMonthItWasTurnedOn() {
        YearMonth now = YearMonth.now();
        budgetService.set(food.getId(), now.minusMonths(3), new BigDecimal("500"), BudgetService.Scope.FROM_MONTH);
        spend(food, now.minusMonths(2), "100.00"); // leftover of an old month must not count
        settings.setBudgetRollover(true); // starts counting now

        var cat = summaryService.summarize(now).categories().stream().filter(c -> food.getId().equals(c.categoryId())).findFirst().orElseThrow();
        assertEquals(0, cat.carry().signum());
        assertEquals(now.toString(), settings.budgetRolloverFrom().orElseThrow().toString());
    }

    @Test
    void aParentBudgetCountsWhatWasFiledUnderItsSubcategories() {
        YearMonth month = YearMonth.of(2026, 4);
        Category child = categoryService.create("Orcamento delivery", null, "#FFB74D", food.getId());
        budgetService.set(food.getId(), month, new BigDecimal("500"), BudgetService.Scope.FROM_MONTH);
        spend(food, month, "80.00");
        spend(child, month, "120.00");

        var cat = summaryService.summarize(month).categories().stream().filter(c -> food.getId().equals(c.categoryId())).findFirst().orElseThrow();
        assertEquals(0, new BigDecimal("200.00").compareTo(cat.budgetSpent()));
        assertEquals(0, new BigDecimal("80.00").compareTo(cat.total())); // its own spending, for the chart
    }

    @Test
    void rejectsLimitsOutOfRange() {
        assertThrows(ResponseStatusException.class,
                () -> budgetService.set(food.getId(), YearMonth.of(2026, 1), BigDecimal.ZERO, BudgetService.Scope.FROM_MONTH));
        assertThrows(ResponseStatusException.class,
                () -> budgetService.set(food.getId(), YearMonth.of(2026, 1), new BigDecimal("1000000000"), BudgetService.Scope.FROM_MONTH));
    }
}
