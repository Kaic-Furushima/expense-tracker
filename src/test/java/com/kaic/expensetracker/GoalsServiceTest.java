package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.Pot;
import com.kaic.expensetracker.model.PotMode;
import com.kaic.expensetracker.model.WishItem;
import com.kaic.expensetracker.model.WishStatus;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.PotService;
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

@SpringBootTest
class GoalsServiceTest {

    @Autowired private PotService potService;
    @Autowired private WishService wishService;
    @Autowired private AccountService accountService;
    @Autowired private ExpenseService expenseService;

    @BeforeEach
    @AfterEach
    void clean() {
        expenseService.deleteAll();
        wishService.findAll().forEach(w -> wishService.delete(w.getId()));
        potService.findAll().forEach(p -> potService.delete(p.getId()));
    }

    private Pot fixedPot(String name, String monthly, YearMonth start) {
        return potService.create(new PotService.Draft(name, null, null, null, PotMode.FIXED,
                new BigDecimal(monthly), start.toString(), true));
    }

    private Pot variablePot(String name) {
        return potService.create(new PotService.Draft(name, null, null, null, PotMode.VARIABLE, null, null, true));
    }

    @Test
    void fixedPotReceivesOneContributionPerMonthAndNeverDuplicates() {
        Pot pot = fixedPot("Viagem", "200.00", YearMonth.now().minusMonths(2));
        potService.sync();
        potService.sync();
        assertEquals(new BigDecimal("600.00"), potService.balanceOf(pot)); // 3 months: two past + current
        assertEquals(3, potService.entriesOf(pot.getId()).size());
    }

    @Test
    void variablePotOnlyGrowsWithDeposits() {
        Pot pot = variablePot("Reserva");
        potService.sync();
        assertEquals(0, potService.balanceOf(pot).signum());

        potService.deposit(pot.getId(), new BigDecimal("150.00"), null, "Bônus");
        potService.withdraw(pot.getId(), new BigDecimal("50.00"), null, null);
        assertEquals(new BigDecimal("100.00"), potService.balanceOf(pot));

        assertThrows(ResponseStatusException.class,
                () -> potService.withdraw(pot.getId(), new BigDecimal("500.00"), null, null));
    }

    @Test
    void fixedPotNeedsAMonthlyAmount() {
        assertThrows(ResponseStatusException.class, () -> potService.create(new PotService.Draft(
                "Sem valor", null, null, null, PotMode.FIXED, null, null, true)));
    }

    @Test
    void wishItemBelongsToNoAccountUntilItIsBought() {
        WishItem item = wishService.create(new WishService.Draft("Fone", new BigDecimal("300.00"), null, null, null));
        assertEquals(WishStatus.WISHED, item.getStatus());
        assertNull(item.getExpense());

        var noAccount = new WishService.Purchase(new BigDecimal("279.90"), null, null, null, null, false);
        assertThrows(ResponseStatusException.class, () -> wishService.buy(item.getId(), noAccount));

        Account account = accountService.findOrCreate("Santander", AccountType.CHECKING, "#E53935");
        WishItem bought = wishService.buy(item.getId(),
                new WishService.Purchase(new BigDecimal("279.90"), LocalDate.of(2026, 5, 3), account.getId(), null, null, false));

        assertEquals(WishStatus.BOUGHT, bought.getStatus());
        assertEquals(new BigDecimal("279.90"), bought.getRealPrice());
        assertEquals(account.getId(), bought.getExpense().getAccount().getId());
        assertEquals(new BigDecimal("279.90"), bought.getExpense().getAmount());
        assertEquals(1, expenseService.getCount());
        assertThrows(ResponseStatusException.class, () -> wishService.buy(item.getId(),
                new WishService.Purchase(new BigDecimal("1.00"), null, account.getId(), null, null, false)));
    }

    @Test
    void payingWithThePotTakesTheMoneyOutAndDeletingThePurchaseGivesItBack() {
        Pot pot = variablePot("Eletrônicos");
        potService.deposit(pot.getId(), new BigDecimal("1000.00"), null, null);
        WishItem item = wishService.create(new WishService.Draft("Monitor", new BigDecimal("800.00"), null, null, pot.getId()));
        Account account = accountService.findOrCreate("Bradesco", AccountType.CHECKING, "#D81B60");

        WishItem bought = wishService.buy(item.getId(),
                new WishService.Purchase(new BigDecimal("750.00"), null, account.getId(), null, null, true));
        assertEquals(new BigDecimal("250.00"), potService.balanceOf(pot));

        // undoing the purchase (deleting its expense) puts the item back on the list and returns the money
        expenseService.deleteById(bought.getExpense().getId());
        assertEquals(new BigDecimal("1000.00"), potService.balanceOf(pot));
        WishItem back = wishService.getOrThrow(item.getId());
        assertEquals(WishStatus.WISHED, back.getStatus());
        assertNull(back.getRealPrice());
        assertNull(back.getExpense());
    }

    @Test
    void cannotPayWithAPotThatHasNoMoney() {
        Pot pot = variablePot("Vazia");
        WishItem item = wishService.create(new WishService.Draft("Cadeira", new BigDecimal("500.00"), null, null, pot.getId()));
        Account account = accountService.defaultAccount();
        assertThrows(ResponseStatusException.class, () -> wishService.buy(item.getId(),
                new WishService.Purchase(new BigDecimal("500.00"), null, account.getId(), null, null, true)));
        assertEquals(0, expenseService.getCount());
    }

    @Test
    void discardAndRestore() {
        WishItem item = wishService.create(new WishService.Draft("Capa", null, null, null, null));
        assertEquals(WishStatus.DISCARDED, wishService.discard(item.getId()).getStatus());
        assertEquals(WishStatus.WISHED, wishService.restore(item.getId()).getStatus());
    }
}
