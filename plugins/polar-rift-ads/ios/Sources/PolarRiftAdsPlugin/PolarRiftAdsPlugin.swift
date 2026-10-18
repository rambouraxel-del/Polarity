import Foundation
import UIKit
import Capacitor
import GoogleMobileAds
import UserMessagingPlatform

/// Plugin Capacitor « PolarRiftAds » : publicité récompensée AdMob + consentement UMP (iOS).
///
/// Règles (identiques à la version Android) :
/// - tout l'état vit sur le fil principal (`@MainActor`) : pas de course ;
/// - `canRequestAds` (UMP) est recontrôlé avant chaque chargement et chaque affichage, jamais mémorisé ;
/// - une seule demande de consentement / un seul chargement à la fois : les appels simultanés partagent le résultat ;
/// - `userId` et `customData` de la session SERVEUR sont fixés sur l'annonce AVANT `present` ;
/// - chaque `show` est résolu UNE seule fois, à la fermeture : « rewarded » si la récompense a été gagnée, « dismissed » sinon, « failed » si rien n'a pu être présenté ;
/// - ce plugin n'accorde jamais rien : la vérification serveur à serveur (SSV) fait seule autorité côté jeu ;
/// - ATT (suivi) : non demandé ici. Le jeu ne fait aucun suivi propre ; AdMob sert des annonces sans IDFA tant que l'autorisation n'est pas donnée.
@objc(PolarRiftAdsPlugin)
public class PolarRiftAdsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PolarRiftAdsPlugin"
    public let jsName = "PolarRiftAds"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestConsent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getConsentState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showPrivacyOptions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise)
    ]

    private let controller = AdsController()

    @objc func requestConsent(_ call: CAPPluginCall) {
        Task { @MainActor in self.controller.requestConsent(call, rootVC: self.topViewController()) }
    }

    @objc func getConsentState(_ call: CAPPluginCall) {
        Task { @MainActor in call.resolve(self.controller.consentState()) }
    }

    @objc func showPrivacyOptions(_ call: CAPPluginCall) {
        Task { @MainActor in await self.controller.showPrivacyOptions(call, rootVC: self.topViewController()) }
    }

    @objc func load(_ call: CAPPluginCall) {
        Task { @MainActor in self.controller.load(call) }
    }

    @objc func show(_ call: CAPPluginCall) {
        let userId = call.getString("userId") ?? ""
        let customData = call.getString("customData") ?? ""
        Task { @MainActor in self.controller.show(call, userId: userId, customData: customData, rootVC: self.topViewController()) }
    }

    /// Contrôleur de vue le plus haut (celui depuis lequel présenter un formulaire ou une publicité).
    @MainActor private func topViewController() -> UIViewController? {
        var window: UIWindow? = UIApplication.shared.delegate?.window ?? nil
        if window == nil {
            let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene
            window = scene?.windows.first(where: { $0.isKeyWindow }) ?? scene?.windows.first
        }
        var top = window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}

/// Rappels du SDK pour UNE présentation (le SDK ne retient que faiblement son délégué : l'objet est conservé par l'état d'affichage).
private final class ShowDelegate: NSObject, FullScreenContentDelegate {
    var onDismiss: (() -> Void)?
    var onFail: (() -> Void)?

    func adDidDismissFullScreenContent(_ ad: FullScreenPresentingAd) {
        onDismiss?()
    }

    func ad(_ ad: FullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) {
        onFail?()
    }
}

private final class ShowState {
    let call: CAPPluginCall
    let delegate = ShowDelegate()
    var earned = false
    var done = false
    init(call: CAPPluginCall) { self.call = call }
}

@MainActor
final class AdsController {
    /// Une annonce chargée expire au bout d'environ une heure : au-delà, elle n'est plus présentée.
    private let adMaxAge: TimeInterval = 55 * 60

    private let settings = AdsSettings.read()

    // consentement
    private var consentFlight = false
    private var consentWaiters: [CAPPluginCall] = []

    // initialisation du SDK (une seule fois, seulement quand les publicités sont permises)
    private var sdkStarted = false
    private var sdkReady = false
    private var afterSdk: [() -> Void] = []

    // annonce préchargée
    private var loadedAd: RewardedAd?
    private var loadedAt = Date.distantPast
    private var loading = false
    private var generation = 0
    private var loadWaiters: [CAPPluginCall] = []

