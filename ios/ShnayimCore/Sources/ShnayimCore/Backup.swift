import Foundation

// Ported from src/backup.js and progressText in src/progress.js. Backups are the same
// files the web app writes and reads, so either app can restore the other's.

public let maxBackupBytes = 2 * 1024 * 1024
private let backupFormat = "shnayim-mikra-backup"

private func isoTimestamp(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

public func createBackup(_ data: AppData, now: Date = Date()) -> String {
    let backup: JSONValue = .object([
        "format": .string(backupFormat), "version": JSONValue(2), "exportedAt": .string(isoTimestamp(now)),
        "data": .object(normalizeData(data).json),
    ])
    return JSON.string(backup, pretty: true) + "\n"
}

public func parseBackup(_ text: String) throws -> AppData {
    guard text.utf8.count <= maxBackupBytes else { throw DataError("Backup exceeds the 2 MB limit.") }
    guard let backup = try? JSON.parse(text) else { throw DataError("Choose a valid JSON backup.") }
    guard backup["format"]?.string == backupFormat, backup["version"] == JSONValue(2) else {
        throw DataError("Unsupported backup format or version.")
    }
    let invalidSettings = DataError("The backup contains invalid settings or progress.")
    guard let data = backup["data"]?.object, let progress = data["progress"]?.object, data["israel"]?.bool != nil,
          let commentary = data["commentary"]?.string, ["rashi", "onkelos"].contains(commentary),
          let theme = data["theme"]?.string, themes.contains(where: { $0.id == theme }),
          validPreferences(data) else { throw invalidSettings }
    if let peirush = data["peirushName"] {
        guard let name = peirush.string, name.utf16.count <= 80 else { throw invalidSettings }
    }
    let parshiyos = ParshaCalendar.shared.idSet
    for (key, value) in progress {
        guard let (year, id) = splitProgressKey(key), key.prefix(while: { $0 != ":" }).count == 4,
              (5000...9998).contains(year), parshiyos.contains(id), let fields = value.object,
              fields.allSatisfy({ isAliyahField($0.key) && $0.value.bool != nil }) else {
            throw DataError("The backup contains an invalid progress record.")
        }
    }
    return try normalizeData(.object(data))
}

public struct BackupSummary: Equatable, Sendable {
    public let parshiyos: Int
    public let completed: Int
    public let aliyos: Int
    public let cycles: [String]
}

public func backupSummary(_ data: AppData) -> BackupSummary {
    let entries = data.progress.filter { hasReadingProgress($0.value) }
    return BackupSummary(
        parshiyos: entries.count,
        completed: entries.values.filter(isComplete).count,
        aliyos: entries.values.reduce(0) { sum, progress in sum + Reading.allCases.reduce(0) { $0 + readingCount(progress, $1) } },
        cycles: Set(entries.keys.compactMap { $0.split(separator: ":").first.map(String.init) }).sorted())
}

/// A readable summary of every cycle, for people rather than for restoring.
public func progressText(_ data: AppData, name: (String) -> String = { $0 }, now: Date = Date()) -> String {
    let entries = data.progress.filter { hasReadingProgress($0.value) }
    let years = Set(entries.keys.compactMap { splitProgressKey($0)?.year }).sorted()
    var lines = [
        "Shnayim Mikra — Progress",
        "Exported: \(isoTimestamp(now))",
        "Parsha calendar: \(data.israel ? "Israel" : "Diaspora")",
        "Parshiyos with progress: \(entries.count)",
        "Completed: \(entries.values.filter(isComplete).count)",
    ]
    if entries.isEmpty { lines += ["", "No progress recorded yet."] }
    for year in years {
        let order = Dictionary(uniqueKeysWithValues: ParshaCalendar.shared.schedule(year: year, israel: data.israel).enumerated().map { ($1.id, $0) })
        let cycle = entries.compactMap { key, progress -> (String, ParshaProgress)? in
            guard let split = splitProgressKey(key), split.year == year else { return nil }
            return (split.id, progress)
        }.sorted { a, b in
            let left = order[a.0] ?? .max, right = order[b.0] ?? .max
            return left != right ? left < right : a.0 < b.0
        }
        lines += ["", "Cycle \(year)–\(year + 1)", "--------------------"]
        for (id, progress) in cycle {
            lines += ["", "\(name(id)) — \(isComplete(progress) ? "Complete" : "In progress")"]
            let commentary = chosenCommentary(progress, fallback: data.commentary)
            for reading in [Reading.mikra1, .mikra2, commentary] {
                let count = readingCount(progress, reading)
                lines.append("  [\(count == 7 ? "x" : " ")] \(data.readingLabel(reading)) — \(count) of 7 aliyos")
                if count > 0 && count < 7 {
                    for (index, checked) in readingChecks(progress, reading).enumerated() {
                        lines.append("    [\(checked ? "x" : " ")] \(aliyahNames[index])")
                    }
                }
            }
        }
    }
    return lines.joined(separator: "\n") + "\n"
}
