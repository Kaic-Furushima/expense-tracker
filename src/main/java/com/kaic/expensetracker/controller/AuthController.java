package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.security.AccessControl;
import com.kaic.expensetracker.security.AccessFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.Set;

/** The optional password: its state, signing in and out, and setting, changing or removing it (Mais → Configurações). */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final Set<String> LOOPBACK = Set.of("127.0.0.1", "localhost", "::1", "[::1]", "0:0:0:0:0:0:0:1");

    /** {@code localOnly}: the app only listens on this computer, so other devices cannot reach it. */
    public record Status(boolean passwordSet, boolean unlocked, boolean localOnly) {
    }

    public record LoginRequest(String password) {
    }

    /** {@code password} empty removes the password; {@code current} is needed to change or remove one. */
    public record PasswordRequest(String current, String password) {
    }

    private final AccessControl access;
    private final String bindAddress;

    public AuthController(AccessControl access, @Value("${server.address:127.0.0.1}") String bindAddress) {
        this.access = access;
        this.bindAddress = bindAddress;
    }

    @GetMapping("/status")
    public Status status(HttpServletRequest request) {
        return new Status(access.passwordSet(), access.unlocked(AccessFilter.tokenOf(request)), isLocalOnly());
    }

    @PostMapping("/login")
    public Status login(@RequestBody LoginRequest request, HttpServletResponse response) {
        setSession(response, access.login(request.password()));
        return new Status(true, true, isLocalOnly());
    }

    @PostMapping("/logout")
    public Status logout(HttpServletRequest request, HttpServletResponse response) {
        access.logout(AccessFilter.tokenOf(request));
        ResponseCookie cookie = ResponseCookie.from(AccessControl.COOKIE, "").path("/").maxAge(Duration.ZERO).httpOnly(true).build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
        boolean set = access.passwordSet();
        return new Status(set, !set, isLocalOnly());
    }

    @PutMapping("/password")
    public Status password(@RequestBody PasswordRequest request, HttpServletResponse response) {
        String token = access.change(request.current(), request.password());
        setSession(response, token);
        boolean set = access.passwordSet();
        return new Status(set, !set || token != null, isLocalOnly());
    }

    private boolean isLocalOnly() {
        return bindAddress == null || bindAddress.isBlank() || LOOPBACK.contains(bindAddress.toLowerCase());
    }

    private static void setSession(HttpServletResponse response, String token) {
        if (token == null) {
            return;
        }
        ResponseCookie cookie = ResponseCookie.from(AccessControl.COOKIE, token).path("/").httpOnly(true)
                .sameSite("Strict").maxAge(Duration.ofDays(30)).build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }
}
