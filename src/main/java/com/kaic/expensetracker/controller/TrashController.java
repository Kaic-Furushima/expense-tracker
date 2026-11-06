package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.profile.ProfileContext;
import com.kaic.expensetracker.sync.SyncService;
import com.kaic.expensetracker.service.TrashService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** The trash: deleted transactions and transfers, kept for {@value TrashService#RETENTION_DAYS} days. */
@RestController
@RequestMapping("/trash")
public class TrashController {

    private final TrashService service;
    private final SyncService sync;

    public TrashController(TrashService service, SyncService sync) {
        this.service = service;
        this.sync = sync;
    }

    @GetMapping
    public List<TrashService.Item> getAll() {
        return service.list();
    }

    @PostMapping("/{kind}/{id}/restore")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void restore(@PathVariable TrashService.Kind kind, @PathVariable Long id) {
        service.restore(kind, id);
        if (kind == TrashService.Kind.EVERYTHING) sync.overwriteCloudAfterReplace(ProfileContext.current());
    }

    /** Removes one item for good. */
    @DeleteMapping("/{kind}/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void purge(@PathVariable TrashService.Kind kind, @PathVariable Long id) {
        service.purge(kind, id);
    }

    /** Empties the trash for good. */
    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void empty() {
        service.empty();
    }
}
