package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.model.Pot;
import com.kaic.expensetracker.model.PotEntry;
import com.kaic.expensetracker.model.PotEntryKind;
import com.kaic.expensetracker.model.PotMode;
import com.kaic.expensetracker.service.PotService;
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
import java.time.LocalDate;
import java.util.List;

/** Pots ("caixinhas"): money set aside that grows every month. */
@RestController
@RequestMapping("/pots")
public class PotController {

    private final PotService service;

    public PotController(PotService service) {
        this.service = service;
    }

    @GetMapping
    public List<PotResponse> getAll() {
        return service.findAll().stream().map(this::toResponse).toList();
    }

    @PostMapping
    public ResponseEntity<PotResponse> create(@Valid @RequestBody PotRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(toResponse(service.create(request.toDraft())));
    }

    @PutMapping("/{id}")
    public PotResponse update(@PathVariable Long id, @Valid @RequestBody PotRequest request) {
        return toResponse(service.update(id, request.toDraft()));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        service.delete(id);
    }

    @GetMapping("/{id}/entries")
    public List<EntryResponse> entries(@PathVariable Long id) {
        return service.entriesOf(id).stream().map(EntryResponse::fromEntity).toList();
    }

    @PostMapping("/{id}/deposit")
    public EntryResponse deposit(@PathVariable Long id, @Valid @RequestBody MoveRequest request) {
        return EntryResponse.fromEntity(service.deposit(id, request.amount(), request.date(), request.note()));
    }

    @PostMapping("/{id}/withdraw")
    public EntryResponse withdraw(@PathVariable Long id, @Valid @RequestBody MoveRequest request) {
        return EntryResponse.fromEntity(service.withdraw(id, request.amount(), request.date(), request.note()));
    }

    @DeleteMapping("/entries/{entryId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteEntry(@PathVariable Long entryId) {
        service.deleteEntry(entryId);
    }

    private PotResponse toResponse(Pot pot) {
        return PotResponse.fromEntity(pot, service.balanceOf(pot), service.currencyOf(pot), service.isMirrored(pot));
    }

    public record PotRequest(
            @NotBlank(message = "Informe o nome da caixinha.") @Size(max = 80, message = "O nome pode ter até 80 caracteres.") String name,
            @Size(max = 7, message = "A cor deve ser um código como #6750A4.") String color,
            @Size(max = 16, message = "O ícone é longo demais.") String icon,
            @DecimalMax(value = "999999999.99", message = "A meta é alta demais.") BigDecimal goal,
            PotMode mode,
            @DecimalMax(value = "999999999.99", message = "O aporte é alto demais.") BigDecimal monthlyAmount,
            String startMonth,
            Boolean active,
            Long accountId,
            @Size(max = 3, message = "Moeda inválida.") String currency) {

        PotService.Draft toDraft() {
            return new PotService.Draft(name, color, icon, goal, mode, monthlyAmount, startMonth, active == null || active, accountId, currency);
        }
    }

    public record MoveRequest(
            @NotNull(message = "Informe o valor.")
            @DecimalMin(value = "0.01", message = "O valor deve ser de pelo menos 0,01.")
            @DecimalMax(value = "999999999.99", message = "O valor é alto demais.") BigDecimal amount,
            LocalDate date,
            @Size(max = 255, message = "A observação pode ter até 255 caracteres.") String note) {
    }

    public record PotResponse(Long id, String name, String color, String icon, BigDecimal goal, PotMode mode,
                              BigDecimal monthlyAmount, String startMonth, boolean active, BigDecimal balance,
                              Long accountId, String accountName, String currency, boolean mirrored) {
        static PotResponse fromEntity(Pot p, BigDecimal balance, String currency, boolean mirrored) {
            return new PotResponse(p.getId(), p.getName(), p.getColor(), p.getIcon(), p.getGoal(), p.getMode(),
                    p.getMonthlyAmount(), p.getStartMonth(), p.isActive(), balance,
                    p.getAccount() == null ? null : p.getAccount().getId(),
                    p.getAccount() == null ? null : p.getAccount().getName(), currency, mirrored);
        }
    }

    public record EntryResponse(Long id, LocalDate date, BigDecimal amount, PotEntryKind kind, String note) {
        static EntryResponse fromEntity(PotEntry e) {
            return new EntryResponse(e.getId(), e.getEntryDate(), e.getAmount(), e.getKind(), e.getNote());
        }
    }
}
