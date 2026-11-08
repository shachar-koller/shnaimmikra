import SwiftUI

/// The web app's slim floating glass bar (.tabbar in src/style.css): four 56pt tabs, 46pt tall,
/// inside 3pt of glass, with a lens that slides to the current tab.
struct GlassTabBar: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Namespace private var lens
    /// Tapping the current tab again, which scrolls it back to the top.
    var reselect: (AppModel.Tab) -> Void = { _ in }

    private static let tabWidth: CGFloat = 56
    private static let tabHeight: CGFloat = 46

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppModel.Tab.allCases) { tab in
                Button {
                    if app.tab == tab { reselect(tab) }
                    else { app.tab = tab }
                } label: {
                    icon(tab)
                        .foregroundStyle(app.tab == tab ? palette.ink : palette.ink.opacity(0.78))
                        .frame(width: Self.tabWidth, height: Self.tabHeight)
                        .background {
                            if app.tab == tab {
                                Capsule()
                                    .fill(palette.ink.opacity(0.08))
                                    .overlay(Capsule().strokeBorder(.white.opacity(palette.theme.isDark ? 0.12 : 0.6), lineWidth: 0.5))
                                    .matchedGeometryEffect(id: "lens", in: lens)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(TabPressStyle())
                .accessibilityLabel(label(tab))
                .accessibilityAddTraits(app.tab == tab ? .isSelected : [])
            }
        }
        .animation(.spring(response: 0.42, dampingFraction: 0.72), value: app.tab)
        .padding(3)
        .modifier(GlassPane(palette: palette))
        .padding(.bottom, 4)
    }

    @ViewBuilder
    private func icon(_ tab: AppModel.Tab) -> some View {
        switch tab {
        case .tracker: Image(systemName: "checkmark.circle").font(.system(size: 19, weight: .medium))
        case .chumash: Image(systemName: "book").font(.system(size: 18, weight: .medium))
        case .settings: Image(systemName: "slider.horizontal.3").font(.system(size: 18, weight: .medium))
        case .account:
            if let user = app.user { Avatar(initial: user.initial, size: 20) }
            else { Image(systemName: "person").font(.system(size: 18, weight: .medium)) }
        }
    }

    private func label(_ tab: AppModel.Tab) -> String {
        switch tab {
        case .tracker: "Tracker"
        case .chumash: "Chumash"
        case .settings: "Settings"
        case .account: app.user.map { "Account, \($0.email ?? "signed in")" } ?? "Account"
        }
    }
}

/// Liquid Glass where the system has it, frosted material before iOS 26.
private struct GlassPane: ViewModifier {
    let palette: Palette

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .glassEffect(.regular.interactive(), in: Capsule())
        } else {
            content
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().strokeBorder(.white.opacity(palette.theme.isDark ? 0.15 : 0.7), lineWidth: 0.5))
                .shadow(color: .black.opacity(0.16), radius: 4, y: 4)
                .shadow(color: .black.opacity(0.07), radius: 1.5, y: 1)
        }
    }
}

private struct TabPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.88 : 1)
            .animation(.spring(response: 0.42, dampingFraction: 0.6), value: configuration.isPressed)
    }
}
