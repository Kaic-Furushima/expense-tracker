package com.kaic.expensetracker;

import com.kaic.expensetracker.controller.ExpenseController;
import com.kaic.expensetracker.service.DemoDataService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.repository.BudgetRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

@SpringBootTest
class DemoDataAndLimitsTest {

    @Autowired
    private DemoDataService demoDataService;

    @Autowired
    private ExpenseService expenseService;

    @Autowired
    private ExpenseController expenseController;

    @Autowired
    private BudgetRepository budgetRepository;

    @BeforeEach
    void setUp() {
        expenseService.deleteAll();
    }

    /** The in-memory database is shared with the other tests: leave no transactions or budgets behind. */
    @AfterEach
    void tearDown() {
        expenseService.deleteAll();
        budgetRepository.deleteAll();
    }

    @Test
    void loadingDemoDataTwiceDoesNotDuplicate() {
        demoDataService.load();
        long first = expenseService.getCount();
        demoDataService.load();
        assertEquals(first, expenseService.getCount());
    }

    @Test
    void rejectsDatesOutsideTheSupportedYears() {
        var request = new ExpenseController.ExpenseRequest("Teste", null, new BigDecimal("10"),
                LocalDate.of(1900, 1, 1));
        assertThrows(ResponseStatusException.class, () -> expenseController.create(request));
    }

    @Test
    void roundsAmountsToCents() {
        var request = new ExpenseController.ExpenseRequest("Teste", null, new BigDecimal("10.005"),
                LocalDate.of(2026, 5, 1));
        assertEquals(new BigDecimal("10.01"), expenseController.create(request).getBody().amount());
    }
}
