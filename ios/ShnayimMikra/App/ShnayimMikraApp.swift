import ShnayimCore
import SwiftUI
import UIKit

@main
struct ShnayimMikraApp: App {
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .onAppear { app.start() }
        }
    }
}

/// Loading, the welcome screen, or the four tabs, in the chosen theme.
struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var app = app
        let theme = Theme.named(app.themeId)
        let palette = Palette(theme)
        let welcome = app.user == nil && !app.guestChosen

        ZStack {
            palette.page.ignoresSafeArea()
            if !app.ready {
                Text("Loading your account…").foregroundStyle(palette.muted)
            } else if welcome {
                WelcomeView().transition(.opacity)
            } else {
                TabView(selection: $app.tab) {
                    TrackerView()
                        .tabItem { Label("Tracker", systemImage: "checkmark.circle") }
                        .tag(AppModel.Tab.tracker)
                    ChumashView()
                        .tabItem { Label("Chumash", systemImage: "book") }
                        .tag(AppModel.Tab.chumash)
                    SettingsView()
                        .tabItem { Label("Settings", systemImage: "slider.horizontal.3") }
                        .tag(AppModel.Tab.settings)
                    AccountView()
                        .tabItem { Label("Account", systemImage: app.user == nil ? "person.crop.circle" : "person.crop.circle.fill") }
                        .tag(AppModel.Tab.account)
                }
                .transition(.opacity)
            }
            ConfettiBurst(trigger: app.celebration, colors: [palette.accent, palette.checkLine, palette.ink.opacity(0.75)])
                .ignoresSafeArea()
        }
        .animation(.easeInOut(duration: 0.25), value: welcome)
        .animation(.easeInOut(duration: 0.25), value: app.ready)
        .environment(\.palette, palette)
        .tint(palette.accent)
        // Following the device leaves the system's appearance alone and picks the matching theme.
        .preferredColorScheme(app.prefs.followDevice ? nil : (theme.isDark ? .dark : .light))
        .dynamicTypeSize(app.prefs.textSize == .larger ? larger(dynamicTypeSize) : dynamicTypeSize)
        .onAppear { app.systemDark = deviceIsDark() }
        .onChange(of: colorScheme) { _, _ in app.systemDark = deviceIsDark() }
        .onChange(of: app.prefs.followDevice) { _, _ in app.systemDark = deviceIsDark() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                app.systemDark = deviceIsDark()
                app.refreshCalendar()
                app.retry()
            } else if phase == .background {
                app.reader.flush()
            }
        }
        // Also reconcile two devices left open without anything else happening.
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                if scenePhase == .active {
                    app.refreshCalendar()
                    app.retry()
                }
            }
        }
    }

    private func larger(_ size: DynamicTypeSize) -> DynamicTypeSize {
        let all = DynamicTypeSize.allCases
        guard let index = all.firstIndex(of: size) else { return size }
        return all[min(index + 2, all.count - 1)]
    }
}

/// The device's own appearance. The window's may be overridden by the chosen theme.
@MainActor
private func deviceIsDark() -> Bool {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    return scene?.screen.traitCollection.userInterfaceStyle == .dark
}
