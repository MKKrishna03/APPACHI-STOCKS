package com.appachi.stocks;

import android.graphics.Bitmap;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Capacitor's native side fires lifecycle events (keyboard show/hide, app
 * resume, etc.) by calling window.Capacitor.triggerEvent(...) via
 * evaluateJavascript on whatever page currently happens to be loaded in the
 * WebView (see Bridge.java's eval()/triggerJSEvent() — it has no check for
 * which origin is active). window.Capacitor is only ever set up for the
 * app's own configured origin (appachi-stocks.onrender.com); when the user
 * navigates in-place to a different allow-listed origin (e.g. the Billing
 * app), that page never gets the real bridge, so the very next lifecycle
 * event (typically a keyboard-show fired by focusing a form control) throws
 * "Cannot read properties of undefined (reading 'triggerEvent')" and can
 * leave the page's JS in a broken state — visible as a blank white screen.
 *
 * This has nothing to do with the destination page's own code; it's
 * Capacitor calling into a page that was never given the bridge object.
 * Injecting a harmless stub as early as onPageStarted (same hook the base
 * class already uses to reset the bridge) means that call always finds
 * *something* to call, instead of crashing.
 */
public class SafeBridgeWebViewClient extends BridgeWebViewClient {

    private static final String SHIM =
        "(function(){" +
        "if(!window.Capacitor){window.Capacitor={};}" +
        "if(typeof window.Capacitor.triggerEvent!=='function'){window.Capacitor.triggerEvent=function(){};}" +
        "})();";

    public SafeBridgeWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        super.onPageStarted(view, url, favicon);
        view.evaluateJavascript(SHIM, null);
    }
}
