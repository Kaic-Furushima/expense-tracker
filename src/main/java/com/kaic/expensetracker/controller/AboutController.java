package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.profile.ProfileContext;
import com.kaic.expensetracker.desktop.WindowsStartup;
import com.kaic.expensetracker.profile.ProfileService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.info.BuildProperties;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.awt.Desktop;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;

/** The "Sobre" footer: version, where the data is kept, and a way to open that folder on the computer running the app. */
@RestController
@RequestMapping("/api/about")
public class AboutController {

    private static final Set<String> LOOPBACK = Set.of("127.0.0.1", "0:0:0:0:0:0:0:1", "::1");

    /** {@code startupAvailable}: the option exists here (packaged program on Windows); {@code startupEnabled}: it is on. */
    public record AboutResponse(String version, String dataFolder, boolean startupAvailable, boolean startupEnabled) {
    }

    public record StartupRequest(boolean enabled) {
    }

    private final ProfileService profiles;
    private final ObjectProvider<BuildProperties> build;

    public AboutController(ProfileService profiles, ObjectProvider<BuildProperties> build) {
        this.profiles = profiles;
        this.build = build;
    }

    @GetMapping
    public AboutResponse about() {
        BuildProperties info = build.getIfAvailable();
        return new AboutResponse(info != null ? info.getVersion() : "dev", dataFolder().toString(),
                WindowsStartup.available(), WindowsStartup.enabled());
    }

    /** Only the computer running the app may open its folders: other devices on the network only see the path. */
    @PostMapping("/open-data-folder")
    public ResponseEntity<Void> openDataFolder(HttpServletRequest request) throws IOException {
        if (!LOOPBACK.contains(request.getRemoteAddr())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "A pasta só pode ser aberta no computador onde o app roda.");
        }
        if (!Desktop.isDesktopSupported() || !Desktop.getDesktop().isSupported(Desktop.Action.OPEN)) {
            throw new ResponseStatusException(HttpStatus.NOT_IMPLEMENTED, "Este computador não consegue abrir pastas daqui.");
        }
        Path folder = dataFolder();
        Files.createDirectories(folder);
        Desktop.getDesktop().open(folder.toFile());
        return ResponseEntity.noContent().build();
    }

    /** Starting with Windows changes the computer, so only the computer running the app may change it. */
    @PutMapping("/startup")
    public AboutResponse startup(@RequestBody StartupRequest request, HttpServletRequest http) throws IOException, InterruptedException {
        if (!LOOPBACK.contains(http.getRemoteAddr())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Esta opção só pode ser mudada no computador onde o app roda.");
        }
        if (!WindowsStartup.available()) {
            throw new ResponseStatusException(HttpStatus.NOT_IMPLEMENTED, "Disponível só no executável do Windows.");
        }
        WindowsStartup.enable(request.enabled());
        return about();
    }

    private Path dataFolder() {
        return profiles.folderOf(ProfileContext.MAIN).toAbsolutePath().normalize();
    }
}
