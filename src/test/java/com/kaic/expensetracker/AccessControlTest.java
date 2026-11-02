package com.kaic.expensetracker;

import com.kaic.expensetracker.security.AccessControl;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class AccessControlTest {

    @TempDir
    Path folder;

    @Test
    void noPasswordByDefaultAndEverythingIsOpen() {
        AccessControl access = new AccessControl(folder.resolve("security.properties"));
        assertFalse(access.passwordSet());
        assertTrue(access.unlocked(null));
    }

    @Test
    void passwordIsRequiredOnceSetAndCanBeChangedAndRemoved() throws Exception {
        Path file = folder.resolve("security.properties");
        AccessControl access = new AccessControl(file);

        String token = access.change(null, "segredo1");
        assertNotNull(token);
        assertTrue(access.passwordSet());
        assertTrue(access.unlocked(token));
        assertFalse(access.unlocked(null));
        assertFalse(access.unlocked("token-inventado"));
        assertFalse(Files.readString(file).contains("segredo1"), "a senha nunca fica gravada em texto");

        // a new instance reads the stored hash
        AccessControl again = new AccessControl(file);
        assertTrue(again.passwordSet());
        String fresh = again.login("segredo1");
        assertTrue(again.unlocked(fresh));
        // the old session was closed by the change
        assertFalse(again.unlocked(token));

        // changing or removing needs the current password
        assertThrows(ResponseStatusException.class, () -> again.change("errada", "outra123"));
        assertThrows(ResponseStatusException.class, () -> again.change(null, ""));
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
                () -> again.change("errada", "")).getStatusCode());

        assertNull(again.change("segredo1", ""));
        assertFalse(again.passwordSet());
        assertFalse(Files.exists(file));
        assertTrue(again.unlocked(null));
    }

    @Test
    void wrongPasswordsPauseTheChecks() {
        AccessControl access = new AccessControl(folder.resolve("security.properties"));
        access.change(null, "segredo1");
        for (int i = 0; i < 4; i++) {
            ResponseStatusException e = assertThrows(ResponseStatusException.class, () -> access.login("errada"));
            assertEquals(HttpStatus.UNAUTHORIZED, e.getStatusCode());
        }
        // the fifth wrong attempt starts a pause, even with the right password afterwards
        assertThrows(ResponseStatusException.class, () -> access.login("errada"));
        ResponseStatusException paused = assertThrows(ResponseStatusException.class, () -> access.login("segredo1"));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, paused.getStatusCode());
    }

    @Test
    void shortPasswordsAreRefused() {
        AccessControl access = new AccessControl(folder.resolve("security.properties"));
        ResponseStatusException e = assertThrows(ResponseStatusException.class, () -> access.change(null, "abc"));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatusCode());
        assertFalse(access.passwordSet());
    }
}
