package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.model.PaymentMethod;
import com.kaic.expensetracker.service.PaymentMethodService;
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

/** How a payment was made (Pix, debit, credit...), independent from the account. */
@RestController
@RequestMapping("/payment-methods")
public class PaymentMethodController {

    private final PaymentMethodService service;

    public PaymentMethodController(PaymentMethodService service) {
        this.service = service;
    }

    @GetMapping
    public List<MethodResponse> getAll() {
        return service.findAll().stream().map(MethodResponse::fromEntity).toList();
    }

    @PostMapping
    public ResponseEntity<MethodResponse> create(@Valid @RequestBody MethodRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(MethodResponse.fromEntity(service.create(request.name())));
    }

    @PutMapping("/{id}")
    public MethodResponse update(@PathVariable Long id, @Valid @RequestBody MethodRequest request) {
        return MethodResponse.fromEntity(service.update(id, request.name()));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        service.delete(id);
    }

    public record MethodRequest(
            @NotBlank(message = "Informe o nome.") @Size(max = 60, message = "O nome pode ter até 60 caracteres.") String name) {
    }

    public record MethodResponse(Long id, String name) {
        public static MethodResponse fromEntity(PaymentMethod m) {
            return new MethodResponse(m.getId(), m.getName());
        }
    }
}
