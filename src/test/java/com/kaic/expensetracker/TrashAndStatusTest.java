package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.ExpenseStatus;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.model.Transfer;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.SummaryService;
import com.kaic.expensetracker.service.TransferService;
import com.kaic.expensetracker.service.TrashService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class TrashAndStatusTest {

    private static final YearMonth MONTH = YearMonth.of(2026, 9);

    @Autowired private ExpenseService expenseService;
    @Autowired private org.springframework.jdbc.core.JdbcTemplate jdbc;
    @Autowired private AccountService accountService;
    @Autowired private TransferService transferService;
    @Autowired private TrashService trashService;
    @Autowired private SummaryService summaryService;

    @BeforeEach
    void setUp() {
        expenseService.deleteAll();
        trashService.empty();
    }

    private Expense save(String name, String amount, TransactionType type, ExpenseStatus status, Account account) {
        Expense e = new Expense();
        e.setName(name);
        e.setAmount(new BigDecimal(amount));
        e.setDate(MONTH.atDay(10));
        e.setType(type);
        e.setStatus(status);
        e.setAccount(account);
        return expenseService.save(e);
    }

    private Account account(String name, String initial) {
        return accountService.create(new AccountService.Draft(name, AccountType.CHECKING, null, null,
                new BigDecimal(initial), null, false));
    }

    @Test
    void deletingSendsToTheTrashAndRestoringBringsItBack() {
        Expense e = save("Apagar e voltar", "10.00", TransactionType.EXPENSE, ExpenseStatus.PAID, accountService.defaultAccount());

        expenseService.deleteById(e.getId());
        assertTrue(expenseService.findById(e.getId()).isEmpty());
        assertTrue(expenseService.findByMonth(MONTH).isEmpty());
        assertEquals(1, trashService.list().size());
        assertEquals(TrashService.Kind.EXPENSE, trashService.list().get(0).kind());

        trashService.restore(TrashService.Kind.EXPENSE, e.getId());
        assertTrue(expenseService.findById(e.getId()).isPresent());
        assertTrue(trashService.list().isEmpty());
    }

    @Test
    void trashedItemsDoNotCountInBalancesAndSummaries() {
        Account a = account("Lixeira saldo", "100.00");
        Expense e = save("Gasto", "40.00", TransactionType.EXPENSE, ExpenseStatus.PAID, a);
        assertEquals(new BigDecimal("60.00"), accountService.balances().get(a.getId()));
        BigDecimal spent = summaryService.summarize(MONTH).expense();

        expenseService.deleteById(e.getId());
        assertEquals(new BigDecimal("100.00"), accountService.balances().get(a.getId()));
        assertEquals(0, spent.subtract(new BigDecimal("40.00")).compareTo(summaryService.summarize(MONTH).expense()));
    }

    @Test
    void purgingRemovesForGood() {
        Expense e = save("Sumir", "5.00", TransactionType.EXPENSE, ExpenseStatus.PAID, accountService.defaultAccount());
        expenseService.deleteById(e.getId());

        trashService.purge(TrashService.Kind.EXPENSE, e.getId());
        assertTrue(trashService.list().isEmpty());
        assertThrows(ResponseStatusException.class, () -> trashService.restore(TrashService.Kind.EXPENSE, e.getId()));
    }

    @Test
    void wipingEverythingGoesToTheTrashAndCanBeUndoneOneByOne() {
        Account a = account("Lixeira tudo A", "0");
        Account b = account("Lixeira tudo B", "0");
        save("Um", "1.00", TransactionType.EXPENSE, ExpenseStatus.PAID, a);
        save("Dois", "2.00", TransactionType.INCOME, ExpenseStatus.PAID, a);
        Transfer t = transferService.create(new TransferService.Draft(a.getId(), b.getId(), new BigDecimal("3.00"), MONTH.atDay(11), "mover"));

        expenseService.deleteAll();
        assertTrue(expenseService.findByMonth(MONTH).isEmpty());
        assertTrue(transferService.findByMonth(MONTH, null).isEmpty());
        assertEquals(3, trashService.list().size());

        trashService.restore(TrashService.Kind.TRANSFER, t.getId());
        assertEquals(1, transferService.findByMonth(MONTH, null).size());
        assertEquals(2, trashService.list().size());
    }

    @Test
    void anAccountWhoseHistoryIsInTheTrashStillCannotBeDeleted() {
        Account a = account("Lixeira conta", "0");
        Expense e = save("Velho", "1.00", TransactionType.EXPENSE, ExpenseStatus.PAID, a);
        expenseService.deleteById(e.getId());

        assertThrows(ResponseStatusException.class, () -> accountService.delete(a.getId()));
        trashService.purge(TrashService.Kind.EXPENSE, e.getId());
        accountService.delete(a.getId()); // now nothing points to it
    }

    @Test
    void whatStayedInTheTrashForTooLongIsRemovedAutomatically() {
        Account account = accountService.defaultAccount();
        Expense old = save("Muito antigo", "1.00", TransactionType.EXPENSE, ExpenseStatus.PAID, account);
        Expense recent = save("Recente", "1.00", TransactionType.EXPENSE, ExpenseStatus.PAID, account);
        expenseService.deleteById(old.getId());
        expenseService.deleteById(recent.getId());
        // age the first one by hand
        jdbc.update("update expenses set deleted_at = ? where id = ?",
                LocalDateTime.now().minusDays(TrashService.RETENTION_DAYS + 5), old.getId());

        trashService.purgeExpired();

        var titles = trashService.list().stream().map(TrashService.Item::title).toList();
        assertEquals(java.util.List.of("Recente"), titles);
    }

    @Test
    void aPendingBillOnlyCountsInTheForecastUntilItIsPaid() {
        Account a = account("Pendente conta", "1000.00");
        save("Salário", "500.00", TransactionType.INCOME, ExpenseStatus.PAID, a);
        Expense bill = save("Conta de luz", "120.00", TransactionType.EXPENSE, ExpenseStatus.PENDING, a);
        save("A receber", "50.00", TransactionType.INCOME, ExpenseStatus.PENDING, a);

        assertEquals(new BigDecimal("1500.00"), accountService.balances().get(a.getId())); // pending is not in the balance
        var before = summaryService.summarize(MONTH, a.getId());
        assertEquals(0, new BigDecimal("500.00").compareTo(before.income()));
        assertEquals(0, BigDecimal.ZERO.compareTo(before.expense()));
        assertEquals(0, new BigDecimal("120.00").compareTo(before.pendingExpense()));
        assertEquals(0, new BigDecimal("50.00").compareTo(before.pendingIncome()));
        assertEquals(0, new BigDecimal("430.00").compareTo(before.projectedBalance())); // 500 - 120 + 50

        Expense paid = expenseService.markPaid(bill.getId(), MONTH.atDay(20));
        assertEquals(ExpenseStatus.PAID, paid.getStatus());
        assertEquals(MONTH.atDay(20), paid.getDate());
        assertEquals(new BigDecimal("1380.00"), accountService.balances().get(a.getId()));
        assertEquals(0, new BigDecimal("120.00").compareTo(summaryService.summarize(MONTH, a.getId()).expense()));
        assertThrows(ResponseStatusException.class, () -> expenseService.markPaid(bill.getId(), null));
    }

    @Test
    void pendingTransactionsOfAllMonthsCanBeListed() {
        Account account = accountService.defaultAccount();
        save("Pendente antigo", "1.00", TransactionType.EXPENSE, ExpenseStatus.PENDING, account);
        save("Pago", "1.00", TransactionType.EXPENSE, ExpenseStatus.PAID, account);
        var pending = expenseService.findPending();
        assertTrue(pending.stream().anyMatch(e -> e.getName().equals("Pendente antigo")));
        assertTrue(pending.stream().noneMatch(e -> e.getName().equals("Pago")));
    }

    @Test
    void everyTransactionRecordsWhenItWasCreatedAndChanged() {
        Expense e = save("Auditoria", "1.00", TransactionType.EXPENSE, ExpenseStatus.PAID, accountService.defaultAccount());
        assertNotNull(e.getCreatedAt());
        assertNotNull(e.getUpdatedAt());
        assertFalse(e.getUpdatedAt().isBefore(e.getCreatedAt()));
        assertEquals(LocalDate.now(), e.getCreatedAt().toLocalDate());
    }
}
