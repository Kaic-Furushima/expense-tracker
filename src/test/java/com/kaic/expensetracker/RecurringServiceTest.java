package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.OccurrenceStatus;
import com.kaic.expensetracker.model.RecurringOccurrence;
import com.kaic.expensetracker.model.RecurringPayment;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.RecurringService;
import com.kaic.expensetracker.service.SettingsService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class RecurringServiceTest {

    @Autowired private RecurringService recurringService;
    @Autowired private ExpenseService expenseService;
    @Autowired private SettingsService settings;

    @BeforeEach
    @AfterEach
    void clean() {
        settings.setBoolean(SettingsService.AUTO_PAY_RECURRING, false);
        expenseService.deleteAll();
        recurringService.findAll().forEach(p -> recurringService.delete(p.getId()));
    }

    private RecurringPayment rule(String name, String amount, boolean variable, int day, String startMonth) {
        return recurringService.create(new RecurringService.Draft(name, TransactionType.EXPENSE,
                amount == null ? null : new BigDecimal(amount), variable, day, null, null, null,
                true, startMonth, null));
    }

    private List<RecurringOccurrence> thisMonth() {
        return recurringService.occurrencesOf(YearMonth.now());
    }

    @Test
    void createsOneOccurrenceForEveryMonthFromTheStartUpToNow() {
        YearMonth start = YearMonth.now().minusMonths(2);
        RecurringPayment p = rule("Internet", "99.90", false, 10, start.toString());
        recurringService.sync();
        recurringService.sync(); // idempotent
        long count = java.util.stream.Stream.of(0, 1, 2)
                .flatMap(i -> recurringService.occurrencesOf(start.plusMonths(i)).stream())
                .filter(o -> o.getRecurring().getId().equals(p.getId()))
                .count();
        assertEquals(3, count);
    }

    @Test
    void shortMonthsClampDayThirtyToTheLastDay() {
        assertEquals(LocalDate.of(2026, 2, 28), RecurringService.dueDate(YearMonth.of(2026, 2), 30));
        assertEquals(LocalDate.of(2028, 2, 29), RecurringService.dueDate(YearMonth.of(2028, 2), 31));
        assertEquals(LocalDate.of(2026, 4, 30), RecurringService.dueDate(YearMonth.of(2026, 4), 31));
    }

    @Test
    void withAutoPayOffNothingIsChargedUntilYouPay() {
        rule("Aluguel", "1450.00", false, 1, null);
        RecurringOccurrence o = thisMonth().get(0);
        assertEquals(OccurrenceStatus.PENDING, o.getStatus());
        assertEquals(0, expenseService.getCount());
    }

    @Test
    void withAutoPayOnDueFixedPaymentsBecomeTransactions() {
        rule("Aluguel", "1450.00", false, 1, null);
        rule("Luz", null, true, 1, null);
        settings.setBoolean(SettingsService.AUTO_PAY_RECURRING, true);
        recurringService.sync();
        recurringService.sync();

        assertEquals(1, expenseService.getCount()); // only the fixed one; the variable one asks for confirmation
        List<RecurringOccurrence> occurrences = thisMonth();
        RecurringOccurrence rent = occurrences.stream().filter(o -> o.getRecurring().getName().equals("Aluguel")).findFirst().orElseThrow();
        RecurringOccurrence power = occurrences.stream().filter(o -> o.getRecurring().getName().equals("Luz")).findFirst().orElseThrow();
        assertEquals(OccurrenceStatus.PAID, rent.getStatus());
        assertEquals(YearMonth.now().atDay(1), rent.getPaidDate());
        assertEquals(OccurrenceStatus.PENDING, power.getStatus());
    }

    @Test
    void canPayAheadOnADifferentDate() {
        rule("Condomínio", "300.00", false, 28, null);
        RecurringOccurrence o = thisMonth().get(0);
        LocalDate early = YearMonth.now().atDay(2);

        RecurringOccurrence paid = recurringService.pay(o.getId(), early, null, null, null);
        assertEquals(OccurrenceStatus.PAID, paid.getStatus());
        assertEquals(early, paid.getPaidDate());
        Expense e = paid.getExpense();
        assertEquals(early, e.getDate());
        assertEquals(new BigDecimal("300.00"), e.getAmount());

        assertThrows(ResponseStatusException.class, () -> recurringService.pay(o.getId(), early, null, null, null));
    }

    @Test
    void variablePaymentNeedsAnAmount() {
        rule("Água", null, true, 15, null);
        RecurringOccurrence o = thisMonth().get(0);
        assertThrows(ResponseStatusException.class, () -> recurringService.pay(o.getId(), null, null, null, null));
        RecurringOccurrence paid = recurringService.pay(o.getId(), null, new BigDecimal("87.35"), null, null);
        assertEquals(new BigDecimal("87.35"), paid.getAmount());
    }

    @Test
    void skipAndReopen() {
        rule("Academia", "100.00", false, 5, null);
        RecurringOccurrence o = thisMonth().get(0);
        assertEquals(OccurrenceStatus.SKIPPED, recurringService.skip(o.getId()).getStatus());
        assertEquals(OccurrenceStatus.PENDING, recurringService.reopen(o.getId()).getStatus());
    }

    @Test
    void deletingThePaymentTransactionSkipsTheOccurrenceSoAutoPayDoesNotRecreateIt() {
        rule("Seguro", "80.00", false, 1, null);
        settings.setBoolean(SettingsService.AUTO_PAY_RECURRING, true);
        recurringService.sync();
        RecurringOccurrence paid = thisMonth().get(0);
        assertEquals(OccurrenceStatus.PAID, paid.getStatus());

        expenseService.deleteById(paid.getExpense().getId());
        recurringService.sync();

        RecurringOccurrence after = thisMonth().get(0);
        assertEquals(OccurrenceStatus.SKIPPED, after.getStatus());
        assertEquals(0, expenseService.getCount());
    }

    @Test
    void unpayingSendsTheTransactionToTheTrashAndReopensTheOccurrence() {
        rule("Condomínio", "300.00", false, 28, null);
        RecurringOccurrence o = thisMonth().get(0);
        recurringService.pay(o.getId(), YearMonth.now().atDay(2), null, null, null);
        assertEquals(1, expenseService.getCount());

        RecurringOccurrence back = recurringService.unpay(o.getId());

        assertEquals(OccurrenceStatus.PENDING, back.getStatus());
        assertNull(back.getExpense());
        assertNull(back.getPaidDate());
        assertEquals(0, expenseService.getCount(), "the amount leaves the balance");
        assertThrows(ResponseStatusException.class, () -> recurringService.unpay(o.getId()), "nothing left to undo");
        // and it can be paid again
        assertEquals(OccurrenceStatus.PAID, recurringService.pay(o.getId(), null, null, null, null).getStatus());
    }

    @Test
    void unpayingADueOccurrenceWithAutoPayOnLeavesItOverdueAndNotPaidAgain() {
        rule("Seguro", "80.00", false, 1, null);
        settings.setBoolean(SettingsService.AUTO_PAY_RECURRING, true);
        recurringService.sync();
        RecurringOccurrence paid = thisMonth().get(0);
        assertEquals(OccurrenceStatus.PAID, paid.getStatus());

        assertEquals(OccurrenceStatus.PENDING, recurringService.unpay(paid.getId()).getStatus());
        recurringService.sync();

        assertEquals(OccurrenceStatus.PENDING, thisMonth().get(0).getStatus(), "overdue, not paid again by itself");
        assertEquals(0, expenseService.getCount());
        // it can still be paid by hand
        assertEquals(OccurrenceStatus.PAID, recurringService.pay(paid.getId(), null, null, null, null).getStatus());
        assertEquals(1, expenseService.getCount());
    }

    @Test
    void unpayingFollowsTheDayTheRuleHasNow() {
        // created on its own due day with auto pay on it is paid at once; later the day is changed to a future one
        YearMonth month = YearMonth.now();
        int today = LocalDate.now().getDayOfMonth();
        int later = today <= 28 ? today + 3 : 1;
        RecurringPayment p = rule("Criada hoje", "40.00", false, today, month.toString());
        settings.setBoolean(SettingsService.AUTO_PAY_RECURRING, true);
        recurringService.sync();
        RecurringOccurrence paid = thisMonth().get(0);
        assertEquals(OccurrenceStatus.PAID, paid.getStatus());

        recurringService.update(p.getId(), new RecurringService.Draft("Criada hoje", TransactionType.EXPENSE,
                new BigDecimal("40.00"), false, later, null, null, null, true, month.toString(), null));
        RecurringOccurrence back = recurringService.unpay(paid.getId());

        assertEquals(RecurringService.dueDate(month, later), back.getDueDate());
        assertEquals(OccurrenceStatus.PENDING, back.getStatus());
        recurringService.sync();
        // a due date still ahead waits for its day; one already past stays overdue (not paid again by itself)
        assertEquals(0, expenseService.getCount());
        assertEquals(0, expenseService.getCount());
    }

    @Test
    void deletingTheRuleCanAlsoSendItsTransactionsToTheTrash() {
        RecurringPayment keeps = rule("Fica", "50.00", false, 28, null);
        RecurringPayment goes = rule("Some", "70.00", false, 28, null);
        thisMonth().forEach(o -> recurringService.pay(o.getId(), YearMonth.now().atDay(2), null, null, null));
        assertEquals(2, expenseService.getCount());
        assertEquals(1, recurringService.createdCount(goes));

        recurringService.delete(keeps.getId()); // default: the transaction it created stays
        assertEquals(2, expenseService.getCount());

        recurringService.delete(goes.getId(), true);
        assertEquals(1, expenseService.getCount(), "only the transaction of the rule deleted with its transactions left");
        assertTrue(recurringService.findAll().isEmpty());
    }

    @Test
    void validatesTheRule() {
        assertThrows(ResponseStatusException.class, () -> rule("X", "10", false, 32, null));
        assertThrows(ResponseStatusException.class, () -> rule("X", null, false, 10, null));
        assertThrows(ResponseStatusException.class, () -> rule(" ", "10", false, 10, null));
    }
}
