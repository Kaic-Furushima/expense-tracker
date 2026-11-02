package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.profile.ProfileContext;
import com.kaic.expensetracker.profile.ProfileFilter;
import com.kaic.expensetracker.profile.ProfileService;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.BackupService;
import com.kaic.expensetracker.service.ExpenseService;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class ProfilesTest {

    @Autowired private ProfileService profiles;
    @Autowired private ProfileFilter filter;
    @Autowired private ExpenseService expenseService;
    @Autowired private AccountService accountService;
    @Autowired private BackupService backupService;

    @BeforeEach
    @AfterEach
    void cleanUp() {
        for (ProfileService.Profile p : profiles.list()) {
            if (!ProfileContext.MAIN.equals(p.id())) {
                profiles.remove(p.id());
            }
        }
        profiles.select(ProfileContext.MAIN);
        profiles.setLanguage("pt");
        expenseService.deleteAll();
    }

    private void spend(String name) {
        Expense e = new Expense();
        e.setName(name);
        e.setAmount(new BigDecimal("10.00"));
        e.setDate(LocalDate.of(2026, 5, 1));
        e.setAccount(accountService.defaultAccount());
        expenseService.save(e);
    }

    private List<String> names() {
        return expenseService.findAll().stream().map(Expense::getName).toList();
    }

    @Test
    void eachProfileHasItsOwnData() {
        spend("do principal");
        ProfileService.Profile other = profiles.create("Maria");

        ProfileContext.runAs(other.id(), () -> {
            assertTrue(names().isEmpty(), "um perfil novo começa vazio");
            spend("da Maria");
            assertEquals(List.of("da Maria"), names());
        });
        assertEquals(List.of("do principal"), names());
    }

    @Test
    void theCookieChoosesTheProfileAndTheLastOneIsTheFallback() throws Exception {
        ProfileService.Profile other = profiles.create("João");

        assertEquals(other.id(), profileSeenBy(other.id()));
        assertEquals(ProfileContext.MAIN, profileSeenBy(ProfileContext.MAIN));
        profiles.select(other.id());
        assertEquals(other.id(), profileSeenBy(null), "sem cookie vale o último escolhido");
        assertEquals(other.id(), profileSeenBy("naoexiste"), "cookie desconhecido é ignorado");
        profiles.select(ProfileContext.MAIN);
        assertEquals(ProfileContext.MAIN, profileSeenBy(null));
        assertEquals(ProfileContext.MAIN, ProfileContext.current(), "a thread volta ao normal depois da requisição");
    }

    private String profileSeenBy(String cookie) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/expenses");
        if (cookie != null) {
            request.setCookies(new Cookie(ProfileFilter.COOKIE, cookie));
        }
        List<String> seen = new ArrayList<>();
        filter.doFilter(request, new MockHttpServletResponse(), new MockFilterChain() {
            @Override
            public void doFilter(jakarta.servlet.ServletRequest req, jakarta.servlet.ServletResponse res) {
                seen.add(ProfileContext.current());
            }
        });
        return seen.get(0);
    }

    @Test
    void namesAreCleanedAndMustBeUnique() {
        assertEquals("Ana Paula", profiles.create("  Ana   Paula ").name());
        assertEquals(409, status(() -> profiles.create("ana paula")));
        assertEquals(409, status(() -> profiles.create("principal")), "o nome do perfil principal também conta");
        assertEquals(400, status(() -> profiles.create("   ")));
        assertEquals(400, status(() -> profiles.create("x".repeat(ProfileService.MAX_NAME + 1))));
        String id = profiles.list().get(1).id();
        assertEquals("Ana", profiles.rename(id, "Ana").name());
        assertEquals("Ana", profiles.list().get(1).name());
    }

    private static int status(Runnable action) {
        try {
            action.run();
            return 200;
        } catch (ResponseStatusException e) {
            return e.getStatusCode().value();
        }
    }

    @Test
    void removingAProfileKeepsItsFolderAndNeverTouchesTheMainOne() {
        ProfileService.Profile other = profiles.create("Temporário");
        java.nio.file.Path folder = profiles.folderOf(other.id());
        assertTrue(java.nio.file.Files.isDirectory(folder));

        profiles.remove(other.id());

        assertFalse(profiles.exists(other.id()));
        assertFalse(java.nio.file.Files.isDirectory(folder), "a pasta original saiu do caminho");
        assertTrue(java.nio.file.Files.isDirectory(folder.resolveSibling(".")), "mas continua dentro de profiles/");
        assertEquals(400, status(() -> profiles.remove(ProfileContext.MAIN)));
        assertEquals(404, status(() -> profiles.remove("naoexiste")));
        assertEquals(1, profiles.list().size());
    }

    @Test
    void backupsBelongToTheProfile() {
        ProfileService.Profile other = profiles.create("Com backup");
        spend("principal");
        BackupService.BackupInfo mainBackup = backupService.create();

        ProfileContext.runAs(other.id(), () -> {
            assertTrue(backupService.list().isEmpty(), "o perfil novo não vê os backups do principal");
            spend("antes");
            BackupService.BackupInfo own = backupService.create();
            spend("depois");
            backupService.restoreSaved(own.name());
            assertEquals(List.of("antes"), names());
        });

        assertEquals(List.of("principal"), names(), "restaurar o outro perfil não mexe no principal");
        assertTrue(backupService.list().stream().anyMatch(b -> b.name().equals(mainBackup.name())));
        backupService.delete(mainBackup.name());
    }

    @Test
    void limitsTheNumberOfProfilesAndTheLanguage() {
        for (int i = 1; i < ProfileService.MAX_PROFILES; i++) {
            profiles.create("Perfil " + i);
        }
        assertEquals(400, status(() -> profiles.create("Um a mais")));

        assertEquals("pt", profiles.language());
        profiles.setLanguage("en");
        assertEquals("en", profiles.language());
        assertEquals(400, status(() -> profiles.setLanguage("fr")));
    }
}
