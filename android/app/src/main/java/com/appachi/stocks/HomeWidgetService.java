package com.appachi.stocks;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.view.View;
import android.webkit.CookieManager;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

// Rows for the home-screen widget, exactly as /api/widget sends them.
public class HomeWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext());
    }

    static class Row { long id; String title, meta, value, valueColor, metaColor, btnLabel, btnPost, btnBody; }

    static int color(String hex, int fallback) {
        try { return hex != null && !hex.isEmpty() ? Color.parseColor(hex) : fallback; } catch (Exception e) { return fallback; }
    }

    static class Factory implements RemoteViewsFactory {
        private final Context ctx;
        private final List<Row> rows = new ArrayList<>();
        Factory(Context ctx) { this.ctx = ctx; }

        @Override public void onCreate() {}
        @Override public void onDestroy() { rows.clear(); }
        @Override public int getCount() { return rows.size(); }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int i) { return i < rows.size() ? rows.get(i).id : i; }
        @Override public boolean hasStableIds() { return true; }

        @Override
        public void onDataSetChanged() {
            List<Row> fresh = new ArrayList<>();
            String title = "APPACHI", empty = "Nothing here", open = "/home.html";
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(HomeWidgetProvider.BASE + "/api/widget").openConnection();
                c.setConnectTimeout(40000); c.setReadTimeout(40000);
                String ck = CookieManager.getInstance().getCookie(HomeWidgetProvider.BASE);
                if (ck != null) c.setRequestProperty("Cookie", ck);
                int code = c.getResponseCode();
                if (code == 401) { title = "APPACHI"; empty = "Open the app and sign in"; open = "/login.html"; }
                else if (code != 200) { title = "APPACHI · can't load (" + code + ")"; empty = "Tap ⟳ to try again"; fresh.addAll(rows); }
                else {
                    StringBuilder sb = new StringBuilder();
                    try (BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
                        String line; while ((line = br.readLine()) != null) sb.append(line);
                    }
                    JSONObject o = new JSONObject(sb.toString());
                    title = o.optString("title", title);
                    empty = o.optString("empty", empty);
                    open = o.optString("open", open);
                    JSONArray arr = o.optJSONArray("rows");
                    for (int i = 0; arr != null && i < arr.length(); i++) {
                        JSONObject x = arr.getJSONObject(i);
                        Row r = new Row();
                        r.id = x.optLong("id", i);
                        r.title = x.optString("title", "");
                        r.meta = x.optString("meta", "");
                        r.value = x.optString("value", "");
                        r.valueColor = x.optString("value_color", "");
                        r.metaColor = x.optString("meta_color", "");
                        JSONObject b = x.optJSONObject("button");
                        if (b != null) { r.btnLabel = b.optString("label", "✓"); r.btnPost = b.optString("post", null); r.btnBody = b.optString("body", "{}"); }
                        fresh.add(r);
                    }
                }
                c.disconnect();
            } catch (Exception e) {
                title = "APPACHI · no connection";
                empty = "Tap ⟳ to try again";
                fresh.addAll(rows); // keep showing the last list
            }
            rows.clear();
            rows.addAll(fresh);
            HomeWidgetProvider.saveHead(ctx, title, empty, open);
        }

        @Override
        public RemoteViews getViewAt(int pos) {
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_home_row);
            if (pos >= rows.size()) return v;
            Row r = rows.get(pos);
            v.setTextViewText(R.id.row_party, r.title);
            v.setTextViewText(R.id.row_meta, r.meta);
            v.setViewVisibility(R.id.row_meta, r.meta.isEmpty() ? View.GONE : View.VISIBLE);
            v.setTextViewText(R.id.row_wt, r.value);
            v.setTextColor(R.id.row_wt, color(r.valueColor, 0xFFD4AF37));
            v.setTextColor(R.id.row_meta, color(r.metaColor, 0xFF8B98A8));
            if (r.btnPost != null && r.btnPost.startsWith("/")) {
                v.setViewVisibility(R.id.row_tick, View.VISIBLE);
                v.setTextViewText(R.id.row_tick, r.btnLabel);
                Intent fill = new Intent();
                fill.putExtra(HomeWidgetProvider.EXTRA_POST, r.btnPost);
                fill.putExtra(HomeWidgetProvider.EXTRA_BODY, r.btnBody);
                v.setOnClickFillInIntent(R.id.row_tick, fill);
            } else {
                v.setViewVisibility(R.id.row_tick, View.GONE);
            }
            return v;
        }
    }
}
