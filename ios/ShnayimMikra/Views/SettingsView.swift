import ShnayimCore
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The Settings tab, ported from settingsPanel() in src/ui.js.
struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @State private var peirush = ""
    @State private var restoring = false
    @State private var confirmingDelete = false
    @State private var preview: ImportPreview?
    @State private var shared: SharedFile?
    @State private var notifications: Reminders.Permission = .notAsked

    var body: some View {
        let prefs = app.prefs
        NavigationStack {
            Form {
                Group {
                Section("Appearance") {
                    Toggle("Follow device appearance", isOn: binding(prefs.followDevice) { app.saveSettings(["followDevice": .bool($0)]) })
                    if prefs.followDevice {
                        Picker("Light theme", selection: binding(prefs.lightTheme) { app.saveSettings(["lightTheme": .string($0)]) }) {
                            ForEach(lightThemes, id: \.self) { Text(Theme.named($0).label).tag($0) }
                        }
                        Picker("Dark theme", selection: binding(prefs.darkTheme) { app.saveSettings(["darkTheme": .string($0)]) }) {
                            ForEach(darkThemes, id: \.self) { Text(Theme.named($0).label).tag($0) }
                        }
                    } else {
                        ThemeGrid()
                    }
                    Picker("Text size", selection: binding(prefs.textSize) { app.saveSettings(["textSize": .string($0.rawValue)]) }) {
                        Text("Standard").tag(TextSize.standard)
                        Text("Larger").tag(TextSize.larger)
                    }
                }

                Section("Learning") {
                    Picker("After Mikra", selection: binding(app.data.commentary) { app.saveSettings(["commentary": .string($0.rawValue)]) }) {
                        Text(app.readingLabel(.onkelos)).tag(Reading.onkelos)
                        Text(app.readingLabel(.rashi)).tag(Reading.rashi)
                    }
                    HStack {
                        Text("Peirush")
                        TextField("Rashi", text: $peirush)
                            .multilineTextAlignment(.trailing)
                            .autocorrectionDisabled()
                            .onChange(of: peirush) { _, value in savePeirush(value) }
                    }
                    Picker("Chumash opening mode", selection: binding(prefs.defaultReaderMode?.rawValue ?? "last-used") {
                        app.saveSettings(["defaultReaderMode": .string($0)])
                    }) {
                        Text("Last used").tag("last-used")
                        ForEach(ReaderMode.allCases, id: \.self) { Text($0.label).tag($0.rawValue) }
                    }
                    Picker("Parsha calendar", selection: binding(app.data.israel) { israel in app.setIsrael(israel) }) {
                        Text("Diaspora").tag(false)
                        Text("Israel").tag(true)
                    }
                    Picker("Parsha names", selection: binding(prefs.naming) { app.saveSettings(["naming": .string($0.rawValue)]) }) {
                        ForEach(Naming.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    let base = app.thisCycle
                    Picker("Cycle", selection: binding(app.year) { app.setCycle($0) }) {
                        ForEach([base - 1, base, base + 1], id: \.self) { Text(cycleLabel($0)).tag($0) }
                    }
                }

                Section {
                    Toggle("Completion confetti", isOn: binding(prefs.confetti) { app.saveSettings(["confetti": .bool($0)]) })
                    Toggle("Vibration", isOn: binding(prefs.vibration) { app.saveSettings(["vibration": .bool($0)]) })
                } header: { Text("Completion effects") } footer: {
                    Text("Effects respect your device’s Reduce Motion setting.")
                }

                Section {
                    ReminderDays()
                    DatePicker("Reminder time", selection: reminderTime, displayedComponents: .hourAndMinute)
                } header: { Text("Reminders") } footer: {
                    Text(reminderNote(prefs))
                }

                Section {
                    Button("Export all progress") { export(json: false) }
                    Button("Download JSON backup") { export(json: true) }
                    Button("Restore JSON backup") { restoring = true }
                    Button("Delete all progress", role: .destructive) { confirmingDelete = true }
                } header: { Text("Progress") } footer: {
                    if !app.statusMessage.isEmpty { Text(app.statusMessage) }
                }
                }
                .listRowBackground(palette.card)
            }
            .foregroundStyle(palette.ink)
            .disabled(app.busy)
            .scrollContentBackground(.hidden)
            .background(palette.page)
            .navigationTitle("Settings")
        }
        .onAppear { peirush = app.data.settings["peirushName"] == nil ? "" : app.data.peirushLabel }
        .task(id: prefs.reminderDays) { notifications = await Reminders.permission() }
        .fileImporter(isPresented: $restoring, allowedContentTypes: [.json]) { result in restore(result) }
        .sheet(item: $preview) { preview in
            ImportPreviewView(preview: preview).environment(app).environment(\.palette, palette)
        }
        .sheet(item: $shared) { file in ShareSheet(items: [file.url]) }
        .confirmationDialog("Delete all progress?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete all progress", role: .destructive) { deleteAll() }
        } message: {
            Text("This clears every checkmark from every cycle\(app.user != nil ? " on this device and in your account" : " on this device"). Your settings and account stay. This cannot be undone. You can export a copy first.")
        }
    }

    private func binding<Value>(_ value: Value, _ set: @escaping (Value) -> Void) -> Binding<Value> {
        Binding(get: { value }, set: set)
    }

    private var reminderTime: Binding<Date> {
        Binding(get: {
            let (hour, minute) = app.prefs.reminderHourMinute
            return Calendar.current.date(from: DateComponents(hour: hour, minute: minute)) ?? Date()
        }, set: { date in
            let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
            app.saveSettings(["reminderTime": .string(String(format: "%02d:%02d", parts.hour ?? 19, parts.minute ?? 0))])
        })
    }

    private func reminderNote(_ prefs: Preferences) -> String {
        if prefs.reminderDays.isEmpty { return "Choose days and a time for a weekly notification. Reminder days and time sync with your account." }
        switch notifications {
        case .denied: return "Notifications are off for Shnayim Mikra. Turn them on in the Settings app to get reminders."
        case .notAsked: return "Choose a day again to allow notifications on this device."
        case .allowed: return "This device will remind you at that time on each chosen day."
        }
    }

    private func savePeirush(_ value: String) {
        let name = peirushName(.string(value))
        app.saveSettings(["peirushName": name == "Rashi" ? .null : .string(name)])
    }

    private func export(json: Bool) {
        let owner = app.owner
        app.busy = true
        app.statusMessage = "Preparing your export…"
        Task {
            defer { app.busy = false }
            var cached = false
            do { try await app.refresh() } catch { cached = true }
            guard app.owner == owner else { app.statusMessage = "Could not export progress. Please try again."; return }
            let data = app.data, now = Date()
            let content = json ? createBackup(data, now: now) : progressText(data, name: { fixName($0, data.preferences.naming) }, now: now)
            let day = ISO8601DateFormatter.string(from: now, timeZone: .current, formatOptions: [.withFullDate])
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("shnayim-mikra-progress-\(day).\(json ? "json" : "txt")")
            do {
                try Data(content.utf8).write(to: url, options: .atomic)
                shared = SharedFile(url: url)
                app.statusMessage = cached ? "Exported saved device progress. Cloud changes could not be checked." : "Your progress file is ready."
            } catch {
                app.statusMessage = "Could not export progress. Please try again."
            }
        }
    }

    private func restore(_ result: Result<URL, Error>) {
        do {
            let url = try result.get()
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let data = try Data(contentsOf: url)
            guard data.count <= maxBackupBytes else { throw DataError("Backup exceeds the 2 MB limit.") }
            preview = ImportPreview(data: try parseBackup(String(decoding: data, as: UTF8.self)), owner: app.owner, settings: true)
        } catch let error as DataError {
            app.statusMessage = error.message
        } catch {
            app.statusMessage = "Choose a valid JSON backup."
        }
    }

    private func deleteAll() {
        app.busy = true
        app.statusMessage = "Deleting progress…"
        Task {
            defer { app.busy = false }
            do {
                try await app.clearAll()
                app.statusMessage = "All progress deleted. Your settings are saved."
            } catch {
                app.statusMessage = app.user != nil
                    ? "Could not delete all progress yet. A saved deletion request will retry when connected. Check sync status in Account."
                    : "Could not delete all progress. Check this device's storage, then try again."
            }
        }
    }
}

