/* push-native.js — Native FCM push registration for Capacitor Android app
   Include on every authenticated page: <script src="/push-native.js" defer></script>
   Does nothing on web browsers (only activates inside Capacitor native app). */

(function () {
  'use strict';

  if (!window.Capacitor?.isNativePlatform?.()) return;

  async function registerFCM() {
    const PushNotifications = window.Capacitor?.Plugins?.PushNotifications;
    if (!PushNotifications) {
      console.warn('[FCM] PushNotifications plugin not available');
      return;
    }

    try {
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') {
        console.warn('[FCM] Notification permission denied');
        return;
      }

      await PushNotifications.register();

      // Send token to server so server can push to this device
      PushNotifications.addListener('registration', async (token) => {
        try {
          await fetch('/api/push/fcm-token', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ token: token.value }),
          });
          console.log('[FCM] Token registered with server');
        } catch (e) {
          console.warn('[FCM] Failed to save token:', e.message);
        }
      });

      PushNotifications.addListener('registrationError', (err) => {
        console.error('[FCM] Registration error:', err.error);
      });

      // Open app to the correct page when user taps notification
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const url = action.notification.data?.url;
        if (url) window.location.href = url;
      });

    } catch (e) {
      console.warn('[FCM] Setup failed:', e.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerFCM);
  } else {
    registerFCM();
  }
})();
