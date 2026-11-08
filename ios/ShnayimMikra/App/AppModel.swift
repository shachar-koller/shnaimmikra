import Foundation
import Observation
import ShnayimCore
import UIKit

/// The session (guest or account, sync) and what the tracker shows. Ported from
/// src/session.js and the state at the top of src/ui.js.
@MainActor
@Observable
final class AppModel {
    enum Tab: String, CaseIterable, Identifiable {
        case tracker, chumash, settings, account
        var id: String { rawValue }
        var label: String { rawValue.capitalized }
    }

    let auth = AuthService()
    private let repository = Repository(storage: FileRecordStorage())
    private let defaults = UserDefaults.standard
    @ObservationIgnored private var engine: SyncEngine?
    @ObservationIgnored private var queue: Task<Void, Never>?
    @ObservationIgnored private var initialized = false
    @ObservationIgnored private var listening = false
    let calendar = ParshaCalendar.shared
    @ObservationIgnored private(set) var reader: ReaderController!

    private(set) var user: AccountUser?
    private(set) var data: AppData = .empty()
    private(set) var status: SyncStatus = .local
    private(set) var storageOK = true
    private(set) var ready: Bool
    var guestChosen: Bool {
        didSet { defaults.set(guestChosen ? true : nil, forKey: "shnaim-mikra-guest-choice") }
    }

    var tab: Tab = .tracker {
        didSet {
            if oldValue == .chumash && tab != .chumash { reader.left() }
            if oldValue != tab { statusMessage = "" }
        }
    }
    var year: Int
    /// The selected parsha, or nil for this week's.
    var chosen: String?
    /// The sefer the list shows, or nil to follow the selected parsha.
    var activeSefer: Int?
    var expanded: [String: Set<Reading>] = [:]
    /// Set when a parsha was just finished, for its "Yasher koach" line.
    var completedFeedback: String?
    /// Counts celebrations, so each one plays its confetti once.
    var celebration = 0
    var today = LocalDay.today()
    var systemDark = false
    /// The last message about an action on the Settings or Account tab.
    var statusMessage = ""
    var busy = false
    @ObservationIgnored private var commentaryPicks: [String: Reading] = [:]

    var cloudEnabled: Bool { auth != nil }

    init() {
        ready = AuthService.configured == false
        guestChosen = UserDefaults.standard.bool(forKey: "shnaim-mikra-guest-choice")
        year = ParshaCalendar.shared.cycleYear()
        load()
        year = calendar.cycleYear(today, israel: data.israel)
        reader = ReaderController(app: self)
    }

    // MARK: Session

    private func load() {
        do {
            data = try repository.read(user?.id).data
            storageOK = true
        } catch {
            data = .empty()
            storageOK = false
        }
    }

    func start() {
        guard !listening else { return }
        listening = true
        guard let auth else { ready = true; return }
        Task { [weak self] in
            for await next in auth.users() {
                await self?.enqueue(next)
            }
        }
    }

    private func enqueue(_ next: AccountUser?) async {
        let previous = queue
        let task = Task { await previous?.value; await self.activate(next) }
        queue = task
        await task.value
    }

    private func activate(_ next: AccountUser?) async {
        if initialized && next?.id == user?.id {
            ready = true
            return
        }
        initialized = true
        await engine?.stop()
        engine = nil
        let previousUser = user
        user = next
        ready = true
        load()
        status = next == nil ? .local : .pending
        if next != nil || previousUser != nil { guestChosen = false }
        completedFeedback = nil
        reader.reset()
        year = calendar.cycleYear(today, israel: data.israel)
        chosen = nil
        activeSefer = nil
        tab = .tracker
        statusMessage = ""
        Task { await Reminders.apply(data.preferences, ask: false) }
        guard let next, let auth else { return }
        let owner = next.id
        let engine = SyncEngine(repository: repository, cloud: SupabaseCloud(client: auth.client), userId: owner,
            onState: { [weak self] value in
                guard let self, self.user?.id == owner else { return }
                self.status = value
            },
            onData: { [weak self] value in
                guard let self, self.user?.id == owner else { return }
                self.receive(value)
            })
        self.engine = engine
        try? await engine.sync()
    }

