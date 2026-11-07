package com.kaic.expensetracker;

import com.kaic.expensetracker.ui.WebViewWindow;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.awt.*;
import java.io.File;
import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Clock;
import java.time.ZoneId;
import java.util.List;

@SpringBootApplication
@EnableScheduling
public class ExpenseTrackerApplication {

    private static final Logger log = LoggerFactory.getLogger(ExpenseTrackerApplication.class);

    /** The started application; null while it starts. */
    private static volatile ConfigurableApplicationContext running;

    /** Porta preferida do servidor no modo janela e porta de controle da instancia unica. */
    private static final int WINDOW_PORT = 18080;
    private static final int CONTROL_PORT = 47821;

    private final Environment env;
    private final ConfigurableApplicationContext applicationContext;

    public ExpenseTrackerApplication(Environment env, ConfigurableApplicationContext applicationContext) {
        this.env = env;
        this.applicationContext = applicationContext;
    }

    /** What "today" means for the app: this computer's zone, unless {@code app.zone} names another (e.g. America/Sao_Paulo). */
    @Bean
    public Clock clock(@Value("${app.zone:}") String zone) {
        return zone.isBlank() ? Clock.systemDefaultZone() : Clock.system(ZoneId.of(zone));
    }

    public static void main(String[] args) {
        // AWT precisa estar habilitado para abrir o navegador/janela
        System.setProperty("java.awt.headless", System.getProperty("java.awt.headless", "false"));

        if (!configureWindowMode()) {
            return;
        }

        boolean windowMode = Boolean.getBoolean("app.window-mode");
        boolean webView = windowMode && !"edge".equalsIgnoreCase(System.getProperty("app.window-engine", "webview"));
        if (windowMode) {
            // The packaged program has no console: an error in the window's thread would otherwise vanish. Keep it in app.log.
            Thread.setDefaultUncaughtExceptionHandler((thread, error) ->
                    log.error("Erro nao tratado na thread {}", thread.getName(), error));
        }
        if (webView) {
            // The window opens at once with its own loading screen; the page is shown when the server is ready.
            WebViewWindow.open("Pocketful", ExpenseTrackerApplication::exitProgram,
                    Paths.get(System.getProperty("app.data-dir", "./data")).toAbsolutePath().resolve("window.properties"));
        }
        try {
            running = new SpringApplicationBuilder(ExpenseTrackerApplication.class)
                    .headless(Boolean.parseBoolean(System.getProperty("java.awt.headless", "false")))
                    .run(args);
        } catch (RuntimeException e) {
            if (webView) {
                WebViewWindow.showError("Não foi possível abrir o Pocketful. Veja o arquivo app.log na pasta de dados.");
            }
            throw e;
        }
    }

    /** Ends the program, after the window was closed for good. */
    private static void exitProgram() {
        ConfigurableApplicationContext context = running;
        System.exit(context == null ? 0 : SpringApplication.exit(context));
    }

    /**
     * Modo janela ({@code app.window-mode=true}, usado pelo executavel gerado com jpackage): porta livre,
     * escuta so em localhost, instancia unica, log em arquivo e, quando empacotado, dados em %APPDATA%.
     *
     * @return false quando outra instancia ja esta aberta (ela e trazida para a frente) e este processo deve sair
     */
    private static boolean configureWindowMode() {
        if (!Boolean.getBoolean("app.window-mode")) {
            return true;
        }
        if (!acquireSingleInstance()) {
            return false;
        }
        System.setProperty("app.open-browser", "false");
        // Porta propria e estavel: o localStorage da janela (tema, aba) e separado por endereco, inclusive a porta.
        if (System.getProperty("server.port") == null) {
            System.setProperty("server.port", String.valueOf(freePort(WINDOW_PORT)));
        }
        if (System.getProperty("server.address") == null) {
            System.setProperty("server.address", "127.0.0.1");
        }
        if (System.getProperty("app.data-dir") == null && System.getProperty("jpackage.app-path") != null) {
            String appData = System.getenv("APPDATA");
            Path base = appData != null ? Paths.get(appData) : Paths.get(System.getProperty("user.home"));
            System.setProperty("app.data-dir", base.resolve("ExpenseTracker").toString());
        }
        if (System.getProperty("logging.file.name") == null) {
            Path dataDir = Paths.get(System.getProperty("app.data-dir", "./data"));
            System.setProperty("logging.file.name", dataDir.resolve("app.log").toString());
        }
        return true;
    }

