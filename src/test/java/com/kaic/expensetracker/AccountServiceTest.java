package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.PaymentMethodService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class AccountServiceTest {

    @Autowired private AccountService accountService;
    @Autowired private ExpenseService expenseService;
    @Autowired private PaymentMethodService paymentMethodService;

    @BeforeEach
    void setUp() {
        expenseService.deleteAll();
    }

    private void tx(Account account, TransactionType type, String amount) {
        Expense e = new Expense();
        e.setName("t");
        e.setAmount(new BigDecimal(amount));
        e.setDate(LocalDate.of(2026, 4, 1));
        e.setType(type);
        e.setAccount(account);
        expenseService.save(e);
    }

    @Test
    void migrationCreatesAMainAccountAndPaymentMethods() {
        assertTrue(accountService.findAll().stream().anyMatch(a -> a.getName().equals("Conta principal")));
        var names = paymentMethodService.findAll().stream().map(m -> m.getName()).toList();
        assertTrue(names.containsAll(java.util.List.of("Pix", "Débito", "Crédito", "Dinheiro")));
    }

    @Test
    void balanceIsInitialPlusIncomeMinusExpenses() {
        Account account = accountService.create(new AccountService.Draft("Conta de teste saldo", AccountType.CHECKING, "#112233", null, new BigDecimal("100.00"), null, false));
        tx(account, TransactionType.INCOME, "500.00");
        tx(account, TransactionType.EXPENSE, "120.50");
        assertEquals(new BigDecimal("479.50"), accountService.balances().get(account.getId()));
    }

    @Test
    void accountWithTransactionsCannotBeDeletedButCanBeArchived() {
        Account account = accountService.create(new AccountService.Draft("Conta de teste arquivo", AccountType.WALLET, null, null, null, null, false));
        tx(account, TransactionType.EXPENSE, "10.00");

        var ex = assertThrows(ResponseStatusException.class, () -> accountService.delete(account.getId()));
        assertEquals(HttpStatus.CONFLICT, ex.getStatusCode());

        Account archived = accountService.update(account.getId(), new AccountService.Draft(account.getName(), account.getType(),
                account.getColor(), account.getIcon(), account.getInitialBalance(), null, true));
        assertTrue(archived.isArchived());
    }

    @Test
    void emptyAccountCanBeDeletedAndNamesAreUnique() {
        Account account = accountService.create(new AccountService.Draft("Conta de teste vazia", AccountType.SAVINGS, null, null, null, null, false));
        assertThrows(ResponseStatusException.class,
                () -> accountService.create(new AccountService.Draft("conta de teste VAZIA", AccountType.SAVINGS, null, null, null, null, false)));
        accountService.delete(account.getId());
        assertTrue(accountService.findAll().stream().noneMatch(a -> a.getId().equals(account.getId())));
    }
}
