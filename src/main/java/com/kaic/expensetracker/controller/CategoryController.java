package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.CategoryService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/categories")
public class CategoryController {

    private final CategoryService categoryService;

    public CategoryController(CategoryService categoryService) {
        this.categoryService = categoryService;
    }

    @GetMapping
    public List<CategoryResponse> getAll() {
        return categoryService.findAll().stream().map(CategoryResponse::fromEntity).toList();
    }

    @PostMapping
    public ResponseEntity<CategoryResponse> create(@Valid @RequestBody CategoryRequest request) {
        Category saved = categoryService.create(request.name(), request.icon(), request.color(), request.parentId(), request.kind());
        return ResponseEntity.status(HttpStatus.CREATED).body(CategoryResponse.fromEntity(saved));
    }

    /** Copies a category (and its subcategories) to the other kind: expense to income, or income to expense. */
    @PostMapping("/{id}/copy")
    public ResponseEntity<CategoryResponse> copy(@PathVariable Long id) {
        return ResponseEntity.status(HttpStatus.CREATED).body(CategoryResponse.fromEntity(categoryService.copyToOtherKind(id)));
    }

    @PutMapping("/{id}")
    public CategoryResponse update(@PathVariable Long id, @Valid @RequestBody CategoryRequest request) {
        return CategoryResponse.fromEntity(categoryService.update(id, request.name(), request.icon(), request.color(), request.parentId()));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        categoryService.delete(id);
    }

    public record CategoryRequest(@NotBlank(message = "Informe o nome da categoria.") @Size(max = 60, message = "O nome pode ter até 60 caracteres.") String name,
                                  @Size(max = 16, message = "O ícone é longo demais.") String icon,
                                  @Size(max = 7, message = "A cor deve ser um código como #6750A4.") String color,
                                  Long parentId,
                                  TransactionType kind) {
        public CategoryRequest(String name, String icon, String color, Long parentId) {
            this(name, icon, color, parentId, null);
        }
    }

    public record CategoryResponse(Long id, String name, String icon, String color, Long parentId, TransactionType kind) {
        public static CategoryResponse fromEntity(Category c) {
            return new CategoryResponse(c.getId(), c.getName(), c.getIcon(), c.getColor(),
                    c.getParent() == null ? null : c.getParent().getId(), c.getKind());
        }
    }
}
