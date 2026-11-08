import Foundation
import XCTest
@testable import ShnayimCore

/// Compares the port with what the web app's own code returns (scripts/build-ios-parity-fixture.mjs).
final class WebParityTests: XCTestCase {
    static let fixture: JSONValue = {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("web-parity.json")
        return try! JSON.parse(Data(contentsOf: url))
    }()
    var fixture: JSONValue { Self.fixture }
    let calendar = ParshaCalendar.shared

    func testCycleYearMatchesEveryDay() {
        for entry in fixture["cycleYears"]!.array! {
            let values = entry.array!.map { $0.integer! }
            let day = LocalDay(number: values[0])
            XCTAssertEqual(calendar.cycleYear(day, israel: false), values[1], "diaspora \(day.components)")
            XCTAssertEqual(calendar.cycleYear(day, israel: true), values[2], "israel \(day.components)")
        }
    }

    func testSchedulesMatch() {
        for entry in fixture["schedules"]!.array! {
            let year = entry["year"]!.integer!, israel = entry["israel"]!.bool!
            let expected = entry["rows"]!.array!.map { "\($0.array![0].string!)@\($0.array![1].integer!)" }
            let actual = calendar.schedule(year: year, israel: israel).map { "\($0.id)@\($0.day.number)" }
            XCTAssertEqual(actual, expected, "\(year) israel=\(israel)")
        }
    }

    func testCurrentParshaAndCountdown() {
        for entry in fixture["current"]!.array! {
            let day = LocalDay(number: entry.array![0].integer!)
            let rows = calendar.schedule(year: calendar.cycleYear(day), israel: false)
            let current = currentParsha(rows, today: day)
            XCTAssertEqual(current.id, entry.array![1].string!)
            XCTAssertEqual(shabbosCountdown(current.day, today: day), entry.array![2].string!)
        }
    }

    func testDates() {
        let entry = fixture["dates"]!.array![0].array!
        let day = LocalDay(number: entry[0].integer!)
        XCTAssertEqual(formatGregorianDate(day), entry[1].string!)
        XCTAssertEqual(formatGregorianDate(day, withYear: true), entry[2].string!)
        XCTAssertEqual(day.components.year, 2026)
        XCTAssertEqual(LocalDay(year: 2026, month: 11, day: 14), day)
    }

    func testNames() {
        for entry in fixture["names"]!.array! {
            let id = entry["id"]!.string!
            XCTAssertEqual(fixName(id), entry["ashkenazi"]!.string!)
            XCTAssertEqual(fixName(id, .sephardi), entry["sephardi"]!.string!)
            XCTAssertEqual(fixName(id, .hebrew), entry["hebrew"]!.string!)
            XCTAssertEqual(heroName([id]), entry["hero"]!.string!)
            XCTAssertEqual(heroName([id], .sephardi), entry["heroSephardi"]!.string!)
            XCTAssertEqual(heroName([id], .hebrew), entry["heroHebrew"]!.string!)
            XCTAssertEqual(hebrewName([id]), entry["he"]!.string!)
        }
        for entry in fixture["doubles"]!.array! {
            let names = entry["names"]!.array!.map { $0.string! }
            XCTAssertEqual(titleName(names), entry["title"]!.string!)
            XCTAssertEqual(titleName(names, .hebrew), entry["titleHebrew"]!.string!)
            XCTAssertEqual(heroName(names), entry["hero"]!.string!)
            XCTAssertEqual(hebrewName(names), entry["he"]!.string!)
        }
    }

    func testNormalizeData() throws {
        let data = try normalizeData(fixture["messy"]!)
        XCTAssertEqual(JSONValue.object(data.json), fixture["normalized"]!)
    }

    func testBackupRoundTripsWithTheWebApp() throws {
        let normalized = try normalizeData(fixture["normalized"]!)
        // The web app's file restores here, and this app's file has the same content.
        XCTAssertEqual(try parseBackup(fixture["backup"]!.string!), normalized)
        let now = ISO8601DateFormatter.withFractions.date(from: "2026-11-08T10:20:30.456Z")!
        XCTAssertEqual(try JSON.parse(createBackup(normalized, now: now)), try JSON.parse(fixture["backup"]!.string!))
        XCTAssertEqual(JSONValue.object(try parseBackup(createBackup(normalized)).json), fixture["restored"]!)
        let summary = backupSummary(normalized), expected = fixture["summary"]!
        XCTAssertEqual(summary.parshiyos, expected["parshiyos"]!.integer)
        XCTAssertEqual(summary.completed, expected["completed"]!.integer)
        XCTAssertEqual(summary.aliyos, expected["aliyos"]!.integer)
        XCTAssertEqual(summary.cycles, expected["cycles"]!.array!.map { $0.string! })
    }

    func testBackupErrors() {
        let texts = [
            "{",
            #"{"format":"x","version":2,"data":{}}"#,
            #"{"format":"shnayim-mikra-backup","version":2,"data":{"progress":{},"israel":false,"commentary":"onkelos","theme":"nope"}}"#,
            #"{"format":"shnayim-mikra-backup","version":2,"data":{"progress":{"5787:Nope":{}},"israel":false,"commentary":"onkelos","theme":"forest"}}"#,
            #"{"format":"shnayim-mikra-backup","version":2,"data":{"progress":{"5787:Noach":{"mikra1_8":true}},"israel":false,"commentary":"onkelos","theme":"forest"}}"#,
        ]
        for (text, entry) in zip(texts, fixture["backupErrors"]!.array!) {
            XCTAssertThrowsError(try parseBackup(text)) { error in
                XCTAssertEqual((error as? DataError)?.message, entry.array![1].string!, entry.array![0].string!)
            }
        }
    }

    func testProgressText() throws {
        let data = try normalizeData(fixture["normalized"]!)
        let now = ISO8601DateFormatter.withFractions.date(from: "2026-11-08T10:20:30.456Z")!
        XCTAssertEqual(progressText(data, name: { fixName($0, data.preferences.naming) }, now: now), fixture["progressText"]!.string!)
    }

    func testThemesMatchTheWebList() {
        XCTAssertEqual(themes.count, 20)
        XCTAssertEqual(Set(themes.map(\.id)), Set(lightThemes + darkThemes))
        for theme in themes { XCTAssertEqual(theme.isDark, darkThemes.contains(theme.id), theme.id) }
    }
}

extension ISO8601DateFormatter {
    static let withFractions: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
