import AuthenticationServices
import Foundation
import ShnayimCore
import Supabase

/// The Supabase project, from Config/Supabase.xcconfig through Info.plist.
/// Without it the app works as on the web without keys: on this device only.
enum AppConfig {
    static let supabaseURL: URL? = {
        guard let host = Bundle.main.object(forInfoDictionaryKey: "SupabaseHost") as? String,
              !host.isEmpty, !host.contains("$(") else { return nil }
        return URL(string: "https://\(host)")
    }()
    static let supabaseKey: String? = {
        guard let key = Bundle.main.object(forInfoDictionaryKey: "SupabaseAnonKey") as? String,
              !key.isEmpty, !key.contains("$(") else { return nil }
        return key
    }()
    /// Must be listed in Supabase → Authentication → URL Configuration → Redirect URLs.
    static let authCallback = URL(string: "shnayimmikra://auth-callback")!
}

struct AccountUser: Equatable {
    let id: String
    let email: String?
    let name: String?

    init(_ user: User) {
        id = user.id.uuidString.lowercased()
        email = user.email
        name = user.userMetadata["name"]?.stringValue ?? user.userMetadata["full_name"]?.stringValue
    }

    var initial: String {
        let source = (email ?? name ?? "•").trimmingCharacters(in: .whitespaces)
        return source.first.map { String($0).uppercased() } ?? "•"
    }
}

final class AuthService {
    let client: SupabaseClient

    init?() {
        guard let url = AppConfig.supabaseURL, let key = AppConfig.supabaseKey else { return nil }
        // A stalled request can stay open for minutes, and sync and sign-out wait on them.
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 15
        client = SupabaseClient(supabaseURL: url, supabaseKey: key, options: SupabaseClientOptions(
            auth: .init(redirectToURL: AppConfig.authCallback, flowType: .pkce, autoRefreshToken: true,
                        emitLocalSessionAsInitialSession: true),
            global: .init(session: URLSession(configuration: configuration))
        ))
    }

    /// Emits the saved session first, then every sign-in and sign-out.
    func users() -> AsyncStream<AccountUser?> {
        AsyncStream { continuation in
            let task = Task {
                for await (_, session) in client.auth.authStateChanges {
                    continuation.yield(session.map { AccountUser($0.user) })
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    @MainActor
    func signInWithGoogle() async throws {
        _ = try await client.auth.signInWithOAuth(provider: .google, redirectTo: AppConfig.authCallback)
    }

    func signOut() async throws {
        do {
            try await client.auth.signOut(scope: .local)
        } catch {
            // Supabase clears this device's session even if the server can't be reached,
            // so that case is a successful local sign-out, not a failure.
            if client.auth.currentSession != nil { throw error }
        }
    }
}

/// Ported from createCloudAdapter in src/sync.js: one profiles row and one progress row per parsha.
final class SupabaseCloud: CloudAdapter {
    private let client: SupabaseClient
    init(client: SupabaseClient) { self.client = client }

    private static func column(_ key: String) -> String {
        key.reduce(into: "") { result, character in
            if character.isUppercase { result += "_" + character.lowercased() } else { result.append(character) }
        }
    }

    private func pullAllProgress(_ userId: String) async throws -> [[String: JSONValue]] {
        var rows: [[String: JSONValue]] = []
        var offset = 0
        while true {
            let page: [[String: JSONValue]] = try await client.from("progress")
                .select((["year", "parsha_id"] + aliyahFields).joined(separator: ", "))
                .eq("user_id", value: userId)
                .order("year").order("parsha_id")
                .range(from: offset, to: offset + 999)
                .execute().value
            rows += page
            if page.count < 1000 { return rows }
            offset += 1000
        }
    }

    func pull(userId: String) async throws -> RemoteState {
        let profiles: [[String: JSONValue]] = try await client.from("profiles")
            .select(settingKeys.map(Self.column).joined(separator: ", "))
            .eq("id", value: userId)
            .limit(1)
            .execute().value
        let rows = try await pullAllProgress(userId)
        var progress: [String: [String: Bool]] = [:]
        for row in rows {
            guard let year = row["year"]?.integer, let id = row["parsha_id"]?.string else { continue }
            progress[progressKey(year, id)] = readingPatch(row.compactMapValues(\.bool))
        }
        let profile = profiles.first.map { row in
            Dictionary(uniqueKeysWithValues: settingKeys.map { ($0, row[Self.column($0)] ?? .null) })
        }
        return RemoteState(progress: progress, profile: profile)
    }

    func writeProgress(userId: String, key: String, patch: [String: Bool]) async throws {
        guard let (year, id) = splitProgressKey(key) else { return }
        // Only edited columns take part in ON CONFLICT UPDATE, so other devices' readings stay.
        var row: [String: JSONValue] = ["user_id": .string(userId), "year": JSONValue(year), "parsha_id": .string(id)]
        for (field, value) in readingPatch(patch) { row[field] = .bool(value) }
        try await client.from("progress").upsert(JSONValue.object(row), onConflict: "user_id,year,parsha_id", returning: .minimal).execute()
    }

    func writeProfile(userId: String, patch: [String: JSONValue]) async throws {
        var row: [String: JSONValue] = ["id": .string(userId)]
        for (key, value) in patch { row[Self.column(key)] = value }
        try await client.from("profiles").upsert(JSONValue.object(row), onConflict: "id", returning: .minimal).execute()
    }

    func clear(userId: String) async throws {
        try await client.from("progress").delete().eq("user_id", value: userId).execute()
    }
}
