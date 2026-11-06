package com.kaic.expensetracker;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

/** Aberta ao adicionar um widget: o que ele mostra (saldo total/conta, orçamento/caixinha) e se tem o botão "+". */
public class WidgetConfigActivity extends Activity {

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setResult(RESULT_CANCELED);
        final int widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }
        final String kind = WidgetSupport.kindOf(this, widgetId);
        final boolean progress = WidgetSupport.KIND_PROGRESS.equals(kind);

        JSONArray choices = WidgetSupport.choices(this, kind);
        final String[] keys = new String[Math.max(1, choices.length())];
        String[] labels = new String[keys.length];
        if (choices.length() == 0) { // o app ainda nao enviou nada (ou esta bloqueado por senha): so o padrao
            keys[0] = progress ? WidgetSupport.DEFAULT_PROGRESS_KEY : WidgetSupport.DEFAULT_BALANCE_KEY;
            labels[0] = getString(progress ? R.string.widget_default_progress : R.string.widget_default_balance);
        }
        for (int i = 0; i < choices.length(); i++) {
            JSONObject item = choices.optJSONObject(i);
            keys[i] = item == null ? "" : item.optString("key");
            labels[i] = item == null ? "" : item.optString("choice");
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(16), dp(20), dp(12));

        TextView title = new TextView(this);
        title.setText(progress ? R.string.widget_config_choose_progress : R.string.widget_config_choose_balance);
        title.setTextSize(18);
        title.setPadding(0, 0, 0, dp(8));
        root.addView(title);

        if (choices.length() == 0) {
            TextView waiting = new TextView(this);
            waiting.setText(R.string.widget_config_waiting);
            waiting.setPadding(0, 0, 0, dp(8));
            root.addView(waiting);
        }

        final RadioGroup group = new RadioGroup(this);
        for (int i = 0; i < keys.length; i++) {
            RadioButton radio = new RadioButton(this);
            radio.setId(i + 1);
            radio.setText(labels[i]);
            group.addView(radio);
        }
        group.check(1);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(group);
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        final CheckBox button = new CheckBox(this);
        button.setText(R.string.widget_config_button);
        root.addView(button);

        Button done = new Button(this);
        done.setText(R.string.widget_config_done);
        done.setOnClickListener(v -> {
            int index = Math.max(0, group.getCheckedRadioButtonId() - 1);
            WidgetSupport.saveConfig(this, widgetId, keys[index], button.isChecked());
            WidgetSupport.render(this, AppWidgetManager.getInstance(this), widgetId);
            setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
            finish();
        });
        root.addView(done);

        setContentView(root);
    }
}
