package com.kaic.expensetracker.desktop;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.Locale;
import java.util.Optional;

/**
 * "Iniciar com o Windows" (E6): a entrada fica em HKCU\...\Run, só para o usuário atual, e só existe quando o programa
 * roda como o executável empacotado (modo janela). Nada é gravado enquanto a opção não for ligada.
 */
public final class WindowsStartup {

    private static final Logger log = LoggerFactory.getLogger(WindowsStartup.class);
    private static final String KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    private static final String NAME = "ExpenseTracker";

    /** The launcher of the packaged program, when this is it running on Windows; empty otherwise. */
    public static Optional<String> launcher() {
        boolean windows = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
        if (!windows || !Boolean.getBoolean("app.window-mode")) {
            return Optional.empty();
        }
        return Optional.ofNullable(System.getProperty("jpackage.app-path")).filter(path -> !path.isBlank());
    }

    public static boolean available() {
        return launcher().isPresent();
    }

    public static boolean enabled() {
        if (!available()) {
            return false;
        }
        try {
            return run("query", KEY, "/v", NAME) == 0;
        } catch (IOException | InterruptedException e) {
            log.warn("Não foi possível ler a opção de iniciar com o Windows", e);
            return false;
        }
    }

    /** Turns the option on or off. Only the current user's startup list is touched. */
    public static void enable(boolean on) throws IOException, InterruptedException {
        String launcher = launcher().orElseThrow(() -> new IllegalStateException("Disponível só no executável do Windows"));
        int code = on
                ? run("add", KEY, "/v", NAME, "/t", "REG_SZ", "/d", "\"" + launcher + "\"", "/f")
                : run("delete", KEY, "/v", NAME, "/f");
        // "delete" of an entry that is not there is fine: the goal (not starting with Windows) is already met
        if (code != 0 && on) {
            throw new IOException("O registro do Windows recusou a alteração (código " + code + ")");
        }
    }

    private static int run(String... args) throws IOException, InterruptedException {
        String[] command = new String[args.length + 1];
        command[0] = "reg";
        System.arraycopy(args, 0, command, 1, args.length);
        Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
        process.getInputStream().readAllBytes();
        return process.waitFor();
    }
}
