package com.appachi.stocks;

import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.CancellationSignal;
import androidx.annotation.RequiresApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.Executor;
import androidx.core.content.ContextCompat;

@CapacitorPlugin(name = "BiometricAuth")
public class BiometricAuthPlugin extends Plugin {

    /** Returns whether biometric hardware is present and enrolled. */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            ret.put("isAvailable", false);
            ret.put("reason", "requires_android_10");
            call.resolve(ret);
            return;
        }
        BiometricManager mgr = getActivity().getSystemService(BiometricManager.class);
        boolean ok = mgr != null && mgr.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS;
        ret.put("isAvailable", ok);
        ret.put("reason", ok ? "ok" : "not_available");
        call.resolve(ret);
    }

    /** Shows the system biometric prompt. Resolves on success, rejects on cancel/error. */
    @PluginMethod
    @RequiresApi(api = Build.VERSION_CODES.P)
    public void authenticate(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            call.reject("Biometric authentication requires Android 9+");
            return;
        }

        call.setKeepAlive(true);

        String title    = call.getString("title",      "APPACHI Stocks");
        String subtitle = call.getString("subtitle",   "Place your finger to unlock");
        String cancel   = call.getString("cancelText", "Use PIN Instead");

        Executor executor = ContextCompat.getMainExecutor(getContext());
        CancellationSignal cancellationSignal = new CancellationSignal();

        BiometricPrompt.AuthenticationCallback callback = new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                call.setKeepAlive(false);
                call.resolve();
            }
            @Override
            public void onAuthenticationError(int errorCode, CharSequence errString) {
                call.setKeepAlive(false);
                call.reject(errString.toString(), String.valueOf(errorCode));
            }
            @Override
            public void onAuthenticationFailed() {
                // Fingerprint not matched — prompt stays open; retry allowed
            }
            @Override
            public void onAuthenticationHelp(int helpCode, CharSequence helpString) {}
        };

        BiometricPrompt prompt = new BiometricPrompt.Builder(getContext())
            .setTitle(title)
            .setSubtitle(subtitle)
            .setNegativeButton(cancel, executor, (dialog, which) -> {
                call.setKeepAlive(false);
                call.reject("Cancelled by user", "10");
            })
            .build();

        getActivity().runOnUiThread(() ->
            prompt.authenticate(cancellationSignal, executor, callback)
        );
    }
}
