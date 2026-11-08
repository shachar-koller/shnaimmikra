import ShnayimCore
import SwiftUI

/// The Account tab, ported from accountPanel() in src/ui.js.
struct AccountView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @State private var preview: ImportPreview?

    var body: some View {
        NavigationStack {
            Form {
                Group {
                    if let user = app.user {
                        Section {
                            HStack(spacing: 12) {
                                Avatar(initial: user.initial, size: 40)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(user.email ?? user.id).font(.body.weight(.semibold))
                                    Text("Signed in").font(.caption).foregroundStyle(palette.muted)
                                }
                            }
                            Button("Sync now") {
                                run("Syncing…", success: "Progress synced.", failure: "Could not sync. Pending changes remain on this device.") {
                                    try await app.refresh()
                                }
                            }
                            Button("Import guest progress") {
                                do { preview = ImportPreview(data: try app.guestData(), owner: app.owner, settings: false) }
                                catch { app.statusMessage = "Guest progress could not be read." }
                            }
                            Button("Sign out", role: .destructive) {
                                run("Signing out…", success: "Signed out. Account progress stays separate on this device.", failure: "Could not sign out. Please try again.") {
                                    try await app.logout()
                                }
                            }
                        } footer: { footer }
                    } else if app.cloudEnabled {
                        Section {
                            GoogleButton()
                        } footer: { footer }
                    } else {
                        Section {
                            Text("Sign-in is unavailable. Your progress is saved on this device.")
                                .foregroundStyle(palette.muted)
                        } footer: { footer }
                    }
                }
                .listRowBackground(palette.card)
            }
            .foregroundStyle(palette.ink)
            .disabled(app.busy)
            .scrollContentBackground(.hidden)
            .background(palette.page)
            .navigationTitle("Account")
        }
        .sheet(item: $preview) { preview in
            ImportPreviewView(preview: preview).environment(app).environment(\.palette, palette)
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(syncText)
            if !app.statusMessage.isEmpty { Text(app.statusMessage) }
        }
    }

    private var syncText: String {
        if !app.storageOK { return "This device could not save your changes." }
        guard app.user != nil else { return "Saved on this device" }
        switch app.status {
        case .pending: return "Changes saved on this device — sync pending"
        case .syncing: return "Syncing…"
        case .ok: return "Saved to your account"
        case .error: return "Could not sync — pending changes remain on this device"
        case .local: return "Saved on this device"
        }
    }

    private func run(_ message: String, success: String, failure: String, _ action: @escaping () async throws -> Void) {
        app.busy = true
        app.statusMessage = message
        Task {
            defer { app.busy = false }
            do {
                try await action()
                app.statusMessage = success
            } catch {
                app.statusMessage = failure
            }
        }
    }
}

struct Avatar: View {
    @Environment(\.palette) private var palette
    let initial: String
    var size: CGFloat = 28

    var body: some View {
        Text(initial)
            .font(.system(size: size * 0.45, weight: .bold))
            .foregroundStyle(palette.onAccent)
            .frame(width: size, height: size)
            .background(palette.accent, in: Circle())
            .accessibilityHidden(true)
    }
}

/// Sign-in through Supabase's Google provider, in the system's secure web sheet.
struct GoogleButton: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @State private var message = ""
    @State private var working = false

    var body: some View {
        VStack(spacing: 10) {
            Button {
                working = true
                message = "Connecting to Google…"
                Task {
                    defer { working = false }
                    do {
                        try await app.signIn()
                        message = "Signed in. Loading your progress…"
                    } catch {
                        message = isCancellation(error) ? "" : "Sign-in was not completed. Please try again."
                    }
                }
            } label: {
                HStack(spacing: 10) {
                    GoogleMark().frame(width: 18, height: 18)
                    Text("Continue with Google").font(.body.weight(.semibold))
                }
                .frame(maxWidth: .infinity, minHeight: 48)
                .foregroundStyle(palette.ink)
                .background(palette.card, in: Capsule())
                .overlay(Capsule().strokeBorder(palette.line, lineWidth: 1.2))
            }
            .buttonStyle(PressableStyle())
            .disabled(working)
            if !message.isEmpty {
                Text(message).font(.footnote).foregroundStyle(palette.muted)
            }
        }
    }

    private func isCancellation(_ error: Error) -> Bool {
        let error = error as NSError
        return error.domain == "com.apple.AuthenticationServices.WebAuthenticationSession" && error.code == 1
    }
}

