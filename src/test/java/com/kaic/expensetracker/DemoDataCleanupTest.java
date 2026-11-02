package com.kaic.expensetracker;

import com.kaic.expensetracker.repository.BudgetRepository;
import com.kaic.expensetracker.service.CategoryService;
import com.kaic.expensetracker.service.DemoDataService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.TrashService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.junit.jupiter.api.Assertions.*;

/** Sample data and the cleanup that goes with it: no duplicates, and clearing sends everything to the trash (T4). */
@SpringBootTest
class DemoDataCleanupTest {

    @Autowired private DemoDataService demo;
    @Autowired private ExpenseService expenses;
    @Autowired private CategoryService categories;
    @Autowired private TrashService trash;
    @Autowired private BudgetRepository budgetRepository;

    @BeforeEach
    void setUp() {
        expenses.deleteAll();
        trash.empty();
    }

    @AfterEach
    void tearDown() {
        expenses.deleteAll();
        trash.empty();
        budgetRepository.deleteAll();
    }

    @Test
    void loadingTheSampleDataAgainDoesNotDuplicateCategoriesEither() {
        demo.load();
        long categoriesAfterFirst = categories.findAll().size();
        long transactionsAfterFirst = expenses.getCount();

        demo.load();

        assertEquals(categoriesAfterFirst, categories.findAll().size());
        assertEquals(transactionsAfterFirst, expenses.getCount());
    }

    @Test
    void clearingSendsEverythingToTheTrashAndEmptyingTheTrashRemovesIt() {
        demo.load();
        assertTrue(expenses.getCount() > 0);

        demo.clear();

        assertEquals(0, expenses.getCount(), "nada fica na lista");
        assertFalse(trash.list().isEmpty(), "mas tudo está na lixeira, podendo ser restaurado");

        trash.empty();

        assertTrue(trash.list().isEmpty());
    }
}
