package com.kaic.expensetracker.security;

import com.kaic.expensetracker.profile.ProfileContext;
import com.kaic.expensetracker.profile.ProfileService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.io.Reader;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/**
 * The optional password that opens the app. There is none by default: anyone who can reach the app uses it. When a
 * password is set (in Mais → Configurações), every screen and every data call asks for it first, on this computer and
 * on the phone alike. The password is stored as a BCrypt hash in {@code security.properties}, in the data folder.
 * Sessions live in memory: after a restart the password is asked again.
 */
@Component
public class AccessControl {

    private static final Logger log = LoggerFactory.getLogger(AccessControl.class);

    public static final String COOKIE = "et_session";
    private static final String HASH_KEY = "password.hash";
    /** PBKDF2-HMAC-SHA256 with a random salt, as OWASP recommends. The JDK provides it, so no extra library is needed. */
    private static final int ITERATIONS = 210_000;
    private static final Duration SESSION_LENGTH = Duration.ofDays(30);
    public static final int MIN_LENGTH = 4;
    public static final int MAX_LENGTH = 72; // BCrypt uses at most 72 bytes
    private static final int FAILURES_BEFORE_PAUSE = 5;
    private static final Duration PAUSE = Duration.ofSeconds(30);

    private final Path file;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, Instant> sessions = new ConcurrentHashMap<>();
    private volatile String hash;
    private int failures;
    private Instant pausedUntil = Instant.MIN;

    @Autowired
    public AccessControl(ProfileService profiles) {
        this(profiles.folderOf(ProfileContext.MAIN).resolve("security.properties"));
    }

    /** The file is given directly by the tests; the application uses the data folder (see above). */
    public AccessControl(Path file) {
        this.file = file;
        this.hash = read();
    }

    public synchronized boolean passwordSet() {
        return hash != null;
    }

    /** True when no password is set, or when {@code token} is a session that is still valid. */
    public boolean unlocked(String token) {
        if (!passwordSet()) {
            return true;
        }
        if (token == null) {
            return false;
        }
        Instant until = sessions.get(token);
        if (until == null) {
            return false;
        }
        if (Instant.now().isAfter(until)) {
            sessions.remove(token);
            return false;
        }
        return true;
    }

    /** Checks the password and opens a session. Repeated wrong passwords pause the checks for a while. */
    public synchronized String login(String password) {
        Instant now = Instant.now();
        if (now.isBefore(pausedUntil)) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                    "Muitas tentativas. Espere " + Math.max(1, Duration.between(now, pausedUntil).toSeconds()) + " segundos.");
        }
        if (hash == null || password == null || !matches(password, hash)) {
            if (hash != null && ++failures >= FAILURES_BEFORE_PAUSE) {
                failures = 0;
                pausedUntil = now.plus(PAUSE);
            }
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Senha incorreta.");
        }
        failures = 0;
        return newSession();
    }

    /**
     * Sets, changes or removes the password. Changing it (or removing it) needs the current one. An empty
     * {@code password} removes it. Every other session is closed; the returned token, when there is one, is the new
     * session for the caller.
     */
    public synchronized String change(String current, String password) {
        if (hash != null && (current == null || !matches(current, hash))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Senha atual incorreta.");
        }
        sessions.clear();
        if (password == null || password.isEmpty()) {
            hash = null;
            write(null);
            return null;
        }
        if (password.length() < MIN_LENGTH || password.length() > MAX_LENGTH) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "A senha deve ter entre " + MIN_LENGTH + " e " + MAX_LENGTH + " caracteres.");
        }
        hash = encode(password);
        write(hash);
        return newSession();
    }

    public void logout(String token) {
        if (token != null) {
            sessions.remove(token);
        }
    }

    /** "pbkdf2$iterations$salt$hash", with the salt and the hash in Base64. */
    private String encode(String password) {
        byte[] salt = new byte[16];
        random.nextBytes(salt);
        byte[] digest = derive(password, salt, ITERATIONS);
        Base64.Encoder b64 = Base64.getEncoder();
        return "pbkdf2$" + ITERATIONS + "$" + b64.encodeToString(salt) + "$" + b64.encodeToString(digest);
    }

    private static boolean matches(String password, String stored) {
        String[] parts = stored.split("\\$");
        if (parts.length != 4 || !"pbkdf2".equals(parts[0])) {
            return false;
        }
        byte[] salt = Base64.getDecoder().decode(parts[2]);
        byte[] expected = Base64.getDecoder().decode(parts[3]);
        return MessageDigest.isEqual(derive(password, salt, Integer.parseInt(parts[1])), expected);
    }

    private static byte[] derive(String password, byte[] salt, int iterations) {
        try {
            PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, iterations, 256);
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Algoritmo de senha indisponível", e);
        }
    }

    private String newSession() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        sessions.put(token, Instant.now().plus(SESSION_LENGTH));
        return token;
    }

    private String read() {
        Properties p = new Properties();
        if (Files.isRegularFile(file)) {
            try (Reader in = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
                p.load(in);
            } catch (IOException e) {
                throw new IllegalStateException("Não foi possível ler a configuração de senha", e);
            }
        }
        String value = p.getProperty(HASH_KEY);
        return value == null || value.isBlank() ? null : value;
    }

    private void write(String value) {
        try {
            Properties p = new Properties();
            if (value != null) {
                p.setProperty(HASH_KEY, value);
            }
            Files.createDirectories(file.getParent());
            if (value == null) {
                Files.deleteIfExists(file);
                log.info("Senha de acesso removida");
                return;
            }
            try (Writer out = Files.newBufferedWriter(file, StandardCharsets.UTF_8)) {
                p.store(out, "Pocketful - senha de acesso (não editar à mão)");
            }
        } catch (IOException e) {
            throw new IllegalStateException("Não foi possível salvar a senha de acesso", e);
        }
    }
}
