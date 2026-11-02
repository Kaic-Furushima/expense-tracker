package com.kaic.expensetracker;

import com.kaic.expensetracker.controller.ExpenseController;
import com.kaic.expensetracker.controller.ExpenseController.ExpenseResponse;
import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.ExpenseStatus;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.TrashService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class InstallmentsAndFiltersTest {

    @Autowired private ExpenseController controller;
    @Autowired private ExpenseService expenseService;
    @Autowired private AccountService accountService;
    @Autowired private TrashService trashService;

    @BeforeEach
    void setUp() {
        expenseService.deleteAll();
        trashService.empty();
    }

    private Account account(String name, AccountType type) {
        return accountService.create(new AccountService.Draft(name, type, null, null, BigDecimal.ZERO, null, false,
                type == AccountType.CREDIT_CARD ? 10 : null, type == AccountType.CREDIT_CARD ? 20 : null));
    }

    private ExpenseController.ExpenseRequest buy(String name, String total, LocalDate date, Account account, Integer installments) {
        return new ExpenseController.ExpenseRequest(name, null, new BigDecimal(total), date, TransactionType.EXPENSE,
                null, account.getId(), null, null, null, installments);
    }

    private List<Expense> group(Long firstId) {
        Expense first = expenseService.findById(firstId).orElseThrow();
        return expenseService.findAll().stream()
                .filter(e -> first.getInstallmentGroup().equals(e.getInstallmentGroup()))
                .sorted((a, b) -> a.getInstallmentNumber() - b.getInstallmentNumber())
                .toList();
    }

    @Test
    void aPurchaseIsSplitInMonthlyInstallmentsAndTheFirstTakesTheLeftoverCents() {
        Account bank = account("Parcelas banco", AccountType.CHECKING);

        ExpenseResponse first = controller.create(buy("Notebook", "100.00", LocalDate.of(2026, 1, 31), bank, 3)).getBody();

        assertEquals(1, first.installmentNumber());
        assertEquals(3, first.installmentTotal());
        List<Expense> all = group(first.id());
        assertEquals(3, all.size());
        assertEquals(new BigDecimal("33.34"), all.get(0).getAmount());
        assertEquals(new BigDecimal("33.33"), all.get(1).getAmount());
        assertEquals(new BigDecimal("33.33"), all.get(2).getAmount());
        assertEquals(new BigDecimal("100.00"), all.stream().map(Expense::getAmount).reduce(BigDecimal.ZERO, BigDecimal::add));
        // monthly, and a short month does not push the next ones
        assertEquals(LocalDate.of(2026, 1, 31), all.get(0).getDate());
        assertEquals(LocalDate.of(2026, 2, 28), all.get(1).getDate());
        assertEquals(LocalDate.of(2026, 3, 31), all.get(2).getDate());
        // the first is paid; the others are bills to pay
        assertEquals(ExpenseStatus.PAID, all.get(0).getStatus());
        assertEquals(ExpenseStatus.PENDING, all.get(1).getStatus());
        assertEquals(ExpenseStatus.PENDING, all.get(2).getStatus());
    }

    @Test
    void onACreditCardEveryInstallmentIsAlreadyCommitted() {
        Account card = account("Parcelas cartao", AccountType.CREDIT_CARD);
        ExpenseResponse first = controller.create(buy("Geladeira", "300.00", LocalDate.of(2026, 5, 5), card, 3)).getBody();
        assertTrue(group(first.id()).stream().allMatch(e -> e.getStatus() == ExpenseStatus.PAID));
        assertEquals(new BigDecimal("-300.00"), accountService.balances().get(card.getId()));
    }

    @Test
    void invalidInstallmentCountsAreRejected() {
        Account bank = account("Parcelas invalidas", AccountType.CHECKING);
        assertThrows(ResponseStatusException.class,
                () -> controller.create(buy("Muito", "1000.00", LocalDate.of(2026, 1, 1), bank, 61)));
        assertThrows(ResponseStatusException.class,
                () -> controller.create(buy("Pouco", "0.05", LocalDate.of(2026, 1, 1), bank, 10)));
        // a single installment is just a normal transaction
        ExpenseResponse one = controller.create(buy("A vista", "10.00", LocalDate.of(2026, 1, 1), bank, 1)).getBody();
        assertNull(one.installmentTotal());
    }

    @Test
    void deletingFromAnInstallmentOnTakesTheFollowingOnesToTheTrashAndCanBeUndone() {
        Account bank = account("Parcelas excluir", AccountType.CHECKING);
        ExpenseResponse first = controller.create(buy("Sofa", "400.00", LocalDate.of(2026, 3, 1), bank, 4)).getBody();
        Long second = group(first.id()).get(1).getId();

        var response = controller.delete(second, "FOLLOWING");

        assertEquals(200, response.getStatusCode().value());
        assertEquals(1, group(first.id()).size()); // only the first is left
        assertEquals(3, trashService.list().size());
        trashService.list().forEach(item -> trashService.restore(item.kind(), item.id()));
        assertEquals(4, group(first.id()).size());
    }

    @Test
    void theListCanBeFilteredByDateRangeAndAmountRangeAndSorted() {
        Account bank = account("Filtros conta", AccountType.CHECKING);
        controller.create(buy("Barato", "10.00", LocalDate.of(2026, 6, 2), bank, null));
        controller.create(buy("Medio", "50.00", LocalDate.of(2026, 6, 15), bank, null));
        controller.create(buy("Caro", "200.00", LocalDate.of(2026, 7, 3), bank, null));

        List<ExpenseResponse> range = controller.getAll(null, null, null, bank.getId(), null, null, null, null,
                LocalDate.of(2026, 6, 10), LocalDate.of(2026, 7, 31), null, null, "date,desc", null, null);
        assertEquals(List.of("Caro", "Medio"), range.stream().map(ExpenseResponse::name).toList());

        List<ExpenseResponse> byAmount = controller.getAll(null, null, null, bank.getId(), null, null, null, null,
                null, null, new BigDecimal("20.00"), null, "amount,asc", null, null);
        assertEquals(List.of("Medio", "Caro"), byAmount.stream().map(ExpenseResponse::name).toList());

        List<ExpenseResponse> capped = controller.getAll(null, null, null, bank.getId(), null, null, null, null,
                null, null, null, new BigDecimal("50.00"), "amount,desc", null, null);
        assertEquals(List.of("Medio", "Barato"), capped.stream().map(ExpenseResponse::name).toList());

        List<ExpenseResponse> byName = controller.getAll(null, null, null, bank.getId(), null, null, null, null,
                null, null, null, null, "name,asc", null, null);
        assertEquals(List.of("Barato", "Caro", "Medio"), byName.stream().map(ExpenseResponse::name).toList());

        List<ExpenseResponse> oldestFirst = controller.getAll(null, null, null, bank.getId(), null, null, null, null,
                null, null, null, null, "date,asc", null, null);
        assertEquals("Barato", oldestFirst.get(0).name());
    }

    @Test
    void theListComesInPagesAndAShorterPageIsTheLast() {
        Account bank = account("Paginas", AccountType.CHECKING);
        controller.create(buy("Um", "1.00", LocalDate.of(2026, 3, 1), bank, null));
        controller.create(buy("Dois", "2.00", LocalDate.of(2026, 3, 2), bank, null));
        controller.create(buy("Tres", "3.00", LocalDate.of(2026, 3, 3), bank, null));

        List<ExpenseResponse> first = controller.getAll(null, null, null, bank.getId(), null, null, null, null,
                null, null, null, null, "date,desc", 0, 2);
        List<ExpenseResponse> last = controller.getAll(null, null, null, bank.getId(), null, null, null, null,
                null, null, null, null, "date,desc", 1, 2);
        assertEquals(List.of("Tres", "Dois"), first.stream().map(ExpenseResponse::name).toList());
        assertEquals(List.of("Um"), last.stream().map(ExpenseResponse::name).toList());
        assertThrows(ResponseStatusException.class, () -> controller.getAll(null, null, null, null, null, null, null, null,
                null, null, null, null, "date,desc", 0, 0));
    }

    @Test
    void searchTextIsMatchedAsTypedNotAsWildcards() {
        Account bank = account("Curinga", AccountType.CHECKING);
        controller.create(buy("Cafe 100% puro", "9.00", LocalDate.of(2026, 3, 1), bank, null));
        controller.create(buy("Padaria", "4.00", LocalDate.of(2026, 3, 2), bank, null));

        assertEquals(List.of("Cafe 100% puro"), controller.getAll(null, null, null, null, null, "100%", null, null)
                .stream().map(ExpenseResponse::name).toList());
        assertEquals(0, controller.getAll(null, null, null, null, null, "_", null, null).size());
    }
}