    private func receive(_ value: AppData) {
        let previous = data
        data = value
        storageOK = true
        if previous.israel != value.israel {
            year = calendar.cycleYear(today, israel: value.israel)
            chosen = nil
            activeSefer = nil
        }
        let before = previous.preferences, after = value.preferences
        if before.reminderDays != after.reminderDays || before.reminderTime != after.reminderTime {
            Task { await Reminders.apply(after, ask: false) }
        }
    }

    @discardableResult
    private func mutate(_ work: (String?) throws -> StoredRecord) -> Bool {
        do {
            let record = try work(user?.id)
            data = record.data
            storageOK = true
            if record.hasPending { engine?.changed() }
            return true
        } catch {
            storageOK = false
            return false
        }
    }

    func retry() {
        Task { try? await engine?.sync() }
    }

    func refresh() async throws {
        await queue?.value
        if let engine { try await engine.sync() }
    }

    func clearAll() async throws {
        await queue?.value
        if let engine { try await engine.clear() }
        else if !mutate({ try repository.clear($0) }) { throw DataError("Storage failed") }
        load()
        clearCommentaryPicks()
        completedFeedback = nil
    }

    func logout() async throws {
        await queue?.value
        // Pending changes are already saved and belong only to this account.
        // A network failure must not discard them or prevent a local sign-out.
        try? await engine?.sync()
        try await auth?.signOut()
        await enqueue(nil)
    }

    func signIn() async throws {
        guard let auth else { throw DataError("Sign-in is unavailable.") }
        try await auth.signInWithGoogle()
    }

    func guestData() throws -> AppData { try repository.read(nil).data }

    func importData(_ imported: AppData, owner: String?, settings: Bool) throws {
        guard user?.id == owner else { throw DataError("The account changed. Open the preview again.") }
        guard mutate({ try repository.importData($0, imported, settings: settings) }) else {
            throw DataError("Could not import progress. Check storage and your account, then try again.")
        }
        Task { await Reminders.apply(data.preferences, ask: false) }
    }

    /// Refreshes an open app after midnight, or on returning to it in a new cycle.
    func refreshCalendar() {
        let now = LocalDay.today()
        guard now != today else { return }
        let oldCycle = calendar.cycleYear(today, israel: data.israel)
        today = now
        if year == oldCycle { year = calendar.cycleYear(now, israel: data.israel) }
    }

    // MARK: Reading the data

    var owner: String? { user?.id }
    var prefs: Preferences { data.preferences }
    var naming: Naming { prefs.naming }
    var rows: [ParshaRow] { calendar.schedule(year: year, israel: data.israel) }
    var thisCycle: Int { calendar.cycleYear(today, israel: data.israel) }
    var weekly: ParshaRow { currentParsha(rows, today: today) }
    var item: ParshaRow { rows.first { $0.id == chosen } ?? weekly }
    var themeId: String { data.resolvedTheme(systemDark: systemDark) }

    func state(_ id: String) -> ParshaProgress { data.progress(year: year, id: id) }
    func viewKey(_ id: String) -> String { "\(owner ?? "guest"):\(year):\(id)" }
    func readingLabel(_ reading: Reading) -> String { data.readingLabel(reading) }
    func titleName(_ names: [String]) -> String { ShnayimCore.titleName(names, naming) }
    func heroName(_ names: [String]) -> String { ShnayimCore.heroName(names, naming) }

    private func pickKey(_ id: String) -> String { "commentary-pick:\(viewKey(id))" }
    /// Covers a parsha switched before anything is checked. Once there are checks, they decide.
    private func pickedCommentary(_ id: String) -> Reading? {
        if let saved = defaults.string(forKey: pickKey(id)).flatMap(Reading.init(rawValue:)), saved.isCommentary { return saved }
        return commentaryPicks[pickKey(id)]
    }
    private func pickCommentary(_ id: String, _ commentary: Reading) {
        commentaryPicks[pickKey(id)] = commentary
        defaults.set(commentary.rawValue, forKey: pickKey(id))
    }
    private func clearCommentaryPicks() {
        let prefix = "commentary-pick:\(owner ?? "guest"):"
        commentaryPicks = commentaryPicks.filter { !$0.key.hasPrefix(prefix) }
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(prefix) { defaults.removeObject(forKey: key) }
    }
    func commentaryOf(_ id: String) -> Reading {
        chosenCommentary(state(id), fallback: pickedCommentary(id) ?? data.commentary)
    }