/// Google's four-color "G".
struct GoogleMark: View {
    var body: some View {
        Canvas { context, size in
            let scale = min(size.width, size.height) / 48
            context.scaleBy(x: scale, y: scale)
            let paths: [(String, Color)] = [
                ("M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z", Color(hex: "#EA4335")),
                ("M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z", Color(hex: "#4285F4")),
                ("M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z", Color(hex: "#FBBC05")),
                ("M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z", Color(hex: "#34A853")),
            ]
            for (data, color) in paths { context.fill(SVGPath.parse(data), with: .color(color)) }
        }
        .accessibilityHidden(true)
    }
}

/// Just enough of SVG path syntax for the Google mark: M, L, H, V, C, S, Z and their relative forms.
enum SVGPath {
    static func parse(_ data: String) -> Path {
        var path = Path()
        var tokens: [String] = []
        var number = ""
        func flush() { if !number.isEmpty { tokens.append(number); number = "" } }
        for character in data {
            if character.isLetter && character != "e" { flush(); tokens.append(String(character)) }
            else if character == "-" { flush(); number = "-" }
            else if character == "," || character == " " { flush() }
            else if character == "." && number.contains(".") { flush(); number = "." }
            else { number.append(character) }
        }
        flush()
        var index = 0, command = "M"
        var current = CGPoint.zero, start = CGPoint.zero, control = CGPoint.zero
        func next() -> CGFloat { defer { index += 1 }; return CGFloat(Double(tokens[index]) ?? 0) }
        while index < tokens.count {
            if let first = tokens[index].first, first.isLetter { command = tokens[index]; index += 1 }
            let relative = command == command.lowercased()
            let base = relative ? current : .zero
            switch command.uppercased() {
            case "M":
                current = CGPoint(x: base.x + next(), y: base.y + next())
                start = current
                path.move(to: current)
                command = relative ? "l" : "L"
            case "L":
                current = CGPoint(x: base.x + next(), y: base.y + next())
                path.addLine(to: current)
            case "H":
                current = CGPoint(x: (relative ? current.x : 0) + next(), y: current.y)
                path.addLine(to: current)
            case "V":
                current = CGPoint(x: current.x, y: (relative ? current.y : 0) + next())
                path.addLine(to: current)
            case "C":
                let c1 = CGPoint(x: base.x + next(), y: base.y + next())
                let c2 = CGPoint(x: base.x + next(), y: base.y + next())
                current = CGPoint(x: base.x + next(), y: base.y + next())
                path.addCurve(to: current, control1: c1, control2: c2)
                control = c2
            case "S":
                let c1 = CGPoint(x: 2 * current.x - control.x, y: 2 * current.y - control.y)
                let c2 = CGPoint(x: base.x + next(), y: base.y + next())
                current = CGPoint(x: base.x + next(), y: base.y + next())
                path.addCurve(to: current, control1: c1, control2: c2)
                control = c2
            case "Z":
                path.closeSubpath()
                current = start
            default:
                index += 1
            }
            if !"CS".contains(command.uppercased()) { control = current }
        }
        return path
    }
}

/// The first screen without an account: sign in, or continue on this device.
struct WelcomeView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            Text("שנים מקרא ואחד תרגום")
                .font(ReaderFont.hebrew(22))
                .foregroundStyle(palette.muted)
            Text("Shnayim\nMikra")
                .font(.system(size: 52, weight: .bold))
                .multilineTextAlignment(.center)
                .foregroundStyle(palette.ink)
            Spacer()
            if app.cloudEnabled { GoogleButton() }
            Button("Continue without an account") {
                withAnimation(.snappy) { app.guestChosen = true }
            }
            .font(.body.weight(.semibold))
            .foregroundStyle(palette.muted)
            .padding(.bottom, 24)
        }
        .padding(.horizontal, 28)
        .frame(maxWidth: 440)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(palette.page)
    }
}
