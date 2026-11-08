// swift-tools-version: 5.10
// Everything with no UI: calendar, progress rules, storage, sync and reader rules.
// It builds on Linux too, so `swift test` runs anywhere a Swift toolchain does.
import PackageDescription

let package = Package(
    name: "ShnayimCore",
    defaultLocalization: "en",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "ShnayimCore", targets: ["ShnayimCore"])],
    targets: [
        .target(name: "ShnayimCore", resources: [.copy("Resources/calendar.json")]),
        .testTarget(name: "ShnayimCoreTests", dependencies: ["ShnayimCore"], exclude: ["web-parity.json"]),
    ]
)
