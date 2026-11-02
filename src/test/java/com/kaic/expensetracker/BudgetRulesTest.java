package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.repository.BudgetRepository;
import com.kaic.expensetracker.service.BudgetService;
import com.kaic.expensetracker.service.CategoryService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

/** Budgets (limits): creating, removing for one month, and the cases that must be refused (T2). */
@SpringBootTest
class BudgetRulesTest {

    @Autowired private BudgetService budgets;
    @Autowired private CategoryService categories;
    @Autowired private BudgetRepository budgetRepository;

    @AfterEach
    void tearDown() {
        budgetRepository.deleteAll();
    }

    private Category category(String name) {
        return categories.create(name + " " + System.nanoTime(), null, null);
    }

    private static void assertMoney(String expected, Optional<BigDecimal> actual) {
        assertTrue(actual.isPresent(), "esperava um limite");
        assertEquals(0, new BigDecimal(expected).compareTo(actual.get()), () -> "limite: " + actual.get());
    }

    @Test
    void aLimitForAnUnknownCategoryIsNotFound() {
        ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> budgets.set(999_999_999L, YearMonth.of(2030, 3), new BigDecimal("100"), BudgetService.Scope.FROM_MONTH));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatusCode());
        assertThrows(ResponseStatusException.class, () -> budgets.upsert(999_999_999L, BigDecimal.TEN));
    }

    @Test
    void removingFromOneMonthKeepsTheEarlierLimit() {
        Category c = category("Orçamento remover");
        budgets.set(c.getId(), YearMonth.of(2030, 3), new BigDecimal("100"), BudgetService.Scope.FROM_MONTH);

        budgets.remove(c.getId(), YearMonth.of(2030, 5));

        assertMoney("100", budgets.book().base(c.getId(), YearMonth.of(2030, 4)));
        assertTrue(budgets.book().base(c.getId(), YearMonth.of(2030, 5)).isEmpty(), "sem limite a partir de maio");
        assertTrue(budgets.book().base(c.getId(), YearMonth.of(2030, 6)).isEmpty());
    }

    @Test
    void theOverallLimitCanBeRemovedFromAMonth() {
        budgets.set(null, YearMonth.of(2030, 3), new BigDecimal("500"), BudgetService.Scope.FROM_MONTH);
        assertMoney("500", budgets.book().base(null, YearMonth.of(2030, 4)));

        budgets.remove(null, YearMonth.of(2030, 4));

        assertMoney("500", budgets.book().base(null, YearMonth.of(2030, 3)));
        assertTrue(budgets.book().base(null, YearMonth.of(2030, 4)).isEmpty());
    }

    @Test
    void settingTheLimitOfOneMonthOnlyGivesTheNextMonthBackItsOldOne() {
        Category c = category("Orçamento só um mês");
        budgets.set(c.getId(), YearMonth.of(2030, 3), new BigDecimal("80"), BudgetService.Scope.FROM_MONTH);

        budgets.set(c.getId(), YearMonth.of(2030, 5), new BigDecimal("200"), BudgetService.Scope.ONLY_MONTH);

        assertMoney("200", budgets.book().base(c.getId(), YearMonth.of(2030, 5)));
        assertMoney("80", budgets.book().base(c.getId(), YearMonth.of(2030, 6)));
    }
}
