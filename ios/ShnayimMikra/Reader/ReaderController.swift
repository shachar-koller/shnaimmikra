import Foundation
import Observation
import ShnayimCore

/// The Chumash tab's reading session: which parsha, where in it, and in which view.
/// Ported from the state and actions in src/reader.js.
@MainActor
@Observable
final class ReaderController {
    struct Location: Equatable {
        let key: String
        let owner: String?
        let year: Int
        let id: String
        var position: ReaderPosition
    }

    enum TextState: Equatable {
        case loading
        case ready(ParshaText)
        case failed
    }

    static let saveFailed = "Progress could not be saved. Check this device's storage."

    @ObservationIgnored private unowned let app: AppModel
    @ObservationIgnored private let store = ReaderStore(store: DefaultsSettingsStore())
    @ObservationIgnored private let library: TextLibrary
    @ObservationIgnored private var opening = true
    @ObservationIgnored private var saveTimer: Task<Void, Never>?
    @ObservationIgnored private var dirty = false

    private(set) var location: Location? {
        didSet {
            let shown = location?.position.aliyah ?? 0
            if shown != aliyah { aliyah = shown }
        }
    }
    /// The aliyah on screen. Kept apart from the position, so scrolling doesn't redraw the text.
    private(set) var aliyah = 0
    private(set) var mode: ReaderMode = defaultReaderMode
    private(set) var text: TextState = .loading
    var saveNote = ""
    /// The parsha list is open.
    var choosingParsha = false
    /// Bumped when the view should scroll to the saved place, rather than follow the reader.
    private(set) var scrollRequest = 0

    init(app: AppModel) {
        self.app = app
        let base = Bundle.main.resourceURL ?? Bundle.main.bundleURL
        library = TextLibrary(directory: base.appendingPathComponent("chumash/v1", isDirectory: true))
    }

    var parsha: ParshaText? {
        switch text {
        case .ready(let parsha): return parsha
        default: return nil
        }
    }
    var position: ReaderPosition { location?.position ?? .start() }
    var progress: ParshaProgress { location.map { app.state($0.id) } ?? [:] }
    var name: String { location.map { titleName([$0.id], app.naming) } ?? "" }
    func aliyahName(_ index: Int? = nil) -> String { aliyahNames[index ?? position.aliyah] }

    // MARK: Session

    /// Selecting a parsha, here or in the tracker, lands here when the tab shows it.
    func sync(_ item: ParshaRow) {
        let owner = app.owner, year = app.year
        let key = "\(owner ?? "guest"):\(year):\(item.id)"
        if opening || location?.owner != owner {
            let preferred = app.prefs.defaultReaderMode
            mode = preferred ?? store.mode(owner: owner)
            if let preferred { store.saveMode(owner: owner, preferred) }
            opening = false
            scrollRequest += 1
        }
        guard location?.key != key else { return }
        flush()
        location = Location(key: key, owner: owner, year: year, id: item.id, position: store.position(owner: owner, year: year, id: item.id))
        saveNote = ""
        load(item.id)
        scrollRequest += 1
    }

    private func load(_ id: String) {
        if let known = library.peek(id) { apply(known); return }
        text = .loading
        do { apply(try library.load(id)) } catch { text = .failed }
    }

    private func apply(_ parsha: ParshaText) {
        text = .ready(parsha)
        // Resolve first: reading `position` inside the assignment would overlap the write to `location`.
        let resolved = resolvePosition(parsha, position)
        location?.position = resolved
    }

    func retry() {
        guard let id = location?.id else { return }
        load(id)
        scrollRequest += 1
    }

    func flush() {
        saveTimer?.cancel()
        guard dirty, let location else { return }
        dirty = false
        store.savePosition(owner: location.owner, year: location.year, id: location.id, location.position)
    }

