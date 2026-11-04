package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.profile.ProfileContext;
import com.kaic.expensetracker.profile.ProfileFilter;
import com.kaic.expensetracker.profile.ProfileService;
import com.kaic.expensetracker.service.DefaultCategories;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.List;

/** Profiles (separate data sets in the same app, without login) and the app language. */
@RestController
public class ProfileController {

    public record NameRequest(String name) {
    }

    public record LanguageRequest(String language) {
    }

    public record ProfilesResponse(List<ProfileService.Profile> profiles, List<ProfileService.TrashedProfile> trashed, String current,
                                   String language) {
    }

    private final ProfileService profiles;
    private final DefaultCategories.Seeder categorySeeder;

    public ProfileController(ProfileService profiles, DefaultCategories.Seeder categorySeeder) {
        this.profiles = profiles;
        this.categorySeeder = categorySeeder;
    }

    @GetMapping("/profiles")
    public ProfilesResponse get() {
        return snapshot(ProfileContext.current());
    }

    @PostMapping("/profiles")
    public ProfilesResponse create(@RequestBody NameRequest request, HttpServletResponse response) {
        ProfileService.Profile created = profiles.create(request.name());
        ProfileContext.runAs(created.id(), categorySeeder::seed);
        return switchTo(created.id(), response);
    }

    @PutMapping("/profiles/{id}")
    public ProfilesResponse rename(@PathVariable String id, @RequestBody NameRequest request) {
        profiles.rename(id, request.name());
        return snapshot(ProfileContext.current());
    }

    @DeleteMapping("/profiles/{id}")
    public ProfilesResponse remove(@PathVariable String id, HttpServletResponse response) {
        boolean wasCurrent = id.equals(ProfileContext.current());
        profiles.remove(id);
        return wasCurrent ? switchTo(ProfileContext.MAIN, response) : snapshot(ProfileContext.current());
    }

    /** Takes a profile out of the trash. */
    @PostMapping("/profiles/{id}/restore")
    public ProfilesResponse restore(@PathVariable String id) {
        profiles.restore(id);
        return snapshot(ProfileContext.current());
    }

    /** Deletes a profile that is in the trash for good (the sync tells the other devices). */
    @DeleteMapping("/profiles/{id}/purge")
    public ProfilesResponse purge(@PathVariable String id) {
        profiles.purge(id);
        return snapshot(ProfileContext.current());
    }

    @PostMapping("/profiles/{id}/switch")
    public ProfilesResponse select(@PathVariable String id, HttpServletResponse response) {
        return switchTo(id, response);
    }

    @PutMapping("/app/language")
    public ProfilesResponse language(@RequestBody LanguageRequest request) {
        profiles.setLanguage(request.language());
        return snapshot(ProfileContext.current());
    }

    private ProfilesResponse switchTo(String id, HttpServletResponse response) {
        profiles.select(id);
        ResponseCookie cookie = ResponseCookie.from(ProfileFilter.COOKIE, id)
                .path("/").sameSite("Lax").maxAge(Duration.ofDays(365)).build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
        return snapshot(id);
    }

    private ProfilesResponse snapshot(String current) {
        return new ProfilesResponse(profiles.list(), profiles.trashed(), current, profiles.language());
    }
}
