import Foundation
import ShnayimCore
import UIKit
import UserNotifications

/// Weekly reminders as local notifications. The web app exports a calendar file instead;
/// the days and time are the same synced preferences.
enum Reminders {
    private static let identifiers = (0..<7).map { "weekly-learning-reminder-\($0)" }

    enum Permission { case allowed, denied, notAsked }

    static func permission() async -> Permission {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return .allowed
        case .denied: return .denied
        default: return .notAsked
        }
    }

    /// Schedules one repeating notification per chosen weekday. Only asks for permission
    /// when `ask` is set, which is when the person changed reminders on this device.
    @discardableResult
    static func apply(_ preferences: Preferences, ask: Bool) async -> Permission {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
        guard !preferences.reminderDays.isEmpty else { return await permission() }
        var current = await permission()
        if current == .notAsked && ask {
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
            current = granted ? .allowed : .denied
        }
        guard current == .allowed else { return current }
        let (hour, minute) = preferences.reminderHourMinute
        for day in preferences.reminderDays {
            let content = UNMutableNotificationContent()
            content.title = "Shnayim Mikra"
            content.body = "Time for Shnayim Mikra."
            content.sound = .default
            // Weekday 1 is Sunday, as day 0 is in the saved preference.
            let trigger = UNCalendarNotificationTrigger(dateMatching: DateComponents(hour: hour, minute: minute, weekday: day + 1), repeats: true)
            try? await center.add(UNNotificationRequest(identifier: identifiers[day], content: content, trigger: trigger))
        }
        return current
    }
}

@MainActor
enum Haptics {
    static func tap(_ enabled: Bool) {
        guard enabled, !UIAccessibility.isReduceMotionEnabled else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    static func success(_ enabled: Bool) {
        guard enabled, !UIAccessibility.isReduceMotionEnabled else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
}
