package com.appachi.stocks;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

// Home-screen widget. Only a viewer: the website (/api/widget) decides the title, the rows, what
// each row's ✓ does and which page a tap opens — so what it lists can change with no new app.
// It signs in with its own key, which the app hands over each time it opens (HomeWidgetPlugin).
// Up to 6 rows are drawn straight into the widget (no list service), plus "+N more".
public class HomeWidgetProvider extends AppWidgetProvider {
    static final String DEFAULT_BASE = "https://appachi-stocks.onrender.com";
    static final String ACTION_ACT = "com.appachi.stocks.WIDGET_ACT";
    static final String ACTION_REFRESH = "com.appachi.stocks.WIDGET_REFRESH";
    static final String EXTRA_ACT = "act";
    static final String PREFS = "home_widget";
    static final int MAX_ROWS = 6;
    static final int[] ROW = { R.id.r0, R.id.r1, R.id.r2, R.id.r3, R.id.r4, R.id.r5 };
    static final int[] ROW_T = { R.id.r0_t, R.id.r1_t, R.id.r2_t, R.id.r3_t, R.id.r4_t, R.id.r5_t };
    static final int[] ROW_M = { R.id.r0_m, R.id.r1_m, R.id.r2_m, R.id.r3_m, R.id.r4_m, R.id.r5_m };
    static final int[] ROW_V = { R.id.r0_v, R.id.r1_v, R.id.r2_v, R.id.r3_v, R.id.r4_v, R.id.r5_v };
    static final int[] ROW_B = { R.id.r0_b, R.id.r1_b, R.id.r2_b, R.id.r3_b, R.id.r4_b, R.id.r5_b };

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    static String base(Context c) { return prefs(c).getString("base", DEFAULT_BASE); }

