package com.kaic.expensetracker.ui;

import javafx.application.Platform;
import javafx.concurrent.Worker;
import javafx.embed.swing.JFXPanel;
import javafx.scene.Scene;
import javafx.scene.web.WebEngine;
import javafx.scene.web.WebView;
import netscape.javascript.JSObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.imageio.ImageIO;
import javax.swing.*;
import java.awt.*;
import java.awt.event.ComponentAdapter;
import java.awt.event.ComponentEvent;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicBoolean;

/** Janela propria com o WebView do JavaFX apontando para o servidor local. */
public final class WebViewWindow {

    private static final Logger log = LoggerFactory.getLogger(WebViewWindow.class);

    private static volatile JFrame frame;

    private WebViewWindow() {
    }

    /** The window's engine, and the action that shows the page in it. Set by the JavaFX thread, read under the lock. */
    private static WebEngine engine;
    private static Runnable pending;
    /** The theme the page uses (remembered), and the state file of this window. */
    private static volatile boolean darkTheme;
    private static volatile WindowState currentState;

    /**
     * Abre a janela na hora, com uma tela de carregamento do proprio app. A pagina do programa aparece quando
     * {@link #navigate} for chamado (o servidor estando de pe). {@code onClose} roda quando o usuario encerra o programa.
     * {@code windowFile} guarda o tamanho e a posicao da janela entre as aberturas. Com o icone na bandeja, fechar a
     * janela so a esconde: o programa segue rodando (os lembretes continuam) e a bandeja tem "Abrir" e "Sair".
     */
    public static void open(String title, Runnable onClose, Path windowFile) {
        SwingUtilities.invokeLater(() -> {
            try {
                UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName());
            } catch (Exception e) {
                log.debug("Look and feel do sistema indisponivel", e);
            }
            JFrame window = new JFrame(title);
            frame = window;
            WindowState state = new WindowState(windowFile);
            currentState = state;
            darkTheme = state.dark();
            window.setDefaultCloseOperation(WindowConstants.DO_NOTHING_ON_CLOSE);
            window.addWindowListener(new WindowAdapter() {
                @Override
                public void windowOpened(WindowEvent e) {
                    // the native window exists now: the title bar can take the remembered theme
                    WindowChrome.setDark(window, darkTheme);
                }

                @Override
                public void windowClosing(WindowEvent e) {
                    if (TrayNotifier.isInstalled()) {
                        state.save();
                        window.setVisible(false);
                        return;
                    }
                    close(window, state, onClose);
                }
            });
            window.addComponentListener(new ComponentAdapter() {
                @Override
                public void componentMoved(ComponentEvent e) {
                    remember(window, state);
                }

                @Override
                public void componentResized(ComponentEvent e) {
                    remember(window, state);
                }
            });
            loadIcon().ifPresent(image -> {
                window.setIconImage(image);
                TrayNotifier.install(image, WebViewWindow::bringToFront, () -> close(window, state, onClose));
            });

            JFXPanel panel = new JFXPanel();
            window.add(panel);
            placeWindow(window, state);
            window.setVisible(true);
            WindowChrome.setDark(window, darkTheme);

            // the profile in use is remembered in a cookie, which the embedded WebView only keeps with a cookie manager
            if (java.net.CookieHandler.getDefault() == null) {
                java.net.CookieHandler.setDefault(new java.net.CookieManager());
            }
            Platform.setImplicitExit(false);
            Platform.runLater(() -> {
                WebView view = new WebView();
                WebEngine web = view.getEngine();
                // Embedded WebViews ignore alert/confirm unless the host answers them.
                web.setOnAlert(event -> runOnSwing(() ->
                        JOptionPane.showMessageDialog(window, event.getData(), title, JOptionPane.INFORMATION_MESSAGE)));
                web.setConfirmHandler(message -> {
                    AtomicBoolean answer = new AtomicBoolean();
                    runOnSwing(() -> answer.set(JOptionPane.showConfirmDialog(window, message, title,
                            JOptionPane.OK_CANCEL_OPTION, JOptionPane.QUESTION_MESSAGE) == JOptionPane.OK_OPTION));
                    return answer.get();
                });
                web.getLoadWorker().stateProperty().addListener((obs, old, loadState) -> {
                    if (loadState == Worker.State.SUCCEEDED) {
                        ((JSObject) web.executeScript("window")).setMember("desktop", DESKTOP_BRIDGE);
                        Object theme = web.executeScript("document.documentElement.dataset.theme");
                        if (theme == null) {
                            // the loading screen: the title bar takes the remembered theme now that the window exists
                            WindowChrome.setDark(window, darkTheme);
                        } else {
                            // The window remembers the theme the user chose, and the page follows it: the page's own storage
                            // may not be ready when its scripts start, so the page can start in the wrong theme.
                            if ("dark".equals(theme) != darkTheme) {
                                web.executeScript("applyTheme(" + darkTheme + " ? 'dark' : 'light')");
                            }
                            WindowChrome.setDark(window, darkTheme);
                        }
                    }
                });
                Runnable first;
                synchronized (WebViewWindow.class) {
                    engine = web;
                    first = pending != null ? pending : () -> web.loadContent(loadingPage(darkTheme));
                }
                first.run();
                panel.setScene(new Scene(view));
            });
        });
    }

    /** Remembers the theme the page uses (for the next loading screen) and darkens the title bar to match. */
    static void applyTheme(boolean dark) {
        darkTheme = dark;
        WindowState state = currentState;
        if (state != null) {
            state.rememberDark(dark);
            state.save();
        }
        SwingUtilities.invokeLater(() -> WindowChrome.setDark(frame, dark));
    }

    /** Shows the program's page. If the window is not ready yet, the page is shown as soon as it is. */
    public static void navigate(String url) {
        show(() -> engine.load(url));
    }

    /** Shows an error in the window, for when the program could not start. */
    public static void showError(String message) {
        show(() -> engine.loadContent(page("<div><strong>Pocketful</strong><p>" + escape(message) + "</p></div>", darkTheme)));
    }

    private static void show(Runnable action) {
        boolean ready;
        synchronized (WebViewWindow.class) {
            pending = action;
            ready = engine != null;
        }
        if (ready) {
            Platform.runLater(action);
        }
    }

    /**
     * The page the window shows before the program's page, and error pages. The colours come from the theme the window
     * remembers, not from the system setting: the WebView does not follow the system's dark mode.
     */
    private static String page(String inner, boolean dark) {
        String background = dark ? "#0e1113" : "#f4f6f8";
        String text = dark ? "#eceff3" : "#1b1e24";
        String accent = dark ? "#5fc4ad" : "#2f7d6d";
        String css = "html, body { margin: 0; height: 100%; overflow: hidden; background: " + background + "; color: " + text + ";"
                + " font-family: Inter, system-ui, 'Segoe UI', Roboto, sans-serif; }"
                + ".wrap { height: 100%; display: grid; place-items: center; align-content: center; gap: 18px; text-align: center; }"
                + ".wrap p { margin: 4px 0 0; opacity: .7; }"
                + ".spin { width: 44px; height: 44px; margin: 0 auto; border-radius: 50%; border: 4px solid rgba(127, 127, 127, .25);"
                + " border-top-color: " + accent + "; animation: spin .9s linear infinite; }"
                + "@keyframes spin { to { transform: rotate(360deg); } }";
        return "<!doctype html><html><head><meta charset=\"utf-8\"><title>Pocketful</title><style>" + css
                + "</style></head><body><div class=\"wrap\">" + inner + "</div></body></html>";
    }

    private static String loadingPage(boolean dark) {
        return page("<div class=\"spin\"></div><div><strong>Pocketful</strong><p>Carregando…</p></div>", dark);
    }

    private static String escape(String text) {
        return String.valueOf(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    /** Encerra o programa de vez: guarda a janela, tira o icone da bandeja e para o servidor. */
    private static void close(JFrame window, WindowState state, Runnable onClose) {
        state.save();
        TrayNotifier.remove();
        window.dispose();
        Platform.exit();
        onClose.run();
    }

    private static void remember(JFrame window, WindowState state) {
        if (window.isVisible() && window.getExtendedState() == Frame.NORMAL) {
            state.remember(window.getBounds());
        }
    }

    /** Restores the last size and position when that spot is still on a screen; otherwise the default, centred. */
    private static void placeWindow(JFrame window, WindowState state) {
        Rectangle saved = state.bounds();
        if (saved != null && onScreen(saved)) {
            window.setBounds(saved);
        } else {
            window.setSize(1200, 800);
            window.setLocationRelativeTo(null);
        }
    }

    private static boolean onScreen(Rectangle area) {
        for (GraphicsDevice device : GraphicsEnvironment.getLocalGraphicsEnvironment().getScreenDevices()) {
            if (device.getDefaultConfiguration().getBounds().intersects(area)) {
                return true;
            }
        }
        return false;
    }

    /** Traz a janela existente para a frente (usado quando o programa e aberto uma segunda vez). */
    public static void bringToFront() {
        SwingUtilities.invokeLater(() -> {
            JFrame window = frame;
            if (window == null) {
                return;
            }
            window.setVisible(true); // back from the tray, if it was hidden there
            window.setExtendedState(window.getExtendedState() & ~Frame.ICONIFIED);
            window.toFront();
            window.requestFocus();
        });
    }

    private static void runOnSwing(Runnable action) {
        try {
            if (SwingUtilities.isEventDispatchThread()) {
                action.run();
            } else {
                SwingUtilities.invokeAndWait(action);
            }
        } catch (Exception e) {
            log.warn("Falha ao exibir dialogo", e);
        }
    }

    private static java.util.Optional<Image> loadIcon() {
        try (InputStream in = WebViewWindow.class.getResourceAsStream("/icons/app.png")) {
            return in == null ? java.util.Optional.empty() : java.util.Optional.of(ImageIO.read(in));
        } catch (IOException e) {
            return java.util.Optional.empty();
        }
    }

    /** Funcoes nativas oferecidas ao JavaScript da pagina como {@code window.desktop}. */
    private static final Bridge DESKTOP_BRIDGE = new Bridge();

    public static final class Bridge {

        /** The page asks for a dark title bar when the dark theme is on (Windows draws the bar itself). */
        public void setDarkTitleBar(boolean dark) {
            applyTheme(dark);
        }

        /** Pergunta onde salvar e grava o arquivo (UTF-8 com BOM, para o Excel). Devolve true se salvou. */
        public boolean saveFile(String suggestedName, String content) {
            boolean[] saved = {false};
            runOnSwing(() -> {
                JFileChooser chooser = new JFileChooser();
                chooser.setDialogTitle("Salvar arquivo");
                chooser.setSelectedFile(new File(chooser.getCurrentDirectory(), suggestedName));
                if (chooser.showSaveDialog(frame) != JFileChooser.APPROVE_OPTION) {
                    return;
                }
                try {
                    Files.writeString(chooser.getSelectedFile().toPath(), "﻿" + content, StandardCharsets.UTF_8);
                    saved[0] = true;
                } catch (IOException e) {
                    log.warn("Nao foi possivel salvar {}", chooser.getSelectedFile(), e);
                    JOptionPane.showMessageDialog(frame, "Não foi possível salvar o arquivo:\n" + e.getMessage(),
                            "Erro", JOptionPane.ERROR_MESSAGE);
                }
            });
            return saved[0];
        }

        /** Pergunta onde salvar e grava bytes (recebidos em base64: PDF, planilha, anexo). Devolve true se salvou. */
        public boolean saveBytes(String suggestedName, String base64) {
            boolean[] saved = {false};
            runOnSwing(() -> {
                JFileChooser chooser = new JFileChooser();
                chooser.setDialogTitle("Salvar arquivo");
                chooser.setSelectedFile(new File(chooser.getCurrentDirectory(), suggestedName));
                if (chooser.showSaveDialog(frame) != JFileChooser.APPROVE_OPTION) {
                    return;
                }
                try {
                    Files.write(chooser.getSelectedFile().toPath(), java.util.Base64.getDecoder().decode(base64));
                    saved[0] = true;
                } catch (IOException | IllegalArgumentException e) {
                    log.warn("Nao foi possivel salvar {}", chooser.getSelectedFile(), e);
                    JOptionPane.showMessageDialog(frame, "Não foi possível salvar o arquivo:\n" + e.getMessage(),
                            "Erro", JOptionPane.ERROR_MESSAGE);
                }
            });
            return saved[0];
        }

        /**
         * Pergunta qual foto ou PDF anexar. Devolve {@code {"name": "...", "data": "<base64>"}} ou null se o
         * usuário cancelar (ou o arquivo passar de 20 MB).
         */
        public String openAttachment() {
            String[] result = {null};
            runOnSwing(() -> {
                JFileChooser chooser = new JFileChooser();
                chooser.setDialogTitle("Escolher foto ou PDF");
                chooser.setFileFilter(new javax.swing.filechooser.FileNameExtensionFilter(
                        "Imagens e PDF", "jpg", "jpeg", "png", "gif", "webp", "pdf"));
                if (chooser.showOpenDialog(frame) != JFileChooser.APPROVE_OPTION) {
                    return;
                }
                try {
                    File file = chooser.getSelectedFile();
                    if (file.length() > 20L * 1024 * 1024) {
                        JOptionPane.showMessageDialog(frame, "O arquivo é grande demais (máximo de 20 MB).",
                                "Anexo", JOptionPane.WARNING_MESSAGE);
                        return;
                    }
                    String data = java.util.Base64.getEncoder().encodeToString(Files.readAllBytes(file.toPath()));
                    String name = file.getName().replace("\\", "\\\\").replace("\"", "\\\"");
                    result[0] = "{\"name\":\"" + name + "\",\"data\":\"" + data + "\"}";
                } catch (IOException e) {
                    log.warn("Nao foi possivel abrir {}", chooser.getSelectedFile(), e);
                    JOptionPane.showMessageDialog(frame, "Não foi possível abrir o arquivo:\n" + e.getMessage(),
                            "Erro", JOptionPane.ERROR_MESSAGE);
                }
            });
            return result[0];
        }

        /** Pergunta qual arquivo de texto abrir e devolve o conteúdo (UTF-8), ou null se o usuário cancelar. */
        public String openFile() {
            String[] content = {null};
            runOnSwing(() -> {
                JFileChooser chooser = new JFileChooser();
                chooser.setDialogTitle("Abrir arquivo");
                if (chooser.showOpenDialog(frame) != JFileChooser.APPROVE_OPTION) {
                    return;
                }
                try {
                    byte[] bytes = Files.readAllBytes(chooser.getSelectedFile().toPath());
                    try {
                        content[0] = StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString();
                    } catch (java.nio.charset.CharacterCodingException notUtf8) {
                        // bank files are often Windows-1252 / ISO-8859-1
                        content[0] = new String(bytes, java.nio.charset.Charset.forName("windows-1252"));
                    }
                } catch (IOException e) {
                    log.warn("Nao foi possivel abrir {}", chooser.getSelectedFile(), e);
                    JOptionPane.showMessageDialog(frame, "Não foi possível abrir o arquivo:\n" + e.getMessage(),
                            "Erro", JOptionPane.ERROR_MESSAGE);
                }
            });
            return content[0];
        }
    }
}
