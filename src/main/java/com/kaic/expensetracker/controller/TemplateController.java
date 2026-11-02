package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.model.ExpenseTemplate;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.TemplateService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.util.List;

/** Favorite transactions. */
@RestController
@RequestMapping("/templates")
public class TemplateController {

    private final TemplateService service;

    public TemplateController(TemplateService service) {
        this.service = service;
    }

    @GetMapping
    public List<TemplateResponse> getAll() {
        return service.findAll().stream().map(TemplateResponse::fromEntity).toList();
    }

    @PostMapping
    public ResponseEntity<TemplateResponse> create(@RequestBody TemplateRequest r) {
        ExpenseTemplate t = service.create(new TemplateService.Draft(r.name(), r.type(), r.amount(), r.categoryId(),
                r.accountId(), r.paymentMethodId(), r.description(), r.tags()));
        return ResponseEntity.status(HttpStatus.CREATED).body(TemplateResponse.fromEntity(t));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        service.delete(id);
    }

    public record TemplateRequest(String name, TransactionType type, BigDecimal amount, Long categoryId, Long accountId,
                                  Long paymentMethodId, String description, List<String> tags) {
    }

    public record TemplateResponse(Long id, String name, TransactionType type, BigDecimal amount, Long categoryId,
                                   String categoryName, Long accountId, String accountName, Long paymentMethodId,
                                   String paymentMethodName, String description, List<String> tags) {
        static TemplateResponse fromEntity(ExpenseTemplate t) {
            return new TemplateResponse(t.getId(), t.getName(), t.getType(), t.getAmount(),
                    t.getCategory() == null ? null : t.getCategory().getId(),
                    t.getCategory() == null ? null : t.getCategory().getName(),
                    t.getAccount() == null ? null : t.getAccount().getId(),
                    t.getAccount() == null ? null : t.getAccount().getName(),
                    t.getPaymentMethod() == null ? null : t.getPaymentMethod().getId(),
                    t.getPaymentMethod() == null ? null : t.getPaymentMethod().getName(),
                    t.getDescription(),
                    t.getTags() == null || t.getTags().isBlank() ? List.of() : List.of(t.getTags().split(" ")));
        }
    }
}
