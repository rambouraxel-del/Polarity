package polarrift.ads;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import java.util.ArrayList;
import java.util.List;

/**
 * Configuration publicitaire déclarée par l'APPLICATION (métadonnées du manifeste, générées par Gradle depuis mobile/ads.json). Identifiants publics,
 * aucun secret. Une valeur absente laisse la fonction désactivée (jamais d'identifiant inventé).
 */
final class AdsSettings {
    final String mode;
    final String rewardedUnitId;
    final List<String> testDeviceIds;
    final String umpGeography;
    final boolean debuggable;

    private AdsSettings(String mode, String rewardedUnitId, List<String> testDeviceIds, String umpGeography, boolean debuggable) {
        this.mode = mode;
        this.rewardedUnitId = rewardedUnitId;
        this.testDeviceIds = testDeviceIds;
        this.umpGeography = umpGeography;
        this.debuggable = debuggable;
    }

    static AdsSettings read(Context context) {
        Bundle meta = null;
        boolean debuggable = false;
        try {
            ApplicationInfo info = context.getPackageManager().getApplicationInfo(context.getPackageName(), PackageManager.GET_META_DATA);
            meta = info.metaData;
            debuggable = (info.flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        } catch (PackageManager.NameNotFoundException ignored) {
            // application introuvable : configuration vide, publicité désactivée
        }
        String mode = str(meta, "polarrift.ads.mode");
        String unit = str(meta, "polarrift.ads.rewardedUnitId");
        String geography = str(meta, "polarrift.ads.umpGeography");
        List<String> devices = new ArrayList<>();
        for (String d : str(meta, "polarrift.ads.testDevices").split(",")) {
            String t = d.trim();
            if (!t.isEmpty()) devices.add(t);
        }
        return new AdsSettings(mode, unit, devices, geography.isEmpty() ? "off" : geography, debuggable);
    }

    private static String str(Bundle meta, String key) {
        Object v = meta == null ? null : meta.get(key);
        return v == null ? "" : String.valueOf(v);
    }

    /** Une publicité ne peut être chargée que si le bloc est configuré. */
    boolean hasUnit() {
        return !rewardedUnitId.isEmpty();
    }

    /** Le débogage du consentement n'existe que dans un build « debuggable » : jamais en production. */
    boolean umpDebugEnabled() {
        return debuggable && !"off".equals(umpGeography);
    }
}
