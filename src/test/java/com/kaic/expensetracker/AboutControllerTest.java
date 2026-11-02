package com.kaic.expensetracker;

import com.kaic.expensetracker.controller.AboutController;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class AboutControllerTest {

    @Autowired private AboutController about;

    @Test
    void reportsVersionAndDataFolder() {
        AboutController.AboutResponse info = about.about();
        assertNotNull(info.version());
        assertFalse(info.version().isBlank());
        assertTrue(new java.io.File(info.dataFolder()).isAbsolute());
    }

    @Test
    void otherDevicesCannotOpenTheDataFolder() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("192.168.0.20");
        ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> about.openDataFolder(request));
        assertEquals(HttpStatus.FORBIDDEN, error.getStatusCode());
    }
}