/// Every theme as a swatch: its page color with a diagonal of its accent.
struct ThemeGrid: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
            ForEach(themes) { theme in
                let selected = app.data.theme == theme.id
                Button {
                    withAnimation(.easeInOut(duration: 0.25)) { app.saveSettings(["theme": .string(theme.id)]) }
                } label: {
                    HStack(spacing: 8) {
                        Swatch(theme: theme)
                        Text(theme.label)
                            .font(.footnote)
                            .foregroundStyle(palette.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        Spacer(minLength: 0)
                    }
                    .padding(8)
                    .background(selected ? palette.selected : palette.readingBackground, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(selected ? palette.accent : palette.line, lineWidth: selected ? 2 : 1))
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel(theme.label)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(.vertical, 4)
    }
}

struct Swatch: View {
    let theme: Theme
    var body: some View {
        ZStack {
            Circle().fill(Color(hex: theme.page))
            DiagonalHalf().fill(Color(hex: theme.accent))
            Circle().strokeBorder(Color(hex: theme.line), lineWidth: 1)
        }
        .clipShape(Circle())
        .frame(width: 22, height: 22)
    }
}

private struct DiagonalHalf: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

struct ReminderDays: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    private let names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

    var body: some View {
        let days = Set(app.prefs.reminderDays)
        VStack(alignment: .leading, spacing: 8) {
            Text("Reminder days")
            HStack(spacing: 6) {
                ForEach(0..<7, id: \.self) { day in
                    let on = days.contains(day)
                    Button {
                        var next = days
                        if on { next.remove(day) } else { next.insert(day) }
                        app.saveSettings(["reminderDays": .array(next.sorted().map { JSONValue($0) })])
                    } label: {
                        Text(String(names[day].prefix(2)))
                            .font(.footnote.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 34)
                            .foregroundStyle(on ? palette.onAccent : palette.ink)
                            .background(on ? palette.accent : palette.readingBackground, in: Capsule())
                            .overlay(Capsule().strokeBorder(on ? .clear : palette.line))
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityLabel(names[day])
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
        }
        .padding(.vertical, 4)
        .animation(.snappy, value: days)
    }
}

struct SharedFile: Identifiable {
    let url: URL
    var id: URL { url }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

struct ImportPreview: Identifiable {
    let id = UUID()
    let data: AppData
    let owner: String?
    /// Backups restore settings too; guest progress brings only checks.
    let settings: Bool
}

struct ImportPreviewView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    let preview: ImportPreview
    @State private var failure = ""

    var body: some View {
        let summary = backupSummary(preview.data)
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text("\(summary.parshiyos) \(summary.parshiyos == 1 ? "parsha" : "parshiyos") with progress, \(summary.completed) completed, \(summary.aliyos) \(summary.aliyos == 1 ? "aliyah" : "aliyos") checked. Cycles: \(summary.cycles.isEmpty ? "none" : summary.cycles.joined(separator: ", ")).")
                Text("Checked aliyos will be added to \(app.user != nil ? "your signed-in account" : "guest progress on this device"). Existing checkmarks will stay.\(preview.settings ? " Learning, appearance, effects and reminder preferences will be restored." : " Guest progress will also remain on this device.")")
                    .foregroundStyle(palette.muted)
                if !failure.isEmpty { Text(failure).foregroundStyle(palette.warning) }
                Spacer()
                Button("Confirm import") {
                    do {
                        try app.importData(preview.data, owner: preview.owner, settings: preview.settings)
                        app.statusMessage = "Progress imported and saved on this device."
                        dismiss()
                    } catch {
                        failure = (error as? DataError)?.message ?? "Could not import progress. Please try again."
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
            }
            .font(.callout)
            .foregroundStyle(palette.ink)
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.page)
            .navigationTitle(preview.settings ? "Restore backup?" : "Import guest progress?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .tint(palette.accent)
        .presentationDetents([.medium])
    }
}
