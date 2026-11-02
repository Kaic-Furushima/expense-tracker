package com.kaic.expensetracker.profile;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/** Points each request at the profile named in its cookie (or the last one used, when there is no cookie). */
@Component
public class ProfileFilter extends OncePerRequestFilter {

    public static final String COOKIE = "profile";

    private final ProfileService profiles;

    public ProfileFilter(ProfileService profiles) {
        this.profiles = profiles;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String id = null;
        if (request.getCookies() != null) {
            for (Cookie cookie : request.getCookies()) {
                if (COOKIE.equals(cookie.getName()) && profiles.exists(cookie.getValue())) {
                    id = cookie.getValue();
                }
            }
        }
        ProfileContext.set(id != null ? id : profiles.last());
        try {
            chain.doFilter(request, response);
        } finally {
            ProfileContext.clear();
        }
    }
}
