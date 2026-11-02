package com.kaic.expensetracker.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;

/**
 * Asks for the password (when one is set) before any data or action. The screens themselves and the sign-in calls are
 * open, so the login form can be shown; everything else answers 401 until a valid session cookie is sent.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class AccessFilter extends OncePerRequestFilter {

    /** Sign-in calls that must work without a session. */
    private static final Set<String> OPEN_CALLS = Set.of("/api/auth/status", "/api/auth/login", "/api/auth/logout");

    private final AccessControl access;

    public AccessFilter(AccessControl access) {
        this.access = access;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (isOpen(request.getRequestURI()) || access.unlocked(tokenOf(request))) {
            chain.doFilter(request, response);
            return;
        }
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/problem+json");
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write("{\"title\":\"Unauthorized\",\"status\":401,\"detail\":\"Entre com a senha.\"}");
    }

    static boolean isOpen(String path) {
        return path.equals("/") || path.equals("/index.html") || path.equals("/sw.js") || path.equals("/manifest.webmanifest")
                || path.equals("/favicon.ico") || path.startsWith("/js/") || path.startsWith("/css/") || path.startsWith("/icons/")
                || OPEN_CALLS.contains(path);
    }

    /** The session token from the request's cookie, or null. */
    public static String tokenOf(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return null;
        }
        for (Cookie cookie : cookies) {
            if (AccessControl.COOKIE.equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }
}
