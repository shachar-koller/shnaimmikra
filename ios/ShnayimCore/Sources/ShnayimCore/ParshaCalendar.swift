import Foundation

/// A calendar day where the person is, counted from 1970-01-01. Shabbos dates have no time of day.
public struct LocalDay: Hashable, Comparable, Sendable {
    public let number: Int

    public init(number: Int) { self.number = number }

    /// Howard Hinnant's days-from-civil.
    public init(year: Int, month: Int, day: Int) {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        number = era * 146097 + doe - 719468
    }

    public static func today(_ now: Date = Date(), calendar: Calendar = .current) -> LocalDay {
        let parts = calendar.dateComponents([.year, .month, .day], from: now)
        return LocalDay(year: parts.year!, month: parts.month!, day: parts.day!)
    }

    public var components: (year: Int, month: Int, day: Int) {
        let z = number + 719468
        let era = (z >= 0 ? z : z - 146096) / 146097
        let doe = z - era * 146097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let day = doy - (153 * mp + 2) / 5 + 1
        let month = mp < 10 ? mp + 3 : mp - 9
        return (yoe + era * 400 + (month <= 2 ? 1 : 0), month, day)
    }

    /// Midnight of this day in the given calendar's time zone.
    public func date(calendar: Calendar = .current) -> Date {
        let (year, month, day) = components
        return calendar.date(from: DateComponents(year: year, month: month, day: day)) ?? Date(timeIntervalSince1970: Double(number) * 86400)
    }

    public static func < (lhs: LocalDay, rhs: LocalDay) -> Bool { lhs.number < rhs.number }
    public func adding(days: Int) -> LocalDay { LocalDay(number: number + days) }
}

/// One parsha in a cycle. A double week is two rows with the same Shabbos.
public struct ParshaRow: Identifiable, Equatable, Hashable, Sendable {
    public let id: String
    public let names: [String]
    public let day: LocalDay
}

/// The parsha calendar, computed by Hebcal for the web app and shipped as data
/// (see scripts/build-ios-data.mjs), so both apps always agree on every Shabbos.
public final class ParshaCalendar: @unchecked Sendable {
    public static let shared: ParshaCalendar = {
        guard let url = Bundle.module.url(forResource: "calendar", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let calendar = try? ParshaCalendar(data: data) else {
            fatalError("calendar.json is missing from ShnayimCore. Run `npm run build:ios-data`.")
        }
        return calendar
    }()

    public let firstYear: Int
    public let lastYear: Int
    /// Every parsha id, in Torah order.
    public let ids: [String]
    private let starts: [Bool: [LocalDay]]
    private let rows: [Bool: [[ParshaRow]]]

    init(data: Data) throws {
        struct Raw: Decodable { let format: Int; let firstYear: Int; let ids: [String]; let diaspora: [[Int]]; let israel: [[Int]] }
        let raw = try JSONDecoder().decode(Raw.self, from: data)
        guard raw.format == 1, !raw.diaspora.isEmpty, raw.diaspora.count == raw.israel.count else {
            throw CocoaError(.fileReadCorruptFile)
        }
        firstYear = raw.firstYear
        lastYear = raw.firstYear + raw.diaspora.count - 1
        ids = raw.ids
        var starts: [Bool: [LocalDay]] = [:], rows: [Bool: [[ParshaRow]]] = [:]
        for (israel, years) in [(false, raw.diaspora), (true, raw.israel)] {
            starts[israel] = years.map { LocalDay(number: $0[0]) }
            rows[israel] = years.map { cycle in
                let start = cycle[0]
                return stride(from: 1, to: cycle.count - 1, by: 2).map { index in
                    let id = raw.ids[cycle[index]]
                    return ParshaRow(id: id, names: [id], day: LocalDay(number: start + cycle[index + 1]))
                }
            }
        }
        self.starts = starts
        self.rows = rows
    }

    private func clamp(_ year: Int) -> Int { min(max(year, firstYear), lastYear) }

    /// The parshiyos of the cycle that begins after Simchas Torah of `year`.
    public func schedule(year: Int, israel: Bool = false) -> [ParshaRow] {
        rows[israel]![clamp(year) - firstYear]
    }

    /// Simchas Torah still belongs to the cycle ending that day.
    public func cycleYear(_ day: LocalDay = .today(), israel: Bool = false) -> Int {
        let starts = starts[israel]!
        guard let next = starts.firstIndex(where: { $0 > day }) else { return lastYear }
        return max(firstYear, firstYear + next - 1)
    }

    public var idSet: Set<String> { Set(ids) }
}

public func currentParsha(_ rows: [ParshaRow], today: LocalDay = .today()) -> ParshaRow {
    rows.first { $0.day >= today } ?? rows[rows.count - 1]
}

public func shabbosCountdown(_ target: LocalDay, today: LocalDay = .today()) -> String {
    let days = target.number - today.number
    if days <= 0 { return "Today" }
    if days == 1 { return "1 day away" }
    return "\(days) days away"
}

public func formatGregorianDate(_ day: LocalDay, withYear: Bool = false) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = withYear ? "MMMM d, yyyy" : "MMMM d"
    return formatter.string(from: Date(timeIntervalSince1970: Double(day.number) * 86400))
}

public func cycleLabel(_ cycle: Int) -> String { "\(cycle)–\(String(String(cycle + 1).suffix(2)))" }
