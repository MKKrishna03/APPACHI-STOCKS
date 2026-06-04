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

    private boolean isGranted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission)
               == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * Request all app permissions at once.
     * Resolves immediately — the system dialogs appear on top.
     */
    @PluginMethod
    public void requestAll(PluginCall call) {
        List<String> needed = new ArrayList<>();

        // Notifications (Android 13+)
        if (Build.VERSION.SDK_INT >= 33) {
            if (!isGranted(Manifest.permission.POST_NOTIFICATIONS))
                needed.add(Manifest.permission.POST_NOTIFICATIONS);
        }

        // Camera
        if (!isGranted(Manifest.permission.CAMERA))
            needed.add(Manifest.permission.CAMERA);

        // Storage / Media
        if (Build.VERSION.SDK_INT >= 33) {
            if (!isGranted(Manifest.permission.READ_MEDIA_IMAGES))
                needed.add(Manifest.permission.READ_MEDIA_IMAGES);
            if (!isGranted(Manifest.permission.READ_MEDIA_VIDEO))
                needed.add(Manifest.permission.READ_MEDIA_VIDEO);
        } else {
            if (!isGranted(Manifest.permission.READ_EXTERNAL_STORAGE))
                needed.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        }

        // Contacts
        if (!isGranted(Manifest.permission.READ_CONTACTS))
            needed.add(Manifest.permission.READ_CONTACTS);

        // SMS
        if (!isGranted(Manifest.permission.READ_SMS))
            needed.add(Manifest.permission.READ_SMS);
        if (!isGranted(Manifest.permission.RECEIVE_SMS))
            needed.add(Manifest.permission.RECEIVE_SMS);

        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(
                getActivity(),
                needed.toArray(new String[0]),
                PERM_REQUEST_CODE
            );
        }

        // Resolve immediately — dialogs appear asynchronously on top
        JSObject ret = new JSObject();
        ret.put("requested", needed.size());
        call.resolve(ret);
    }
}
