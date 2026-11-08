import Foundation

// Ported from createRepository in src/storage.js. Saved data is the local truth for guests;
// for accounts it is a cache plus the explicit edits not yet acknowledged by the server.

/// Where records are saved. The app uses files; tests use memory.
public protocol RecordStorage: AnyObject {
    func read(_ key: String) throws -> String?
    func write(_ key: String, _ value: String) throws
}

public final class MemoryStorage: RecordStorage {
    public var values: [String: String] = [:]
    public var failWrites = false
    public init() {}
    public func read(_ key: String) throws -> String? { values[key] }
    public func write(_ key: String, _ value: String) throws {
        if failWrites { throw DataError("Storage is full") }
        values[key] = value
    }
}

public let guestStorageKey = "shnaim-mikra-v1"
public func storageKey(_ userId: String?) -> String { userId.map { "shnaim-mikra-v2:account:\($0)" } ?? guestStorageKey }

/// One explicit edit. Its id lets an acknowledgement remove exactly what was sent.
public struct PendingOperation: Equatable, Sendable {
    public let id: String
    public let value: JSONValue
    public init(id: String = PendingOperation.newId(), value: JSONValue) { self.id = id; self.value = value }
    public static func newId() -> String {
        (0..<16).map { _ in String(format: "%02x", UInt8.random(in: .min ... .max)) }.joined()
    }
    var json: JSONValue { .object(["id": .string(id), "value": value]) }
    init?(json: JSONValue) {
        guard let id = json["id"]?.string, let value = json["value"] else { return nil }
        self.id = id
        self.value = value
    }
}

public struct Pending: Equatable, Sendable {
    public var progress: [String: [String: PendingOperation]] = [:]
    public var profile: [String: PendingOperation] = [:]
    public var reset: String?
    public init() {}

    public var isEmpty: Bool { reset == nil && progress.isEmpty && profile.isEmpty }

    var json: JSONValue {
        var object: [String: JSONValue] = [
            "progress": .object(progress.mapValues { .object($0.mapValues(\.json)) }),
            "profile": .object(profile.mapValues(\.json)),
        ]
        if let reset { object["reset"] = .string(reset) }
        return .object(object)
    }
    init(json: JSONValue?) {
        for (key, fields) in json?["progress"]?.object ?? [:] {
            let operations = (fields.object ?? [:]).compactMapValues(PendingOperation.init(json:))
            if !operations.isEmpty { progress[key] = operations }
        }
        profile = (json?["profile"]?.object ?? [:]).compactMapValues(PendingOperation.init(json:))
        reset = json?["reset"]?.string
    }
}

public func pendingValues(_ fields: [String: PendingOperation]) -> [String: JSONValue] { fields.mapValues(\.value) }
func pendingChecks(_ fields: [String: PendingOperation]) -> [String: Bool] { fields.compactMapValues(\.value.bool) }

public struct StoredRecord: Equatable, Sendable {
    public var data: AppData
    public var pending: Pending
    public var hasPending: Bool { !pending.isEmpty }
}

/// The parts of a pending record sent in one request, for `acknowledge`.
public struct SentChanges: Sendable {
    public var progress: [String: [String: PendingOperation]] = [:]
    public var profile: [String: PendingOperation] = [:]
    public init(progress: [String: [String: PendingOperation]] = [:], profile: [String: PendingOperation] = [:]) {
        self.progress = progress
        self.profile = profile
    }
}

/// What the account holds. Profile values are nil or `.null` for settings it never saved.
public struct RemoteState: Sendable {
    public var progress: [String: [String: Bool]]
    public var profile: [String: JSONValue]?
    public init(progress: [String: [String: Bool]], profile: [String: JSONValue]?) {
        self.progress = progress
        self.profile = profile
    }
}

public final class Repository {
    private let storage: RecordStorage
    public init(storage: RecordStorage) { self.storage = storage }

    public func read(_ userId: String?) throws -> StoredRecord {
        let raw = try storage.read(storageKey(userId)).map { try JSON.parse($0) }
        if let version = raw?["storageVersion"], version != JSONValue(2) { throw DataError("Unsupported storage version") }
        let data = try normalizeData(raw ?? .object(AppData.empty().json))
        return StoredRecord(data: data, pending: userId != nil ? Pending(json: raw?["pending"]) : Pending())
    }

    @discardableResult
    private func write(_ userId: String?, _ record: StoredRecord) throws -> StoredRecord {
        var object = record.data.json
        if userId != nil {
            object["storageVersion"] = JSONValue(2)
            object["pending"] = record.pending.json
        }
        let serialized = JSON.string(.object(object))
        if try storage.read(storageKey(userId)) != serialized { try storage.write(storageKey(userId), serialized) }
        return record
    }

    @discardableResult
    private func change(_ userId: String?, _ update: (inout StoredRecord) -> Void) throws -> StoredRecord {
        var record = try read(userId)
        update(&record)
        return try write(userId, record)
    }

