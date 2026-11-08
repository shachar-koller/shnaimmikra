import Foundation
import XCTest
@testable import ShnayimCore

// Ports of the web app's storage, sync and reader tests (tests/aliyah.test.js, preferences.test.js, reader.test.js).

private let key = "5787:Bereshit"
private func checked(_ reading: Reading) -> [String: Bool] { wholeReadingPatch(reading, checked: true) }
private func repository(_ values: [String: String] = [:]) -> Repository {
    let storage = MemoryStorage()
    storage.values = values
    return Repository(storage: storage)
}

final class FakeCloud: CloudAdapter {
    var progress: [String: [String: Bool]] = [:]
    var profile: [String: JSONValue]?
    var offline = false
    var writes: [[String: Bool]] = []
    var profileWrites: [[String: JSONValue]] = []

    func pull(userId: String) async throws -> RemoteState {
        if offline { throw DataError("offline") }
        return RemoteState(progress: progress, profile: profile)
    }
    func writeProgress(userId: String, key: String, patch: [String: Bool]) async throws {
        if offline { throw DataError("offline") }
        writes.append(patch)
        progress[key] = (progress[key] ?? [:]).merging(patch) { _, new in new }
    }
    func writeProfile(userId: String, patch: [String: JSONValue]) async throws {
        if offline { throw DataError("offline") }
        profileWrites.append(patch)
        profile = (profile ?? [:]).merging(patch) { _, new in new }
    }
    func clear(userId: String) async throws {
        if offline { throw DataError("offline") }
        progress = [:]
    }
}

final class RepositoryTests: XCTestCase {
    func testPendingEditsOverlayRefreshedRecordsAndAcknowledgeIndependently() throws {
        let start = JSON.string(.object(["progress": .object([key: .object(checked(.mikra1).mapValues(JSONValue.bool))])]))
        let repo = repository([storageKey("alice"): start])
        try repo.reading("alice", key: key, patch: ["mikra1_4": false])
        let sent = try repo.read("alice").pending
        XCTAssertEqual(pendingValues(sent.progress[key]!), ["mikra1_4": .bool(false)])
        try repo.acceptRemote("alice", RemoteState(progress: [key: checked(.mikra1).merging(["mikra2_6": true]) { $1 }], profile: nil))
        XCTAssertEqual(readingCount(try repo.read("alice").data.progress[key], .mikra1), 6)
        XCTAssertEqual(readingCount(try repo.read("alice").data.progress[key], .mikra2), 1)
        try repo.reading("alice", key: key, patch: ["mikra1_4": true])
        try repo.acknowledge("alice", sent: SentChanges(progress: sent.progress, profile: sent.profile))
        XCTAssertEqual(pendingValues(try repo.read("alice").pending.progress[key]!), ["mikra1_4": .bool(true)])
        XCTAssertNil(try repo.read(nil).data.progress[key])
    }

    func testResetKeepsOnlyLaterEditsAndGuestImportStaysSeparate() throws {
        let repo = repository()
        try repo.reading("alice", key: key, patch: ["mikra1_1": true])
        try repo.requestReset("alice")
        let reset = try repo.read("alice").pending.reset!
        try repo.reading("alice", key: key, patch: ["mikra2_4": true])
        try repo.acknowledgeReset("alice", resetId: reset)
        let progress = try repo.read("alice").data.progress[key]
        XCTAssertEqual(readingCount(progress, .mikra1), 0)
        XCTAssertEqual(readingCount(progress, .mikra2), 1)
        XCTAssertEqual(try repo.read("bob").data.progress, [:])
        try repo.reading(nil, key: key, patch: ["onkelos_3": true])
        try repo.importData("alice", try repo.read(nil).data, settings: false)
        XCTAssertEqual(readingCount(try repo.read("alice").data.progress[key], .onkelos), 1)
        XCTAssertEqual(readingCount(try repo.read(nil).data.progress[key], .mikra2), 0)
    }

    func testDeviceChoicesFillSettingsTheAccountNeverSaved() throws {
        let repo = repository()
        try repo.settings("account", patch: ["theme": .string("midnight"), "glass": JSONValue(35), "confetti": .bool(true), "peirushName": .string("Ramban")])
        let pending = try repo.read("account").pending
        try repo.acknowledge("account", sent: SentChanges(profile: pending.profile))
        try repo.acceptRemote("account", RemoteState(progress: [:], profile: [
            "israel": .bool(false), "commentary": .string("onkelos"), "theme": .null, "glass": JSONValue(70), "confetti": .null, "peirushName": .null,
        ]))
        XCTAssertEqual(pendingValues(try repo.read("account").pending.profile), ["theme": .string("midnight"), "peirushName": .string("Ramban")])
        XCTAssertEqual(try repo.read("account").data.preferences.glass, 70)
        let fresh = repository()
        try fresh.acceptRemote("account", RemoteState(progress: [:], profile: ["israel": .bool(false), "commentary": .string("onkelos"), "theme": .null, "glass": .null]))
        XCTAssertFalse(try fresh.read("account").hasPending)
    }

