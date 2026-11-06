package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.Pot;
import com.kaic.expensetracker.model.PotMode;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.model.WishItem;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.PotService;
import com.kaic.expensetracker.service.SummaryService;
import com.kaic.expensetracker.service.WishService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;

import static org.junit.jupiter.api.Assertions.*;

/** Correção de saldo, caixinha atrelada a uma conta e compra parcelada da lista de desejos. */
@SpringBootTest
class AdjustmentPotAccountInstallmentTest {

    @Autowired private AccountService accountService;
    @Autowired private ExpenseService expenseService;
    @Autowired private SummaryService summaryService;
    @Autowired private PotService potService;
    @Autowired private WishService wishService;

    @BeforeEach
    @AfterEach
    void clean() {
        expenseService.deleteAll();
        wishService.findAll().forEach(w -> wishService.delete(w.getId()));
        potService.findAll().forEach(p -> potService.delete(p.getId()));
    }

    private Account bank(String name) {
        return accountService.findOrCreate(name, AccountType.CHECKING, "#E53935");
    }

    @Test
    void balanceCorrectionMovesTheBalanceButIsNotIncomeOrExpense() {
        Account account = bank("Banco Correção");
        BigDecimal before = accountService.balances().get(account.getId());

        Expense up = accountService.adjustBalance(account.getId(), before.add(new BigDecimal("250.50")));
        assertEquals(TransactionType.INCOME, up.getType());
        assertEquals(new BigDecimal("250.50"), up.getAmount());
        assertTrue(up.isAdjustment());
        assertEquals(before.add(new BigDecimal("250.50")), accountService.balances().get(account.getId()));

        Expense down = accountService.adjustBalance(account.getId(), before.add(new BigDecimal("200.00")));
        assertEquals(TransactionType.EXPENSE, down.getType());
        assertEquals(new BigDecimal("50.50"), down.getAmount());
        assertEquals(before.add(new BigDecimal("200.00")), accountService.balances().get(account.getId()));

        var summary = summaryService.summarize(YearMonth.now(), account.getId());
        assertEquals(0, summary.income().signum());
        assertEquals(0, summary.expense().signum());
        assertEquals(new BigDecimal("200.00"), summary.adjustment());
        assertEquals(new BigDecimal("200.00"), summary.balance());
        assertTrue(summary.categories().isEmpty());
    }

    @Test
    void correctionToTheSameBalanceDoesNothingAndCardsHaveNone() {
        Account account = bank("Banco Igual");
        BigDecimal current = accountService.balances().get(account.getId());
        assertNull(accountService.adjustBalance(account.getId(), current));
        assertEquals(0, expenseService.getCount());

        Account card = accountService.create(new AccountService.Draft("Cartão X", AccountType.CREDIT_CARD, null, null,
                BigDecimal.ZERO, null, false, 5, 12));
        assertThrows(ResponseStatusException.class, () -> accountService.adjustBalance(card.getId(), BigDecimal.TEN));
        assertThrows(ResponseStatusException.class, () -> accountService.adjustBalance(account.getId(), null));
    }

    @Test
    void potCanBeTiedToAnAccountAndLosesTheLinkWhenTheAccountIsDeleted() {
        Account account = bank("Banco da Caixinha");
        Pot pot = potService.create(new PotService.Draft("Reserva", null, null, null, PotMode.VARIABLE, null, null, true,
                account.getId()));
        assertEquals(account.getId(), potService.getOrThrow(pot.getId()).getAccount().getId());

        Pot untied = potService.update(pot.getId(), new PotService.Draft("Reserva", null, null, null, PotMode.VARIABLE,
                null, null, true, null));
        assertNull(untied.getAccount());

        assertThrows(ResponseStatusException.class, () -> potService.create(new PotService.Draft("Outra", null, null, null,
                PotMode.VARIABLE, null, null, true, 999_999L)));

        potService.update(pot.getId(), new PotService.Draft("Reserva", null, null, null, PotMode.VARIABLE, null, null, true,
                account.getId()));
        accountService.delete(account.getId());
        assertNull(potService.getOrThrow(pot.getId()).getAccount());
    }

    @Test
    void wishPurchaseCanBeInstallments() {
        Account account = bank("Banco Parcelas");
        WishItem item = wishService.create(new WishService.Draft("Notebook", new BigDecimal("3000.00"), null, null, null));
        WishItem bought = wishService.buy(item.getId(), new WishService.Purchase(new BigDecimal("1000.00"),
                LocalDate.of(2026, 5, 3), account.getId(), null, null, false, 3));

        assertEquals(new BigDecimal("1000.00"), bought.getRealPrice());
        assertEquals(1, bought.getExpense().getInstallmentNumber());
        assertEquals(3, bought.getExpense().getInstallmentTotal());
        assertEquals(3, expenseService.getCount());
        assertEquals(new BigDecimal("333.34"), bought.getExpense().getAmount()); // 1000 / 3: the odd cent goes to the first one
    }
}
