package com.kaic.expensetracker;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Pasta de backups escolhida pela pessoa (Storage Access Framework): o seletor de pastas do Android devolve uma
 * permissao que fica valendo depois de fechar o app, e os arquivos gravados la ficam fora do app (sobrevivem a
 * desinstalacao). Cada chamada recebe o endereco da pasta guardado pelo front-end.
 */
@CapacitorPlugin(name = "BackupFolder")
public class BackupFolderPlugin extends Plugin {

    private static final int FLAGS = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION;

    private ContentResolver resolver() {
        return getContext().getContentResolver();
    }

    private static Uri parentOf(Uri tree) {
        return DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    }

    /** Abre o seletor de pastas do sistema. Resolve {uri, name}, ou {uri: null} se a pessoa cancelar. */
    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(FLAGS);
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject out = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            out.put("uri", JSObject.NULL);
            call.resolve(out);
            return;
        }
        Uri tree = data.getData();
        try {
            resolver().takePersistableUriPermission(tree,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (RuntimeException e) {
            call.reject("Não foi possível guardar a permissão para esta pasta.");
            return;
        }
        out.put("uri", tree.toString());
        out.put("name", nameOf(tree));
        call.resolve(out);
    }

    private String nameOf(Uri tree) {
        try (Cursor c = resolver().query(parentOf(tree), new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (RuntimeException e) {
            // cai no nome padrao abaixo
        }
        return "Pasta escolhida";
    }

    /** Grava (ou substitui) um arquivo de texto na pasta. */
    @PluginMethod
    public void write(PluginCall call) {
        String uri = call.getString("uri");
        String name = call.getString("name");
        String text = call.getString("text");
        if (uri == null || name == null || text == null) {
            call.reject("Dados incompletos.");
            return;
        }
        try {
            Uri tree = Uri.parse(uri);
            Uri existing = find(tree, name);
            Uri target = existing != null ? existing
                : DocumentsContract.createDocument(resolver(), parentOf(tree), "application/json", name);
            if (target == null) throw new IllegalStateException("O Android recusou criar o arquivo.");
            try (OutputStream out = resolver().openOutputStream(target, "wt")) {
                if (out == null) throw new IllegalStateException("Não foi possível abrir o arquivo para gravar.");
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(message(e));
        }
    }

    /** Nomes dos arquivos que estao na pasta. */
    @PluginMethod
    public void list(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null) {
            call.reject("Dados incompletos.");
            return;
        }
        try {
            Uri tree = Uri.parse(uri);
            JSArray names = new JSArray();
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            try (Cursor c = resolver().query(children, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                while (c != null && c.moveToNext()) names.put(c.getString(0));
            }
            JSObject out = new JSObject();
            out.put("names", names);
            call.resolve(out);
        } catch (Exception e) {
            call.reject(message(e));
        }
    }

    /** Apaga um arquivo da pasta (so os que o app criou; quem chama escolhe o nome). */
    @PluginMethod
    public void remove(PluginCall call) {
        String uri = call.getString("uri");
        String name = call.getString("name");
        if (uri == null || name == null) {
            call.reject("Dados incompletos.");
            return;
        }
        try {
            Uri file = find(Uri.parse(uri), name);
            if (file != null) DocumentsContract.deleteDocument(resolver(), file);
            call.resolve();
        } catch (Exception e) {
            call.reject(message(e));
        }
    }

    /** Solta a permissao da pasta (os arquivos ja gravados continuam la). */
    @PluginMethod
    public void release(PluginCall call) {
        String uri = call.getString("uri");
        if (uri != null) {
            try {
                resolver().releasePersistableUriPermission(Uri.parse(uri),
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (RuntimeException e) {
                // ja nao estava valendo
            }
        }
        call.resolve();
    }

    private Uri find(Uri tree, String name) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        String[] columns = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME};
        try (Cursor c = resolver().query(children, columns, null, null, null)) {
            while (c != null && c.moveToNext()) {
                if (name.equals(c.getString(1))) return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
            }
        }
        return null;
    }

    private static String message(Exception e) {
        if (e instanceof SecurityException) return "Sem permissão para esta pasta. Escolha a pasta de novo.";
        return e.getMessage() != null ? e.getMessage() : e.toString();
    }
}
