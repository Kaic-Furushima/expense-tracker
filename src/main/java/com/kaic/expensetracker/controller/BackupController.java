package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.profile.ProfileContext;
import com.kaic.expensetracker.profile.ProfileService;
import com.kaic.expensetracker.service.BackupService;
import com.kaic.expensetracker.sync.SyncService;
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
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;

/** In-app backup and restore of the whole database. */
@RestController
@RequestMapping("/backups")
public class BackupController {

    private final BackupService service;
    private final ProfileService profiles;
    private final SyncService sync;

    public BackupController(BackupService service, ProfileService profiles, SyncService sync) {
        this.service = service;
        this.profiles = profiles;
        this.sync = sync;
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

    /**
     * Restores a saved backup. By default over the profile in use; {@code profileId} picks another profile to overwrite
     * and {@code newProfileName} puts the backup in a new profile instead (nothing is overwritten).
     */
    @PostMapping("/{name}/restore")
    public RestoreResult restore(@PathVariable String name, @RequestBody(required = false) RestoreRequest request) {
        return restoreInto(service.read(name), request == null ? RestoreRequest.NONE : request);
    }

    /** Same, with the content of a backup file picked by the user. */
    @PostMapping("/restore")
    public RestoreResult restoreFromFile(@RequestBody RestoreRequest request) {
        if (request.content() == null || request.content().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O arquivo está vazio.");
        }
        return restoreInto(request.content(), request);
    }

    private RestoreResult restoreInto(String content, RestoreRequest r) {
        boolean isNew = r.newProfileName() != null && !r.newProfileName().isBlank();
        String target = isNew ? profiles.create(r.newProfileName()).id()
                : (r.profileId() == null || r.profileId().isBlank() ? ProfileContext.current() : r.profileId());
        if (!isNew && !profiles.exists(target)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Perfil não encontrado.");
        try {
            if (!isNew && Boolean.TRUE.equals(r.backupFirst())) ProfileContext.runAs(target, service::create);
            ProfileContext.runAs(target, () -> service.restoreContent(content));
        } catch (RuntimeException e) {
            if (isNew) { // the profile made for this restore is not kept
                profiles.remove(target);
                profiles.purge(target);
            }
            throw e;
        }
        String syncError = null;
        if (!isNew && sync.connected()) { // the restored profile becomes the truth in the cloud, and so on the other devices
            try {
                sync.forceOverwrite(target);
            } catch (RuntimeException e) {
                syncError = e.getMessage();
            }
        }
        return new RestoreResult(target, isNew, syncError);
    }

    public record RestoreRequest(String content, String profileId, String newProfileName, Boolean backupFirst) {
        static final RestoreRequest NONE = new RestoreRequest(null, null, null, null);
    }

    /** {@code syncError}: the restore worked but the cloud could not be updated now (it will be on the next sync). */
    public record RestoreResult(String profileId, boolean created, String syncError) {
    }

    public record BackupResponse(String name, long sizeBytes, Instant createdAt) {
        static BackupResponse fromInfo(BackupService.BackupInfo info) {
            return new BackupResponse(info.name(), info.sizeBytes(), info.createdAt());
        }
    }
}
