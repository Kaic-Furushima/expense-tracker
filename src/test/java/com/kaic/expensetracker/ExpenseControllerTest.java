package com.kaic.expensetracker;

import com.kaic.expensetracker.controller.ExpenseController;
import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.PaymentMethodService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class ExpenseControllerTest {

    @Autowired
    private ExpenseController expenseController;

    @Autowired
    private ExpenseService expenseService;

    @Autowired
    private AccountService accountService;

    @Autowired
    private PaymentMethodService paymentMethodService;

    @BeforeEach
    void setUp() {
        expenseService.deleteAll();
    }

    private ExpenseController.ExpenseRequest request(String name, String amount, LocalDate date, TransactionType type,
                                                     Long accountId, Long paymentMethodId) {
        return new ExpenseController.ExpenseRequest(name, null, new BigDecimal(amount), date,
                type, null, accountId, paymentMethodId);
    }

    @Test
    void testCreateAndRetrieveExpense() {
        Account santander = accountService.findOrCreate("Santander", AccountType.CHECKING, "#E53935");
        Long creditId = paymentMethodService.findAll().stream()
                .filter(m -> m.getName().equals("Crédito")).findFirst().orElseThrow().getId();

        var created = new ExpenseController.ExpenseRequest("Notebook Dell", "Notebook para trabalho",
                new BigDecimal("4200.00"), LocalDate.now(), null, null, santander.getId(), creditId);

        ResponseEntity<ExpenseController.ExpenseResponse> response = expenseController.create(created);
        assertEquals(HttpStatus.CREATED, response.getStatusCode());
        assertNotNull(response.getBody());
        assertNotNull(response.getBody().id());
        assertEquals("Notebook Dell", response.getBody().name());
        assertEquals("Santander", response.getBody().accountName());
        assertEquals("Crédito", response.getBody().paymentMethodName());

        ExpenseController.ExpenseResponse fetched = expenseController.getById(response.getBody().id());
        assertEquals(new BigDecimal("4200.00"), fetched.amount());
        assertEquals(santander.getId(), fetched.accountId());

        assertEquals(1, expenseController.getAll(null, null, null, null, null, null, null, null).size());
    }

    @Test
    void testUpdateExpense() {
        Account bradesco = accountService.findOrCreate("Bradesco", AccountType.CHECKING, "#D81B60");
        var created = expenseController.create(request("Fone", "150.00", LocalDate.now(), null, null, null)).getBody();
        assertNotNull(created);

        var updateReq = new ExpenseController.ExpenseRequest("Fone Noise Cancelling", "Fone atualizado",
                new BigDecimal("350.00"), LocalDate.now(), null, null, bradesco.getId(), null);

        ExpenseController.ExpenseResponse updated = expenseController.update(created.id(), updateReq);
        assertEquals("Fone Noise Cancelling", updated.name());
        assertEquals(new BigDecimal("350.00"), updated.amount());
        assertEquals("Bradesco", updated.accountName());
    }

    @Test
    void withoutAnAccountTheMainOneIsUsed() {
        var created = expenseController.create(request("Pizza", "50.00", LocalDate.of(2026, 2, 5), null, null, null)).getBody();
        assertNotNull(created);
        assertEquals(accountService.defaultAccount().getId(), created.accountId());
    }

    @Test
    void testFiltersByMonthTypeAndAccount() {
        Account santander = accountService.findOrCreate("Santander", AccountType.CHECKING, "#E53935");
        Account bradesco = accountService.findOrCreate("Bradesco", AccountType.CHECKING, "#D81B60");
        expenseController.create(request("Salário", "1000.00", LocalDate.of(2026, 1, 5), TransactionType.INCOME, santander.getId(), null));
        expenseController.create(request("Pizza", "50.00", LocalDate.of(2026, 2, 5), null, bradesco.getId(), null));
        expenseController.create(request("Pizza grande", "80.00", LocalDate.of(2026, 2, 6), null, santander.getId(), null));

        assertEquals(1, expenseController.getAll(YearMonth.of(2026, 1), null, null, null, null, null, null, null).size());
        assertEquals(2, expenseController.getAll(null, TransactionType.EXPENSE, null, null, null, "piz", null, null).size());

        List<ExpenseController.ExpenseResponse> inBradesco = expenseController.getAll(null, null, null, bradesco.getId(), null, null, null, null);
        assertEquals(1, inBradesco.size());
        assertEquals("Pizza", inBradesco.get(0).name());

        // the account name is searchable too
        assertEquals(1, expenseController.getAll(null, null, null, null, null, "bradesco", null, null).size());
    }

    @Test
    void testMissingCategoryIsRejected() {
        var request = new ExpenseController.ExpenseRequest("X", null, BigDecimal.ONE, LocalDate.now(),
                null, 999999L, null, null);
        var ex = assertThrows(ResponseStatusException.class, () -> expenseController.create(request));
        assertEquals(HttpStatus.NOT_FOUND, ex.getStatusCode());
    }

    @Test
    void testMissingAccountIsRejected() {
        var request = request("X", "1.00", LocalDate.now(), null, 999999L, null);
        var ex = assertThrows(ResponseStatusException.class, () -> expenseController.create(request));
        assertEquals(HttpStatus.NOT_FOUND, ex.getStatusCode());
    }
}
