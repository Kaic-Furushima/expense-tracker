package com.kaic.expensetracker;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Recebe do app o resumo que os widgets da tela inicial mostram (ver WidgetSupport) e os redesenha. */
@CapacitorPlugin(name = "Widgets")
public class WidgetsPlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("Falta o resumo dos widgets.");
            return;
        }
        WidgetSupport.saveSnapshot(getContext(), json);
        WidgetSupport.refreshAll(getContext());
        call.resolve();
    }
}
