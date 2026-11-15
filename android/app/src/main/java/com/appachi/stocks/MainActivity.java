package com.appachi.stocks;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppPermissionsPlugin.class);
        registerPlugin(NativePrintPlugin.class);
        registerPlugin(HomeWidgetPlugin.class);
        super.onCreate(savedInstanceState);
        requestNotificationPermission();
        // See SafeBridgeWebViewClient — prevents a native-triggered JS crash
        // on pages outside our own origin (e.g. the Billing app) that never
        // received Capacitor's own bridge object.
        getBridge().setWebViewClient(new SafeBridgeWebViewClient(getBridge()));
        // The web view cannot save downloads (e.g. a new app version): hand them to the phone browser
        getBridge().getWebView().setDownloadListener((url, ua, cd, mime, len) -> {
            try { startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url))); } catch (Exception ignored) {}
        });
        openPathFrom(getIntent());
    }

    // Save the login cookie to disk so the home-screen widget can use it
    @Override
    public void onPause() {
        super.onPause();
        android.webkit.CookieManager.getInstance().flush();
        HomeWidgetProvider.refreshAll(this);
    }

    // The home-screen widget opens the app on a given page (e.g. the To collect list)
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openPathFrom(intent);
    }

    private void openPathFrom(Intent intent) {
        if (intent == null) return;
        String path = intent.getStringExtra("openPath");
        if (path == null || !path.startsWith("/")) return;
        intent.removeExtra("openPath");
        final String url = HomeWidgetProvider.BASE + path;
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(url));
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
            }
        }
    }
}
