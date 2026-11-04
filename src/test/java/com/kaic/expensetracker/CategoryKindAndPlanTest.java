package com.kaic.expensetracker;

import com.kaic.expensetracker.controller.ExpenseController;
import com.kaic.expensetracker.controller.ExpenseController.ExpenseRequest;
import com.kaic.expensetracker.controller.ExpenseController.InstallmentSlot;
import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.ExpenseStatus;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.CategoryService;
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

/** Expense and income categories are separate lists, and an installment purchase can follow a custom plan. */
@SpringBootTest
class CategoryKindAndPlanTest {

    @Autowired private CategoryService categoryService;
    @Autowired private ExpenseController controller;
    @Autowired private ExpenseService expenseService;
    @Autowired private TrashService trashService;

    @BeforeEach
    void setUp() {
        expenseService.deleteAll();
        trashService.empty();
    }

    private static String unique(String base) {
        return base + " " + System.nanoTime();
    }

    @Test
    void theSameNameCanExistInBothKindsButNotTwiceInOne() {
        String name = unique("Freela");
        Category income = categoryService.create(name, null, null, null, TransactionType.INCOME);
        Category expense = categoryService.create(name, null, null, null, TransactionType.EXPENSE);
        assertNotEquals(income.getId(), expense.getId());
        assertThrows(ResponseStatusException.class,
                () -> categoryService.create(name.toUpperCase(), null, null, null, TransactionType.INCOME));
        assertEquals(TransactionType.EXPENSE, categoryService.create(unique("Padrao"), null, null).getKind());
    }

    @Test
    void aSubcategoryTakesTheKindOfItsParent() {
        Category parent = categoryService.create(unique("Renda"), null, null, null, TransactionType.INCOME);
        Category child = categoryService.create(unique("Aluguel"), null, null, parent.getId(), TransactionType.EXPENSE);
        assertEquals(TransactionType.INCOME, child.getKind());
        Category other = categoryService.create(unique("Gasto"), null, null);
        assertThrows(ResponseStatusException.class,
                () -> categoryService.update(child.getId(), child.getName(), null, null, other.getId()));
    }

    @Test
    void anExpenseTakesAnExpenseCategoryAndAnIncomeAnIncomeOne() {
        Category food = categoryService.create(unique("Comida"), null, null);
        Category pay = categoryService.create(unique("Pagamento"), null, null, null, TransactionType.INCOME);
        LocalDate day = LocalDate.of(2026, 5, 2);
        assertThrows(ResponseStatusException.class, () -> controller.create(new ExpenseRequest("x", null,
                BigDecimal.TEN, day, TransactionType.INCOME, food.getId(), null, null)));
        assertThrows(ResponseStatusException.class, () -> controller.create(new ExpenseRequest("x", null,
                BigDecimal.TEN, day, TransactionType.EXPENSE, pay.getId(), null, null)));
        assertNotNull(controller.create(new ExpenseRequest("x", null, BigDecimal.TEN, day, TransactionType.INCOME,
                pay.getId(), null, null)).getBody());
    }

    @Test
    void copyingBringsTheSubcategoriesAndNeverDuplicatesANameInTheTarget() {
        Category home = categoryService.create(unique("Casa"), null, null);
        categoryService.create(unique("Luz"), null, null, home.getId());
        Category copy = categoryService.copyToOtherKind(home.getId());
        assertEquals(TransactionType.INCOME, copy.getKind());
        assertEquals(home.getName(), copy.getName());
        long kids = categoryService.findAll().stream()
                .filter(c -> c.getParent() != null && c.getParent().getId().equals(copy.getId())).count();
        assertEquals(1, kids);
        assertEquals(copy.getId(), categoryService.copyToOtherKind(home.getId()).getId());
        assertEquals(home.getId(), categoryService.copyToOtherKind(copy.getId()).getId());
    }

    private ExpenseRequest buy(List<InstallmentSlot> plan) {
        return new ExpenseRequest("Geladeira", null, new BigDecimal("1000.00"), LocalDate.of(2026, 5, 10),
                TransactionType.EXPENSE, null, null, null, null, null, null, plan);
    }

    private List<Expense> group(Long firstId) {
        Expense first = expenseService.findById(firstId).orElseThrow();
        return expenseService.findAll().stream()
                .filter(e -> first.getInstallmentGroup().equals(e.getInstallmentGroup()))
                .sorted((a, b) -> a.getInstallmentNumber() - b.getInstallmentNumber()).toList();
    }

    @Test
    void eachInstallmentOfAPlanHasItsOwnDateAndStatus() {
        Long id = controller.create(buy(List.of(
                new InstallmentSlot(LocalDate.of(2026, 5, 10), ExpenseStatus.PAID, null),
                new InstallmentSlot(LocalDate.of(2026, 6, 2), ExpenseStatus.PAID, null),
                new InstallmentSlot(LocalDate.of(2026, 6, 20), ExpenseStatus.PENDING, null)))).getBody().id();
        List<Expense> g = group(id);
        assertEquals(List.of(LocalDate.of(2026, 5, 10), LocalDate.of(2026, 6, 2), LocalDate.of(2026, 6, 20)),
                g.stream().map(Expense::getDate).toList());
        assertEquals(List.of(ExpenseStatus.PAID, ExpenseStatus.PAID, ExpenseStatus.PENDING),
                g.stream().map(Expense::getStatus).toList());
        assertEquals(new BigDecimal("333.34"), g.get(0).getAmount());
        assertEquals(new BigDecimal("333.33"), g.get(1).getAmount());
        assertTrue(g.stream().allMatch(e -> e.getInstallmentTotal() == 3));
    }

    @Test
    void ownAmountsAreKeptAndTheBlankOnesShareWhatIsLeft() {
        Long id = controller.create(buy(List.of(
                new InstallmentSlot(LocalDate.of(2026, 5, 10), null, new BigDecimal("400")),
                new InstallmentSlot(LocalDate.of(2026, 6, 10), null, null),
                new InstallmentSlot(LocalDate.of(2026, 7, 10), null, null)))).getBody().id();
        List<Expense> g = group(id);
        assertEquals(0, new BigDecimal("400.00").compareTo(g.get(0).getAmount()));
        assertEquals(0, new BigDecimal("300.00").compareTo(g.get(1).getAmount()));
        assertEquals(0, new BigDecimal("300.00").compareTo(g.get(2).getAmount()));
        assertEquals(List.of(ExpenseStatus.PAID, ExpenseStatus.PENDING, ExpenseStatus.PENDING),
                g.stream().map(Expense::getStatus).toList());
    }

    @Test
    void aBadPlanIsRefusedAndNothingIsSaved() {
        long before = expenseService.getCount();
        assertThrows(ResponseStatusException.class, () -> controller.create(buy(List.of(
                new InstallmentSlot(LocalDate.of(2026, 5, 10), null, BigDecimal.ZERO),
                new InstallmentSlot(LocalDate.of(2026, 6, 10), null, null)))));
        assertThrows(ResponseStatusException.class, () -> controller.create(buy(List.of(
                new InstallmentSlot(LocalDate.of(2026, 5, 10), null, new BigDecimal("1000")),
                new InstallmentSlot(LocalDate.of(2026, 6, 10), null, null)))));
        assertEquals(before, expenseService.getCount());
    }
}
