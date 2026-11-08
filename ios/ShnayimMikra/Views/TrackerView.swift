import ShnayimCore
import SwiftUI

/// The Tracker tab, ported from render() in src/ui.js.
struct TrackerView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette

    var body: some View {
        let rows = app.rows
        let item = app.item
        let inThisCycle = app.year == app.thisCycle
        let weeklyRows = rows.filter { $0.day == app.weekly.day }
        let offWeek = !weeklyRows.contains { $0.id == item.id }

        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                TitleRow(names: item.names)
                    .id("top")
                if offWeek || !inThisCycle {
                    HStack {
                        Text("Shabbos of \(formatGregorianDate(item.day, withYear: !inThisCycle))")
                            .foregroundStyle(palette.muted)
                        Spacer()
                        if inThisCycle {
                            Button("Back to this week") {
                                withAnimation(.snappy) { app.select(nil) }
                            }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(palette.accent)
                        }
                    }
                    .font(.subheadline)
                }
                ProgressCard(item: item, isDoubleWeek: rows.contains { $0.id != item.id && $0.day == item.day })
                    .id(item.id)
                    .transition(.asymmetric(insertion: .opacity.combined(with: .offset(x: 16)), removal: .opacity))
                YearCard(rows: rows, weeklyRows: weeklyRows, inThisCycle: inThisCycle)
                ShabbosCard(rows: rows, inThisCycle: inThisCycle)
                CycleCard(rows: rows, item: item, weeklyRows: inThisCycle ? weeklyRows : [])
                if !app.storageOK {
                    Text("Progress could not be saved. Check this device's storage.")
                        .font(.footnote)
                        .foregroundStyle(palette.warning)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(palette.page)
    }
}

struct TitleRow: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    let names: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(app.heroName(names))
                .font(.largeTitle.weight(.bold))
                .foregroundStyle(palette.ink)
                .environment(\.layoutDirection, app.naming == .hebrew ? .rightToLeft : .leftToRight)
                .frame(maxWidth: .infinity, alignment: .leading)
            if app.naming != .hebrew {
                Text(hebrewName(names))
                    .font(.title3)
                    .foregroundStyle(palette.muted)
                    .environment(\.layoutDirection, .rightToLeft)
            }
        }
        .padding(.top, 8)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// One bar per reading, so progress stays visible while every checklist is folded.
struct ParshaMeter: View {
    @Environment(\.palette) private var palette
    let progress: ParshaProgress
    let commentary: Reading
    let celebrating: Bool

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array([Reading.mikra1, .mikra2, commentary].enumerated()), id: \.offset) { index, reading in
                Bar(fraction: Double(readingCount(progress, reading)) / 7, height: 8)
                    .scaleEffect(y: celebrating ? 1.5 : 1)
                    .animation(.spring(response: 0.35, dampingFraction: 0.45).delay(Double(index) * 0.08), value: celebrating)
            }
        }
        .accessibilityElement()
        .accessibilityLabel("\(steps(progress)) of 3 complete")
    }
}

struct ProgressCard: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    let item: ParshaRow
    let isDoubleWeek: Bool

    var body: some View {
        let progress = app.state(item.id)
        let commentary = app.commentaryOf(item.id)
        let celebrating = app.completedFeedback == app.viewKey(item.id) && isComplete(progress)
        let expanded = app.expanded[app.viewKey(item.id)] ?? []

        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Progress").font(.headline).foregroundStyle(palette.ink)
                Spacer()
                Text("\(steps(progress)) of 3")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(palette.muted)
                    .contentTransition(.numericText())
            }
            ParshaMeter(progress: progress, commentary: commentary, celebrating: celebrating)
            if isDoubleWeek {
                Text("Aliyos follow each parsha separately.")
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
            }
            VStack(spacing: 8) {
                ForEach([Reading.mikra1, .mikra2, commentary], id: \.self) { reading in
                    ReadingBlock(item: item, reading: reading, progress: progress, open: expanded.contains(reading))
                }
            }
            if celebrating {
                CompletionBanner()
                    .transition(.asymmetric(insertion: .scale(scale: 0.85).combined(with: .opacity), removal: .opacity))
            }
        }
        .card()
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(palette.accent, lineWidth: 2)
                .opacity(celebrating ? 1 : 0)
                .scaleEffect(celebrating ? 1 : 0.97)
        )
        .animation(.spring(response: 0.5, dampingFraction: 0.7), value: celebrating)
        .animation(.snappy, value: progress)
    }
}

