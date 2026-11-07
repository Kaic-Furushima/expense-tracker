package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.Tag;
import com.kaic.expensetracker.model.Transfer;
import com.kaic.expensetracker.service.DemoDataService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.RecurringService;
import com.kaic.expensetracker.service.ReminderService;
import com.kaic.expensetracker.service.UpcomingService;
import com.kaic.expensetracker.service.SettingsService;
import com.kaic.expensetracker.service.SummaryService;
import com.kaic.expensetracker.service.TransferService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

/** Dashboard summary, CSV export, settings and data maintenance used by the web/mobile UI. */
@RestController
@RequestMapping("/api")
public class ApiController {

    private final SummaryService summaryService;
    private final ExpenseService expenseService;
    private final TransferService transferService;
    private final DemoDataService demoDataService;
    private final SettingsService settingsService;
    private final RecurringService recurringService;
    private final UpcomingService upcomingService;
    private final ReminderService reminderService;

    public ApiController(SummaryService summaryService, ExpenseService expenseService, TransferService transferService,
                         DemoDataService demoDataService, SettingsService settingsService,
                         RecurringService recurringService, UpcomingService upcomingService,
                         ReminderService reminderService) {
        this.upcomingService = upcomingService;
        this.reminderService = reminderService;
        this.summaryService = summaryService;
        this.expenseService = expenseService;
        this.transferService = transferService;
        this.demoDataService = demoDataService;
        this.settingsService = settingsService;
        this.recurringService = recurringService;
    }

    @GetMapping("/summary")
    public SummaryService.MonthSummary summary(@RequestParam(required = false) YearMonth month,
                                               @RequestParam(required = false) Long accountId,
                                               @RequestParam(required = false) String currency) {
        return summaryService.summarize(month == null ? YearMonth.now() : month, accountId, currency);
    }

