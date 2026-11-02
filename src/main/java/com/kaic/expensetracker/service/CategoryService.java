package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.repository.BudgetRepository;
import com.kaic.expensetracker.repository.CategoryRepository;
import com.kaic.expensetracker.repository.ExpenseRepository;
import com.kaic.expensetracker.repository.RecurringPaymentRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Optional;

@Service
@Transactional(readOnly = true)
public class CategoryService {

    private final CategoryRepository categoryRepository;
    private final ExpenseRepository expenseRepository;
    private final BudgetRepository budgetRepository;
    private final RecurringPaymentRepository recurringPaymentRepository;

    public CategoryService(CategoryRepository categoryRepository,
                           ExpenseRepository expenseRepository,
                           BudgetRepository budgetRepository,
                           RecurringPaymentRepository recurringPaymentRepository) {
        this.categoryRepository = categoryRepository;
        this.expenseRepository = expenseRepository;
        this.budgetRepository = budgetRepository;
        this.recurringPaymentRepository = recurringPaymentRepository;
    }

    public List<Category> findAll() {
        return categoryRepository.findAllByOrderByNameAsc();
    }

    public Optional<Category> findById(Long id) {
        return categoryRepository.findById(id);
    }

    public Category getOrThrow(Long id) {
        return findById(id).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Categoria não encontrada: " + id));
    }

    @Transactional
    public Category create(String name, String icon, String color) {
        return create(name, icon, color, null);
    }

    @Transactional
    public Category create(String name, String icon, String color, Long parentId) {
        if (categoryRepository.existsByNameIgnoreCase(name.trim())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Já existe uma categoria com esse nome.");
        }
        Category category = new Category();
        apply(category, name, icon, color, parentId);
        return categoryRepository.save(category);
    }

    @Transactional
    public Category update(Long id, String name, String icon, String color, Long parentId) {
        Category category = getOrThrow(id);
        boolean renamed = !category.getName().equalsIgnoreCase(name.trim());
        if (renamed && categoryRepository.existsByNameIgnoreCase(name.trim())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Já existe uma categoria com esse nome.");
        }
        apply(category, name, icon, color, parentId);
        return categoryRepository.save(category);
    }

    /**
     * Deleting keeps the transactions (they become uncategorized, trash included) and promotes the subcategories to
     * top-level categories.
     */
    @Transactional
    public void delete(Long id) {
        Category category = getOrThrow(id);
        categoryRepository.detachChildren(category);
        expenseRepository.detachCategory(id);
        recurringPaymentRepository.detachCategory(category);
        budgetRepository.deleteByCategory(category);
        categoryRepository.delete(category);
    }

    @Transactional
    public Category findOrCreate(String name, String icon, String color) {
        return categoryRepository.findAll().stream()
                .filter(c -> c.getName().equalsIgnoreCase(name))
                .findFirst()
                .orElseGet(() -> create(name, icon, color));
    }

    private void apply(Category category, String name, String icon, String color, Long parentId) {
        category.setParent(resolveParent(category, parentId));
        category.setName(name.trim());
        category.setIcon(icon == null || icon.isBlank() ? "🏷️" : icon.trim());
        category.setColor(color == null || !color.matches("#[0-9a-fA-F]{6}") ? "#6750A4" : color);
    }

    /** Only one level: the parent must be a top-level category, and a category with subcategories cannot become one. */
    private Category resolveParent(Category category, Long parentId) {
        if (parentId == null) {
            return null;
        }
        if (category.getId() != null && category.getId().equals(parentId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Uma categoria não pode ser subcategoria dela mesma.");
        }
        Category parent = getOrThrow(parentId);
        if (parent.getParent() != null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Só existe um nível de subcategorias.");
        }
        if (category.getId() != null && categoryRepository.existsByParent(category)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Esta categoria já tem subcategorias; não pode virar subcategoria.");
        }
        return parent;
    }
}
