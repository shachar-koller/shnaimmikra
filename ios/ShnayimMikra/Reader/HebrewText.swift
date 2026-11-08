import ShnayimCore
import SwiftUI

private typealias SwiftUIKeys = AttributeScopes.SwiftUIAttributes

/// Turns a verse's parts into styled text, as the web reader's tx-* classes do.
enum HebrewText {
    static let size: CGFloat = 24

    static func inline(_ parts: [TextPart], palette: Palette, size: CGFloat = HebrewText.size) -> AttributedString {
        var result = AttributedString()
        for part in parts {
            switch part {
            case .plain(let text):
                result += run(text, size: size)
            case .formatted(let format, let text):
                var piece: AttributedString
                switch format {
                case .big: piece = run(text, size: size * 1.35)
                case .small: piece = run(text, size: size * 0.8)
                case .bold: piece = run(text, size: size); piece[SwiftUIKeys.FontAttribute.self] = ReaderFont.hebrew(size).bold()
                case .ketiv, .note:
                    piece = run(text, size: size * 0.72)
                    piece[SwiftUIKeys.ForegroundColorAttribute.self] = palette.muted
                case .qere: piece = run(text, size: size)
                }
                result += piece
            case .petuchah, .setumah:
                result += run(" ", size: size)
            }
        }
        return result
    }

    private static func run(_ text: String, size: CGFloat) -> AttributedString {
        var piece = AttributedString(text)
        piece[SwiftUIKeys.FontAttribute.self] = ReaderFont.hebrew(size)
        return piece
    }

    /// Classic layout: paragraphs split at each petuchah, with perek and verse markers
    /// and a wide gap for each setumah.
    static func classicParagraphs(_ verses: [Verse], palette: Palette) -> [(verses: [String], text: AttributedString)] {
        var paragraphs: [(verses: [String], text: AttributedString)] = [([], AttributedString())]
        func append(_ piece: AttributedString, verse: String) {
            var last = paragraphs[paragraphs.count - 1]
            if !last.verses.contains(verse) { last.verses.append(verse) }
            last.text += piece
            paragraphs[paragraphs.count - 1] = last
        }
        for (index, verse) in verses.enumerated() {
            if verse.verse == 1 || index == 0 {
                var perek = AttributedString(" פרק \(hebrewNumber(verse.chapter)) ")
                perek[SwiftUIKeys.FontAttribute.self] = .system(size: size * 0.55, weight: .semibold)
                perek[SwiftUIKeys.ForegroundColorAttribute.self] = palette.softInk
                perek[SwiftUIKeys.BackgroundColorAttribute.self] = palette.readingBackground
                append(perek + run(" ", size: size), verse: verse.ref)
            }
            var marker = AttributedString(hebrewNumber(verse.verse))
            marker[SwiftUIKeys.FontAttribute.self] = .system(size: size * 0.55, weight: .regular)
            marker[SwiftUIKeys.ForegroundColorAttribute.self] = palette.softInk
            marker[SwiftUIKeys.BaselineOffsetAttribute.self] = size * 0.35
            append(marker + run(" ", size: size), verse: verse.ref)
            guard let torah = verse.torah else {
                var missing = AttributedString("Text not available ")
                missing[SwiftUIKeys.FontAttribute.self] = .footnote
                missing[SwiftUIKeys.ForegroundColorAttribute.self] = palette.muted
                append(missing, verse: verse.ref)
                continue
            }
            var broke = false
            for part in torah {
                broke = false
                switch part {
                case .petuchah:
                    paragraphs.append(([], AttributedString()))
                    broke = true
                case .setumah:
                    append(run("\u{2003}\u{2003}\u{2003}", size: size), verse: verse.ref)
                default:
                    append(inline([part], palette: palette), verse: verse.ref)
                }
            }
            if !broke { append(run(" ", size: size), verse: verse.ref) }
        }
        return paragraphs.filter { !$0.verses.isEmpty }
    }
}

/// Right-to-left text that fills the width and starts at the right edge.
struct RightToLeft: ViewModifier {
    func body(content: Content) -> some View {
        content
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .environment(\.layoutDirection, .rightToLeft)
    }
}

extension View {
    func rightToLeft() -> some View { modifier(RightToLeft()) }
}
