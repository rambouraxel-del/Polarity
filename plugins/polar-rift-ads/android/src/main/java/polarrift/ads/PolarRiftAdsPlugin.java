package polarrift.ads;

import android.app.Activity;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.RequestConfiguration;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;
import com.google.android.gms.ads.rewarded.ServerSideVerificationOptions;
import com.google.android.ump.ConsentDebugSettings;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.FormError;
import com.google.android.ump.UserMessagingPlatform;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Plugin Capacitor « PolarRiftAds » : publicité récompensée AdMob + consentement UMP.
 *
 * Règles :
 * - TOUT l'état est manipulé sur le fil principal (Handler) : pas de verrou, pas de course ; les SDK exigent d'ailleurs l'interface sur ce fil ;
 * - `canRequestAds` (UMP) est recontrôlé avant chaque chargement et chaque affichage, jamais mémorisé ;
 * - une seule demande de consentement / un seul chargement à la fois : les appels simultanés partagent le même résultat ;
 * - `userId` et `customData` de la session SERVEUR sont fixés sur l'annonce AVANT `show` ;
 * - chaque appel `show` est résolu UNE seule fois, à la fermeture : « rewarded » si la récompense a été gagnée (la fermeture ne l'efface pas),
 *   « dismissed » sinon, « failed » si rien n'a pu être présenté ;
 * - ce plugin n'accorde jamais rien : la vérification serveur à serveur (SSV) fait seule autorité côté jeu.
 */
@CapacitorPlugin(name = "PolarRiftAds")
public class PolarRiftAdsPlugin extends Plugin {

    /** Une annonce chargée expire au bout d'environ une heure : au-delà, elle n'est plus présentée. */
    private static final long AD_MAX_AGE_MS = 55L * 60L * 1000L;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService background = Executors.newSingleThreadExecutor();

    private AdsSettings settings;
    private ConsentInformation consentInfo;

    // consentement
    private boolean consentFlight = false;
    private final List<PluginCall> consentWaiters = new ArrayList<>();

    // initialisation du SDK (une seule fois, seulement quand les publicités sont permises)
    private boolean sdkStarted = false;
    private boolean sdkReady = false;
    private final List<Runnable> afterSdk = new ArrayList<>();

    // annonce préchargée
    private RewardedAd loadedAd = null;
    private long loadedAt = 0;
    private boolean loading = false;
    private int generation = 0;
    private final List<PluginCall> loadWaiters = new ArrayList<>();

    // affichage en cours
    private ShowState activeShow = null;

    @Override
    public void load() {
        settings = AdsSettings.read(getContext());
        consentInfo = UserMessagingPlatform.getConsentInformation(getContext());
    }

    // ————————————————————————————————————————— consentement (UMP)

    @PluginMethod
    public void requestConsent(final PluginCall call) {
        main.post(() -> {
            consentWaiters.add(call);
            if (consentFlight) return; // une demande à la fois : les appels simultanés partagent le résultat
            consentFlight = true;
            final Activity activity = getActivity();
            if (activity == null) {
                finishConsent("no_activity");
                return;
            }
            try {
                consentInfo.requestConsentInfoUpdate(
                    activity,
                    buildConsentParameters(activity),
                    () -> UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity, (FormError formError) -> finishConsent(formError == null ? null : formError.getMessage())),
                    (FormError requestError) -> finishConsent(requestError.getMessage())
                );
            } catch (RuntimeException e) {
                finishConsent(String.valueOf(e.getMessage()));
            }
        });
    }

    private ConsentRequestParameters buildConsentParameters(Context context) {
        ConsentRequestParameters.Builder params = new ConsentRequestParameters.Builder();
        // Débogage du consentement : uniquement dans un build « debuggable » ET si la configuration le demande (jamais en production)
        if (settings.umpDebugEnabled()) {
            ConsentDebugSettings.Builder debug = new ConsentDebugSettings.Builder(context);
            debug.setDebugGeography("eea".equals(settings.umpGeography) ? ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_EEA : ConsentDebugSettings.DebugGeography.DEBUG_GEOGRAPHY_NOT_EEA);
            for (String id : settings.testDeviceIds) debug.addTestDeviceHashedId(id);
            params.setConsentDebugSettings(debug.build());
        }
        // Aucune déclaration d'âge ou de public « enfants » n'est faite ici (public général : adolescents et adultes) ; aucun réinitialisation du consentement.
        return params.build();
    }

    /** Résout TOUS les appels en attente avec l'état UMP officiel (même en cas d'erreur : jamais une autorisation forcée). */
    private void finishConsent(String error) {
        consentFlight = false;
        JSObject state = consentState();
        if (error != null) state.put("error", error);
        List<PluginCall> waiters = new ArrayList<>(consentWaiters);
        consentWaiters.clear();
        if (consentInfo.canRequestAds()) startSdk(null);
        for (PluginCall c : waiters) c.resolve(state);
    }

    @PluginMethod
    public void getConsentState(final PluginCall call) {
        main.post(() -> call.resolve(consentState()));
    }

    @PluginMethod
    public void showPrivacyOptions(final PluginCall call) {
        main.post(() -> {
            final Activity activity = getActivity();
            if (activity == null || activeShow != null || consentFlight) {
                call.resolve(consentState());
                return;
            }
            invalidateAd(); // la publicité préchargée l'a été avec l'ancien choix
            UserMessagingPlatform.showPrivacyOptionsForm(activity, (FormError formError) ->
                main.post(() -> {
                    invalidateAd();
                    JSObject state = consentState();
                    if (formError != null) state.put("error", formError.getMessage());
                    call.resolve(state);
                })
            );
        });
    }

    private JSObject consentState() {
        JSObject o = new JSObject();
        o.put("canRequestAds", consentInfo.canRequestAds());
        o.put("privacyOptionsRequired", consentInfo.getPrivacyOptionsRequirementStatus() == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED);
        String status;
        switch (consentInfo.getConsentStatus()) {
            case ConsentInformation.ConsentStatus.REQUIRED: status = "required"; break;
            case ConsentInformation.ConsentStatus.NOT_REQUIRED: status = "not_required"; break;
            case ConsentInformation.ConsentStatus.OBTAINED: status = "obtained"; break;
            default: status = "unknown";
        }
        o.put("status", status);
        return o;
    }

    // ————————————————————————————————————————— SDK Google Mobile Ads

    /** Démarre le SDK une seule fois, seulement quand les publicités sont permises ; exécute ensuite `then`. */
    private void startSdk(Runnable then) {
        if (then != null) afterSdk.add(then);
        if (sdkReady) {
            runAfterSdk();
            return;
        }
        if (sdkStarted) return;
        sdkStarted = true;
        final Context context = getContext().getApplicationContext();
        if (!settings.testDeviceIds.isEmpty()) {
            MobileAds.setRequestConfiguration(new RequestConfiguration.Builder().setTestDeviceIds(settings.testDeviceIds).build());
        }
        // L'initialisation peut être longue : hors du fil principal, puis retour sur le fil principal
        background.execute(() -> MobileAds.initialize(context, status -> main.post(() -> {
            sdkReady = true;
            runAfterSdk();
        })));
    }

    private void runAfterSdk() {
        List<Runnable> todo = new ArrayList<>(afterSdk);
        afterSdk.clear();
        for (Runnable r : todo) r.run();
    }

    private void invalidateAd() {
        generation++;
        loadedAd = null;
    }

    private static JSObject loadReply(boolean ready, String reason) {
        JSObject o = new JSObject();
        o.put("ready", ready);
        if (reason != null) o.put("reason", reason);
        return o;
    }

    // ————————————————————————————————————————— chargement

    @PluginMethod
    public void load(final PluginCall call) {
        main.post(() -> {
            // Recontrôle UMP avant CHAQUE chargement
            if (!consentInfo.canRequestAds()) {
                invalidateAd();
                call.resolve(loadReply(false, "consent"));
                return;
            }
            if (!settings.hasUnit()) {
                call.resolve(loadReply(false, "config"));
                return;
            }
            if (loadedAd != null && System.currentTimeMillis() - loadedAt < AD_MAX_AGE_MS) {
                call.resolve(loadReply(true, null));
                return;
            }
            loadedAd = null;
            loadWaiters.add(call);
            if (loading) return; // un seul chargement à la fois
            loading = true;
            final int gen = generation;
            startSdk(() -> doLoad(gen));
        });
    }

    private void doLoad(final int gen) {
        if (!consentInfo.canRequestAds()) {
            finishLoad(gen, null, "consent");
            return;
        }
        RewardedAd.load(getContext(), settings.rewardedUnitId, new AdRequest.Builder().build(), new RewardedAdLoadCallback() {
            @Override
            public void onAdLoaded(RewardedAd ad) {
                main.post(() -> finishLoad(gen, ad, null));
            }

            @Override
            public void onAdFailedToLoad(LoadAdError error) {
                // Code 3 = pas d'annonce disponible (NO_FILL) ; tout autre code = erreur
                main.post(() -> finishLoad(gen, null, error.getCode() == AdRequest.ERROR_CODE_NO_FILL ? "no_fill" : "error"));
            }
        });
    }

    private void finishLoad(int gen, RewardedAd ad, String reason) {
        loading = false;
        boolean stale = gen != generation; // le choix de confidentialité a changé pendant le chargement : l'annonce est abandonnée
        if (ad != null && !stale) {
            loadedAd = ad;
            loadedAt = System.currentTimeMillis();
        }
        boolean ready = loadedAd != null;
        List<PluginCall> waiters = new ArrayList<>(loadWaiters);
        loadWaiters.clear();
        for (PluginCall c : waiters) c.resolve(loadReply(ready, ready ? null : (stale ? "stale" : reason)));
    }

    // ————————————————————————————————————————— affichage

    /** Un affichage : une seule résolution, quel que soit l'enchaînement des rappels du SDK. */
    private static final class ShowState {
        final PluginCall call;
        boolean earned = false;
        boolean done = false;

        ShowState(PluginCall call) {
            this.call = call;
        }
    }

    private void finishShow(ShowState s, String result, String reason) {
        if (s.done) return;
        s.done = true;
        if (activeShow == s) activeShow = null;
        JSObject o = new JSObject();
        o.put("result", result);
        if (reason != null) o.put("reason", reason);
        s.call.resolve(o);
    }

    private static JSObject failed(String reason) {
        JSObject o = new JSObject();
        o.put("result", "failed");
        o.put("reason", reason);
        return o;
    }

    @PluginMethod
    public void show(final PluginCall call) {
        final String userId = call.getString("userId", "");
        final String customData = call.getString("customData", "");
        main.post(() -> {
            if (userId == null || userId.isEmpty() || customData == null || customData.isEmpty()) {
                call.resolve(failed("bad_request")); // sans les identifiants de la session serveur, la vérification serveur ne pourrait jamais aboutir
                return;
            }
            if (activeShow != null) {
                call.resolve(failed("busy")); // appels simultanés : une seule publicité à la fois
                return;
            }
            // Recontrôle UMP juste avant l'affichage
            if (!consentInfo.canRequestAds()) {
                invalidateAd();
                call.resolve(failed("consent"));
                return;
            }
            final Activity activity = getActivity();
            final RewardedAd ad = loadedAd;
            if (activity == null || ad == null || System.currentTimeMillis() - loadedAt >= AD_MAX_AGE_MS) {
                loadedAd = null;
                call.resolve(failed("not_ready"));
                return;
            }
            loadedAd = null; // une annonce = une seule projection
            final ShowState state = new ShowState(call);
            activeShow = state;
            // Options de vérification serveur à serveur AVANT la présentation
            ad.setServerSideVerificationOptions(new ServerSideVerificationOptions.Builder().setUserId(userId).setCustomData(customData).build());
            ad.setFullScreenContentCallback(new FullScreenContentCallback() {
                @Override
                public void onAdDismissedFullScreenContent() {
                    // La fermeture ne doit pas effacer une récompense déjà gagnée ; sans récompense, elle ne peut jamais en produire une
                    main.post(() -> finishShow(state, state.earned ? "rewarded" : "dismissed", null));
                }

                @Override
                public void onAdFailedToShowFullScreenContent(AdError error) {
                    main.post(() -> finishShow(state, "failed", "show_error"));
                }
            });
            try {
                ad.show(activity, rewardItem -> state.earned = true);
            } catch (RuntimeException e) {
                finishShow(state, "failed", "show_exception");
            }
        });
    }

    // ————————————————————————————————————————— cycle de vie

    @Override
    protected void handleOnDestroy() {
        main.post(() -> {
            if (activeShow != null) finishShow(activeShow, activeShow.earned ? "rewarded" : "failed", "destroyed");
            loadedAd = null;
        });
        background.shutdown();
        super.handleOnDestroy();
    }
}
