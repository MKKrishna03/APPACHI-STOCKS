package com.appachi.stocks;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Bridges JS window.print() to Android's native PrintManager. The stock
// Capacitor WebView never implements window.print() itself — without this,
// tapping Print inside the app silently does nothing. Uses the bridge's own
// WebView.createPrintDocumentAdapter() so it renders exactly what's on
// screen, respecting the existing @media print CSS.
@CapacitorPlugin(name = "NativePrint")
public class NativePrintPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            WebView webView = (WebView) getBridge().getWebView();
            PrintManager printManager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
            String jobName = "APPACHI-" + System.currentTimeMillis();
            PrintDocumentAdapter printAdapter = webView.createPrintDocumentAdapter(jobName);
            printManager.print(jobName, printAdapter, new PrintAttributes.Builder().build());
            call.resolve();
        });
    }
}