    // ── kept for older callers (MainActivity) ──
    static final String BASE = DEFAULT_BASE;
    static void refreshAll(Context ctx) { refreshAsync(ctx.getApplicationContext(), null); }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        final PendingResult pr = goAsync();
        refreshAsync(ctx.getApplicationContext(), pr);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        String a = intent.getAction();
        final Context app = ctx.getApplicationContext();
        if (ACTION_REFRESH.equals(a)) {
            showStatus(app, "Updating…");
            refreshAsync(app, goAsync());
        } else if (ACTION_ACT.equals(a)) {
            final String act = intent.getStringExtra(EXTRA_ACT);
            if (act == null) return;
            showStatus(app, "Saving…");
            final PendingResult pr = goAsync();
            new Thread(() -> {
                try { post(app, "/api/widget/act", new JSONObject().put("act", act).toString()); } catch (Exception ignored) {}
                refreshNow(app);
                pr.finish();
            }).start();
        }
    }

    static int[] ids(Context ctx) {
        return AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, HomeWidgetProvider.class));
    }

    static void refreshAsync(final Context app, final PendingResult pr) {
        new Thread(() -> {
            try { refreshNow(app); } finally { if (pr != null) pr.finish(); }
        }).start();
    }

    static HttpURLConnection open(Context ctx, String path) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(base(ctx) + path).openConnection();
        c.setConnectTimeout(25000);
        c.setReadTimeout(25000);
        String token = prefs(ctx).getString("token", null);
        if (token != null) c.setRequestProperty("Authorization", "Bearer " + token);
        return c;
    }

    static void post(Context ctx, String path, String body) throws Exception {
        HttpURLConnection c = open(ctx, path);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        try (OutputStream os = c.getOutputStream()) { os.write(body.getBytes("UTF-8")); }
        c.getResponseCode();
        c.disconnect();
    }

    static int color(String hex, int fallback) {
        try { return hex != null && !hex.isEmpty() ? Color.parseColor(hex) : fallback; } catch (Exception e) { return fallback; }
    }

    static void showStatus(Context ctx, String text) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : ids(ctx)) {
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_home);
            v.setTextViewText(R.id.w_status, text);
            v.setViewVisibility(R.id.w_status, View.VISIBLE);
            mgr.partiallyUpdateAppWidget(id, v);
        }
    }

    // Fetch /api/widget and draw every widget. Never leaves it blank: any problem shows in the status line.
    static void refreshNow(Context ctx) {
        int[] ids = ids(ctx);
        if (ids.length == 0) return;
        String title = "APPACHI", empty = "Nothing here", open = "/home.html", status = null;
        JSONArray rows = null;
        if (prefs(ctx).getString("token", null) == null) {
            empty = "Open the app once to connect";
        } else {
            try {
                HttpURLConnection c = open(ctx, "/api/widget");
                int code = c.getResponseCode();
                if (code == 401) { empty = "Open the app once to connect"; }
                else if (code != 200) { status = "Could not load (" + code + ") — tap ⟳"; }
                else {
                    StringBuilder sb = new StringBuilder();
                    try (BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
                        String line; while ((line = br.readLine()) != null) sb.append(line);
                    }
                    JSONObject o = new JSONObject(sb.toString());
                    title = o.optString("title", title);
                    empty = o.optString("empty", empty);
                    open = o.optString("open", open);
                    rows = o.optJSONArray("rows");
                    prefs(ctx).edit().putString("last", sb.toString()).apply();
                    status = "Updated " + new SimpleDateFormat("h:mm a", Locale.US).format(new Date());
                }
                c.disconnect();
            } catch (Exception e) {
                // server asleep / no internet: keep showing the last list
                status = "No connection — tap ⟳";
                try {
                    String last = prefs(ctx).getString("last", null);
                    if (last != null) { JSONObject o = new JSONObject(last); title = o.optString("title", title); empty = o.optString("empty", empty); open = o.optString("open", open); rows = o.optJSONArray("rows"); }
                } catch (Exception ignored) {}
            }
        }

        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : ids) {
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_home);
            v.setTextViewText(R.id.w_title, title);
            v.setTextViewText(R.id.w_empty, empty);
            if (status != null) { v.setTextViewText(R.id.w_status, status); v.setViewVisibility(R.id.w_status, View.VISIBLE); }
            else v.setViewVisibility(R.id.w_status, View.GONE);

            int n = rows == null ? 0 : rows.length();
            v.setViewVisibility(R.id.w_empty, n == 0 ? View.VISIBLE : View.GONE);
            for (int i = 0; i < MAX_ROWS; i++) {
                if (i >= n) { v.setViewVisibility(ROW[i], View.GONE); continue; }
                JSONObject x = rows.optJSONObject(i);
                if (x == null) { v.setViewVisibility(ROW[i], View.GONE); continue; }
                v.setViewVisibility(ROW[i], View.VISIBLE);
                v.setTextViewText(ROW_T[i], x.optString("title", ""));
                String meta = x.optString("meta", "");
                v.setTextViewText(ROW_M[i], meta);
                v.setViewVisibility(ROW_M[i], meta.isEmpty() ? View.GONE : View.VISIBLE);
                v.setTextColor(ROW_M[i], color(x.optString("meta_color", ""), 0xFF8B98A8));
                v.setTextViewText(ROW_V[i], x.optString("value", ""));
                v.setTextColor(ROW_V[i], color(x.optString("value_color", ""), 0xFFD4AF37));
                JSONObject b = x.optJSONObject("button");
                String act = b != null ? b.optString("act", "") : "";
                if (!act.isEmpty()) {
                    v.setViewVisibility(ROW_B[i], View.VISIBLE);
                    v.setTextViewText(ROW_B[i], b.optString("label", "✓"));
                    Intent t = new Intent(ctx, HomeWidgetProvider.class).setAction(ACTION_ACT).putExtra(EXTRA_ACT, act);
                    v.setOnClickPendingIntent(ROW_B[i], PendingIntent.getBroadcast(ctx, 100 + i, t, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
                } else v.setViewVisibility(ROW_B[i], View.GONE);
            }
            if (n > MAX_ROWS) { v.setTextViewText(R.id.w_more, "+" + (n - MAX_ROWS) + " more — tap the title"); v.setViewVisibility(R.id.w_more, View.VISIBLE); }
            else v.setViewVisibility(R.id.w_more, View.GONE);

            Intent o = new Intent(ctx, MainActivity.class);
            o.putExtra("openPath", open);
            o.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent openPi = PendingIntent.getActivity(ctx, 1, o, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            v.setOnClickPendingIntent(R.id.w_title, openPi);
            v.setOnClickPendingIntent(R.id.w_empty, openPi);
            v.setOnClickPendingIntent(R.id.w_more, openPi);
            Intent ref = new Intent(ctx, HomeWidgetProvider.class).setAction(ACTION_REFRESH);
            v.setOnClickPendingIntent(R.id.w_refresh, PendingIntent.getBroadcast(ctx, 2, ref, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            mgr.updateAppWidget(id, v);
        }
    }
}
