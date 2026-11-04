package com.kaic.expensetracker.sync;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * End-to-end encryption of what goes to the hub; same format as the phone's {@code sync/crypto.js}:
 * {@code "v1." + base64(12-byte iv) + "." + base64(ciphertext + 16-byte GCM tag)}, key = PBKDF2-HMAC-SHA256(password,
 * salt, 310000 iterations) used as AES-256-GCM. The salt lives on the hub (it is not secret) and is the same everywhere.
 */
public final class SyncCrypto {

    public static final int ITERATIONS = 310_000;
    private static final String VERIFY_TEXT = "expense-tracker-sync";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final SecretKey key;

    private SyncCrypto(SecretKey key) {
        this.key = key;
    }

    public static String newSalt() {
        byte[] salt = new byte[16];
        RANDOM.nextBytes(salt);
        return Base64.getEncoder().encodeToString(salt);
    }

    public static SyncCrypto fromPassword(String password, String salt) {
        return fromPassword(password, salt, ITERATIONS);
    }

    public static SyncCrypto fromPassword(String password, String salt, int iterations) {
        try {
            PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), Base64.getDecoder().decode(salt), iterations, 256);
            byte[] raw = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
            return new SyncCrypto(new SecretKeySpec(raw, "AES"));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Não foi possível preparar a criptografia do sync.", e);
        }
    }

    public String encrypt(String text) {
        try {
            byte[] iv = new byte[12];
            RANDOM.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
            byte[] data = cipher.doFinal(text.getBytes(StandardCharsets.UTF_8));
            Base64.Encoder b64 = Base64.getEncoder();
            return "v1." + b64.encodeToString(iv) + "." + b64.encodeToString(data);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Não foi possível cifrar os dados do sync.", e);
        }
    }

    public String decrypt(String token) {
        String[] parts = token == null ? new String[0] : token.split("\\.");
        if (parts.length != 3 || !parts[0].equals("v1")) {
            throw new IllegalArgumentException("Formato de dados do sync desconhecido.");
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Base64.getDecoder().decode(parts[1])));
            return new String(cipher.doFinal(Base64.getDecoder().decode(parts[2])), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException e) {
            throw new IllegalArgumentException("Senha de sync incorreta ou dados corrompidos.", e);
        }
    }

    /** Proves the password is right without revealing anything: a fixed text, encrypted. */
    public String makeCheck() {
        return encrypt(VERIFY_TEXT);
    }

    public boolean verify(String check) {
        return VERIFY_TEXT.equals(decrypt(check));
    }
}
