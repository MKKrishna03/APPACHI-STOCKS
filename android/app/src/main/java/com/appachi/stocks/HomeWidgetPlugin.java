package com.appachi.stocks;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Lets any page in the app refresh the home-screen widget: Capacitor.Plugins.HomeWidget.refresh()
@CapacitorPlugin(name = "HomeWidget")
public class HomeWidgetPlugin extends Plugin {
    @PluginMethod
    public void refresh(PluginCall call) {
        HomeWidgetProvider.refreshAll(getContext());
        call.resolve();
    }
}
