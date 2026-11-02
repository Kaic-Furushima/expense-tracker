package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.ExpenseService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class ExpenseServiceTest {

    @Autowired
    private ExpenseService expenseService;

    @Autowired
    private AccountService accountService;

    @BeforeEach
    void setUp() {
        expenseService.deleteAll();
    }

    @Test
    void testSaveAndFindAll() {
        Expense expense = new Expense();
        expense.setName("Aluguel");
        expense.setDescription("Aluguel mensal");
        expense.setAmount(new BigDecimal("1200.00"));
        expense.setDate(LocalDate.of(2026, 5, 1));
        expense.setAccount(accountService.defaultAccount());

        Expense saved = expenseService.save(expense);
        assertNotNull(saved.getId());
        assertEquals("Aluguel", saved.getName());
        assertEquals(accountService.defaultAccount().getId(), saved.getAccount().getId());

        List<Expense> all = expenseService.findAll();
        assertEquals(1, all.size());
    }

    @Test
    void testMetricsAndCalculations() {
        Expense e1 = new Expense();
        e1.setName("Mercado");
        e1.setAmount(new BigDecimal("350.00"));
        e1.setDate(LocalDate.now());
        e1.setAccount(accountService.defaultAccount());
        expenseService.save(e1);

        Expense e2 = new Expense();
        e2.setName("Ações BOVA11");
        e2.setAmount(new BigDecimal("500.00"));
        e2.setDate(LocalDate.now());
        e2.setAccount(accountService.defaultAccount());
        expenseService.save(e2);

        assertEquals(new BigDecimal("850.00"), expenseService.getTotalAmount());
        assertEquals(2, expenseService.getCount());

        List<Expense> searchResult = expenseService.list(new ExpenseService.Filter(null, null, null, null, null, "mercado", null, null, null, null, null, null), "date,desc", null, null);
        assertEquals(1, searchResult.size());
        assertEquals("Mercado", searchResult.get(0).getName());
    }

    @Test
    void testDeleteById() {
        Expense e = new Expense();
        e.setName("Café");
        e.setAmount(new BigDecimal("8.50"));
        e.setDate(LocalDate.now());
        e.setAccount(accountService.defaultAccount());
        Expense saved = expenseService.save(e);

        assertTrue(expenseService.findById(saved.getId()).isPresent());
        expenseService.deleteById(saved.getId());
        assertFalse(expenseService.findById(saved.getId()).isPresent());
    }
}

