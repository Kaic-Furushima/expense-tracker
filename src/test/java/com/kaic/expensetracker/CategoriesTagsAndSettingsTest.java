package com.kaic.expensetracker;

import com.kaic.expensetracker.controller.ExpenseController;
import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.service.CategoryService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.SettingsService;
import com.kaic.expensetracker.service.TagService;
import org.junit.jupiter.api.AfterEach;
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
class CategoriesTagsAndSettingsTest {

    @Autowired private CategoryService categoryService;
    @Autowired private ExpenseController expenseController;
    @Autowired private ExpenseService expenseService;
    @Autowired private TagService tagService;
    @Autowired private SettingsService settings;

    @BeforeEach
    @AfterEach
    void clean() {
        expenseService.deleteAll();
        settings.setCurrency("BRL");
        settings.setBudgetRollover(false);
    }

    private ExpenseController.ExpenseResponse create(String name, Long categoryId, List<String> tags) {
        return expenseController.create(new ExpenseController.ExpenseRequest(name, null, new BigDecimal("10.00"),
                LocalDate.of(2026, 5, 3), null, categoryId, null, null, null, tags)).getBody();
    }

    @Test
    void subcategoriesHaveOneLevelOnly() {
        Category parent = categoryService.create("Sub pai", null, "#111111");
        Category child = categoryService.create("Sub filho", null, "#222222", parent.getId());
        assertEquals(parent.getId(), child.getParent().getId());

        assertThrows(ResponseStatusException.class, () -> categoryService.create("Sub neto", null, "#333333", child.getId()));
        assertThrows(ResponseStatusException.class,
                () -> categoryService.update(parent.getId(), "Sub pai", null, "#111111", child.getId())); // would loop
        Category other = categoryService.create("Sub outro", null, "#444444");
        assertThrows(ResponseStatusException.class,
                () -> categoryService.update(parent.getId(), "Sub pai", null, "#111111", other.getId())); // parent with children
    }

    @Test
    void deletingAParentPromotesItsChildrenAndKeepsTheTransactions() {
        Category parent = categoryService.create("Apagar pai", null, "#111111");
        Category child = categoryService.create("Apagar filho", null, "#222222", parent.getId());
        var tx = create("No filho", child.getId(), null);

        categoryService.delete(parent.getId());

        assertNull(categoryService.getOrThrow(child.getId()).getParent());
        assertEquals(child.getId(), expenseController.getById(tx.id()).categoryId());
    }

    @Test
    void filteringByAParentCategoryAlsoFindsItsSubcategories() {
        Category parent = categoryService.create("Filtro pai", null, "#111111");
        Category child = categoryService.create("Filtro filho", null, "#222222", parent.getId());
        Category other = categoryService.create("Filtro outro", null, "#333333");
        create("No pai", parent.getId(), null);
        create("No filho", child.getId(), null);
        create("Em outro", other.getId(), null);

        var byParent = expenseController.getAll(null, null, parent.getId(), null, null, null, null, null);
        assertEquals(2, byParent.size());
        // the free-text search also finds a subcategory through the name of its parent
        assertEquals(2, expenseController.getAll(null, null, null, null, null, "filtro pai", null, null).size());
        var byChild = expenseController.getAll(null, null, child.getId(), null, null, null, null, null);
        assertEquals(1, byChild.size());
        assertEquals(parent.getId(), byChild.get(0).categoryParentId());
    }

    @Test
    void tagsAreNormalizedAndSearchable() {
        var tx = create("Com tags", null, List.of("#Viagem", "  Trabalho Remoto ", "viagem", ""));
        assertEquals(List.of("trabalho-remoto", "viagem"), tx.tags());
        create("Sem tags", null, null);

        assertEquals(1, expenseController.getAll(null, null, null, null, null, null, null, "viagem").size());
        assertEquals(1, expenseController.getAll(null, null, null, null, null, null, null, "#Viagem").size());
        assertEquals(1, expenseController.getAll(null, null, null, null, null, "#remoto", null, null).size()); // free text
        assertTrue(tagService.names().containsAll(List.of("viagem", "trabalho-remoto")));
    }

    @Test
    void tagsCanBeReplacedAndRemoved() {
        var tx = create("Trocar tags", null, List.of("a1", "b1"));
        var updated = expenseController.update(tx.id(), new ExpenseController.ExpenseRequest("Trocar tags", null,
                new BigDecimal("10.00"), LocalDate.of(2026, 5, 3), null, null, null, null, null, List.of("c1")));
        assertEquals(List.of("c1"), updated.tags());
        var cleared = expenseController.update(tx.id(), new ExpenseController.ExpenseRequest("Trocar tags", null,
                new BigDecimal("10.00"), LocalDate.of(2026, 5, 3), null, null, null, null, null, List.of()));
        assertTrue(cleared.tags().isEmpty());
    }

    @Test
    void limitsTheNumberAndSizeOfTags() {
        List<String> tooMany = java.util.stream.IntStream.rangeClosed(1, 11).mapToObj(i -> "tag" + i).toList();
        assertThrows(ResponseStatusException.class, () -> create("Muitas", null, tooMany));
        assertThrows(ResponseStatusException.class, () -> create("Longa", null, List.of("x".repeat(41))));
    }

    @Test
    void currencyDefaultsToRealAndOnlyAcceptsKnownOnes() {
        assertEquals("BRL", settings.currency());
        settings.setCurrency("usd");
        assertEquals("USD", settings.currency());
        assertThrows(ResponseStatusException.class, () -> settings.setCurrency("XYZ"));
        assertEquals("USD", settings.currency());
    }

    @Test
    void rolloverRemembersWhenItWasTurnedOn() {
        assertTrue(settings.budgetRolloverFrom().isEmpty());
        settings.setBudgetRollover(true);
        assertEquals(java.time.YearMonth.now(), settings.budgetRolloverFrom().orElseThrow());
        settings.setBudgetRollover(false);
        assertTrue(settings.budgetRolloverFrom().isEmpty());
    }
}