    func testClearingTheCustomPeirushSendsTheDefault() throws {
        let repo = repository()
        try repo.settings("alice", patch: ["peirushName": .string("Ramban")])
        try repo.acknowledge("alice", sent: SentChanges(profile: try repo.read("alice").pending.profile))
        try repo.settings("alice", patch: ["peirushName": .null])
        XCTAssertNil(try repo.read("alice").data.settings["peirushName"])
        XCTAssertEqual(pendingValues(try repo.read("alice").pending.profile), ["peirushName": .string("Rashi")])
    }

    func testGuestsHaveNoPendingAndIdenticalWritesAreSkipped() throws {
        let storage = MemoryStorage()
        let repo = Repository(storage: storage)
        try repo.reading(nil, key: key, patch: ["mikra1_1": true])
        XCTAssertFalse(try repo.read(nil).hasPending)
        storage.failWrites = true
        // Nothing changes, so nothing is written and nothing fails.
        XCTAssertNoThrow(try repo.reading(nil, key: key, patch: ["mikra1_1": true]))
        XCTAssertThrowsError(try repo.reading(nil, key: key, patch: ["mikra1_2": true]))
    }

    func testUnsupportedStorageVersionIsRefused() {
        let repo = repository([storageKey("alice"): #"{"storageVersion":3,"progress":{}}"#])
        XCTAssertThrowsError(try repo.read("alice"))
    }
}

@MainActor
final class SyncTests: XCTestCase {
    func testOfflineDevicesMergeDifferentAliyosAndUntouchedCachesNeverUpload() async throws {
        let cloud = FakeCloud()
        cloud.progress = [key: checked(.mikra1)]
        cloud.offline = true
        let a = repository(), b = repository()
        try a.reading("alice", key: key, patch: ["mikra1_2": false])
        try b.reading("alice", key: key, patch: ["mikra1_3": false, "mikra2_7": true])
        let engineA = SyncEngine(repository: a, cloud: cloud, userId: "alice")
        let engineB = SyncEngine(repository: b, cloud: cloud, userId: "alice")
        do {
            try await engineA.sync()
            XCTFail("Expected offline")
        } catch {}
        XCTAssertTrue(try a.read("alice").hasPending)
        cloud.offline = false
        try await engineB.sync()
        try await engineA.sync()
        try await engineB.sync()
        for repo in [a, b] {
            let progress = try repo.read("alice").data.progress[key]
            XCTAssertEqual(readingCount(progress, .mikra1), 5)
            XCTAssertEqual(progress?["mikra2_7"], true)
            XCTAssertFalse(try repo.read("alice").hasPending)
        }
        XCTAssertEqual(cloud.writes, [["mikra1_3": false, "mikra2_7": true], ["mikra1_2": false]])
        try await engineA.sync()
        XCTAssertEqual(cloud.writes.count, 2)
        await engineA.stop()
        await engineB.stop()
    }

    func testTwoDevicesShareSettings() async throws {
        let cloud = FakeCloud()
        cloud.profile = ["israel": .bool(false), "commentary": .string("onkelos")]
        let a = repository(), b = repository()
        let engineA = SyncEngine(repository: a, cloud: cloud, userId: "alice")
        let engineB = SyncEngine(repository: b, cloud: cloud, userId: "alice")
        try a.settings("alice", patch: ["theme": .string("midnight"), "glass": JSONValue(35), "defaultReaderMode": .string("classic")])
        try await engineA.sync()
        try await engineB.sync()
        XCTAssertEqual(try b.read("alice").data.theme, "midnight")
        XCTAssertEqual(try b.read("alice").data.preferences.glass, 35)
        XCTAssertEqual(try b.read("alice").data.preferences.defaultReaderMode, .classic)
        try b.settings("alice", patch: ["theme": .string("forest")])
        try await engineB.sync()
        try await engineA.sync()
        XCTAssertEqual(try a.read("alice").data.theme, "forest")
        XCTAssertEqual(try a.read("alice").data.preferences.glass, 35)
        XCTAssertFalse(try a.read("alice").hasPending || b.read("alice").hasPending)
        await engineA.stop()
        await engineB.stop()
    }

    func testClearPersistsTheResetBeforeContactingTheServer() async throws {
        let cloud = FakeCloud()
        cloud.progress = [key: checked(.mikra1)]
        let repo = repository()
        let engine = SyncEngine(repository: repo, cloud: cloud, userId: "alice")
        try await engine.sync()
        XCTAssertEqual(readingCount(try repo.read("alice").data.progress[key], .mikra1), 7)
        cloud.offline = true
        do { try await engine.clear(); XCTFail("Expected offline") } catch {}
        XCTAssertNotNil(try repo.read("alice").pending.reset)
        cloud.offline = false
        try await engine.sync()
        XCTAssertEqual(try repo.read("alice").data.progress, [:])
        XCTAssertEqual(cloud.progress, [:])
        XCTAssertFalse(try repo.read("alice").hasPending)
        await engine.stop()
    }

    func testConcurrentSyncsShareOneRun() async throws {
        let cloud = FakeCloud()
        let repo = repository()
        try repo.reading("alice", key: key, patch: ["mikra1_1": true])
        var states: [SyncStatus] = []
        let engine = SyncEngine(repository: repo, cloud: cloud, userId: "alice", onState: { states.append($0) })
        async let first: Void = engine.sync()
        async let second: Void = engine.sync()
        _ = try await (first, second)
        XCTAssertEqual(cloud.writes.count, 1)
        XCTAssertEqual(states.filter { $0 == .syncing }.count, 1)
        XCTAssertEqual(states.last, .ok)
        await engine.stop()
    }
}

final class ReadingTests: XCTestCase {
    func testCommentaryChoiceAndSwap() {
        XCTAssertEqual(chosenCommentary([:], fallback: .rashi), .rashi)
        XCTAssertEqual(chosenCommentary(["rashi_1": true]), .rashi)
        XCTAssertEqual(chosenCommentary(["rashi_1": true, "onkelos_2": true], fallback: .rashi), .rashi)
        let progress: ParshaProgress = ["onkelos_1": true, "onkelos_2": true, "rashi_2": true]
        let patch = commentarySwapPatch(progress, from: .onkelos, to: .rashi)
        XCTAssertEqual(patch, ["rashi_1": true, "onkelos_1": false])
        let swapped = applyReadingPatch(progress, patch)
        XCTAssertEqual(applyReadingPatch(swapped, commentarySwapPatch(swapped, from: .rashi, to: .onkelos)), progress)
    }

    func testMixedCommentaryNeverCompletesTheThirdReading() {
        var progress = checked(.mikra1).merging(checked(.mikra2)) { $1 }
        for index in 0..<4 { progress[aliyahField(.onkelos, index)] = true }
        for index in 4..<7 { progress[aliyahField(.rashi, index)] = true }
        XCTAssertEqual(steps(progress), 2)
        XCTAssertFalse(isComplete(progress))
        XCTAssertEqual(aliyahSteps(progress), 18)
    }

    func testPreferencesValidation() {
        XCTAssertTrue(validPreferences(["reminderDays": .array([JSONValue(0), JSONValue(6)]), "reminderTime": .string("23:59")]))
        XCTAssertFalse(validPreferences(["reminderDays": .array([JSONValue(1), JSONValue(1)])]))
        XCTAssertFalse(validPreferences(["reminderTime": .string("24:00")]))
        XCTAssertFalse(validPreferences(["glass": .number(50.5)]))
        XCTAssertFalse(validPreferences(["lightTheme": .string("midnight")]))
        XCTAssertEqual(Preferences([:]).defaultReaderMode, nil)
        XCTAssertEqual(Preferences(["defaultReaderMode": .string("cards")]).defaultReaderMode, .cards)
    }
}

final class ReaderTests: XCTestCase {
    static let textDirectory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("public/chumash/v1")
    let library = TextLibrary(directory: ReaderTests.textDirectory)

    func testEveryParshaLoadsWithSevenAliyosAndAllVerses() throws {
        var total = 0
        for id in ParshaCalendar.shared.ids {
            let parsha = try library.load(id)
            XCTAssertEqual(parsha.aliyot.count, 7, id)
            for aliyah in parsha.aliyot {
                XCTAssertFalse(aliyah.verses.isEmpty, id)
                for verse in aliyah.verses {
                    XCTAssertNotNil(verse.torah, "\(id) \(verse.ref)")
                    XCTAssertNotNil(verse.onkelos, "\(id) \(verse.ref)")
                }
            }
            total += parsha.aliyot.reduce(0) { $0 + $1.verses.count }
        }
        XCTAssertEqual(total, 5846)
    }

    func testFormatsAndBreaksSurvive() throws {
        let bereshit = try library.load("Bereshit")
        let first = bereshit.aliyot[0].verses[0]
        XCTAssertEqual(first.ref, "1:1")
        XCTAssertEqual(first.torah?.first, .formatted(.big, "בְּ"))
        let parts = ParshaCalendar.shared.ids.flatMap { id in
            (try? library.load(id))?.aliyot.flatMap { $0.verses.flatMap { ($0.torah ?? []) + ($0.onkelos ?? []) } } ?? []
        }
        XCTAssertEqual(parts.filter { $0 == .petuchah }.count, 291)
        XCTAssertEqual(parts.filter { $0 == .setumah }.count, 379)
    }

    func testStepsWalkAnAliyahStopAtItsEndAndGoBackAcrossBoundaries() throws {
        let parsha = try library.load("Bereshit")
        var position = resolvePosition(parsha, .start(0))
        XCTAssertEqual(position.ref, "1:1")
        XCTAssertEqual(stepPasuk(parsha, position, -1), position)
        let count = parsha.aliyot[0].verses.count
        for _ in 0..<(count - 1) { position = stepPasuk(parsha, position, 1) }
        XCTAssertEqual(position.ref, "2:3")
        position = stepPasuk(parsha, position, 1)
        XCTAssertTrue(position.end)
        XCTAssertEqual(stepPasuk(parsha, position, 1), position)
        XCTAssertEqual(stepPasuk(parsha, position, -1), ReaderPosition(aliyah: 0, ref: "2:3"))
        XCTAssertEqual(stepPasuk(parsha, resolvePosition(parsha, .start(1)), -1), ReaderPosition(aliyah: 0, ref: "2:3"))
        XCTAssertEqual(pasukLocation(parsha, ReaderPosition(aliyah: 0, ref: "2:3")).number, count)
    }

    func testReadingProgressCountsEachReading() throws {
        let parsha = try library.load("Bereshit")
        let total = parsha.aliyot.reduce(0) { $0 + $1.verses.count }
        XCTAssertEqual(parshaReadingProgress(parsha, resolvePosition(parsha, .start(0)), mode: .flow).value, 1)
        XCTAssertEqual(parshaReadingProgress(parsha, resolvePosition(parsha, .start(0)), mode: .flow).total, total * 3)
        var position = resolvePosition(parsha, .start(0))
        position.part = .second
        XCTAssertEqual(parshaReadingProgress(parsha, position, mode: .cards).value, 3)
        XCTAssertEqual(parshaReadingProgress(parsha, position, mode: .classic).value, 1)
        let end = ReaderPosition(aliyah: 6, ref: parsha.aliyot[6].verses.last!.ref, end: true)
        XCTAssertEqual(parshaReadingProgress(parsha, end, mode: .flow).value, total * 3)
    }

    func testPositionsFromStorageAreCleaned() throws {
        let parsha = try library.load("Noach")
        XCTAssertEqual(ReaderPosition.clean(try JSON.parse(#"{"aliyah":9}"#)), .start())
        XCTAssertEqual(ReaderPosition.clean(try JSON.parse(#"{"aliyah":2,"ref":"7:1","part":"weird","end":1}"#)),
                       ReaderPosition(aliyah: 2, ref: "7:1"))
        XCTAssertEqual(resolvePosition(parsha, ReaderPosition(aliyah: 0, ref: "50:1", part: .second)).ref, parsha.aliyot[0].verses[0].ref)
    }

    func testBookmarksAreScopedToOwnerCycleAndParsha() {
        let store = ReaderStore(store: MemorySettingsStore())
        store.savePosition(owner: nil, year: 5787, id: "Noach", ReaderPosition(aliyah: 3, ref: "8:1", part: .targum))
        XCTAssertEqual(store.position(owner: nil, year: 5787, id: "Noach"), ReaderPosition(aliyah: 3, ref: "8:1", part: .targum))
        XCTAssertEqual(store.position(owner: "alice", year: 5787, id: "Noach"), .start())
        XCTAssertEqual(store.position(owner: nil, year: 5788, id: "Noach"), .start())
        XCTAssertEqual(store.mode(owner: "alice"), .flow)
        store.saveMode(owner: "alice", .cards)
        XCTAssertEqual(store.mode(owner: "alice"), .cards)
        XCTAssertEqual(store.mode(owner: nil), .flow)
    }

    func testCompletionPatchesAndMarkCounts() {
        XCTAssertEqual(aliyahCompletionPatch(2), ["mikra1_3": true, "mikra2_3": true, "onkelos_3": true])
        XCTAssertEqual(mikraPatch(.mikra2, 0), ["mikra2_1": true])
        XCTAssertEqual(aliyahMarkCount(["mikra1_1": true, "rashi_1": true, "onkelos_2": true], 0), 2)
        XCTAssertTrue(isMarked(["mikra1_1": true, "mikra2_1": true], mikraPatch(.mikra1, 0)))
    }

    func testSlugs() {
        XCTAssertEqual(textSlug("Beha'alotcha"), "beha-alotcha")
        XCTAssertEqual(textSlug("Achrei Mot"), "achrei-mot")
        XCTAssertEqual(textSlug("Lech-Lecha"), "lech-lecha")
        XCTAssertEqual(Set(ParshaCalendar.shared.ids.map(textSlug)).count, ParshaCalendar.shared.ids.count)
    }
}