/// "Yasher koach!", with a tick that draws itself in.
struct CompletionBanner: View {
    @Environment(\.palette) private var palette
    @State private var drawn = false

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle().fill(palette.accent)
                CheckShape()
                    .trim(from: 0, to: drawn ? 1 : 0)
                    .stroke(palette.onAccent, style: StrokeStyle(lineWidth: 2.6, lineCap: .round, lineJoin: .round))
                    .padding(7)
            }
            .frame(width: 30, height: 30)
            .scaleEffect(drawn ? 1 : 0.5)
            Text("Yasher koach! Parsha complete.")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(palette.ink)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.readingOn, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.55).delay(0.1)) { drawn = true }
        }
        .accessibilityElement(children: .combine)
    }
}

struct CheckShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY + rect.height * 0.05))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.36, y: rect.maxY - rect.height * 0.12))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + rect.height * 0.12))
        return path
    }
}

/// One reading: its bulk check, and a fold with seven aliyah checks.
struct ReadingBlock: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    let item: ParshaRow
    let reading: Reading
    let progress: ParshaProgress
    let open: Bool

    var body: some View {
        let count = readingCount(progress, reading)
        let checks = readingChecks(progress, reading)
        let label = app.readingLabel(reading)
        let status = count == 7 ? "Complete" : count > 0 ? "\(count) of 7 aliyos" : "Not started"

        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button {
                    withAnimation(.snappy) { app.toggleExpanded(item.id, reading) }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.bold))
                            .foregroundStyle(palette.muted)
                            .rotationEffect(.degrees(open ? 90 : 0))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(label).font(.body.weight(.semibold)).foregroundStyle(palette.ink)
                            HStack(spacing: 6) {
                                HStack(spacing: 3) {
                                    ForEach(0..<7, id: \.self) { index in
                                        Circle()
                                            .fill(checks[index] ? palette.accent : palette.track)
                                            .frame(width: 6, height: 6)
                                            .scaleEffect(checks[index] ? 1 : 0.8)
                                            .animation(.spring(response: 0.3, dampingFraction: 0.5).delay(Double(index) * 0.03), value: checks[index])
                                    }
                                }
                                Text(status)
                                    .font(.caption)
                                    .foregroundStyle(palette.muted)
                                    .contentTransition(.numericText())
                            }
                        }
                        Spacer(minLength: 0)
                    }
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("\(open ? "Hide" : "Show") \(label) aliyos, \(status)")

                Button {
                    app.toggleReading(item.id, reading)
                } label: {
                    CheckCircle(on: count == 7, mixed: count > 0 && count < 7, size: 32)
                        .padding(4)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("\(app.titleName(item.names)), \(label), \(status). \(count == 7 ? "Clear" : "Mark") all seven aliyos")
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 12)

            if open {
                VStack(spacing: 0) {
                    ForEach(0..<7, id: \.self) { index in
                        Button {
                            app.toggleAliyah(item.id, reading, index)
                        } label: {
                            HStack {
                                Text(aliyahNames[index]).foregroundStyle(palette.ink)
                                Spacer()
                                CheckCircle(on: checks[index], size: 24)
                            }
                            .padding(.vertical, 9)
                            .padding(.horizontal, 14)
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityLabel("\(app.titleName(item.names)), \(label), \(aliyahNames[index])")
                        .accessibilityAddTraits(checks[index] ? .isSelected : [])
                        if index < 6 { Divider().overlay(palette.line).padding(.leading, 14) }
                    }
                    if reading.isCommentary {
                        Button("Switch to \(app.readingLabel(reading.other)) for this parsha") {
                            withAnimation(.snappy) { app.switchCommentary(item.id) }
                        }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(palette.accent)
                        .padding(.vertical, 10)
                    }
                }
                .background(palette.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding([.horizontal, .bottom], 8)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .background(count == 7 ? palette.readingOn : palette.readingBackground,
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .strokeBorder(count == 7 ? palette.readingOnLine : palette.line))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct YearCard: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    let rows: [ParshaRow]
    let weeklyRows: [ParshaRow]
    let inThisCycle: Bool

    var body: some View {
        let done = rows.filter { isComplete(app.state($0.id)) }.count
        let weeklyTotal = weeklyRows.count * 3
        let weeklySteps = weeklyRows.reduce(0) { $0 + steps(app.state($1.id)) }
        let weeklyNames = weeklyRows.flatMap(\.names)

        VStack(alignment: .leading, spacing: 16) {
            if inThisCycle {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        Kicker("This week")
                        Spacer()
                        Counter(value: weeklySteps, total: weeklyTotal)
                    }
                    HStack(spacing: 4) {
                        ForEach(0..<weeklyTotal, id: \.self) { index in
                            Capsule()
                                .fill(weeklySteps > index ? palette.accent : palette.track)
                                .frame(height: 8)
                                .animation(.spring(response: 0.4, dampingFraction: 0.6).delay(Double(index) * 0.05), value: weeklySteps)
                        }
                    }
                    .accessibilityElement()
                    .accessibilityLabel("\(weeklySteps) of \(weeklyTotal) completed for \(app.titleName(weeklyNames))")
                    Text(app.titleName(weeklyNames)).font(.subheadline).foregroundStyle(palette.ink)
                    ForEach(weeklyRows) { row in
                        let detail = app.readingDetail(row.id)
                        if !detail.isEmpty {
                            Text(weeklyRows.count > 1 ? "\(app.titleName(row.names)): \(detail)" : detail)
                                .font(.caption)
                                .foregroundStyle(palette.muted)
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Kicker(inThisCycle ? "This year" : "This cycle")
                    Spacer()
                    Counter(value: done, total: rows.count, big: true)
                }
                Bar(fraction: rows.isEmpty ? 0 : Double(done) / Double(rows.count))
                    .accessibilityLabel("\(done) of \(rows.count) parshiyos completed")
                Text("Parshiyos completed").font(.subheadline).foregroundStyle(palette.muted)
            }
        }
        .card()
    }
}

/// A count that rolls to its new value.
struct Counter: View {
    @Environment(\.palette) private var palette
    let value: Int
    let total: Int
    var big = false

    var body: some View {
        (Text("\(value)").font((big ? Font.title : .title3).weight(.bold).monospacedDigit()).foregroundStyle(palette.ink)
            + Text(" / \(total)").font(.subheadline.monospacedDigit()).foregroundStyle(palette.muted))
            .contentTransition(.numericText(value: Double(value)))
            .animation(.snappy, value: value)
    }
}

struct ShabbosCard: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    let rows: [ParshaRow]
    let inThisCycle: Bool

    var body: some View {
        let summary: (title: String, main: String, detail: String) = inThisCycle
            ? ("Upcoming Shabbos", shabbosCountdown(app.weekly.day, today: app.today), formatGregorianDate(app.weekly.day))
            : app.year < app.thisCycle
                ? ("Past cycle", cycleLabel(app.year), "Ended \(formatGregorianDate(rows[rows.count - 1].day, withYear: true))")
                : ("Future cycle", cycleLabel(app.year), "Begins \(formatGregorianDate(rows[0].day, withYear: true))")
        VStack(alignment: .leading, spacing: 4) {
            Kicker(summary.title)
            Text(summary.main).font(.title2.weight(.bold)).foregroundStyle(palette.ink)
            Text(summary.detail).font(.subheadline).foregroundStyle(palette.muted)
        }
        .card()
        .accessibilityElement(children: .combine)
    }
}

struct CycleCard: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Namespace private var pill
    let rows: [ParshaRow]
    let item: ParshaRow
    let weeklyRows: [ParshaRow]

    var body: some View {
        let books = sefarim(for: app.naming)
        let viewSefer = app.activeSefer ?? seferOf(item.id)
        let seferRows = rows.filter { seferOf($0.id) == viewSefer }
        let seferDone = seferRows.filter { isComplete(app.state($0.id)) }.count
        let hebrew = app.naming == .hebrew

        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 2) {
                ForEach(Array(books.enumerated()), id: \.offset) { index, sefer in
                    let sRows = rows.filter { seferOf($0.id) == index }
                    let sDone = sRows.filter { isComplete(app.state($0.id)) }.count
                    Button {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { app.activeSefer = index }
                    } label: {
                        Text(sefer.en)
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .foregroundStyle(index == viewSefer ? palette.ink : palette.muted)
                            .frame(maxWidth: .infinity, minHeight: 32)
                            .background {
                                if index == viewSefer {
                                    Capsule().fill(palette.card)
                                        .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
                                        .matchedGeometryEffect(id: "pill", in: pill)
                                }
                            }
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityLabel("\(sefer.en), \(sDone) of \(sRows.count) completed")
                    .accessibilityAddTraits(index == viewSefer ? .isSelected : [])
                }
            }
            .padding(3)
            .background(palette.track, in: Capsule())

            HStack(alignment: .firstTextBaseline) {
                Text("\(hebrew ? "ספר" : "Sefer") \(books[viewSefer].en)")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(palette.ink)
                Spacer()
                Text("\(seferDone)/\(seferRows.count)")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(palette.muted)
                    .contentTransition(.numericText())
            }
            .environment(\.layoutDirection, hebrew ? .rightToLeft : .leftToRight)

            VStack(spacing: 0) {
                ForEach(Array(seferRows.enumerated()), id: \.element.id) { index, row in
                    ParshaListRow(number: index + 1, row: row, current: weeklyRows.contains { $0.id == row.id },
                                  selected: row.id == item.id)
                    if index < seferRows.count - 1 { Divider().overlay(palette.line) }
                }
            }
            .id(viewSefer)
            .transition(.opacity)
        }
        .card(padding: 12)
    }
}

