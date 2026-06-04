package com.appachi.stocks;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BiometricAuth")
public class BiometricAuthPlugin extends Plugin {

    private static final int AUTH_CODE = 9182;
    private PluginCall pendingCall;

    private KeyguardManager km() {
        return (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
    }

    private boolean isSecure() {
        KeyguardManager km = km();
        if (km == null) return false;
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            ? km.isDeviceSecure()
            : km.isKeyguardSecure();
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("isAvailable", isSecure());
        call.resolve(ret);
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        if (!isSecure()) {
            call.reject("No secure lock screen on this device", "NOT_ENROLLED");
            return;
        }

        String title    = call.getString("title",    "APPACHI Stocks");
        String subtitle = call.getString("subtitle", "Verify your identity to continue");

        Intent intent = km().createConfirmDeviceCredentialIntent(title, subtitle);
        if (intent == null) {
            call.reject("Authentication dialog unavailable", "NOT_AVAILABLE");
            return;
        }

        call.setKeepAlive(true);
        pendingCall = call;
        getActivity().startActivityForResult(intent, AUTH_CODE);
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        if (requestCode != AUTH_CODE || pendingCall == null) return;

        PluginCall call = pendingCall;
        pendingCall = null;
        call.setKeepAlive(false);

        if (resultCode == Activity.RESULT_OK) {
            call.resolve();
        } else {
            call.reject("Authentication cancelled", "CANCELLED");
        }
    }
}
