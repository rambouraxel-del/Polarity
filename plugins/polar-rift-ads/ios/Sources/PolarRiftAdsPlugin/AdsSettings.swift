import Foundation

/// Configuration publicitaire déclarée par l'APPLICATION (Info.plist, bloc `PolarRiftAds` généré depuis mobile/ads.json par `npm run mobile:ads -- --apply`).
/// Identifiants publics, aucun secret. Une valeur absente laisse la fonction désactivée (jamais d'identifiant inventé).
struct AdsSettings {
    let mode: String
    let rewardedUnitId: String
    let testDeviceIds: [String]
    let umpGeography: String

    static func read() -> AdsSettings {
        let d = Bundle.main.object(forInfoDictionaryKey: "PolarRiftAds") as? [String: Any] ?? [:]
        return AdsSettings(
            mode: d["mode"] as? String ?? "",
            rewardedUnitId: d["rewardedUnitId"] as? String ?? "",
            testDeviceIds: (d["testDeviceIds"] as? [String]) ?? [],
            umpGeography: d["umpDebugGeography"] as? String ?? "off")
    }

    var hasUnit: Bool { !rewardedUnitId.isEmpty }

    /// Débogage du consentement : seulement dans un build de développement ET si la configuration le demande (jamais en production).
    var umpDebugEnabled: Bool {
        #if DEBUG
        return umpGeography != "off"
        #else
        return false
        #endif
    }

    /// Garde de production : un build « Release » configuré avec les identifiants de démonstration, des appareils de test ou un débogage du consentement
    /// n'affiche AUCUNE publicité (échec fermé). Le contrôle de publication `npm run mobile:ads -- --release` l'interdit déjà avant l'archivage.
    var releaseConfigurationRejected: Bool {
        #if DEBUG
        return false
        #else
        return mode != "live" || umpGeography != "off" || !testDeviceIds.isEmpty
        #endif
    }
}
