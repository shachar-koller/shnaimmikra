import Foundation

// Ported from createSyncEngine in src/sync.js.

/// The account's storage. The app implements it with Supabase; tests with memory.
public protocol CloudAdapter: AnyObject {
    func pull(userId: String) async throws -> RemoteState
    /// Only the edited fields are written, so readings made on another device are preserved.
    func writeProgress(userId: String, key: String, patch: [String: Bool]) async throws
    func writeProfile(userId: String, patch: [String: JSONValue]) async throws
    func clear(userId: String) async throws
}

public enum SyncStatus: String, Sendable {
    case local, pending, syncing, ok, error
}

/// Sends pending edits in order, then takes the account's state. One run at a time;
/// failures retry with backoff, and nothing pending is ever dropped.
@MainActor
public final class SyncEngine {
    private let repository: Repository
    private let cloud: CloudAdapter
    private let userId: String
    private let onState: (SyncStatus) -> Void
    private let onData: (AppData) -> Void
    private var active: Task<Void, Error>?
    private var timer: Task<Void, Never>?
    private var stopped = false
    private var retryDelay: Double = 1

    public init(repository: Repository, cloud: CloudAdapter, userId: String,
                onState: @escaping (SyncStatus) -> Void = { _ in }, onData: @escaping (AppData) -> Void = { _ in }) {
        self.repository = repository
        self.cloud = cloud
        self.userId = userId
        self.onState = onState
        self.onData = onData
    }

    private func schedule(after seconds: Double = 0.4) {
        guard !stopped else { return }
        timer?.cancel()
        timer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled else { return }
            try? await self?.sync()
        }
    }

    private func drain() async throws {
        while !stopped {
            let pending = try repository.read(userId).pending
            if let reset = pending.reset {
                try await cloud.clear(userId: userId)
                try repository.acknowledgeReset(userId, resetId: reset)
                continue
            }
            if let key = pending.progress.keys.sorted().first, let fields = pending.progress[key] {
                try await cloud.writeProgress(userId: userId, key: key, patch: pendingChecks(fields))
                try repository.acknowledge(userId, sent: SentChanges(progress: [key: fields]))
            } else if !pending.profile.isEmpty {
                try await cloud.writeProfile(userId: userId, patch: pendingValues(pending.profile))
                try repository.acknowledge(userId, sent: SentChanges(profile: pending.profile))
            } else { return }
        }
    }

    private func run() async throws {
        if stopped { return }
        if try repository.read(userId).hasPending { try await drain() }
        if stopped { return }
        let remote = try await cloud.pull(userId: userId)
        if stopped { return }
        let record = try repository.acceptRemote(userId, remote)
        onData(record.data)
        retryDelay = 1
        onState(record.hasPending ? .pending : .ok)
        if record.hasPending { schedule() }
    }

    /// Joins a run already in progress rather than starting another.
    public func sync() async throws {
        if stopped { return }
        timer?.cancel()
        if let active { return try await active.value }
        onState(.syncing)
        let task = Task { try await self.run() }
        active = task
        defer { if active == task { active = nil } }
        do {
            try await task.value
        } catch {
            if !stopped {
                onState(.error)
                schedule(after: retryDelay)
                retryDelay = min(retryDelay * 2, 60)
            }
            throw error
        }
    }

    public func changed() {
        onState(.pending)
        schedule()
    }

    public func clear() async throws {
        timer?.cancel()
        if let active { _ = try? await active.value }
        if stopped { throw DataError("Account changed") }
        // Persist intent before touching the server, so a crash or storage failure
        // after deletion cannot cause old pending edits to recreate the data.
        try repository.requestReset(userId)
        try await sync()
    }

    public func stop() async {
        stopped = true
        timer?.cancel()
        if let active { _ = try? await active.value }
    }
}
