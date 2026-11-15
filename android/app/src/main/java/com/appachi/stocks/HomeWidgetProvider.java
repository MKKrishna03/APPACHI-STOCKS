package com.appachi.stocks;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.webkit.CookieManager;
import android.widget.RemoteViews;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// Home-screen widget. It is only a viewer: the website (/api/widget) decides the title, the rows,
// what each row's button does and which page a tap opens — so the list can change without a new
// app. Uses the app's own login cookie. Today it lists open issue vouchers to collect.
public class HomeWidgetProvider extends AppWidgetProvider {
    static final String BASE = "https://appachi-stocks.onrender.com";
    static final String ACTION_POST = "com.appachi.stocks.WIDGET_POST";
    static final String ACTION_REFRESH = "com.appachi.stocks.WIDGET_REFRESH";
    static final String EXTRA_POST = "post";
    static final String EXTRA_BODY = "body";
    static final String PREFS = "home_widget";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx, id));
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.w_list);
    }

    static RemoteViews build(Context ctx, int widgetId) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_home);
        v.setTextViewText(R.id.w_title, p.getString("title", "APPACHI"));
        v.setTextViewText(R.id.w_empty, p.getString("empty", "Loading…"));

        Intent svc = new Intent(ctx, HomeWidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(R.id.w_list, svc);
        v.setEmptyView(R.id.w_list, R.id.w_empty);

        int imm = PendingIntent.FLAG_IMMUTABLE;
        int mut = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;

        // title / empty text → open the page the website named
        Intent open = new Intent(ctx, MainActivity.class);
        open.putExtra("openPath", p.getString("open", "/home.html"));
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(ctx, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | imm);
        v.setOnClickPendingIntent(R.id.w_title, openPi);
        v.setOnClickPendingIntent(R.id.w_empty, openPi);

        Intent ref = new Intent(ctx, HomeWidgetProvider.class).setAction(ACTION_REFRESH);
        v.setOnClickPendingIntent(R.id.w_refresh, PendingIntent.getBroadcast(ctx, 2, ref, PendingIntent.FLAG_UPDATE_CURRENT | imm));

        // each row's button fills in its own POST url + body
        Intent tap = new Intent(ctx, HomeWidgetProvider.class).setAction(ACTION_POST);
        v.setPendingIntentTemplate(R.id.w_list, PendingIntent.getBroadcast(ctx, 3, tap, PendingIntent.FLAG_UPDATE_CURRENT | mut));
        return v;
    }

    static int[] ids(Context ctx) {
        return AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, HomeWidgetProvider.class));
    }

    static void refreshAll(Context ctx) {
        int[] ids = ids(ctx);
        if (ids.length > 0) AppWidgetManager.getInstance(ctx).notifyAppWidgetViewDataChanged(ids, R.id.w_list);
    }

    // called after each fetch: remember title / empty text / open page and redraw the frame
    static void saveHead(Context ctx, String title, String empty, String open) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("title", title).putString("empty", empty).putString("open", open).apply();
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : ids(ctx)) {
            RemoteViews v = build(ctx, id);
            mgr.partiallyUpdateAppWidget(id, v);
        }
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        String a = intent.getAction();
        if (ACTION_REFRESH.equals(a)) { refreshAll(ctx); return; }
        if (ACTION_POST.equals(a)) {
            final String path = intent.getStringExtra(EXTRA_POST);
            final String body = intent.getStringExtra(EXTRA_BODY);
            if (path == null || !path.startsWith("/")) return;
            final PendingResult pr = goAsync();
            final Context app = ctx.getApplicationContext();
            new Thread(() -> {
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(BASE + path).openConnection();
                    c.setRequestMethod("POST");
                    c.setConnectTimeout(30000); c.setReadTimeout(30000);
                    c.setDoOutput(true);
                    c.setRequestProperty("Content-Type", "application/json");
                    String ck = CookieManager.getInstance().getCookie(BASE);
                    if (ck != null) c.setRequestProperty("Cookie", ck);
                    try (OutputStream os = c.getOutputStream()) { os.write((body != null ? body : "{}").getBytes("UTF-8")); }
                    c.getResponseCode();
                    c.disconnect();
                } catch (Exception ignored) {
                } finally {
                    refreshAll(app);
                    pr.finish();
                }
            }).start();
        }
    }
}