    // affichage en cours
    private var activeShow: ShowState?

    /// Création possible depuis un contexte non isolé (propriété du plugin) : l'état n'est ensuite manipulé que sur le fil principal.
    nonisolated init() {}

    // ————————————————————————————————————————— consentement (UMP)

    func requestConsent(_ call: CAPPluginCall, rootVC: UIViewController?) {
        consentWaiters.append(call)
        if consentFlight { return } // une demande à la fois : les appels simultanés partagent le résultat
        consentFlight = true
        let parameters = RequestParameters()
        // Débogage du consentement : seulement en développement ET si la configuration le demande (jamais en production)
        if settings.umpDebugEnabled {
            let debug = DebugSettings()
            debug.geography = DebugGeography(rawValue: settings.umpGeography == "eea" ? 1 : 2) ?? DebugGeography.disabled
            debug.testDeviceIdentifiers = settings.testDeviceIds
            parameters.debugSettings = debug
        }
        // Aucune déclaration d'âge ou de public « enfants » (public général : adolescents et adultes) ; aucun reset du consentement.
        ConsentInformation.shared.requestConsentInfoUpdate(with: parameters) { [weak self] error in
            Task { @MainActor in
                guard let self = self else { return }
                if let error = error {
                    self.finishConsent(error: error.localizedDescription)
                    return
                }
                guard let vc = rootVC else {
                    self.finishConsent(error: "no_view_controller")
                    return
                }
                do {
                    try await ConsentForm.loadAndPresentIfRequired(from: vc)
                    self.finishConsent(error: nil)
                } catch {
                    self.finishConsent(error: error.localizedDescription)
                }
            }
        }
    }

    /// Résout TOUS les appels en attente avec l'état UMP officiel (même en cas d'erreur : jamais une autorisation forcée).
    private func finishConsent(error: String?) {
        consentFlight = false
        var state = consentState()
        if let error = error { state["error"] = error }
        let waiters = consentWaiters
        consentWaiters.removeAll()
        if ConsentInformation.shared.canRequestAds { startSdk(nil) }
        for c in waiters { c.resolve(state) }
    }

    func consentState() -> [String: Any] {
        let info = ConsentInformation.shared
        let status: String
        switch info.consentStatus {
        case .required: status = "required"
        case .notRequired: status = "not_required"
        case .obtained: status = "obtained"
        default: status = "unknown"
        }
        return [
            "canRequestAds": info.canRequestAds,
            "privacyOptionsRequired": info.privacyOptionsRequirementStatus == .required,
            "status": status
        ]
    }

    func showPrivacyOptions(_ call: CAPPluginCall, rootVC: UIViewController?) async {
        guard let vc = rootVC, activeShow == nil, !consentFlight else {
            call.resolve(consentState())
            return
        }
        invalidateAd() // la publicité préchargée l'a été avec l'ancien choix
        var state: [String: Any]
        do {
            try await ConsentForm.presentPrivacyOptionsForm(from: vc)
            invalidateAd()
            state = consentState()
        } catch {
            invalidateAd()
            state = consentState()
            state["error"] = error.localizedDescription
        }
        call.resolve(state)
    }

    // ————————————————————————————————————————— SDK Google Mobile Ads

    /// Démarre le SDK une seule fois, seulement quand les publicités sont permises ; exécute ensuite `then`.
    private func startSdk(_ then: (() -> Void)?) {
        if let then = then { afterSdk.append(then) }
        if sdkReady {
            runAfterSdk()
            return
        }
        if sdkStarted { return }
        sdkStarted = true
        if !settings.testDeviceIds.isEmpty {
            MobileAds.shared.requestConfiguration.testDeviceIdentifiers = settings.testDeviceIds
        }
        MobileAds.shared.start { [weak self] _ in
            Task { @MainActor in
                self?.sdkReady = true
                self?.runAfterSdk()
            }
        }
    }

    private func runAfterSdk() {
        let todo = afterSdk
        afterSdk.removeAll()
        for r in todo { r() }
    }

    private func invalidateAd() {
        generation += 1
        loadedAd = nil
    }

    private func loadReply(ready: Bool, reason: String?) -> [String: Any] {
        var o: [String: Any] = ["ready": ready]
        if let reason = reason { o["reason"] = reason }
        return o
    }

    // ————————————————————————————————————————— chargement

