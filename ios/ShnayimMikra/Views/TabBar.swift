import SwiftUI
import UIKit

/// A real `UITabBar`, so iOS 26 draws its own Liquid Glass and selection lens. `TabView` always
/// spans the screen; placing the bar directly lets it be a narrower, centered pill.
struct NativeTabBar: UIViewRepresentable {
    /// Before iOS 26 the bar is opaque and belongs edge to edge.
    static var maxWidth: CGFloat {
        if #available(iOS 26.0, *) { return 338 }
        return .infinity
    }
    /// Tall enough for the glass pill, measured up from the bottom of the screen.
    static let height: CGFloat = 84
    /// The room scrolling content leaves above the bottom safe area, so its end clears the bar.
    static let contentClearance: CGFloat = 56

    let selected: AppModel.Tab
    let palette: Palette
    let onSelect: (AppModel.Tab) -> Void

    func makeUIView(context: Context) -> NativeTabBarHost { NativeTabBarHost() }

    func updateUIView(_ host: NativeTabBarHost, context: Context) {
        host.onSelect = onSelect
        host.selected = selected
        host.tint = UIColor(palette.accent)
        host.overrideUserInterfaceStyle = palette.theme.isDark ? .dark : .light
    }
}

final class NativeTabBarHost: UIView, UITabBarDelegate {
    var onSelect: (AppModel.Tab) -> Void = { _ in }
    var selected = AppModel.Tab.tracker { didSet { showSelection() } }
    var tint: UIColor = .tintColor { didSet { tabBar.tintColor = tint } }

    private let tabBar = BottomAnchoredTabBar()
    private let tabs = AppModel.Tab.allCases

    override init(frame: CGRect) {
        super.init(frame: frame)
        tabBar.delegate = self
        tabBar.itemPositioning = .fill
        // On iPad's regular width the bar uses a compressed inline row.
        tabBar.traitOverrides.horizontalSizeClass = .compact
        tabBar.items = tabs.enumerated().map { index, tab in
            let item = UITabBarItem(title: nil, image: Self.icon(tab.symbol), selectedImage: Self.icon(tab.selectedSymbol))
            item.tag = index
            item.accessibilityLabel = tab.accessibilityName
            return item
        }
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        addSubview(tabBar)
        NSLayoutConstraint.activate([
            tabBar.leadingAnchor.constraint(equalTo: leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: trailingAnchor),
            tabBar.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        showSelection()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        showSelection()
    }

    /// Only the bar takes touches, so content above it stays reachable.
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === self ? nil : hit
    }

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        onSelect(tabs[item.tag])
    }

    private func showSelection() {
        guard let index = tabs.firstIndex(of: selected), let item = tabBar.items?[index], tabBar.selectedItem !== item else { return }
        tabBar.selectedItem = item
    }

    /// Draws every symbol in the same box, since each one otherwise gets its own optical size.
    private static func icon(_ symbol: String) -> UIImage? {
        guard let image = UIImage(systemName: symbol) else { return nil }
        let canvas = CGSize(width: 28, height: 28)
        let scale = min(24 / image.size.width, 24 / image.size.height)
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        return UIGraphicsImageRenderer(size: canvas).image { _ in
            image.draw(in: CGRect(x: (canvas.width - size.width) / 2, y: (canvas.height - size.height) / 2, width: size.width, height: size.height))
        }.withRenderingMode(.alwaysTemplate)
    }
}

/// Re-measures when it learns the home indicator's inset, which sets where the pill floats.
private final class BottomAnchoredTabBar: UITabBar {
    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        invalidateIntrinsicContentSize()
    }
}

private extension AppModel.Tab {
    var symbol: String {
        switch self {
        case .tracker: "checkmark.circle"
        case .chumash: "book"
        case .settings: "slider.horizontal.3"
        case .account: "person.crop.circle"
        }
    }

    var selectedSymbol: String {
        switch self {
        case .tracker: "checkmark.circle.fill"
        case .chumash: "book.fill"
        case .settings: "slider.horizontal.3"
        case .account: "person.crop.circle.fill"
        }
    }

    var accessibilityName: String {
        switch self {
        case .tracker: "Tracker"
        case .chumash: "Chumash"
        case .settings: "Settings"
        case .account: "Account"
        }
    }
}
