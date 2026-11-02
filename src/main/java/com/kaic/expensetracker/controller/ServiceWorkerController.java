package com.kaic.expensetracker.controller;

import org.springframework.core.io.ClassPathResource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Serves {@code sw.js} with a cache name taken from the content of the app shell (the files listed in its
 * {@code SHELL} array). Whenever one of those files changes, the cache name changes too, so the browser installs the
 * new shell and drops the old one; nothing has to be bumped by hand.
 */
@RestController
public class ServiceWorkerController {

    private static final String TEMPLATE = "static/sw.js";
    private static final String VERSION_MARK = "__VERSION__";
    private static final Pattern SHELL_LIST = Pattern.compile("const SHELL = \\[(.*?)];", Pattern.DOTALL);
    private static final Pattern SHELL_PATH = Pattern.compile("'(/[^']*)'");

    private final String script;

    public ServiceWorkerController() {
        this.script = render();
    }

    @GetMapping(value = "/sw.js")
    public ResponseEntity<String> serviceWorker() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .contentType(MediaType.parseMediaType("text/javascript;charset=UTF-8"))
                .body(script);
    }

    private static String render() {
        try {
            String template = new ClassPathResource(TEMPLATE).getContentAsString(StandardCharsets.UTF_8);
            Matcher list = SHELL_LIST.matcher(template);
            if (!list.find()) {
                throw new IllegalStateException("sw.js sem a lista SHELL");
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            Matcher path = SHELL_PATH.matcher(list.group(1));
            while (path.find()) {
                digest.update(read(path.group(1)));
            }
            String version = HexFormat.of().formatHex(digest.digest()).substring(0, 12);
            return template.replace(VERSION_MARK, version);
        } catch (IOException | NoSuchAlgorithmException e) {
            throw new IllegalStateException("Não foi possível preparar o sw.js", e);
        }
    }

    /** "/" is the page itself; every other path is a file under static/. */
    private static byte[] read(String path) throws IOException {
        String file = path.equals("/") ? "static/index.html" : "static" + path;
        try {
            return new ClassPathResource(file).getContentAsByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException("Arquivo da casca do app não encontrado: " + path, e);
        }
    }
}
