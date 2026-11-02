package com.kaic.expensetracker;

import com.kaic.expensetracker.security.SameOriginFilter;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;

class SameOriginFilterTest {

    private int send(String method, String host, String origin, String fetchSite) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest(method, "/api/demo-data");
        request.addHeader("Host", host);
        if (origin != null) {
            request.addHeader("Origin", origin);
        }
        if (fetchSite != null) {
            request.addHeader("Sec-Fetch-Site", fetchSite);
        }
        MockHttpServletResponse response = new MockHttpServletResponse();
        new SameOriginFilter().doFilter(request, response, new MockFilterChain());
        return response.getStatus();
    }

    @Test
    void allowsReadsAndRequestsWithoutBrowserHeaders() throws Exception {
        assertEquals(200, send("GET", "localhost:8080", "http://evil.example", "cross-site"));
        assertEquals(200, send("POST", "localhost:8080", null, null));
    }

    @Test
    void allowsSameOriginWrites() throws Exception {
        assertEquals(200, send("POST", "localhost:8080", "http://localhost:8080", "same-origin"));
        assertEquals(200, send("DELETE", "192.168.0.7:8080", "http://192.168.0.7:8080", null));
    }

    @Test
    void blocksCrossSiteWrites() throws Exception {
        assertEquals(403, send("POST", "localhost:8080", "http://evil.example", "cross-site"));
        assertEquals(403, send("POST", "localhost:8080", null, "same-site"));
        assertEquals(403, send("PUT", "localhost:8080", "http://localhost:3000", null));
        assertEquals(403, send("DELETE", "localhost:8080", "null", null));
    }
}
