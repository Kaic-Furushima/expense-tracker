package com.kaic.expensetracker;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Widgets da tela inicial. Eles nao enxergam o banco (que fica dentro do WebView): o app entrega um resumo pronto, em
 * JSON, que fica guardado aqui e e so desenhado. Com senha no app (e a opcao de mostrar com senha desligada), o resumo
 * chega sem valores nenhuns, so com o aviso: o widget nunca guarda nem mostra dados que a senha deveria proteger.
 */
final class WidgetSupport {

    static final String KIND_BALANCE = "balance";
    static final String KIND_PROGRESS = "progress";
    static final String DEFAULT_BALANCE_KEY = "total";
    static final String DEFAULT_PROGRESS_KEY = "b-total";
    /** Endereco que o botao "+" abre; o app o trata (depois da senha, se houver) e abre "Novo lancamento". */
    static final String NEW_ENTRY_URL = "expensetracker://widget/new";

    private static final String PREFS = "widgets";
    private static final String SNAPSHOT = "snapshot";
    private static final int ADD_REQUEST_OFFSET = 100000;

    private WidgetSupport() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void saveSnapshot(Context context, String json) {
        prefs(context).edit().putString(SNAPSHOT, json).apply();
    }

    /** O ultimo resumo recebido do app, ou null se o app ainda nao enviou nenhum. */
    static JSONObject snapshot(Context context) {
        String json = prefs(context).getString(SNAPSHOT, null);
        if (json == null) return null;
        try {
            return new JSONObject(json);
        } catch (JSONException e) {
            return null;
        }
    }

    static void saveConfig(Context context, int id, String key, boolean button) {
        prefs(context).edit().putString("key_" + id, key).putBoolean("button_" + id, button).apply();
    }

    static void clearConfig(Context context, int id) {
        prefs(context).edit().remove("key_" + id).remove("button_" + id).apply();
    }

    static String kindOf(Context context, int id) {
        android.appwidget.AppWidgetProviderInfo info = AppWidgetManager.getInstance(context).getAppWidgetInfo(id);
        boolean progress = info != null && info.provider.getClassName().endsWith("ProgressWidgetProvider");
        return progress ? KIND_PROGRESS : KIND_BALANCE;
    }

    private static String defaultKey(String kind) {
        return KIND_PROGRESS.equals(kind) ? DEFAULT_PROGRESS_KEY : DEFAULT_BALANCE_KEY;
    }

    private static JSONObject find(JSONArray items, String key) {
        if (items == null) return null;
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item != null && key.equals(item.optString("key"))) return item;
        }
        return null;
    }

    private static String text(JSONObject snapshot, String name, String fallback) {
        JSONObject texts = snapshot == null ? null : snapshot.optJSONObject("texts");
        String value = texts == null ? "" : texts.optString(name, "");
        return value.isEmpty() ? fallback : value;
    }

    /** O que o app listou para este tipo de widget; vazio se o app ainda nao enviou nada. */
    static JSONArray choices(Context context, String kind) {
        JSONObject snapshot = snapshot(context);
        if (snapshot == null) return new JSONArray();
        JSONArray items = snapshot.optJSONArray(KIND_PROGRESS.equals(kind) ? "progress" : "balances");
        return items == null ? new JSONArray() : items;
    }

    static void render(Context context, AppWidgetManager manager, int id) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget);
        JSONObject themed = snapshot(context);
        // segue o tema do app (o enviado no resumo), nao o do aparelho; sem resumo ainda, o do aparelho
        boolean dark = themed != null && themed.has("dark") ? themed.optBoolean("dark")
                : (context.getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES;
        int textColor = Color.parseColor(dark ? "#ECEFF1" : "#1B1F24");
        int mutedColor = Color.parseColor(dark ? "#9AA5AF" : "#5F6B76");
        int negativeColor = Color.parseColor(dark ? "#EF9A9A" : "#C62828");
        views.setInt(R.id.widget_root, "setBackgroundResource", dark ? R.drawable.widget_bg_d : R.drawable.widget_bg);
        for (int view : new int[]{R.id.widget_title, R.id.widget_sub}) views.setTextColor(view, mutedColor);
        views.setTextColor(R.id.widget_message, textColor);
        String kind = kindOf(context, id);
        SharedPreferences prefs = prefs(context);
        String key = prefs.getString("key_" + id, defaultKey(kind));
        boolean button = prefs.getBoolean("button_" + id, false);

        JSONObject snapshot = snapshot(context);
        String message = null;
        JSONObject item = null;
        if (snapshot == null) {
            message = context.getString(R.string.widget_open_app);
            button = false;
        } else {
            item = find(snapshot.optJSONArray(KIND_PROGRESS.equals(kind) ? "progress" : "balances"), key);
            if (item == null) message = text(snapshot, "missing", context.getString(R.string.widget_open_app));
        }

        if (message != null) {
            for (int view : new int[]{R.id.widget_title, R.id.widget_main, R.id.widget_sub, R.id.widget_bar, R.id.widget_bar_d}) {
                views.setViewVisibility(view, View.GONE);
            }
            views.setViewVisibility(R.id.widget_message, View.VISIBLE);
            views.setTextViewText(R.id.widget_message, message);
        } else {
            views.setViewVisibility(R.id.widget_message, View.GONE);
            views.setViewVisibility(R.id.widget_title, View.VISIBLE);
            views.setViewVisibility(R.id.widget_main, View.VISIBLE);
            views.setTextViewText(R.id.widget_title, item.optString("name"));
            views.setTextViewText(R.id.widget_main, item.optString("main"));
            views.setTextColor(R.id.widget_main, item.optBoolean("negative") ? negativeColor : textColor);
            String sub = item.optString("sub");
            views.setViewVisibility(R.id.widget_sub, sub.isEmpty() ? View.GONE : View.VISIBLE);
            views.setTextViewText(R.id.widget_sub, sub);
            int progress = item.optInt("progress", -1);
            int barId = dark ? R.id.widget_bar_d : R.id.widget_bar;
            views.setViewVisibility(R.id.widget_bar, View.GONE);
            views.setViewVisibility(R.id.widget_bar_d, View.GONE);
            if (progress >= 0) {
                views.setViewVisibility(barId, View.VISIBLE);
                views.setProgressBar(barId, 100, progress, false);
            }
        }

        views.setViewVisibility(R.id.widget_add, button ? View.VISIBLE : View.GONE);
        views.setContentDescription(R.id.widget_add, text(snapshot, "add", context.getString(R.string.widget_add_description)));

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open != null) views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, id, open, flags));
        // intent explicito (so este app a recebe): o app guarda o pedido e, passada a senha, abre "Novo lancamento"
        Intent add = new Intent(context, MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse(NEW_ENTRY_URL));
        views.setOnClickPendingIntent(R.id.widget_add, PendingIntent.getActivity(context, ADD_REQUEST_OFFSET + id, add, flags));

        manager.updateAppWidget(id, views);
    }

    /** Redesenha todos os widgets deste app (depois que o app envia um resumo novo). */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (Class<?> provider : new Class<?>[]{BalanceWidgetProvider.class, ProgressWidgetProvider.class}) {
            for (int id : manager.getAppWidgetIds(new ComponentName(context, provider))) render(context, manager, id);
        }
    }
}
