import Foundation

// Ported from src/preferences.js and the theme list in src/storage.js.

/// A palette from style.css. Colors are hex strings, so this module needs no UI framework.
public struct Theme: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let isDark: Bool
    public let page, card, ink, muted, line, track, selected, accent, onAccent, softInk: String
    public let readingBackground, readingOn, readingOnLine, checkLine, danger, warning: String
    public let buttonBackground, buttonInk, numberInk: String
    public let tile, readingLine, listLine: String

    public static func named(_ id: String) -> Theme { themes.first { $0.id == id } ?? themes[0] }
}

public let lightThemes = ["grayscale", "forest", "parchment", "tekhelet", "jerusalem-stone", "pomegranate", "etrog", "argaman", "shkiah", "hadas"]
public let darkThemes = ["dark-grayscale", "forest-dark", "midnight", "kinneret", "olive-press", "havdalah", "negev", "lailah", "kiddush", "bareket"]

public func validTheme(_ value: JSONValue?) -> String {
    if let id = value?.string, themes.contains(where: { $0.id == id }) { return id }
    return "grayscale"
}

public enum ReaderMode: String, CaseIterable, Sendable {
    case cards, flow, classic
    public var label: String { rawValue.capitalized }
}
public let defaultReaderMode = ReaderMode.flow

public enum TextSize: String, CaseIterable, Sendable { case standard, larger }

public let preferenceDefaults: [String: JSONValue] = [
    "followDevice": .bool(false), "lightTheme": .string("grayscale"), "darkTheme": .string("dark-grayscale"),
    "textSize": .string("standard"), "glass": JSONValue(50), "naming": .string("ashkenazi"),
    "confetti": .bool(true), "vibration": .bool(true), "defaultReaderMode": .string("last-used"),
    "reminderDays": .array([]), "reminderTime": .string("19:00"),
]
public let preferenceKeys = ["followDevice", "lightTheme", "darkTheme", "textSize", "glass", "naming", "confetti", "vibration",
                             "defaultReaderMode", "reminderDays", "reminderTime"]

private func isReminderTime(_ text: String) -> Bool {
    let parts = text.split(separator: ":", omittingEmptySubsequences: false)
    guard text.count == 5, parts.count == 2, parts.allSatisfy({ $0.count == 2 && $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) }),
          let hours = Int(parts[0]), let minutes = Int(parts[1]) else { return false }
    return hours < 24 && minutes < 60
}

private func isValidPreference(_ key: String, _ value: JSONValue) -> Bool {
    switch key {
    case "followDevice", "confetti", "vibration": return value.bool != nil
    case "lightTheme": return value.string.map(lightThemes.contains) ?? false
    case "darkTheme": return value.string.map(darkThemes.contains) ?? false
    case "textSize": return value.string.map { TextSize(rawValue: $0) != nil } ?? false
    case "glass": return value.integer.map { (0...100).contains($0) } ?? false
    case "naming": return value.string.map { Naming(rawValue: $0) != nil } ?? false
    case "defaultReaderMode": return value.string.map { $0 == "last-used" || ReaderMode(rawValue: $0) != nil } ?? false
    case "reminderDays":
        guard let days = value.array else { return false }
        let numbers = days.compactMap(\.integer)
        return numbers.count == days.count && numbers.allSatisfy { (0...6).contains($0) } && Set(numbers).count == numbers.count
    case "reminderTime": return value.string.map(isReminderTime) ?? false
    default: return false
    }
}

/// Every preference present in `raw` is valid. Absent ones are fine.
public func validPreferences(_ raw: [String: JSONValue]) -> Bool {
    preferenceKeys.allSatisfy { key in raw[key].map { isValidPreference(key, $0) } ?? true }
}

/// Absent preferences stay absent, so existing saves and older backups keep their defaults.
public func normalizePreferences(_ raw: [String: JSONValue]) -> [String: JSONValue] {
    var result: [String: JSONValue] = [:]
    for key in preferenceKeys {
        guard let value = raw[key] else { continue }
        if !isValidPreference(key, value) { result[key] = preferenceDefaults[key] }
        else if let days = value.array { result[key] = .array(days.sorted { ($0.integer ?? 0) < ($1.integer ?? 0) }) }
        else { result[key] = value }
    }
    return result
}

/// Preferences with defaults filled in, typed for the UI.
public struct Preferences: Equatable, Sendable {
    public var followDevice: Bool
    public var lightTheme: String
    public var darkTheme: String
    public var textSize: TextSize
    public var glass: Int
    public var naming: Naming
    public var confetti: Bool
    public var vibration: Bool
    /// nil means "last used".
    public var defaultReaderMode: ReaderMode?
    public var reminderDays: [Int]
    public var reminderTime: String

    public init(_ settings: [String: JSONValue]) {
        let values = preferenceDefaults.merging(normalizePreferences(settings)) { _, new in new }
        followDevice = values["followDevice"]?.bool ?? false
        lightTheme = values["lightTheme"]?.string ?? "grayscale"
        darkTheme = values["darkTheme"]?.string ?? "dark-grayscale"
        textSize = TextSize(rawValue: values["textSize"]?.string ?? "") ?? .standard
        glass = values["glass"]?.integer ?? 50
        naming = Naming(rawValue: values["naming"]?.string ?? "") ?? .ashkenazi
        confetti = values["confetti"]?.bool ?? true
        vibration = values["vibration"]?.bool ?? true
        defaultReaderMode = ReaderMode(rawValue: values["defaultReaderMode"]?.string ?? "")
        reminderDays = values["reminderDays"]?.array?.compactMap(\.integer) ?? []
        reminderTime = values["reminderTime"]?.string ?? "19:00"
    }

    public var reminderHourMinute: (hour: Int, minute: Int) {
        let parts = reminderTime.split(separator: ":").compactMap { Int($0) }
        return parts.count == 2 ? (parts[0], parts[1]) : (19, 0)
    }
}
