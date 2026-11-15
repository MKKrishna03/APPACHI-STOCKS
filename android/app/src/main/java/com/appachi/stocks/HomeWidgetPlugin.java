package com.appachi.stocks;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Pages in the app talk to the home-screen widget through this:
//   HomeWidget.setToken({ token, base }) — the widget's own sign-in key (from /api/widget/token)
//   HomeWidget.refresh()                 — redraw it now
@CapacitorPlugin(name = "HomeWidget")
public class HomeWidgetPlugin extends Plugin {
    @PluginMethod
    public void setToken(PluginCall call) {
        String token = call.getString("token");
        String base = call.getString("base");
        android.content.SharedPreferences.Editor e = HomeWidgetProvider.prefs(getContext()).edit();
        if (token != null && token.matches("[a-f0-9]{48}")) e.putString("token", token);
        if (base != null && base.startsWith("https://")) e.putString("base", base);
        e.apply();
        HomeWidgetProvider.refreshAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void refresh(PluginCall call) {
        HomeWidgetProvider.refreshAll(getContext());
        call.resolve();
    }
}
