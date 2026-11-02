package com.kaic.expensetracker;

import com.kaic.expensetracker.controller.ServiceWorkerController;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ServiceWorkerTest {

    @Test
    void theCacheNameComesFromTheShellContentNotFromAPlaceholder() {
        String body = new ServiceWorkerController().serviceWorker().getBody();
        assertFalse(body.contains("__VERSION__"));
        assertTrue(body.matches("(?s).*const CACHE = 'expense-tracker-[0-9a-f]{12}';.*"));
    }
}