    /** Trava de instancia unica: a primeira escuta numa porta local; as seguintes so pedem que ela mostre a janela. */
    private static boolean acquireSingleInstance() {
        try {
            ServerSocket control = new ServerSocket(CONTROL_PORT, 5, InetAddress.getLoopbackAddress());
            Thread listener = new Thread(() -> {
                while (!control.isClosed()) {
                    try (Socket ignored = control.accept()) {
                        WebViewWindow.bringToFront();
                    } catch (IOException e) {
                        break;
                    }
                }
            }, "single-instance");
            listener.setDaemon(true);
            listener.start();
            return true;
        } catch (IOException busy) {
            try (Socket ignored = new Socket(InetAddress.getLoopbackAddress(), CONTROL_PORT)) {
                return false;
            } catch (IOException notAnInstance) {
                return true; // a porta esta ocupada por outro programa; segue normalmente
            }
        }
    }

    private static int freePort(int preferred) {
        for (int port = preferred; port < preferred + 50; port++) {
            try (ServerSocket socket = new ServerSocket(port)) {
                return port;
            } catch (Exception ignored) {
                // porta ocupada, tenta a proxima
            }
        }
        return 0;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        String port = env.getProperty("local.server.port", env.getProperty("server.port", "8080"));
        String bind = env.getProperty("server.address", "127.0.0.1");
        if (bind.equals("127.0.0.1") || bind.equals("localhost") || bind.equals("::1")) {
            log.info("Pocketful disponível em http://localhost:{}/ (somente neste computador; para o celular, use run.bat celular)", port);
        } else {
            log.info("Pocketful disponível em http://localhost:{}/ e na rede local em http://{}:{}/",
                    port, localAddress(), port);
        }

        if (Boolean.parseBoolean(env.getProperty("app.window-mode", "false"))) {
            openWindow();
        } else if (Boolean.parseBoolean(env.getProperty("app.open-browser", "false"))) {
            openBrowser();
        }
    }

    /**
     * Janela propria: com o WebView (padrao) ela ja esta aberta, com a tela de carregamento, e aqui so recebe o endereco
     * do programa. Com o Edge/Chrome ("app.window-engine=edge") abre a janela dele agora.
     */
    private void openWindow() {
        if (!"edge".equalsIgnoreCase(env.getProperty("app.window-engine", "webview"))) {
            String port = env.getProperty("local.server.port", env.getProperty("server.port", "8080"));
            WebViewWindow.navigate("http://localhost:" + port + "/");
            return;
        }
        openAppWindow();
    }

    /**
     * Abre o Edge/Chrome em "modo app" (janela propria, sem abas nem barra de endereco) com um perfil
     * dedicado; ao fechar a janela o processo termina e a aplicacao encerra junto.
     */
    private void openAppWindow() {
        String port = env.getProperty("local.server.port", env.getProperty("server.port", "8080"));
        String url = "http://localhost:" + port + "/";
        String browser = findAppBrowser();
        if (browser == null) {
            log.warn("Edge/Chrome nao encontrado; abrindo no navegador padrao");
            openBrowser();
            return;
        }
        try {
            Path profile = Paths.get(env.getProperty("app.data-dir", "./data")).toAbsolutePath().resolve("browser-profile");
            Files.createDirectories(profile);
            Process process = new ProcessBuilder(browser, "--app=" + url, "--user-data-dir=" + profile,
                    "--no-first-run", "--window-size=1200,800").start();
            Thread watcher = new Thread(() -> {
                try {
                    process.waitFor();
                } catch (InterruptedException e) {
                    return;
                }
                log.info("Janela fechada; encerrando");
                System.exit(SpringApplication.exit(applicationContext));
            }, "app-window-watcher");
            watcher.setDaemon(true);
            watcher.start();
        } catch (Exception e) {
            log.warn("Falha ao abrir janela do app; abrindo no navegador padrao", e);
            openBrowser();
        }
    }

    private static String findAppBrowser() {
        List<String> candidates = List.of(
                "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
                "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
                "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
                "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");
        return candidates.stream().filter(path -> new File(path).isFile()).findFirst().orElse(null);
    }

    private static String localAddress() {
        try {
            return InetAddress.getLocalHost().getHostAddress();
        } catch (Exception e) {
            return "<ip-do-computador>";
        }
    }

    private void openBrowser() {
        String port = env.getProperty("server.port", "8080");
        String contextPath = env.getProperty("server.servlet.context-path", "");
        String effectiveContext = (contextPath == null || contextPath.isBlank()) ? "" : contextPath;
        String url = "http://localhost:" + port + effectiveContext + "/";

        try {
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                Desktop.getDesktop().browse(new URI(url));
                log.info("Opened default browser to {}", url);
                return;
            }

            String os = System.getProperty("os.name").toLowerCase();
            Runtime rt = Runtime.getRuntime();
            if (os.contains("win")) {
                rt.exec(new String[]{"cmd", "/c", "start", "", url});
            } else if (os.contains("mac")) {
                rt.exec(new String[]{"open", url});
            } else {
                rt.exec(new String[]{"xdg-open", url});
            }
            log.info("Tried opening browser to {} using platform fallback", url);
        } catch (Exception e) {
            log.warn("Failed to open browser to {}", url, e);
        }
    }
}
