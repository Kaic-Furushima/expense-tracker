package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.model.Attachment;
import com.kaic.expensetracker.service.AttachmentService;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/** Receipts (photos/PDFs) attached to transactions. */
@RestController
public class AttachmentController {

    private final AttachmentService service;

    public AttachmentController(AttachmentService service) {
        this.service = service;
    }

    @GetMapping("/expenses/{expenseId}/attachments")
    public List<AttachmentService.Meta> list(@PathVariable Long expenseId) {
        return service.list(expenseId);
    }

    /** Body: {@code fileName} and the file content in base64. */
    @PostMapping("/expenses/{expenseId}/attachments")
    public ResponseEntity<AttachmentService.Meta> add(@PathVariable Long expenseId, @RequestBody AddRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.add(expenseId, request.fileName(), request.data()));
    }

    /** {expense id: number of attachments} for the transactions that have any. */
    @GetMapping("/attachments/counts")
    public Map<Long, Long> counts() {
        return service.counts();
    }

    /** The file itself. Served with the type found by inspecting it, never as a page. */
    @GetMapping("/attachments/{id}")
    public ResponseEntity<byte[]> download(@PathVariable Long id) {
        Attachment a = service.get(id);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(a.getContentType()))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.inline()
                        .filename(a.getFileName(), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'")
                .cacheControl(CacheControl.noStore())
                .body(AttachmentService.decode(a));
    }

    @DeleteMapping("/attachments/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }

    public record AddRequest(String fileName, String data) {
    }
}
