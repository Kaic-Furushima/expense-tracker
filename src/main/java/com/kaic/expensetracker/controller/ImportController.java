package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.service.ImportService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Import of bank statements (OFX or CSV) and of the CSV exported by this app. Two steps: {@code preview} reads the
 * file text and returns the lines with suggested categories and duplicate marks; {@code commit} saves the lines the
 * user kept.
 */
@RestController
@RequestMapping("/import")
public class ImportController {

    private final ImportService service;

    public ImportController(ImportService service) {
        this.service = service;
    }

    @PostMapping("/preview")
    public ImportService.Preview preview(@RequestBody PreviewRequest request) {
        return service.preview(request.content(), request.accountId(), Boolean.TRUE.equals(request.invertSigns()));
    }

    @PostMapping("/commit")
    public ImportService.Result commit(@RequestBody CommitRequest request) {
        return service.commit(request.rows(), request.accountId());
    }

    public record PreviewRequest(String content, Long accountId, Boolean invertSigns) {
    }

    public record CommitRequest(List<ImportService.Row> rows, Long accountId) {
    }
}
