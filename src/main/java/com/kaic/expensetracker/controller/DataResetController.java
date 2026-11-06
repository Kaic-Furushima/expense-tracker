package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.profile.ProfileContext;
import com.kaic.expensetracker.service.TrashSnapshotService;
import com.kaic.expensetracker.sync.SyncService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** "Limpar tudo": every record of the profile in use goes to the trash and the app is left as a new install. */
@RestController
@RequestMapping("/api/data")
public class DataResetController {

    private final TrashSnapshotService snapshots;
    private final SyncService sync;

    public DataResetController(TrashSnapshotService snapshots, SyncService sync) {
        this.snapshots = snapshots;
        this.sync = sync;
    }

    /** Saves a full copy in the trash (restorable for 30 days) and resets the data. */
    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void clearEverything() {
        snapshots.trashEverything();
        sync.overwriteCloudAfterReplace(ProfileContext.current());
    }
}
