package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.service.BackupService;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;

/** In-app backup and restore of the whole database. */
@RestController
@RequestMapping("/backups")
public class BackupController {

    private final BackupService service;

    public BackupController(BackupService service) {
        this.service = service;
    }

    @GetMapping
    public List<BackupResponse> list() {
        return service.list().stream().map(BackupResponse::fromInfo).toList();
    }

    @PostMapping
    public ResponseEntity<BackupResponse> create() {
        return ResponseEntity.status(HttpStatus.CREATED).body(BackupResponse.fromInfo(service.create()));
    }

    /** The backup file itself (a plain-text SQL script). */
    @GetMapping("/{name}")
    public ResponseEntity<byte[]> download(@PathVariable String name) {
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + name + "\"")
                .contentType(MediaType.parseMediaType("text/plain;charset=UTF-8"))
                .body(service.read(name).getBytes(StandardCharsets.UTF_8));
    }

    @DeleteMapping("/{name}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String name) {
        service.delete(name);
    }

    /** Replaces all the data with a saved backup. */
    @PostMapping("/{name}/restore")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void restore(@PathVariable String name) {
        service.restoreSaved(name);
    }

    /** Replaces all the data with the content of a backup file picked by the user. */
    @PostMapping("/restore")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void restoreFromFile(@RequestBody RestoreRequest request) {
        service.restoreContent(request.content());
    }

    public record RestoreRequest(@NotBlank(message = "O arquivo está vazio.") String content) {
    }

    public record BackupResponse(String name, long sizeBytes, Instant createdAt) {
        static BackupResponse fromInfo(BackupService.BackupInfo info) {
            return new BackupResponse(info.name(), info.sizeBytes(), info.createdAt());
        }
    }
}
