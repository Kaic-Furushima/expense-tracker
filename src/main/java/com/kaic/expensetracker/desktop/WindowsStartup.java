package com.kaic.expensetracker.desktop;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Paths;
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

    /**
     * The command that starts the packaged program, when this is it running on Windows; empty otherwise. It is the
     * jpackage launcher, or, in the portable package (no .exe of its own), {@code app.startup-command=self}.
     */
    public static Optional<String> launcher() {
        boolean windows = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
        if (!windows || !Boolean.getBoolean("app.window-mode")) {
            return Optional.empty();
        }
        String command = System.getProperty("app.startup-command");
        if ("self".equals(command)) {
            return Optional.of(selfCommand());
        }
        if (command != null && !command.isBlank()) {
            return Optional.of(command);
        }
        return Optional.ofNullable(System.getProperty("jpackage.app-path")).filter(path -> !path.isBlank())
                .map(path -> "\"" + path + "\"");
    }

    /** Portable package: no .exe, so the command is this same JVM started on this same jar, in window mode. */
    private static String selfCommand() {
        String javaw = Paths.get(System.getProperty("java.home"), "bin", "javaw.exe").toString();
        String dataDir = System.getProperty("app.data-dir");
        return "\"" + javaw + "\" -Dapp.window-mode=true -Dfile.encoding=UTF-8"
                + (dataDir == null ? "" : " \"-Dapp.data-dir=" + dataDir + "\"")
                + " -Dapp.startup-command=self -jar \"" + System.getProperty("java.class.path") + "\"";
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
                ? run("add", KEY, "/v", NAME, "/t", "REG_SZ", "/d", launcher, "/f")
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
