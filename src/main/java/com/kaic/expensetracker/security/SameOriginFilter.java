package com.kaic.expensetracker.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Set;

/**
 * Blocks writes (POST/PUT/DELETE) that a browser sends on behalf of another site (CSRF). The app has no login, so
 * without this any web page the user opens could call {@code http://localhost:PORT/...}. Requests from non-browser
 * clients carry neither header and pass through.
 */
@Component
public class SameOriginFilter extends OncePerRequestFilter {

    private static final Set<String> SAFE_METHODS = Set.of(
            HttpMethod.GET.name(), HttpMethod.HEAD.name(), HttpMethod.OPTIONS.name(), HttpMethod.TRACE.name());

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (SAFE_METHODS.contains(request.getMethod()) || isSameOrigin(request)) {
            chain.doFilter(request, response);
            return;
        }
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/problem+json");
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write("{\"title\":\"Forbidden\",\"status\":403,\"detail\":\"Requisição de outra origem bloqueada.\"}");
    }

    static boolean isSameOrigin(HttpServletRequest request) {
        String fetchSite = request.getHeader("Sec-Fetch-Site");
        if (fetchSite != null && !fetchSite.equals("same-origin") && !fetchSite.equals("none")) {
            return false;
        }
        String origin = request.getHeader("Origin");
        if (origin == null) {
            return true;
        }
        try {
            String authority = URI.create(origin).getAuthority();
            return authority != null && authority.equalsIgnoreCase(request.getHeader("Host"));
        } catch (IllegalArgumentException e) {
            return false; // "null" and malformed origins
        }
    }
}