    /** Every transaction and transfer, oldest first. Amounts are plain numbers (no currency symbol). */
    @GetMapping("/export.csv")
    public ResponseEntity<byte[]> exportCsv() {
        record Line(LocalDate date, long order, String text) {
        }
        List<Line> lines = new ArrayList<>();
        for (Expense e : expenseService.findAll()) {
            lines.add(new Line(e.getDate(), e.getId(), String.join(";",
                    e.getDate().toString(),
                    e.getType().name(),
                    cell(e.getName()),
                    cell(e.getCategory() == null ? "" : e.getCategory().getName()),
                    e.getAmount().toPlainString(),
                    cell(e.getAccount() == null ? "" : e.getAccount().getName()),
                    "",
                    cell(e.getPaymentMethod() == null ? "" : e.getPaymentMethod().getName()),
                    e.isPaid() ? "PAGO" : "A_PAGAR",
                    cell(e.getTags().stream().map(Tag::getName).sorted().collect(Collectors.joining(" "))),
                    cell(e.getDescription()),
                    cell(currencyOf(e.getAccount())),
                    "",
                    "")));
        }
        for (Transfer t : transferService.findAll()) {
            lines.add(new Line(t.getDate(), t.getId(), String.join(";",
                    t.getDate().toString(),
                    "TRANSFER",
                    cell(t.getDescription() == null ? "Transferência" : t.getDescription()),
                    "",
                    t.getAmount().toPlainString(),
                    cell(t.getFromAccount().getName()),
                    cell(t.getToAccount().getName()),
                    "",
                    "PAGO",
                    "",
                    "",
                    cell(currencyOf(t.getFromAccount())),
                    t.getToAmount() == null ? "" : t.getToAmount().toPlainString(),
                    cell(currencyOf(t.getToAccount())))));
        }
        lines.sort(Comparator.comparing(Line::date).thenComparingLong(Line::order));

        StringBuilder csv = new StringBuilder("﻿data;tipo;nome;categoria;valor;conta;conta_destino;forma_pagamento;situacao;tags;descricao;moeda;valor_destino;moeda_destino\n");
        lines.forEach(line -> csv.append(line.text()).append('\n'));
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"lancamentos.csv\"")
                .contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
                .body(csv.toString().getBytes(StandardCharsets.UTF_8));
    }

    /** The account's currency for the CSV: its own, or the main one. */
    private String currencyOf(com.kaic.expensetracker.model.Account account) {
        if (account == null) {
            return settingsService.currency();
        }
        return account.getCurrency() == null ? settingsService.currency() : account.getCurrency();
    }

    @GetMapping("/settings")
    public SettingsResponse settings() {
        return new SettingsResponse(settingsService.autoPayRecurring(), settingsService.budgetRollover(),
                settingsService.budgetRolloverFrom().map(YearMonth::toString).orElse(null), settingsService.currency(),
                settingsService.remindersEnabled(), settingsService.reminderDays(), settingsService.autoBackup());
    }

    @PutMapping("/settings")
    public SettingsResponse updateSettings(@RequestBody SettingsRequest request) {
        if (request.autoPayRecurring() != null) {
            settingsService.setBoolean(SettingsService.AUTO_PAY_RECURRING, request.autoPayRecurring());
            // Turning it on pays what is already due right away.
            recurringService.sync();
        }
        if (request.budgetRollover() != null) {
            settingsService.setBudgetRollover(request.budgetRollover());
        }
        if (request.currency() != null) {
            settingsService.setCurrency(request.currency());
        }
        if (request.remindersEnabled() != null) {
            settingsService.setBoolean(SettingsService.REMINDERS_ENABLED, request.remindersEnabled());
        }
        if (request.reminderDays() != null) {
            settingsService.setReminderDays(request.reminderDays());
        }
        if (request.autoBackup() != null) {
            settingsService.setBoolean(SettingsService.AUTO_BACKUP, request.autoBackup());
        }
        return settings();
    }

    public record SettingsRequest(Boolean autoPayRecurring, Boolean budgetRollover, String currency,
                                  Boolean remindersEnabled, Integer reminderDays, Boolean autoBackup) {
        public SettingsRequest(Boolean autoPayRecurring, Boolean budgetRollover, String currency) {
            this(autoPayRecurring, budgetRollover, currency, null, null, null);
        }
    }

    public record SettingsResponse(boolean autoPayRecurring, boolean budgetRollover, String budgetRolloverFrom,
                                   String currency, boolean remindersEnabled, int reminderDays, boolean autoBackup) {
    }

    /**
     * What is still to come in and go out between two dates (default: today to one month ahead), and the balance
     * expected afterwards.
     */
    @GetMapping("/upcoming")
    public UpcomingService.Upcoming upcoming(@RequestParam(required = false) LocalDate from,
                                             @RequestParam(required = false) LocalDate to,
                                             @RequestParam(required = false) Long accountId,
                                             @RequestParam(required = false) String currency) {
        return upcomingService.compute(from, to, accountId, currency);
    }

    /** Things that deserve attention now (overdue and due-soon bills, budgets near the limit, end of month). */
    @GetMapping("/reminders")
    public List<ReminderService.Reminder> reminders() {
        return reminderService.current();
    }

    @PostMapping("/demo-data")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void loadDemoData() {
        demoDataService.load();
    }

    /**
     * Quotes a CSV cell and neutralizes spreadsheet formula injection: a cell that starts with = + - @ (or a tab or a
     * carriage return, which spreadsheets also read as the start of a formula) gets an apostrophe in front.
     * ImportService undoes this when the file comes back.
     */
    static String cell(String value) {
        if (value == null) {
            return "";
        }
        String safe = value.replace("\"", "\"\"").replace("\r", " ").replace("\n", " ");
        if (!safe.isEmpty() && FORMULA_STARTS.indexOf(safe.charAt(0)) >= 0) {
            safe = "'" + safe;
        }
        return "\"" + safe + "\"";
    }

    static final String FORMULA_STARTS = "=+-@\t";
}