    private func setPosition(_ position: ReaderPosition, later: Bool = false) {
        location?.position = position
        dirty = true
        if later {
            saveTimer?.cancel()
            saveTimer = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 250_000_000)
                guard !Task.isCancelled else { return }
                self?.flush()
            }
        } else { flush() }
    }

    /// Leaving the tab: the next visit opens in the preferred mode again.
    func left() {
        flush()
        opening = true
    }

    /// Nothing from the previous account stays in memory. Its bookmarks stay under its own keys.
    func reset() {
        flush()
        location = nil
        text = .loading
        opening = true
        saveNote = ""
    }

    // MARK: Following the reader

    /// The view reports the topmost reading on screen as they scroll.
    func track(ref: String, part: PasukPart, end: Bool) {
        guard parsha != nil else { return }
        let current = position
        // Classic has no parts. A new verse there starts its sequence over.
        let part = mode == .classic ? (ref == current.ref ? current.part : .first) : part
        guard ref != current.ref || part != current.part || end != current.end else { return }
        setPosition(ReaderPosition(aliyah: current.aliyah, ref: ref, part: part, end: end), later: true)
    }

    // MARK: Actions

    private func show(_ position: ReaderPosition) {
        saveNote = ""
        setPosition(position)
        scrollRequest += 1
    }

    func goToAliyah(_ index: Int) {
        guard (0..<aliyahCount).contains(index), index != position.aliyah || position.end else { return }
        show(parsha.map { resolvePosition($0, .start(index)) } ?? .start(index))
    }

    func canStep(_ direction: Int) -> Bool {
        guard let parsha else { return false }
        return stepPasuk(parsha, position, direction) != position
    }

    func step(_ direction: Int) {
        guard let parsha else { return }
        let next = stepPasuk(parsha, position, direction)
        if next != position { show(next) }
    }

    /// What the card underneath shows while one is dragged in `direction`.
    func peek(_ direction: Int) -> ReaderPosition? {
        guard let parsha else { return nil }
        let next = stepPasuk(parsha, position, direction)
        return next == position ? nil : next
    }

    func chooseMode(_ next: ReaderMode) {
        guard next != mode, let location else { return }
        mode = next
        store.saveMode(owner: location.owner, next)
        scrollRequest += 1
    }

    func chooseParsha(_ id: String) {
        app.select(id)
    }

    var nextParsha: ParshaRow? {
        let rows = app.rows
        guard let index = rows.firstIndex(where: { $0.id == location?.id }), index + 1 < rows.count else { return nil }
        return rows[index + 1]
    }

    /// Reading never marks anything; only these buttons do, and they only ever add checks.
    func mark(_ patch: [String: Bool]) {
        guard let id = location?.id, !isMarked(progress, patch) else { return }
        let wasComplete = isComplete(app.state(id))
        let saved = app.setProgress(id, patch)
        saveNote = saved ? "" : Self.saveFailed
        guard saved else { return }
        if !wasComplete && isComplete(app.state(id)) { app.celebrate() }
        else { Haptics.tap(app.prefs.vibration) }
    }

    /// Once this aliyah's marks are in, moving on is the obvious next step.
    var marksDone: Bool {
        let index = position.aliyah
        let patch = mode == .classic ? mikraPatch(.mikra1, index).merging(mikraPatch(.mikra2, index)) { $1 } : aliyahCompletionPatch(index)
        return isMarked(progress, patch)
    }

    // MARK: Describing the place

    var locationText: String {
        let aliyah = "Aliyah \(position.aliyah + 1)"
        guard let parsha else { return aliyah }
        if position.end && mode == .cards { return "\(aliyah) · End" }
        let (number, total) = pasukLocation(parsha, position)
        return "\(aliyah) · Pasuk \(number) of \(total)"
    }

    var readingProgress: (value: Int, total: Int, description: String)? {
        guard let parsha else { return nil }
        let (value, total) = parshaReadingProgress(parsha, position, mode: mode)
        let part = mode == .classic ? "Mikra" : position.part.label
        return (value, total, "\(value) of \(total) readings in \(name) · \(position.end ? "End of \(aliyahName())" : part)")
    }

    func pasukReference(_ verse: Verse) -> String {
        // From the text, not the position, so scrolling doesn't redraw every pasuk.
        let sefer = sefarim(for: app.naming)[seferOf(parsha?.id ?? "")].en
        return app.naming == .hebrew
            ? "\(sefer) \(hebrewNumber(verse.chapter)):\(hebrewNumber(verse.verse))"
            : "\(sefer) \(verse.chapter):\(verse.verse)"
    }
}
