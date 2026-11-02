package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.Transfer;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.SummaryService;
import com.kaic.expensetracker.service.TransferService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class TransfersTest {

    private static final YearMonth MONTH = YearMonth.of(2026, 7);

    @Autowired private AccountService accountService;
    @Autowired private TransferService transferService;
    @Autowired private ExpenseService expenseService;
    @Autowired private SummaryService summaryService;

    @BeforeEach
    void setUp() {
        expenseService.deleteAll();
    }

    private Account account(String name, String initial) {
        return accountService.create(new AccountService.Draft(name, AccountType.CHECKING, null, null,
                new BigDecimal(initial), null, false));
    }

    private Transfer move(Account from, Account to, String amount) {
        return transferService.create(new TransferService.Draft(from.getId(), to.getId(), new BigDecimal(amount),
                MONTH.atDay(10), "teste"));
    }

    private BigDecimal balance(Account account) {
        return accountService.balances().get(account.getId());
    }

    @Test
    void aTransferMovesBalanceButIsNeitherIncomeNorExpense() {
        Account a = account("Transfer origem", "1000.00");
        Account b = account("Transfer destino", "50.00");
        BigDecimal incomeBefore = summaryService.summarize(MONTH).income();
        BigDecimal expenseBefore = summaryService.summarize(MONTH).expense();

        Transfer t = move(a, b, "300.00");

        assertEquals(new BigDecimal("700.00"), balance(a));
        assertEquals(new BigDecimal("350.00"), balance(b));
        assertEquals(0, incomeBefore.compareTo(summaryService.summarize(MONTH).income()));
        assertEquals(0, expenseBefore.compareTo(summaryService.summarize(MONTH).expense()));

        // deleting it (to the trash) gives the money back
        transferService.delete(t.getId());
        assertEquals(new BigDecimal("1000.00"), balance(a));
        assertEquals(new BigDecimal("50.00"), balance(b));
    }

    @Test
    void anInvestmentIsATransferIntoASubAccountKeptSeparateFromTheAvailableBalance() {
        Account nubank = account("Nubank teste", "1000.00");
        Account cofrinho = accountService.create(new AccountService.Draft("Caixinha Nubank teste", AccountType.INVESTMENT,
                null, null, BigDecimal.ZERO, nubank.getId(), false));
        assertEquals(nubank.getId(), cofrinho.getParent().getId());

        move(nubank, cofrinho, "400.00");

        assertEquals(new BigDecimal("600.00"), balance(nubank)); // available balance of the bank account
        assertEquals(new BigDecimal("400.00"), balance(cofrinho)); // saved apart, not counted in the account above
    }

    @Test
    void onlyOneLevelOfSubAccounts() {
        Account bank = account("Banco um nivel", "0");
        Account part = accountService.create(new AccountService.Draft("Parte um nivel", AccountType.SAVINGS, null, null,
                BigDecimal.ZERO, bank.getId(), false));

        assertThrows(ResponseStatusException.class, () -> accountService.create(new AccountService.Draft(
                "Parte da parte", AccountType.SAVINGS, null, null, BigDecimal.ZERO, part.getId(), false)));
        // an account that already has parts cannot become a part itself
        Account other = account("Outro banco", "0");
        assertThrows(ResponseStatusException.class, () -> accountService.update(bank.getId(), new AccountService.Draft(
                bank.getName(), bank.getType(), bank.getColor(), bank.getIcon(), BigDecimal.ZERO, other.getId(), false)));
        // nor can it be deleted or archived while it has parts
        assertThrows(ResponseStatusException.class, () -> accountService.delete(bank.getId()));
        assertThrows(ResponseStatusException.class, () -> accountService.update(bank.getId(), new AccountService.Draft(
                bank.getName(), bank.getType(), bank.getColor(), bank.getIcon(), BigDecimal.ZERO, null, true)));
    }

    @Test
    void validatesTheTransfer() {
        Account a = account("Validacao A", "0");
        Account b = account("Validacao B", "0");
        assertThrows(ResponseStatusException.class, () -> move(a, a, "10.00"));
        assertThrows(ResponseStatusException.class, () -> move(a, b, "0.00"));
        assertThrows(ResponseStatusException.class, () -> transferService.create(new TransferService.Draft(
                a.getId(), b.getId(), new BigDecimal("10.00"), LocalDate.of(1900, 1, 1), null)));

        Account archived = accountService.update(b.getId(), new AccountService.Draft(
                b.getName(), b.getType(), b.getColor(), b.getIcon(), BigDecimal.ZERO, null, true));
        assertThrows(ResponseStatusException.class, () -> move(a, archived, "10.00"));
    }

    @Test
    void anAccountWithTransfersCannotBeDeleted() {
        Account a = account("Com transferencia A", "0");
        Account b = account("Com transferencia B", "0");
        move(a, b, "5.00");
        assertThrows(ResponseStatusException.class, () -> accountService.delete(a.getId()));
        assertThrows(ResponseStatusException.class, () -> accountService.delete(b.getId()));
    }

    @Test
    void listsTheMonthTransfersOfOneAccount() {
        Account a = account("Lista A", "0");
        Account b = account("Lista B", "0");
        Account c = account("Lista C", "0");
        move(a, b, "1.00");
        move(b, c, "2.00");
        assertEquals(2, transferService.findByMonth(MONTH, b.getId()).size());
        assertEquals(1, transferService.findByMonth(MONTH, a.getId()).size());
    }
}