struct ParshaListRow: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    let number: Int
    let row: ParshaRow
    let current: Bool
    let selected: Bool

    var body: some View {
        let progress = app.state(row.id)
        let done = isComplete(progress)
        let count = steps(progress)
        let fraction = Double(aliyahSteps(progress)) / 21
        let partial = fraction > 0 && !done
        let status = done ? "Completed" : partial ? "\(count) of 3 done, \(app.readingDetail(row.id).isEmpty ? "In progress" : app.readingDetail(row.id))" : "Not started"

        Button {
            withAnimation(.snappy) { app.select(row.id) }
        } label: {
            HStack(spacing: 12) {
                Text("\(number)")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(palette.numberInk)
                    .frame(width: 22)
                Text(app.titleName(row.names))
                    .font(.body)
                    .foregroundStyle(palette.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .environment(\.layoutDirection, app.naming == .hebrew ? .rightToLeft : .leftToRight)
                HStack(spacing: 5) {
                    if current { Circle().fill(palette.accent).frame(width: 6, height: 6) }
                    Text(partial ? (count > 0 ? "\(count)/3" : "In progress") : current ? "Current" : "")
                        .font(.caption)
                        .foregroundStyle(palette.muted)
                }
                StatusRing(fraction: fraction, done: done)
            }
            .padding(.vertical, 11)
            .padding(.horizontal, 8)
            .background(selected ? palette.selected : .clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("\(app.titleName(row.names)), \(status)\(current ? ", current parsha" : "")")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
