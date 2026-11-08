import Foundation

// Ported from normalizeData in src/storage.js and peirushName in src/progress.js.

public struct DataError: LocalizedError, Equatable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

public let settingKeys = ["israel", "commentary", "theme", "peirushName"] + preferenceKeys
public let settingDefaults: [String: JSONValue] = preferenceDefaults.merging([
    "israel": .bool(false), "commentary": .string("onkelos"), "theme": .string("grayscale"), "peirushName": .string("Rashi"),
]) { _, new in new }

public func peirushName(_ value: JSONValue?) -> String {
    guard let text = value?.string else { return "Rashi" }
    let collapsed = text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    let name = String(collapsed.prefix(80))
    return name.isEmpty ? "Rashi" : name
}

/// Everything one person has saved: checks per "year:parsha", and settings.
/// Settings keep JSON values so they round-trip with the account and backups;
/// `israel`, `commentary` and `theme` are always present after normalizing.
public struct AppData: Equatable, Sendable {
    public var progress: [String: ParshaProgress]
    public var settings: [String: JSONValue]

    public static func empty() -> AppData {
        AppData(progress: [:], settings: ["israel": .bool(false), "commentary": .string("onkelos"), "theme": .string("grayscale")])
    }

    public var israel: Bool { settings["israel"]?.bool ?? false }
    public var commentary: Reading { settings["commentary"]?.string == "rashi" ? .rashi : .onkelos }
    public var theme: String { validTheme(settings["theme"]) }
    public var peirushLabel: String { peirushName(settings["peirushName"]) }
    public var preferences: Preferences { Preferences(settings) }

    public func progress(year: Int, id: String) -> ParshaProgress { progress[progressKey(year, id)] ?? [:] }

    /// The theme to show now. Following the device picks the light or dark choice.
    public func resolvedTheme(systemDark: Bool) -> String {
        let prefs = preferences
        return prefs.followDevice ? (systemDark ? prefs.darkTheme : prefs.lightTheme) : theme
    }

    public func readingLabel(_ reading: Reading) -> String {
        switch reading {
        case .mikra1: "Mikra I"
        case .mikra2: "Mikra II"
        case .onkelos: "Targum"
        case .rashi: peirushLabel
        }
    }

    /// The flat shape the web app saves and backs up: `{ progress, israel, commentary, theme, … }`.
    public var json: [String: JSONValue] {
        var result = settings
        result["progress"] = .object(progress.mapValues { .object($0.mapValues(JSONValue.bool)) })
        return result
    }
}

private func isProgressKey(_ key: String) -> Bool {
    guard let colon = key.firstIndex(of: ":") else { return false }
    let year = key[..<colon]
    return year.count == 4 && year.allSatisfy { $0.isASCII && $0.isNumber } && key.index(after: colon) < key.endIndex
}

/// Accepts anything from storage, an account or a backup; returns well-formed data.
public func normalizeData(_ raw: JSONValue) throws -> AppData {
    guard let object = raw.object else { throw DataError("Invalid saved data") }
    var progress: [String: ParshaProgress] = [:]
    for (key, value) in object["progress"]?.object ?? [:] {
        guard isProgressKey(key), let fields = value.object else { continue }
        let checked = normalizeProgress(fields.compactMapValues { $0 == .bool(true) ? true : nil })
        if !checked.isEmpty { progress[key] = checked }
    }
    var settings = normalizePreferences(object)
    settings["israel"] = .bool(object["israel"] == .bool(true))
    settings["commentary"] = .string(object["commentary"]?.string == "rashi" ? "rashi" : "onkelos")
    settings["theme"] = .string(validTheme(object["theme"]))
    let peirush = peirushName(object["peirushName"])
    if peirush != "Rashi" { settings["peirushName"] = .string(peirush) }
    return AppData(progress: progress, settings: settings)
}

public func normalizeData(_ data: AppData) -> AppData {
    (try? normalizeData(.object(data.json))) ?? .empty()
}
