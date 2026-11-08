import ShnayimCore
import SwiftUI

/// A theme's colors for SwiftUI. The values come from the web app's style.css.
struct Palette: Equatable {
    let theme: Theme
    let page, card, ink, muted, line, track, selected, accent, onAccent, softInk: Color
    let readingBackground, readingOn, readingOnLine, checkLine, danger, warning, buttonBackground, buttonInk, numberInk: Color

    init(_ theme: Theme) {
        self.theme = theme
        page = Color(hex: theme.page); card = Color(hex: theme.card); ink = Color(hex: theme.ink)
        muted = Color(hex: theme.muted); line = Color(hex: theme.line); track = Color(hex: theme.track)
        selected = Color(hex: theme.selected); accent = Color(hex: theme.accent); onAccent = Color(hex: theme.onAccent)
        softInk = Color(hex: theme.softInk); readingBackground = Color(hex: theme.readingBackground)
        readingOn = Color(hex: theme.readingOn); readingOnLine = Color(hex: theme.readingOnLine)
        checkLine = Color(hex: theme.checkLine); danger = Color(hex: theme.danger); warning = Color(hex: theme.warning)
        buttonBackground = Color(hex: theme.buttonBackground); buttonInk = Color(hex: theme.buttonInk)
        numberInk = Color(hex: theme.numberInk)
    }

    static let fallback = Palette(Theme.named("grayscale"))
}

extension Color {
    init(hex: String) {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let value = UInt64(digits, radix: 16) ?? 0
        let hasAlpha = digits.count == 8
        let red = Double((value >> (hasAlpha ? 24 : 16)) & 0xff) / 255
        let green = Double((value >> (hasAlpha ? 16 : 8)) & 0xff) / 255
        let blue = Double((value >> (hasAlpha ? 8 : 0)) & 0xff) / 255
        let alpha = hasAlpha ? Double(value & 0xff) / 255 : 1
        self.init(.sRGB, red: red, green: green, blue: blue, opacity: alpha)
    }
}

private struct PaletteKey: EnvironmentKey {
    static let defaultValue = Palette.fallback
}

extension EnvironmentValues {
    var palette: Palette {
        get { self[PaletteKey.self] }
        set { self[PaletteKey.self] = newValue }
    }
}

/// The reader's Hebrew face. It has cantillation marks, which the system Hebrew fonts lack.
enum ReaderFont {
    static let name = "NotoSerifHebrew-Regular"

    static func hebrew(_ size: CGFloat, relativeTo style: Font.TextStyle = .title3) -> Font {
        .custom(name, size: size, relativeTo: style)
    }
}

/// The rounded surface every section sits on.
struct CardStyle: ViewModifier {
    @Environment(\.palette) private var palette
    var padding: CGFloat = 16

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(palette.line, lineWidth: 1))
    }
}

extension View {
    func card(padding: CGFloat = 16) -> some View { modifier(CardStyle(padding: padding)) }
}

/// The small uppercase heading above a number.
struct Kicker: View {
    @Environment(\.palette) private var palette
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.semibold))
            .tracking(0.6)
            .foregroundStyle(palette.muted)
    }
}

/// A full-width filled button in the theme's button colors.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.palette) private var palette
    @Environment(\.isEnabled) private var enabled
    var prominent = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, 16)
            .foregroundStyle(prominent ? palette.buttonInk : palette.ink)
            .background(prominent ? palette.buttonBackground : palette.readingBackground,
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(prominent ? .clear : palette.line))
            .opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
    }
}

/// Shrinks a little under the finger, like the web app's :active states.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
    }
}

/// A round check that fills, ticks, and shows a dash while a reading is part done.
struct CheckCircle: View {
    @Environment(\.palette) private var palette
    let on: Bool
    var mixed = false
    var size: CGFloat = 28

    var body: some View {
        ZStack {
            Circle()
                .fill(on ? palette.accent : palette.card)
                .overlay(Circle().strokeBorder(on ? palette.accent : palette.checkLine, lineWidth: 1.6))
            Image(systemName: "checkmark")
                .font(.system(size: size * 0.46, weight: .bold))
                .foregroundStyle(palette.onAccent)
                .scaleEffect(on ? 1 : 0.4)
                .opacity(on ? 1 : 0)
            Capsule()
                .fill(palette.accent)
                .frame(width: size * 0.42, height: 2.6)
                .opacity(mixed && !on ? 1 : 0)
        }
        .frame(width: size, height: size)
        .animation(.spring(response: 0.32, dampingFraction: 0.6), value: on)
        .animation(.easeOut(duration: 0.2), value: mixed)
    }
}

/// A ring filled to `fraction`, with a tick when the parsha is done.
struct StatusRing: View {
    @Environment(\.palette) private var palette
    let fraction: Double
    let done: Bool

    var body: some View {
        ZStack {
            Circle().stroke(palette.track, lineWidth: 3)
            Circle()
                .trim(from: 0, to: done ? 1 : fraction)
                .stroke(palette.accent, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if done {
                Circle().fill(palette.accent).padding(1)
                Image(systemName: "checkmark")
                    .font(.system(size: 10, weight: .heavy))
                    .foregroundStyle(palette.onAccent)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .frame(width: 24, height: 24)
        .animation(.spring(response: 0.45, dampingFraction: 0.75), value: fraction)
        .animation(.spring(response: 0.4, dampingFraction: 0.6), value: done)
    }
}

/// A thin progress bar.
struct Bar: View {
    @Environment(\.palette) private var palette
    let fraction: Double
    var height: CGFloat = 8

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(palette.track)
                Capsule().fill(palette.accent)
                    .frame(width: max(0, min(1, fraction)) * geometry.size.width)
            }
        }
        .frame(height: height)
        .animation(.spring(response: 0.5, dampingFraction: 0.8), value: fraction)
    }
}
