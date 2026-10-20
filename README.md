# Remainder

A phone-only, installable coding contest calendar for iPhone and Android. It combines upcoming and live contests, filters by platform and date, and keeps a personal reminder list on the device. On wider screens it stays in a phone-sized layout.

## Run locally

Serve this directory over localhost (service workers and notifications require a secure context):

```sh
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). To install on a phone, deploy the static files to an HTTPS host and open it on that phone:

- **iPhone:** Open the site in Safari, tap Share, then **Add to Home Screen**.
- **Android:** Open the site in Chrome and choose **Install app** / **Add to Home screen** from the browser menu (or use the app's Install button).

## Contest feed

The app requests the public [Kontests API](https://kontests.net/api/v1/all) in the browser and refreshes every five minutes. If the feed is unavailable or blocked by CORS/network policy, the app uses a clearly labeled sample schedule so the interface remains usable. That sample schedule is not live event data.

## Notifications

The browser Notification API can deliver reminders on this device after permission is granted. The app checks scheduled reminders while its page is open and refreshes them every 15 seconds. Reminder selections and lead time are stored in local storage on this device.

Browsers do not allow a static website to wake itself and deliver a scheduled notification after it has been fully closed. Reliable closed-app phone push requires a push subscription plus a hosted push service/server (VAPID keys and a deployment). This project includes the installable PWA shell and notification click handling; it does not claim background push without that service.
