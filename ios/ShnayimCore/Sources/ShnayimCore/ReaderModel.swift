import Foundation

// Ported from src/reader-model.js: positions, navigation, bookmarks and completion patches.

public enum PasukPart: String, CaseIterable, Sendable, Codable {
    case first, targum, second
    public var label: String {
        switch self {
        case .first: "Mikra I"
        case .targum: "Targum Onkelos"
        case .second: "Mikra II"
        }
    }
}

public let shnayimMikraReadings: [Reading] = [.mikra1, .mikra2, .onkelos]

/// A place in a parsha: an aliyah, a pasuk in it and which reading of that pasuk,
/// or the end of the aliyah.
public struct ReaderPosition: Equatable, Hashable, Sendable, Codable {
    public var aliyah: Int
    public var ref: String?
    public var part: PasukPart
    public var end: Bool

    public init(aliyah: Int = 0, ref: String? = nil, part: PasukPart = .first, end: Bool = false) {
        self.aliyah = aliyah
        self.ref = ref
        self.part = part
        self.end = end
    }

    public static func start(_ aliyah: Int = 0) -> ReaderPosition { ReaderPosition(aliyah: aliyah) }

    /// Accepts anything from storage; returns a well-formed position or a fresh start.
    public static func clean(_ raw: JSONValue?) -> ReaderPosition {
        guard let aliyah = raw?["aliyah"]?.integer, (0..<aliyahCount).contains(aliyah) else { return .start() }
        return ReaderPosition(aliyah: aliyah, ref: raw?["ref"]?.string,
                              part: PasukPart(rawValue: raw?["part"]?.string ?? "") ?? .first,
                              end: raw?["end"] == .bool(true))
    }

    var json: JSONValue {
        .object(["aliyah": JSONValue(aliyah), "ref": ref.map(JSONValue.string) ?? .null, "part": .string(part.rawValue), "end": .bool(end)])
    }
}

/// Fits a position to the loaded text. A verse outside the aliyah starts the aliyah over.
public func resolvePosition(_ parsha: ParshaText, _ position: ReaderPosition) -> ReaderPosition {
    let aliyah = (0..<aliyahCount).contains(position.aliyah) ? position.aliyah : 0
    let verses = parsha.aliyot[aliyah].verses
    if verses.contains(where: { $0.ref == position.ref }) {
        return ReaderPosition(aliyah: aliyah, ref: position.ref, part: position.part, end: position.end)
    }
    return ReaderPosition(aliyah: aliyah, ref: verses[0].ref)
}

/// One pasuk forward or back. Returns the same position when there is nowhere to go.
public func stepPasuk(_ parsha: ParshaText, _ position: ReaderPosition, _ direction: Int) -> ReaderPosition {
    let aliyah = position.aliyah
    let verses = parsha.aliyot[aliyah].verses
    let index = verses.firstIndex { $0.ref == position.ref } ?? -1
    if direction > 0 {
        if position.end { return position }
        if index == verses.count - 1 { return ReaderPosition(aliyah: aliyah, ref: position.ref, end: true) }
        return ReaderPosition(aliyah: aliyah, ref: verses[index + 1].ref)
    }
    if position.end { return ReaderPosition(aliyah: aliyah, ref: verses[verses.count - 1].ref) }
    if index > 0 { return ReaderPosition(aliyah: aliyah, ref: verses[index - 1].ref) }
    if aliyah > 0 { return ReaderPosition(aliyah: aliyah - 1, ref: parsha.aliyot[aliyah - 1].verses.last?.ref) }
    return position
}

public func pasukLocation(_ parsha: ParshaText, _ position: ReaderPosition) -> (number: Int, total: Int) {
    let verses = parsha.aliyot[position.aliyah].verses
    return ((verses.firstIndex { $0.ref == position.ref } ?? -1) + 1, verses.count)
}

/// Position across the entire parsha, counting each reading of a pasuk separately.
public func parshaReadingProgress(_ parsha: ParshaText, _ position: ReaderPosition, mode: ReaderMode) -> (value: Int, total: Int) {
    let counts = parsha.aliyot.map(\.verses.count)
    let preceding = counts.prefix(position.aliyah).reduce(0, +)
    let readings = mode == .classic ? 1 : PasukPart.allCases.count
    let total = counts.reduce(0, +) * readings
    if position.end { return ((preceding + counts[position.aliyah]) * readings, total) }
    let number = pasukLocation(parsha, position).number
    let part = mode == .classic ? 0 : PasukPart.allCases.firstIndex(of: position.part)!
    return ((preceding + number - 1) * readings + part + 1, total)
}

public func aliyahCompletionPatch(_ aliyah: Int) -> [String: Bool] {
    Dictionary(uniqueKeysWithValues: shnayimMikraReadings.map { (aliyahField($0, aliyah), true) })
}
public func mikraPatch(_ reading: Reading, _ aliyah: Int) -> [String: Bool] {
    precondition(reading == .mikra1 || reading == .mikra2, "\(reading) is not a mikra reading")
    return [aliyahField(reading, aliyah): true]
}
/// Readings marked for one aliyah. Either commentary counts, as it does in the tracker's steps.
public func aliyahMarkCount(_ progress: ParshaProgress?, _ aliyah: Int) -> Int {
    [Reading.mikra1, .mikra2].filter { progress?[aliyahField($0, aliyah)] == true }.count
        + ([Reading.onkelos, .rashi].contains { progress?[aliyahField($0, aliyah)] == true } ? 1 : 0)
}
public func isMarked(_ progress: ParshaProgress?, _ patch: [String: Bool]) -> Bool {
    patch.keys.allSatisfy { progress?[$0] == true }
}

/// Simple string settings the reader keeps on this device, such as UserDefaults.
public protocol SettingsStore: AnyObject {
    func string(forKey key: String) -> String?
    func set(_ value: String?, forKey key: String)
}

/// Bookmarks live apart from progress, scoped to guest or account, then cycle and parsha.
/// They stay on this device, as on the web.
public final class ReaderStore {
    private let store: SettingsStore
    public init(store: SettingsStore) { self.store = store }

    private func owner(_ owner: String?) -> String { owner ?? "guest" }
    private func positionKey(_ owner: String?, _ year: Int, _ id: String) -> String {
        "shnaim-mikra-reader-position:\(self.owner(owner)):\(year):\(id)"
    }

    public func position(owner: String?, year: Int, id: String) -> ReaderPosition {
        guard let saved = store.string(forKey: positionKey(owner, year, id)) else { return .start() }
        return ReaderPosition.clean(try? JSON.parse(saved))
    }

    public func savePosition(owner: String?, year: Int, id: String, _ position: ReaderPosition) {
        store.set(JSON.string(position.json), forKey: positionKey(owner, year, id))
    }

    public func mode(owner: String?) -> ReaderMode {
        ReaderMode(rawValue: store.string(forKey: "shnaim-mikra-reader-mode:\(self.owner(owner))") ?? "") ?? defaultReaderMode
    }

    public func saveMode(owner: String?, _ mode: ReaderMode) {
        store.set(mode.rawValue, forKey: "shnaim-mikra-reader-mode:\(self.owner(owner))")
    }
}

public final class MemorySettingsStore: SettingsStore {
    public var values: [String: String] = [:]
    public init() {}
    public func string(forKey key: String) -> String? { values[key] }
    public func set(_ value: String?, forKey key: String) { values[key] = value }
}
