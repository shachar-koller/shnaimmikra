import SwiftUI

/// A short burst in the theme's own colors, reserved for finishing all three readings.
/// Each change of `trigger` plays it once. It never takes touches.
struct ConfettiBurst: View {
    let trigger: Int
    let colors: [Color]
    /// Where the burst starts, in the overlay's unit coordinates.
    var origin = UnitPoint(x: 0.5, y: 0.32)

    private struct Piece {
        let angle: Double
        let speed: Double
        let spin: Double
        let size: CGSize
        let color: Int
        let round: Bool
        let life: Double
        let drift: Double
    }

    @State private var started: Date?
    @State private var pieces: [Piece] = []

    var body: some View {
        TimelineView(.animation(minimumInterval: nil, paused: started == nil)) { context in
            Canvas { canvas, size in
                guard let started else { return }
                let time = context.date.timeIntervalSince(started)
                let center = CGPoint(x: origin.x * size.width, y: origin.y * size.height)
                for piece in pieces where time < piece.life {
                    let progress = time / piece.life
                    // Out fast, then slow, then fall: an ease-out flight with gravity.
                    let travel = piece.speed * (1 - pow(1 - min(time / 0.9, 1), 3))
                    let x = center.x + cos(piece.angle) * travel + piece.drift * time
                    let y = center.y + sin(piece.angle) * travel * 0.8 + 260 * time * time
                    var context = canvas
                    context.opacity = progress < 0.7 ? 1 : max(0, 1 - (progress - 0.7) / 0.3)
                    context.translateBy(x: x, y: y)
                    context.rotate(by: .degrees(piece.spin * time))
                    let rect = CGRect(x: -piece.size.width / 2, y: -piece.size.height / 2, width: piece.size.width, height: piece.size.height)
                    let path = piece.round ? Path(ellipseIn: rect) : Path(roundedRect: rect, cornerRadius: 1.5)
                    context.fill(path, with: .color(colors[piece.color % max(colors.count, 1)]))
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onChange(of: trigger) { _, _ in play() }
    }

    private func play() {
        pieces = (0..<44).map { index in
            let round = index % 3 == 1
            let side = Double.random(in: 5...9)
            return Piece(
                angle: Double(index) / 44 * 2 * .pi + .random(in: -0.25...0.25),
                speed: .random(in: 90...210),
                spin: .random(in: -540...540),
                size: round ? CGSize(width: side * 0.9, height: side * 0.9) : CGSize(width: side, height: side * 0.55),
                color: index,
                round: round,
                life: .random(in: 1.1...1.6),
                drift: .random(in: -30...30))
        }
        let start = Date()
        started = start
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            if started == start { started = nil }
        }
    }
}