    private func patchReading(_ record: inout StoredRecord, _ userId: String?, _ key: String, _ patch: [String: Bool]) {
        let expanded = readingPatch(patch)
        guard !expanded.isEmpty else { return }
        let checked = applyReadingPatch(record.data.progress[key], expanded)
        record.data.progress[key] = checked.isEmpty ? nil : checked
        if userId != nil {
            var pending = record.pending.progress[key] ?? [:]
            for (field, value) in expanded { pending[field] = PendingOperation(value: .bool(value)) }
            record.pending.progress[key] = pending
        }
    }

    /// A nil value (`.null`) removes an optional setting, such as a custom peirush.
    private func patchSettings(_ record: inout StoredRecord, _ userId: String?, _ patch: [String: JSONValue]) {
        for key in settingKeys {
            guard let value = patch[key], value != (record.data.settings[key] ?? .null) else { continue }
            record.data.settings[key] = value == .null ? nil : value
            // Clearing the custom label saves the default, so other devices see it as a change.
            if userId != nil {
                record.pending.profile[key] = PendingOperation(value: key == "peirushName" ? .string(peirushName(value)) : value)
            }
        }
    }

    @discardableResult
    public func reading(_ userId: String?, key: String, patch: [String: Bool]) throws -> StoredRecord {
        try change(userId) { patchReading(&$0, userId, key, patch) }
    }

    @discardableResult
    public func settings(_ userId: String?, patch: [String: JSONValue]) throws -> StoredRecord {
        try change(userId) { patchSettings(&$0, userId, patch) }
    }

    @discardableResult
    public func clear(_ userId: String?) throws -> StoredRecord {
        try change(userId) {
            $0.data.progress = [:]
            $0.pending.progress = [:]
        }
    }

    @discardableResult
    public func requestReset(_ userId: String?) throws -> StoredRecord {
        try change(userId) {
            $0.pending.reset = PendingOperation.newId()
            // The explicit reset supersedes all earlier reading edits.
            $0.pending.progress = [:]
        }
    }

    @discardableResult
    public func acknowledgeReset(_ userId: String?, resetId: String) throws -> StoredRecord {
        try change(userId) { record in
            guard record.pending.reset == resetId else { return }
            record.pending.reset = nil
            record.data.progress = [:]
            // Keep edits made after the reset was requested.
            for (key, fields) in record.pending.progress {
                let checked = applyReadingPatch([:], pendingChecks(fields))
                if !checked.isEmpty { record.data.progress[key] = checked }
            }
        }
    }

    /// Explicit, additive import only. Normal synchronization never unions caches.
    @discardableResult
    public func importData(_ userId: String?, _ imported: AppData, settings includeSettings: Bool = true) throws -> StoredRecord {
        try change(userId) { record in
            for (key, value) in imported.progress {
                var patch: [String: Bool] = [:]
                for reading in Reading.allCases {
                    let current = readingChecks(record.pending.reset != nil ? [:] : record.data.progress[key], reading)
                    for (index, checked) in readingChecks(value, reading).enumerated() where checked && !current[index] {
                        patch[aliyahField(reading, index)] = true
                    }
                }
                if !patch.isEmpty { patchReading(&record, userId, key, patch) }
            }
            if includeSettings {
                var settings = imported.settings
                settings["peirushName"] = imported.settings["peirushName"] ?? .null
                patchSettings(&record, userId, settings)
            }
        }
    }

    @discardableResult
    public func acknowledge(_ userId: String?, sent: SentChanges) throws -> StoredRecord {
        try change(userId) { record in
            for (field, operation) in sent.profile where record.pending.profile[field]?.id == operation.id {
                record.pending.profile[field] = nil
            }
            for (key, fields) in sent.progress {
                guard var current = record.pending.progress[key] else { continue }
                for (field, operation) in fields where current[field]?.id == operation.id { current[field] = nil }
                record.pending.progress[key] = current.isEmpty ? nil : current
            }
        }
    }

    /// Server state is authoritative except for explicit, unacknowledged edits.
    @discardableResult
    public func acceptRemote(_ userId: String?, _ remote: RemoteState) throws -> StoredRecord {
        try change(userId) { record in
            let remoteData = try? normalizeData(.object(["progress": .object(remote.progress.mapValues { .object($0.mapValues(JSONValue.bool)) })]))
            record.data.progress = remoteData?.progress ?? [:]
            for (key, fields) in record.pending.progress {
                let next = applyReadingPatch(record.data.progress[key], pendingChecks(fields))
                record.data.progress[key] = next.isEmpty ? nil : next
            }
            if let profile = remote.profile {
                for key in settingKeys where record.pending.profile[key] == nil {
                    if let value = profile[key], value != .null { record.data.settings[key] = value }
                    // The account has never saved this setting, so a choice already made here becomes its value.
                    else if let local = record.data.settings[key], local != settingDefaults[key] {
                        record.pending.profile[key] = PendingOperation(value: local)
                    }
                }
            }
            for (key, value) in pendingValues(record.pending.profile) { record.data.settings[key] = value }
            record.data = normalizeData(record.data)
        }
    }
}
