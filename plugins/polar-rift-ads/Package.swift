// swift-tools-version: 5.9
import PackageDescription

// Plugin Capacitor local « polar-rift-ads » (iOS) : publicité récompensée AdMob + consentement UMP.
// Versions des SDK : branche maintenue pour Capacitor 8 (plugin communautaire capacitor-community/admob 8.2.x : Google Mobile Ads 13.11.0, UMP 3.1.x).
let package = Package(
    name: "PolarRiftAds",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "PolarRiftAds",
            targets: ["PolarRiftAdsPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/googleads/swift-package-manager-google-mobile-ads.git", exact: "13.11.0"),
        .package(url: "https://github.com/googleads/swift-package-manager-google-user-messaging-platform.git", .upToNextMinor(from: "3.1.0"))
    ],
    targets: [
        .target(
            name: "PolarRiftAdsPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "GoogleMobileAds", package: "swift-package-manager-google-mobile-ads"),
                .product(name: "GoogleUserMessagingPlatform", package: "swift-package-manager-google-user-messaging-platform")
            ],
            path: "ios/Sources/PolarRiftAdsPlugin")
    ]
)
