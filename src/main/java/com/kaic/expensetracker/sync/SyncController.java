package com.kaic.expensetracker.sync;

import com.kaic.expensetracker.sync.SyncService.Connect;
import com.kaic.expensetracker.sync.SyncService.Status;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** The sync screen's routes (the phone app answers the same ones). */
@RestController
@RequestMapping("/api/sync")
public class SyncController {

    public record AutoRequest(Boolean enabled) {
    }

    /** Password fields never come back: the status has the e-mail and the project address only. */
    public record ConnectRequest(String url, String anonKey, String email, String password, String syncPassword, Boolean createAccount,
                                 Boolean useCentral) {
    }

    private final SyncService service;

    public SyncController(SyncService service) {
        this.service = service;
    }

    @GetMapping
    public Status status() {
        return service.status();
    }

    @PutMapping
    public Status connect(@RequestBody ConnectRequest r) {
        return guarded(() -> service.connect(new Connect(r.url(), r.anonKey(), r.email(), r.password(), r.syncPassword(),
                Boolean.TRUE.equals(r.createAccount()), Boolean.TRUE.equals(r.useCentral()))));
    }

    @PostMapping("/now")
    public Status now() {
        return guarded(service::syncNow);
    }

    @PutMapping("/auto")
    public Status auto(@RequestBody AutoRequest r) {
        return guarded(() -> service.setAuto(!Boolean.FALSE.equals(r.enabled())));
    }

    @DeleteMapping
    public Status disconnect() {
        return guarded(service::disconnect);
    }

    private static Status guarded(java.util.function.Supplier<Status> action) {
        try {
            return action.get();
        } catch (IllegalArgumentException | IllegalStateException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }
}
