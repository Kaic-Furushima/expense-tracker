package com.kaic.expensetracker;

import com.kaic.expensetracker.sync.SyncController;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import static org.junit.jupiter.api.Assertions.*;

/** The routes the sync screen calls, on the real application context (no hub is ever contacted here). */
@SpringBootTest
class SyncControllerTest {

    @Autowired private SyncController sync;

    @Test
    void startsDisconnected() {
        var status = sync.status();
        assertTrue(status.available());
        assertFalse(status.configured());
        assertNull(status.lastError());
    }

    @Test
    void refusesToSyncWithoutAConnectionAndToConnectWithAnEmptyForm() {
        ResponseStatusException none = assertThrows(ResponseStatusException.class, sync::now);
        assertEquals(HttpStatus.BAD_REQUEST, none.getStatusCode());
        ResponseStatusException empty = assertThrows(ResponseStatusException.class,
                () -> sync.connect(new SyncController.ConnectRequest("", "", "", "", "", false, false)));
        assertEquals(HttpStatus.BAD_REQUEST, empty.getStatusCode());
        assertFalse(sync.status().configured());
    }
}
