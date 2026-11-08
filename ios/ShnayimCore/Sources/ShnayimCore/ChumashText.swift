import Foundation

// Ported from src/chumash-text.js. The app ships every parsha's text (public/chumash/v1),
// so reading needs no network at all.

public enum TextFormat: String, Sendable { case big, small, bold, ketiv, qere, note }

public enum TextPart: Equatable, Sendable {
    case plain(String)
    case formatted(TextFormat, String)
    /// Petuchah: the next text starts a new paragraph.
    case petuchah
    /// Setumah: a gap within the line.
    case setumah
}

public struct Verse: Identifiable, Equatable, Sendable {
    public let ref: String
    public let chapter: Int
    public let verse: Int
    public let torah: [TextPart]?
    public let onkelos: [TextPart]?
    public var id: String { ref }
}

public struct AliyahText: Equatable, Sendable {
    public let index: Int
    public let verses: [Verse]
}

public struct ParshaText: Equatable, Sendable {
    public let id: String
    public let book: String
    public let aliyot: [AliyahText]
}

public struct TextError: LocalizedError, Equatable {
    public let message: String
    public var errorDescription: String? { message }
}

public func textSlug(_ id: String) -> String {
    var slug = ""
    var gap = false
    for character in id.lowercased() {
        if character.isASCII && character.isLetter {
            if gap && !slug.isEmpty { slug.append("-") }
            slug.append(character)
            gap = false
        } else { gap = true }
    }
    return slug
}

private func parseRef(_ ref: String) -> (Int, Int)? {
    let parts = ref.split(separator: ":", omittingEmptySubsequences: false)
    guard parts.count == 2, parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) }),
          let chapter = Int(parts[0]), let verse = Int(parts[1]) else { return nil }
    return (chapter, verse)
}

/// Only known kinds keep their formatting. Anything else stays as literal text.
private func cleanVerse(_ value: JSONValue) -> [TextPart]? {
    let parts: [JSONValue] = value.string != nil ? [value] : value.array ?? []
    let cleaned: [TextPart] = parts.compactMap { part in
        if let text = part.string { return text.isEmpty ? nil : .plain(text) }
        guard let pair = part.array, let kind = pair.first?.string else { return nil }
        if kind == "pe" { return .petuchah }
        if kind == "samekh" { return .setumah }
        guard pair.count > 1, let text = pair[1].string, !text.isEmpty else { return nil }
        return TextFormat(rawValue: kind).map { .formatted($0, text) } ?? .plain(text)
    }
    let hasText = cleaned.contains { if case .plain = $0 { true } else if case .formatted = $0 { true } else { false } }
    return hasText ? cleaned : nil
}

private func verseMap(_ entries: JSONValue?) -> [String: [TextPart]] {
    var verses: [String: [TextPart]] = [:]
    for entry in entries?.array ?? [] {
        guard let pair = entry.array, pair.count > 1, let ref = pair[0].string, parseRef(ref) != nil,
              let verse = cleanVerse(pair[1]) else { continue }
        verses[ref] = verse
    }
    return verses
}

/// Pairs Torah and Onkelos by reference, never by position. A verse missing from
/// either side stays nil, so a view can say so instead of showing the wrong text.
public func resolveParsha(_ data: Data, id: String) throws -> ParshaText {
    let raw = try JSON.parse(data)
    guard raw["format"] == JSONValue(1), raw["id"]?.string == id, let ranges = raw["aliyot"]?.array, ranges.count == aliyahCount else {
        throw TextError(message: "Unexpected text for \(id)")
    }
    let torah = verseMap(raw["torah"]), onkelos = verseMap(raw["onkelos"])
    let counts = raw["verseCounts"]?.object ?? [:]
    let invalid = TextError(message: "Bad aliyah range")
    let aliyot = try ranges.enumerated().map { index, range -> AliyahText in
        guard let pair = range.array, pair.count == 2, let first = pair[0].string.flatMap(parseRef),
              let last = pair[1].string.flatMap(parseRef) else { throw invalid }
        var verses: [Verse] = []
        var (chapter, verse) = first
        while true {
            guard let count = counts[String(chapter)]?.integer, verse <= count, verses.count <= 500 else { throw invalid }
            let ref = "\(chapter):\(verse)"
            verses.append(Verse(ref: ref, chapter: chapter, verse: verse, torah: torah[ref], onkelos: onkelos[ref]))
            if chapter == last.0 && verse == last.1 { break }
            if verse == count { chapter += 1; verse = 1 } else { verse += 1 }
        }
        return AliyahText(index: index, verses: verses)
    }
    guard aliyot.contains(where: { $0.verses.contains { $0.torah != nil } }) else { throw TextError(message: "No text for \(id)") }
    return ParshaText(id: id, book: raw["book"]?.string ?? "", aliyot: aliyot)
}

/// Reads parshiyos from the app's bundled text folder, once each.
public final class TextLibrary {
    private let directory: URL
    private var memory: [String: ParshaText] = [:]

    public init(directory: URL) { self.directory = directory }

    public func peek(_ id: String) -> ParshaText? { memory[id] }

    public func load(_ id: String) throws -> ParshaText {
        if let known = memory[id] { return known }
        let url = directory.appendingPathComponent("\(textSlug(id)).json")
        guard let data = try? Data(contentsOf: url) else { throw TextError(message: "The text of this parsha is missing from the app.") }
        let parsha = try resolveParsha(data, id: id)
        memory[id] = parsha
        return parsha
    }
}
