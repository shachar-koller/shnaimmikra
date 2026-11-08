import Foundation
import ShnayimCore

/// Saves each guest or account record as its own file in Application Support,
/// written atomically so a crash never leaves half a record.
final class FileRecordStorage: RecordStorage {
    private let directory: URL

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        directory = base.appendingPathComponent("Progress", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    private func url(_ key: String) -> URL {
        let safe = key.map { $0.isLetter || $0.isNumber || $0 == "-" ? String($0) : "_" }.joined()
        return directory.appendingPathComponent("\(safe).json")
    }

    func read(_ key: String) throws -> String? {
        let url = url(key)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try String(contentsOf: url, encoding: .utf8)
    }

    func write(_ key: String, _ value: String) throws {
        try Data(value.utf8).write(to: url(key), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

/// Reader bookmarks and other device-only choices.
final class DefaultsSettingsStore: SettingsStore {
    private let defaults: UserDefaults
    init(defaults: UserDefaults = .standard) { self.defaults = defaults }
    func string(forKey key: String) -> String? { defaults.string(forKey: key) }
    func set(_ value: String?, forKey key: String) { defaults.set(value, forKey: key) }
}
