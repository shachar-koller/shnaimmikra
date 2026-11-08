import ShnayimCore
import SwiftUI
import UIKit

/// Cards: one pasuk at a time. Pages turn the Hebrew way, so pulling the card
/// to the right goes forward. The card follows and tilts with the finger, shows
/// the next one underneath, and flies away on release; a short drag springs back.
struct CardDeck: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drag: CGFloat = 0
    @State private var horizontal: Bool?
    @State private var width: CGFloat = 360

    var body: some View {
        let reader = app.reader!
        let direction = drag >= 0 ? 1 : -1
        VStack(spacing: 16) {
            ZStack(alignment: .top) {
                if drag != 0, let peek = reader.peek(direction) {
                    CardFace(position: peek)
                        .scaleEffect(0.94 + 0.06 * min(abs(drag) / width, 1), anchor: .top)
                        .opacity(0.5 + 0.5 * min(abs(drag) / (width * 0.5), 1))
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                CardFace(position: reader.position)
                    .id(reader.position)
                    .offset(x: drag)
                    .rotationEffect(.degrees(Double(drag / width) * 8), anchor: .bottom)
                    .simultaneousGesture(swipe(reader))
                    .transition(reduceMotion ? AnyTransition.identity : AnyTransition.asymmetric(
                        insertion: .scale(scale: 0.96, anchor: .top).combined(with: .opacity),
                        removal: .identity))
            }
            .background(GeometryReader { geometry in
                Color.clear
                    .onAppear { width = max(geometry.size.width, 1) }
                    .onChange(of: geometry.size.width) { _, value in width = max(value, 1) }
            })
            .accessibilityAction(named: "Next pasuk") { turn(reader, 1) }
            .accessibilityAction(named: "Previous pasuk") { turn(reader, -1) }
            CardNav(turn: { turn(reader, $0) })
        }
    }

    private func swipe(_ reader: ReaderController) -> some Gesture {
        DragGesture(minimumDistance: 14)
            .onChanged { value in
                // Decide once per stroke, so vertical scrolling never moves the card.
                if horizontal == nil {
                    horizontal = abs(value.translation.width) > abs(value.translation.height) * 1.5
                }
                guard horizontal == true, !reduceMotion else { return }
                let dx = value.translation.width
                // Resist where there is nowhere to go.
                drag = reader.canStep(dx >= 0 ? 1 : -1) ? dx : dx * 0.25
            }
            .onEnded { value in
                defer { horizontal = nil }
                guard horizontal == true else { return }
                let dx = value.translation.width, predicted = value.predictedEndTranslation.width
                let far = abs(dx) >= max(56, width * 0.16) || abs(predicted) >= width * 0.5
                let direction = (abs(dx) > 1 ? dx : predicted) > 0 ? 1 : -1
                if far && abs(dx) >= abs(value.translation.height) * 2 && reader.canStep(direction) {
                    turn(reader, direction)
                } else {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.7)) { drag = 0 }
                }
            }
    }

    /// Throws the card off in `direction`, then shows the next one.
    func turn(_ reader: ReaderController, _ direction: Int) {
        guard reader.canStep(direction) else { return }
        if reduceMotion {
            drag = 0
            reader.step(direction)
            return
        }
        withAnimation(.easeIn(duration: 0.2)) { drag = CGFloat(direction) * width * 1.3 }
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 200_000_000)
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { drag = 0 }
            withAnimation(.spring(response: 0.32, dampingFraction: 0.85)) { reader.step(direction) }
            UIAccessibility.post(notification: .announcement, argument: announcement(reader))
        }
    }

    private func announcement(_ reader: ReaderController) -> String {
        guard let parsha = reader.parsha else { return "" }
        let position = reader.position
        if position.end { return "End of \(reader.aliyahName(position.aliyah))" }
        let (number, total) = pasukLocation(parsha, position)
        return "Pasuk \(number) of \(total), \(position.ref ?? "")"
    }
}

/// One card: a pasuk as Torah, Targum, then Torah again, or the end of the aliyah.
struct CardFace: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    let position: ReaderPosition

    var body: some View {
        Group {
            if position.end {
                EndActions()
            } else if let verse = app.reader.parsha?.aliyot[position.aliyah].verses.first(where: { $0.ref == position.ref }) {
                PasukGroup(verse: verse)
                    .padding(10)
                    .background(palette.track.opacity(0.35), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            }
        }
        .background(palette.page, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(0.08), radius: 10, y: 4)
    }
}

/// Previous on the right and Next on the left, the way a Hebrew page turns.
struct CardNav: View {
    @Environment(AppModel.self) private var app
    let turn: (Int) -> Void

    var body: some View {
        let reader = app.reader!
        let position = reader.position
        let verses = reader.parsha?.aliyot[position.aliyah].verses ?? []
        let atStart = position.aliyah == 0 && !position.end && verses.first?.ref == position.ref
        let atLast = !position.end && verses.last?.ref == position.ref
        HStack(spacing: 10) {
            Button {
                turn(1)
            } label: {
                Label(atLast ? "End of aliyah" : "Next pasuk", systemImage: "chevron.left")
            }
            .buttonStyle(PrimaryButtonStyle(prominent: true))
            .disabled(position.end)
            Button {
                turn(-1)
            } label: {
                HStack { Text("Previous pasuk"); Image(systemName: "chevron.right") }
            }
            .buttonStyle(PrimaryButtonStyle(prominent: false))
            .disabled(atStart)
        }
        .font(.subheadline)
    }
}
