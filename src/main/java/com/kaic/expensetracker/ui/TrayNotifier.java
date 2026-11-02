package com.kaic.expensetracker.ui;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.awt.AWTException;
import java.awt.Image;
import java.awt.MenuItem;
import java.awt.PopupMenu;
import java.awt.SystemTray;
import java.awt.TrayIcon;

/**
 * Ícone na bandeja do sistema usado para mostrar lembretes (contas que vencem, orçamento perto do limite) quando o
 * aplicativo está no modo janela. Fora desse modo (ou sem bandeja) não faz nada.
 */
public final class TrayNotifier {

    private static final Logger log = LoggerFactory.getLogger(TrayNotifier.class);

    private static volatile TrayIcon icon;

    private TrayNotifier() {
    }

    /**
     * Coloca o ícone na bandeja. Clicar nele (ou "Abrir") traz a janela para a frente; "Sair" encerra o programa.
     */
    public static synchronized void install(Image image, Runnable onOpen, Runnable onExit) {
        if (icon != null || image == null || !SystemTray.isSupported()) {
            return;
        }
        try {
            TrayIcon created = new TrayIcon(image, "Expense Tracker");
            created.setImageAutoSize(true);
            PopupMenu menu = new PopupMenu();
            MenuItem open = new MenuItem("Abrir");
            open.addActionListener(e -> onOpen.run());
            MenuItem exit = new MenuItem("Sair");
            exit.addActionListener(e -> onExit.run());
            menu.add(open);
            menu.addSeparator();
            menu.add(exit);
            created.setPopupMenu(menu);
            created.addActionListener(e -> onOpen.run());
            SystemTray.getSystemTray().add(created);
            icon = created;
            Runtime.getRuntime().addShutdownHook(new Thread(TrayNotifier::remove));
        } catch (AWTException | RuntimeException e) {
            log.debug("Bandeja do sistema indisponivel", e);
        }
    }

    public static boolean isInstalled() {
        return icon != null;
    }

    public static void show(String title, String text) {
        TrayIcon current = icon;
        if (current != null) {
            current.displayMessage(title, text, TrayIcon.MessageType.INFO);
        }
    }

    public static synchronized void remove() {
        TrayIcon current = icon;
        if (current != null) {
            SystemTray.getSystemTray().remove(current);
            icon = null;
        }
    }
}
