package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.service.ReportService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.YearMonth;

/** Statements for a month or any period, as PDF or Excel. */
@RestController
@RequestMapping("/reports")
public class ReportController {

    private static final MediaType XLSX = MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    private final ReportService service;

    public ReportController(ReportService service) {
        this.service = service;
    }

    /**
     * {@code statement.pdf} or {@code statement.xlsx}. The period is {@code month=2026-11} or {@code from} and
     * {@code to}; {@code accountId} limits it to one account.
     */
    @GetMapping("/statement.{format}")
    public ResponseEntity<byte[]> statement(@PathVariable String format,
                                            @RequestParam(required = false) YearMonth month,
                                            @RequestParam(required = false) LocalDate from,
                                            @RequestParam(required = false) LocalDate to,
                                            @RequestParam(required = false) Long accountId,
                                            @RequestParam(required = false) String currency) {
        LocalDate start = from != null ? from : (month == null ? YearMonth.now() : month).atDay(1);
        LocalDate end = to != null ? to : from != null ? from.plusMonths(1).minusDays(1)
                : (month == null ? YearMonth.now() : month).atEndOfMonth();
        ReportService.Data data = service.collect(start, end, accountId, currency);
        String name = "extrato-" + (from == null && to == null ? start.toString().substring(0, 7) : start + "_a_" + end);
        boolean pdf = format.equalsIgnoreCase("pdf");
        if (!pdf && !format.equalsIgnoreCase("xlsx")) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + name + (pdf ? ".pdf" : ".xlsx") + "\"")
                .contentType(pdf ? MediaType.APPLICATION_PDF : XLSX)
                .body(pdf ? service.pdf(data) : service.xlsx(data));
    }
}
