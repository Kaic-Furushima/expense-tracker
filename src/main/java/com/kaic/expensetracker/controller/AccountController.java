package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.service.AccountService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
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
import java.util.List;
import java.util.Map;

/**
 * Accounts (Santander, Bradesco, wallet...). Every transaction belongs to one of them. An account can sit inside
 * another one (a "cofrinho", for example a Nubank caixinha) with a balance kept separate from its parent's.
 */
@RestController
@RequestMapping("/accounts")
public class AccountController {

    private final AccountService accountService;

    public AccountController(AccountService accountService) {
        this.accountService = accountService;
    }

    @GetMapping
    public List<AccountResponse> getAll() {
        Map<Long, BigDecimal> balances = accountService.balances();
        return accountService.findAll().stream()
                .map(a -> AccountResponse.fromEntity(a, balances.getOrDefault(a.getId(), a.getInitialBalance()), accountService.currencyOf(a)))
                .toList();
    }

    @PostMapping
    public ResponseEntity<AccountResponse> create(@Valid @RequestBody AccountRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(withBalance(accountService.create(request.toDraft())));
    }

    @PutMapping("/{id}")
    public AccountResponse update(@PathVariable Long id, @Valid @RequestBody AccountRequest request) {
        return withBalance(accountService.update(id, request.toDraft()));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        accountService.delete(id);
    }

    /** Moves the balance to the value typed (the difference becomes a balance-correction entry). */
    @PostMapping("/{id}/adjust-balance")
    public AccountResponse adjustBalance(@PathVariable Long id, @Valid @RequestBody AdjustBalanceRequest request) {
        accountService.adjustBalance(id, request.balance());
        return withBalance(accountService.getOrThrow(id));
    }

    public record AdjustBalanceRequest(
            @NotNull(message = "Informe o saldo atual.")
            @DecimalMin(value = "-999999999.99", message = "O saldo é baixo demais.")
            @DecimalMax(value = "999999999.99", message = "O saldo é alto demais.") BigDecimal balance) {
    }

    private AccountResponse withBalance(Account account) {
        return AccountResponse.fromEntity(account,
                accountService.balances().getOrDefault(account.getId(), account.getInitialBalance()), accountService.currencyOf(account));
    }

    public record AccountRequest(
            @NotBlank(message = "Informe o nome da conta.") @Size(max = 80, message = "O nome pode ter até 80 caracteres.") String name,
            AccountType type,
            @Size(max = 7, message = "A cor deve ser um código como #6750A4.") String color,
            @Size(max = 16, message = "O ícone é longo demais.") String icon,
            @DecimalMin(value = "-999999999.99", message = "O saldo inicial é baixo demais.")
            @DecimalMax(value = "999999999.99", message = "O saldo inicial é alto demais.") BigDecimal initialBalance,
            Long parentId,
            Boolean archived,
            Integer closingDay,
            Integer dueDay,
            Boolean saved,
            @Size(max = 3, message = "Moeda inválida.") String currency) {

        AccountService.Draft toDraft() {
            return new AccountService.Draft(name, type, color, icon, initialBalance, parentId, Boolean.TRUE.equals(archived),
                    closingDay, dueDay, saved, currency);
        }
    }

    public record AccountResponse(Long id, String name, AccountType type, String color, String icon,
                                  BigDecimal initialBalance, boolean archived, Long parentId, String parentName,
                                  BigDecimal balance, Integer closingDay, Integer dueDay, boolean saved,
                                  String currency) {
        public static AccountResponse fromEntity(Account a, BigDecimal balance, String currency) {
            Account parent = a.getParent();
            return new AccountResponse(a.getId(), a.getName(), a.getType(), a.getColor(), a.getIcon(),
                    a.getInitialBalance(), a.isArchived(), parent == null ? null : parent.getId(),
                    parent == null ? null : parent.getName(), balance,
                    a.getClosingDay(), a.getDueDay(), Boolean.TRUE.equals(a.getSaved()), currency);
        }
    }
}
