package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.model.WishItem;
import com.kaic.expensetracker.model.WishStatus;
import com.kaic.expensetracker.service.WishService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
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

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/** Wish list: products with an estimated price that belong to no account until they are bought. */
@RestController
@RequestMapping("/wishes")
public class WishController {

    private final WishService service;

    public WishController(WishService service) {
        this.service = service;
    }

    @GetMapping
    public List<WishResponse> getAll() {
        return service.findAll().stream().map(this::toResponse).toList();
    }

    @PostMapping
    public ResponseEntity<WishResponse> create(@Valid @RequestBody WishRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(toResponse(service.create(request.toDraft())));
    }

    @PutMapping("/{id}")
    public WishResponse update(@PathVariable Long id, @Valid @RequestBody WishRequest request) {
        return toResponse(service.update(id, request.toDraft()));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        service.delete(id);
    }

    /** Records the real price and the account, creating the expense. */
    @PostMapping("/{id}/buy")
    public WishResponse buy(@PathVariable Long id, @Valid @RequestBody BuyRequest request) {
        return toResponse(service.buy(id, new WishService.Purchase(request.price(), request.date(),
                request.accountId(), request.paymentMethodId(), request.categoryId(), Boolean.TRUE.equals(request.usePot()),
                request.installments() == null ? 1 : request.installments())));
    }

    @PostMapping("/{id}/discard")
    public WishResponse discard(@PathVariable Long id) {
        return toResponse(service.discard(id));
    }

    @PostMapping("/{id}/restore")
    public WishResponse restore(@PathVariable Long id) {
        return toResponse(service.restore(id));
    }

    private WishResponse toResponse(WishItem item) {
        return WishResponse.fromEntity(item, service.currencyOf(item));
    }

    public record WishRequest(
            @NotBlank(message = "Informe o nome do produto.") @Size(max = 120, message = "O nome pode ter até 120 caracteres.") String name,
            @DecimalMin(value = "0.01", message = "O preço deve ser de pelo menos 0,01.")
            @DecimalMax(value = "999999999.99", message = "O preço é alto demais.") BigDecimal estimatedPrice,
            @Size(max = 255, message = "A observação pode ter até 255 caracteres.") String notes,
            @Size(max = 500, message = "O link pode ter até 500 caracteres.") String url,
            Long potId,
            @Size(max = 3, message = "Moeda inválida.") String currency) {

        WishService.Draft toDraft() {
            return new WishService.Draft(name, estimatedPrice, notes, url, potId, currency);
        }
    }

    public record BuyRequest(
            @NotNull(message = "Informe o preço pago.")
            @DecimalMin(value = "0.01", message = "O preço deve ser de pelo menos 0,01.")
            @DecimalMax(value = "999999999.99", message = "O preço é alto demais.") BigDecimal price,
            LocalDate date,
            @NotNull(message = "Informe em qual conta foi a compra.") Long accountId,
            Long paymentMethodId,
            Long categoryId,
            Boolean usePot,
            @Min(value = 1, message = "O número de parcelas deve ser de pelo menos 1.")
            @Max(value = 60, message = "O número de parcelas pode ser de até 60.") Integer installments) {
    }

    public record WishResponse(Long id, String name, BigDecimal estimatedPrice, String notes, String url,
                               WishStatus status, Long potId, String potName, BigDecimal realPrice,
                               LocalDate purchaseDate, Long expenseId, LocalDate createdAt, String currency) {
        static WishResponse fromEntity(WishItem w, String currency) {
            return new WishResponse(w.getId(), w.getName(), w.getEstimatedPrice(), w.getNotes(), w.getUrl(), w.getStatus(),
                    w.getPot() == null ? null : w.getPot().getId(),
                    w.getPot() == null ? null : w.getPot().getName(),
                    w.getRealPrice(), w.getPurchaseDate(),
                    w.getExpense() == null ? null : w.getExpense().getId(), w.getCreatedAt(), currency);
        }
    }
}