    /// The reading in progress, as "Mikra II: 3 of 7 aliyos".
    func readingDetail(_ id: String) -> String {
        let progress = state(id)
        guard let reading = [Reading.mikra1, .mikra2, commentaryOf(id)].first(where: {
            let count = readingCount(progress, $0)
            return count > 0 && count < 7
        }) else { return "" }
        return "\(readingLabel(reading)): \(readingCount(progress, reading)) of 7 aliyos"
    }

    // MARK: Changing progress

    @discardableResult
    func setProgress(_ id: String, _ patch: [String: Bool]) -> Bool {
        mutate { try repository.reading($0, key: progressKey(year, id), patch: patch) }
    }

    /// Saves a progress change from the tracker, with its feedback.
    func updateReading(_ id: String, _ reading: Reading, _ patch: [String: Bool]) {
        let before = readingCount(state(id), reading)
        let wasComplete = isComplete(state(id))
        guard setProgress(id, patch) else { return }
        if reading.isCommentary { pickCommentary(id, reading) }
        let finished = !wasComplete && isComplete(state(id))
        completedFeedback = finished ? viewKey(id) : nil
        if finished { celebrate() }
        else if readingCount(state(id), reading) > before { Haptics.tap(prefs.vibration) }
    }

    func celebrate() {
        if prefs.confetti && !UIAccessibility.isReduceMotionEnabled { celebration += 1 }
        Haptics.success(prefs.vibration)
    }

    func toggleReading(_ id: String, _ reading: Reading) {
        updateReading(id, reading, wholeReadingPatch(reading, checked: !readingComplete(state(id), reading)))
    }

    func toggleAliyah(_ id: String, _ reading: Reading, _ index: Int) {
        updateReading(id, reading, [aliyahField(reading, index): !readingChecks(state(id), reading)[index]])
    }

    func switchCommentary(_ id: String) {
        let current = commentaryOf(id), next = current.other
        pickCommentary(id, next)
        guard setProgress(id, commentarySwapPatch(state(id), from: current, to: next)) else {
            pickCommentary(id, current)
            return
        }
        var open = expanded[viewKey(id)] ?? []
        if open.remove(current) != nil { open.insert(next) }
        expanded[viewKey(id)] = open
    }

    func toggleExpanded(_ id: String, _ reading: Reading) {
        var open = expanded[viewKey(id)] ?? []
        if open.contains(reading) { open.remove(reading) } else { open.insert(reading) }
        expanded[viewKey(id)] = open
    }

    func select(_ id: String?) {
        chosen = id
        activeSefer = id.map(seferOf)
        completedFeedback = nil
    }

    // MARK: Settings

    /// Saves settings. `.null` removes an optional one, such as a custom peirush.
    func saveSettings(_ patch: [String: JSONValue]) {
        let before = prefs
        let saved = mutate { try repository.settings($0, patch: patch) }
        statusMessage = saved ? "" : "Changed, but this device could not save it."
        let after = prefs
        if before.reminderDays != after.reminderDays || before.reminderTime != after.reminderTime {
            Task { await Reminders.apply(after, ask: true) }
        }
    }

    func setIsrael(_ israel: Bool) {
        saveSettings(["israel": .bool(israel)])
        year = calendar.cycleYear(today, israel: israel)
        chosen = nil
        activeSefer = nil
    }

    func setCycle(_ cycle: Int) {
        year = cycle
        chosen = nil
        activeSefer = nil
    }
}

extension AuthService {
    static var configured: Bool { AppConfig.supabaseURL != nil && AppConfig.supabaseKey != nil }
}
