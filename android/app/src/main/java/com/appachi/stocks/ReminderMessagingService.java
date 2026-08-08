package com.appachi.stocks;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/* Replaces the default Capacitor push-notifications MessagingService (removed
   in AndroidManifest.xml via tools:node="remove") so "stock-reminder" and
   "reminder-cancel" data-only FCM messages can be rendered as pinned/ongoing
   notifications instead of the OS's normal dismissible ones. Every other
   message type falls through to PushNotificationsPlugin.sendRemoteMessage(),
   preserving all existing push behavior (e.g. "owner notified when staff
   marks a stock done") unchanged. */
public class ReminderMessagingService extends FirebaseMessagingService {

    private static final String CHANNEL_ID = "stock_reminders";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        Map<String, String> data = remoteMessage.getData();
        String type = data.get("type");

        if ("stock-reminder".equals(type)) {
            showOngoing(data);
        } else if ("reminder-cancel".equals(type)) {
            cancel(data);
        } else {
            PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
        }
    }

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        PushNotificationsPlugin.onNewToken(token);
    }

    private void showOngoing(Map<String, String> data) {
        int id;
        try {
            id = Integer.parseInt(data.get("reminderId"));
        } catch (Exception e) {
            return;
        }

        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("url", data.get("url"));
        PendingIntent pi = PendingIntent.getActivity(
                this, id, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        ensureChannel();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                // TODO: swap for a proper white-silhouette notification icon asset —
                // this project has no dedicated small-icon drawable yet, so the full
                // launcher icon is reused as a functional fallback.
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(data.get("title"))
                .setContentText(data.get("body"))
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(pi)
                .setPriority(NotificationCompat.PRIORITY_HIGH);

        NotificationManagerCompat.from(this).notify(id, builder.build());
    }

    private void cancel(Map<String, String> data) {
        try {
            int id = Integer.parseInt(data.get("reminderId"));
            NotificationManagerCompat.from(this).cancel(id);
        } catch (Exception ignored) {}
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Stock Reminders", NotificationManager.IMPORTANCE_HIGH);
            NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }
}