    func load(_ call: CAPPluginCall) {
        // Garde de production : configuration de démonstration / de debug en « Release » = aucune publicité
        if settings.releaseConfigurationRejected {
            call.resolve(loadReply(ready: false, reason: "config"))
            return
        }
        // Recontrôle UMP avant CHAQUE chargement
        if !ConsentInformation.shared.canRequestAds {
            invalidateAd()
            call.resolve(loadReply(ready: false, reason: "consent"))
            return
        }
        if !settings.hasUnit {
            call.resolve(loadReply(ready: false, reason: "config"))
            return
        }
        if loadedAd != nil && Date().timeIntervalSince(loadedAt) < adMaxAge {
            call.resolve(loadReply(ready: true, reason: nil))
            return
        }
        loadedAd = nil
        loadWaiters.append(call)
        if loading { return } // un seul chargement à la fois
        loading = true
        let gen = generation
        startSdk { [weak self] in self?.doLoad(gen) }
    }

    private func doLoad(_ gen: Int) {
        if !ConsentInformation.shared.canRequestAds {
            finishLoad(gen: gen, ad: nil, reason: "consent")
            return
        }
        RewardedAd.load(with: settings.rewardedUnitId, request: Request()) { [weak self] ad, error in
            Task { @MainActor in
                if error != nil || ad == nil {
                    self?.finishLoad(gen: gen, ad: nil, reason: "no_fill_or_error")
                } else {
                    self?.finishLoad(gen: gen, ad: ad, reason: nil)
                }
            }
        }
    }

    private func finishLoad(gen: Int, ad: RewardedAd?, reason: String?) {
        loading = false
        let stale = gen != generation // le choix de confidentialité a changé pendant le chargement : l'annonce est abandonnée
        if let ad = ad, !stale {
            loadedAd = ad
            loadedAt = Date()
        }
        let ready = loadedAd != nil
        let waiters = loadWaiters
        loadWaiters.removeAll()
        let why: String? = ready ? nil : (stale ? "stale" : reason)
        for c in waiters { c.resolve(loadReply(ready: ready, reason: why)) }
    }

    // ————————————————————————————————————————— affichage

    private func finishShow(_ s: ShowState, result: String, reason: String?) {
        if s.done { return }
        s.done = true
        if activeShow === s { activeShow = nil }
        var o: [String: Any] = ["result": result]
        if let reason = reason { o["reason"] = reason }
        s.call.resolve(o)
    }

    private func failed(_ reason: String) -> [String: Any] {
        return ["result": "failed", "reason": reason]
    }

    func show(_ call: CAPPluginCall, userId: String, customData: String, rootVC: UIViewController?) {
        if userId.isEmpty || customData.isEmpty {
            call.resolve(failed("bad_request")) // sans les identifiants de la session serveur, la vérification serveur ne pourrait jamais aboutir
            return
        }
        if settings.releaseConfigurationRejected {
            call.resolve(failed("config"))
            return
        }
        if activeShow != nil {
            call.resolve(failed("busy")) // appels simultanés : une seule publicité à la fois
            return
        }
        // Recontrôle UMP juste avant l'affichage
        if !ConsentInformation.shared.canRequestAds {
            invalidateAd()
            call.resolve(failed("consent"))
            return
        }
        guard let vc = rootVC, let ad = loadedAd, Date().timeIntervalSince(loadedAt) < adMaxAge else {
            loadedAd = nil
            call.resolve(failed("not_ready"))
            return
        }
        loadedAd = nil // une annonce = une seule projection
        let state = ShowState(call: call)
        activeShow = state
        // Options de vérification serveur à serveur AVANT la présentation
        let ssv = ServerSideVerificationOptions()
        ssv.userIdentifier = userId
        ssv.customRewardText = customData
        ad.serverSideVerificationOptions = ssv
        state.delegate.onDismiss = { [weak self] in
            // La fermeture ne doit pas effacer une récompense déjà gagnée ; sans récompense, elle ne peut jamais en produire une
            Task { @MainActor in self?.finishShow(state, result: state.earned ? "rewarded" : "dismissed", reason: nil) }
        }
        state.delegate.onFail = { [weak self] in
            Task { @MainActor in self?.finishShow(state, result: "failed", reason: "show_error") }
        }
        ad.fullScreenContentDelegate = state.delegate
        ad.present(from: vc) { state.earned = true }
    }
}
