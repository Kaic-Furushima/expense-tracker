package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.TransactionType;
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
        return create(name, icon, color, null, TransactionType.EXPENSE);
    }

    @Transactional
    public Category create(String name, String icon, String color, Long parentId) {
        return create(name, icon, color, parentId, TransactionType.EXPENSE);
    }

    /** A subcategory always has the kind of its parent (the {@code kind} given is ignored then). */
    @Transactional
    public Category create(String name, String icon, String color, Long parentId, TransactionType kind) {
        Category category = new Category();
        category.setKind(kind == null ? TransactionType.EXPENSE : kind);
        Category parent = resolveParent(category, parentId);
        if (parent != null) {
            category.setKind(parent.getKind());
        }
        if (categoryRepository.existsByNameIgnoreCaseAndKind(name.trim(), category.getKind())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Já existe uma categoria com esse nome.");
        }
        apply(category, name, icon, color, parent);
        return categoryRepository.save(category);
    }

    @Transactional
    public Category update(Long id, String name, String icon, String color, Long parentId) {
        Category category = getOrThrow(id);
        boolean renamed = !category.getName().equalsIgnoreCase(name.trim());
        if (renamed && categoryRepository.existsByNameIgnoreCaseAndKind(name.trim(), category.getKind())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Já existe uma categoria com esse nome.");
        }
        apply(category, name, icon, color, resolveParent(category, parentId));
        return categoryRepository.save(category);
    }

    /**
     * Copies a category (with its subcategories) to the other kind, so a name used for expenses can also be used for
     * income and vice versa. A name that already exists in the target kind is kept as it is. Returns the copy.
     */
    @Transactional
    public Category copyToOtherKind(Long id) {
        Category source = getOrThrow(id);
        TransactionType target = source.getKind() == TransactionType.EXPENSE ? TransactionType.INCOME : TransactionType.EXPENSE;
        Category top = source.getParent() == null ? source : source.getParent();
        Category topCopy = copyOne(top, target, null);
        for (Category child : categoryRepository.findAllByOrderByNameAsc()) {
            if (child.getParent() != null && child.getParent().getId().equals(top.getId())
                    && (source.getParent() == null || child.getId().equals(source.getId()))) {
                copyOne(child, target, topCopy.getId());
            }
        }
        if (source.getParent() == null) {
            return topCopy;
        }
        return categoryRepository.findAllByOrderByNameAsc().stream()
                .filter(c -> c.getKind() == target && c.getName().equalsIgnoreCase(source.getName())).findFirst().orElse(topCopy);
    }

    private Category copyOne(Category from, TransactionType target, Long parentId) {
        return categoryRepository.findAllByOrderByNameAsc().stream()
                .filter(c -> c.getKind() == target && c.getName().equalsIgnoreCase(from.getName())).findFirst()
                .orElseGet(() -> create(from.getName(), from.getIcon(), from.getColor(), parentId, target));
    }

    /** Fails unless the category is of the given kind (an expense takes an expense category, income an income one). */
    public void requireKind(Category category, TransactionType type) {
        if (category != null && category.getKind() != type) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, type == TransactionType.INCOME
                    ? "Esta categoria é de despesa; escolha uma categoria de receita."
                    : "Esta categoria é de receita; escolha uma categoria de despesa.");
        }
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
        return findOrCreate(name, icon, color, TransactionType.EXPENSE);
    }

    @Transactional
    public Category findOrCreate(String name, String icon, String color, TransactionType kind) {
        TransactionType wanted = kind == null ? TransactionType.EXPENSE : kind;
        return categoryRepository.findAll().stream()
                .filter(c -> c.getKind() == wanted && c.getName().equalsIgnoreCase(name))
                .findFirst()
                .orElseGet(() -> create(name, icon, color, null, wanted));
    }

    private void apply(Category category, String name, String icon, String color, Category parent) {
        category.setParent(parent);
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
        if (category.getId() != null && parent.getKind() != category.getKind()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A subcategoria precisa ser do mesmo tipo da categoria principal.");
        }
        if (parent.getParent() != null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Só existe um nível de subcategorias.");
        }
        if (category.getId() != null && categoryRepository.existsByParent(category)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Esta categoria já tem subcategorias; não pode virar subcategoria.");
        }
        return parent;
    }
}
