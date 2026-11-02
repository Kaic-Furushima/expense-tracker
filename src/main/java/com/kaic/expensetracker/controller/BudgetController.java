package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.service.BudgetService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.List;

/**
 * Monthly limits. A limit applies from the month it is set until it is changed again, so editing one month never
 * rewrites the past. {@code /budgets/total} is the overall monthly limit.
 */
@RestController
@RequestMapping("/budgets")
public class BudgetController {

    private final BudgetService budgetService;

    public BudgetController(BudgetService budgetService) {
        this.budgetService = budgetService;
    }

    /** Limits of every category in force in a month (default: the current one). */
    @GetMapping
    public List<BudgetResponse> getAll(@RequestParam(required = false) YearMonth month) {
        return budgetService.effectiveInMonth(month == null ? YearMonth.now() : month).stream()
                .map(e -> new BudgetResponse(e.categoryId(), e.amount(), e.fromMonth()))
                .toList();
    }

    @GetMapping("/total")
    public TotalResponse total(@RequestParam(required = false) YearMonth month) {
        var effective = budgetService.effectiveTotal(month == null ? YearMonth.now() : month);
        return new TotalResponse(effective.map(BudgetService.Effective::amount).orElse(null),
                effective.map(BudgetService.Effective::fromMonth).orElse(null));
    }

    @PutMapping("/total")
    public TotalResponse setTotal(@RequestParam(required = false) YearMonth month, @Valid @RequestBody BudgetRequest request) {
        YearMonth m = month == null ? YearMonth.now() : month;
        budgetService.set(null, m, request.amount(), scope(request));
        return total(m);
    }

    @DeleteMapping("/total")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeTotal(@RequestParam(required = false) YearMonth month) {
        budgetService.remove(null, month == null ? YearMonth.now() : month);
    }

    /** Sets a category's limit from {@code month} on ({@code scope=FROM_MONTH}) or only for that month. */
    @PutMapping("/{categoryId}")
    public BudgetResponse set(@PathVariable Long categoryId, @RequestParam(required = false) YearMonth month,
                              @Valid @RequestBody BudgetRequest request) {
        YearMonth m = month == null ? YearMonth.now() : month;
        budgetService.set(categoryId, m, request.amount(), scope(request));
        return budgetService.effectiveInMonth(m).stream()
                .filter(e -> categoryId.equals(e.categoryId()))
                .map(e -> new BudgetResponse(e.categoryId(), e.amount(), e.fromMonth()))
                .findFirst().orElseThrow();
    }

    /** From {@code month} on the category has no limit (earlier months keep theirs). */
    @DeleteMapping("/{categoryId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long categoryId, @RequestParam(required = false) YearMonth month) {
        budgetService.remove(categoryId, month == null ? YearMonth.now() : month);
    }

    private static BudgetService.Scope scope(BudgetRequest request) {
        return request.scope() == null ? BudgetService.Scope.FROM_MONTH : request.scope();
    }

    public record BudgetRequest(
            @NotNull(message = "Informe o limite.")
            @DecimalMin(value = "0.01", message = "O limite deve ser de pelo menos 0,01.")
            @DecimalMax(value = "999999999.99", message = "O limite é alto demais.") BigDecimal amount,
            BudgetService.Scope scope) {
    }

    public record BudgetResponse(Long categoryId, BigDecimal amount, String fromMonth) {
    }

    public record TotalResponse(BigDecimal amount, String fromMonth) {
    }
}
