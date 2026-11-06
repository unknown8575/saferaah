package in.saferaah.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.lang.reflect.Method;
import java.util.Locale;

/**
 * Navigation status outside the app: an ongoing notification with the next turn, the
 * distance to it and the arrival time. On Android 16 it asks to be promoted to a
 * Live Update, which shows as a chip in the status bar and at the top of the lock
 * screen (Android's equivalent of the iPhone's Dynamic Island). Also speaks the
 * turns with the phone's own text-to-speech, because WebView has no speech engine.
 */
@CapacitorPlugin(
    name = "NavStatus",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class NavStatusPlugin extends Plugin implements TextToSpeech.OnInitListener {
    private static final String CHANNEL = "saferaah_nav";
    private static final int NOTIFICATION_ID = 4711;

    private TextToSpeech tts;
    private boolean ttsReady = false;
    private String pendingText = null;
    private String pendingLang = "en-IN";

    @Override
    public void load() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Navigation", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Next turn and arrival time while you travel");
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.setShowBadge(false);
            manager().createNotificationChannel(ch);
        }
    }

    private NotificationManager manager() {
        return (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private static int tierColor(String tier) {
        switch (tier) {
            case "yellow": return Color.parseColor("#F2A900");
            case "red": return Color.parseColor("#E03131");
            case "darkred": return Color.parseColor("#8B0000");
            default: return Color.parseColor("#1F9D55");
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        Context ctx = getContext();
        String title = call.getString("title", "");
        String text = call.getString("text", "");
        String chip = call.getString("chip", "");
        String tier = call.getString("tier", "green");
        Double progress = call.getDouble("progress", 0.0);

        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open != null) open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL) : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_stat_nav)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new Notification.BigTextStyle().bigText(text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setContentIntent(pi)
            .setCategory(Notification.CATEGORY_NAVIGATION)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setColor(tierColor(tier))
            .setProgress(1000, (int) Math.round((progress == null ? 0 : progress) * 1000), false);

        if (Build.VERSION.SDK_INT >= 36) {
            // Android 16 Live Update: ask for promotion and give the status-bar chip its text.
            Bundle extras = new Bundle();
            extras.putBoolean("android.requestPromotedOngoing", true);
            b.addExtras(extras);
            callIfPresent(b, "setRequestPromotedOngoing", boolean.class, true);
            callIfPresent(b, "setShortCriticalText", String.class, chip);
        }
        try {
            manager().notify(NOTIFICATION_ID, b.build());
        } catch (SecurityException e) {
            // notifications not allowed: guidance still works inside the app
        }
        call.resolve();
    }

    /** These builder methods only exist on newer Android versions. */
    private static void callIfPresent(Notification.Builder b, String name, Class<?> type, Object arg) {
        try {
            Method m = Notification.Builder.class.getMethod(name, type);
            m.invoke(b, arg);
        } catch (Exception ignored) { }
    }

    @PluginMethod
    public void end(PluginCall call) {
        manager().cancel(NOTIFICATION_ID);
        call.resolve();
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        String lang = call.getString("lang", "en-IN");
        if (tts == null) {
            pendingText = text;
            pendingLang = lang;
            tts = new TextToSpeech(getContext(), this);
        } else if (!ttsReady) {
            pendingText = text;
            pendingLang = lang;
        } else {
            say(text, lang);
        }
        call.resolve();
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        if (tts != null) tts.stop();
        call.resolve();
    }

    @Override
    public void onInit(int status) {
        ttsReady = status == TextToSpeech.SUCCESS;
        if (ttsReady) {
            tts.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build());
            if (pendingText != null) say(pendingText, pendingLang);
        }
        pendingText = null;
    }

    private void say(String text, String lang) {
        int r = tts.setLanguage(Locale.forLanguageTag(lang));
        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) tts.setLanguage(Locale.ENGLISH);
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "saferaah-nav");
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) tts.shutdown();
        manager().cancel(NOTIFICATION_ID);
    }
}
