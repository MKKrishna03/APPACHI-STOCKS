package com.appachi.stocks;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "AppPermissions")
public class AppPermissionsPlugin extends Plugin {

    private static final int PERM_REQUEST_CODE = 2001;

    @PluginMethod
    public void requestAll(PluginCall call) {
        List<String> needed = new ArrayList<>();

        // Only request notification permission (Android 13+)
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }

        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(
                getActivity(),
                needed.toArray(new String[0]),
                PERM_REQUEST_CODE
            );
        }

        JSObject ret = new JSObject();
        ret.put("requested", needed.size());
        call.resolve(ret);
    }
}
