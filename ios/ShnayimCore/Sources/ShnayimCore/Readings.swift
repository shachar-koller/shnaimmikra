// Ported from src/readings.js. Progress is a set of checked aliyah fields such as "mikra1_3".

public enum Reading: String, CaseIterable, Sendable, Codable {
    case mikra1, mikra2, onkelos, rashi

    public var isCommentary: Bool { self == .onkelos || self == .rashi }
    /// The other commentary. Only meaningful for Onkelos and Rashi.
    public var other: Reading { self == .rashi ? .onkelos : .rashi }
}

/// Checked fields only. An unchecked field is absent.
public typealias ParshaProgress = [String: Bool]

public let aliyahCount = 7
public let aliyahNames = ["Rishon", "Sheni", "Shlishi", "Rivi'i", "Chamishi", "Shishi", "Shevi'i"]
public let commentaries: [Reading] = [.onkelos, .rashi]

public func aliyahField(_ reading: Reading, _ index: Int) -> String { "\(reading.rawValue)_\(index + 1)" }

public let aliyahFields: [String] = Reading.allCases.flatMap { reading in
    (0..<aliyahCount).map { aliyahField(reading, $0) }
}
private let aliyahFieldSet = Set(aliyahFields)
public func isAliyahField(_ field: String) -> Bool { aliyahFieldSet.contains(field) }

public func readingChecks(_ progress: ParshaProgress?, _ reading: Reading) -> [Bool] {
    (0..<aliyahCount).map { progress?[aliyahField(reading, $0)] == true }
}
public func readingCount(_ progress: ParshaProgress?, _ reading: Reading) -> Int {
    readingChecks(progress, reading).filter { $0 }.count
}
public func readingComplete(_ progress: ParshaProgress?, _ reading: Reading) -> Bool {
    readingCount(progress, reading) == aliyahCount
}
public func aliyahSteps(_ progress: ParshaProgress?) -> Int {
    readingCount(progress, .mikra1) + readingCount(progress, .mikra2)
        + max(readingCount(progress, .onkelos), readingCount(progress, .rashi))
}

/// Completed readings out of three. Either commentary completes the third.
public func steps(_ progress: ParshaProgress?) -> Int {
    (readingComplete(progress, .mikra1) ? 1 : 0) + (readingComplete(progress, .mikra2) ? 1 : 0)
        + (readingComplete(progress, .onkelos) || readingComplete(progress, .rashi) ? 1 : 0)
}
public func isComplete(_ progress: ParshaProgress?) -> Bool { steps(progress) == 3 }

/// A parsha uses one commentary or the other. Its checks decide, and only an empty or tied
/// parsha follows the fallback, so the choice syncs along with the checks.
public func chosenCommentary(_ progress: ParshaProgress?, fallback: Reading = .onkelos) -> Reading {
    let onkelos = readingCount(progress, .onkelos), rashi = readingCount(progress, .rashi)
    return rashi > onkelos ? .rashi : onkelos > rashi ? .onkelos : fallback
}

/// Swapping rather than moving keeps a hidden set from an old or conflicting edit,
/// and switching back restores exactly what was there.
public func commentarySwapPatch(_ progress: ParshaProgress?, from: Reading, to: Reading) -> [String: Bool] {
    let source = readingChecks(progress, from), target = readingChecks(progress, to)
    var patch: [String: Bool] = [:]
    for index in 0..<aliyahCount where source[index] != target[index] {
        patch[aliyahField(to, index)] = source[index]
        patch[aliyahField(from, index)] = target[index]
    }
    return patch
}

public func hasReadingProgress(_ progress: ParshaProgress?) -> Bool {
    Reading.allCases.contains { readingCount(progress, $0) > 0 }
}

public func normalizeProgress(_ progress: [String: Bool]) -> ParshaProgress {
    progress.filter { isAliyahField($0.key) && $0.value }
}
public func readingPatch(_ patch: [String: Bool]) -> [String: Bool] {
    patch.filter { isAliyahField($0.key) }
}
public func wholeReadingPatch(_ reading: Reading, checked: Bool) -> [String: Bool] {
    Dictionary(uniqueKeysWithValues: (0..<aliyahCount).map { (aliyahField(reading, $0), checked) })
}
public func applyReadingPatch(_ progress: ParshaProgress?, _ patch: [String: Bool]) -> ParshaProgress {
    normalizeProgress((progress ?? [:]).merging(readingPatch(patch)) { _, new in new })
}

/// "5787:Bereshit" → (5787, "Bereshit").
public func splitProgressKey(_ key: String) -> (year: Int, id: String)? {
    guard let colon = key.firstIndex(of: ":"), let year = Int(key[..<colon]) else { return nil }
    return (year, String(key[key.index(after: colon)...]))
}
public func progressKey(_ year: Int, _ id: String) -> String { "\(year):\(id)" }
