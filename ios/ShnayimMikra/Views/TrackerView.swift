import ShnayimCore
import SwiftUI

/// The Tracker tab, ported from render() in src/ui.js.
struct TrackerView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    /// Bumped when the Tracker tab is tapped again, to scroll back to the top like the web app.
    var topRequest = 0

    var body: some View {
        let rows = app.rows
        let item = app.item
        let inThisCycle = app.year == app.thisCycle
        let weeklyRows = rows.filter { $0.day == app.weekly.day }
        let offWeek = !weeklyRows.contains { $0.id == item.id }

        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Shnayim Mikra")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(palette.muted)
                        .padding(.leading, 6)
                        .padding(.bottom, 8)
                        .id("top")
                    TitleRow(names: item.names)
                    if offWeek || !inThisCycle {
                        HStack {
                            Text("Shabbos of \(formatGregorianDate(item.day, withYear: !inThisCycle))")
                                .foregroundStyle(palette.muted)
                            Spacer()
                            if inThisCycle {
                                Button("Back to this week") {
                                    withAnimation(.snappy) { app.select(nil) }
                                }
                                .underline()
                                .foregroundStyle(palette.accent)
                                .frame(minHeight: 44)
                            }
                        }
                        .font(.footnote)
                        .padding(.horizontal, 6)
                        .padding(.top, 6)
                    }
                    VStack(spacing: 12) {
                        ProgressCard(item: item, isDoubleWeek: rows.contains { $0.id != item.id && $0.day == item.day })
                            .id(item.id)
                            .transition(.asymmetric(insertion: .opacity.combined(with: .offset(x: 16)), removal: .opacity))
                        let side = dynamicTypeSize.isAccessibilitySize
                            ? AnyLayout(VStackLayout(spacing: 10)) : AnyLayout(HStackLayout(alignment: .top, spacing: 10))
                        side {
                            YearCard(rows: rows, weeklyRows: weeklyRows, inThisCycle: inThisCycle)
                            ShabbosCard(rows: rows, inThisCycle: inThisCycle)
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        CycleCard(rows: rows, item: item, weeklyRows: inThisCycle ? weeklyRows : [])
                    }
                    .padding(.top, 16)
                    if !app.storageOK {
                        Text("Progress could not be saved. Check this device's storage.")
                            .font(.footnote)
                            .foregroundStyle(palette.warning)
                            .padding(.top, 18)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 24)
                .frame(maxWidth: 820)
                .frame(maxWidth: .infinity)
            }
            .onChange(of: topRequest) { _, _ in
                withAnimation(.snappy) { proxy.scrollTo("top", anchor: .top) }
            }
        }
        .background(palette.page)
    }
}

/// The parsha's name, with its Hebrew name across from it (.titlerow).
struct TitleRow: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    let names: [String]

    var body: some View {
        TitleLayout(spacing: 10) {
            Text(app.heroName(names))
                .font(.title.weight(.bold))
                .tracking(-1)
                .foregroundStyle(palette.ink)
                .environment(\.layoutDirection, app.naming == .hebrew ? .rightToLeft : .leftToRight)
            if app.naming != .hebrew {
                Text(hebrewName(names))
                    .font(.title2.weight(.medium))
                    .foregroundStyle(palette.softInk)
                    .multilineTextAlignment(.trailing)
                    .environment(\.layoutDirection, .rightToLeft)
            }
        }
        .padding(.horizontal, 6)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// The title on the leading side and, across from it on the same baseline, the Hebrew name,
/// which takes at most 35% of the width (.titlerow and .he).
struct TitleLayout: Layout {
    var spacing: CGFloat

    private func sizes(_ width: CGFloat, _ subviews: Subviews) -> [CGSize] {
        guard subviews.count > 1 else { return [subviews.first?.sizeThatFits(ProposedViewSize(width: width, height: nil)) ?? .zero] }
        let ideal = subviews[1].sizeThatFits(.unspecified).width
        let side = subviews[1].sizeThatFits(ProposedViewSize(width: min(ideal, width * 0.35), height: nil))
        let title = subviews[0].sizeThatFits(ProposedViewSize(width: max(0, width - side.width - spacing), height: nil))
        return [title, side]
    }

    private func baselines(_ sizes: [CGSize], _ subviews: Subviews) -> [CGFloat] {
        zip(subviews, sizes).map { $0.dimensions(in: ProposedViewSize($1))[VerticalAlignment.firstTextBaseline] }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 360
        let sizes = sizes(width, subviews)
        let lines = baselines(sizes, subviews)
        let top = lines.max() ?? 0
        let height = zip(sizes, lines).map { top - $1 + $0.height }.max() ?? 0
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let sizes = sizes(bounds.width, subviews)
        let lines = baselines(sizes, subviews)
        let top = lines.max() ?? 0
        for (index, subview) in subviews.enumerated() {
            let x = index == 0 ? bounds.minX : bounds.maxX - sizes[index].width
            subview.place(at: CGPoint(x: x, y: bounds.minY + top - lines[index]), proposal: ProposedViewSize(sizes[index]))
        }
    }
}

/// One bar per reading, so progress stays visible while every checklist is folded (.parsha-meter).
struct ParshaMeter: View {
    @Environment(\.palette) private var palette
    let progress: ParshaProgress
    let commentary: Reading
    let celebrating: Bool

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array([Reading.mikra1, .mikra2, commentary].enumerated()), id: \.offset) { index, reading in
                Bar(fraction: Double(readingCount(progress, reading)) / 7, height: 5)
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

        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("Progress").font(.callout.weight(.semibold)).foregroundStyle(palette.ink)
                Spacer()
                Text("\(steps(progress)) of 3")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(palette.muted)
                    .contentTransition(.numericText())
            }
            .padding(.bottom, 8)
            ParshaMeter(progress: progress, commentary: commentary, celebrating: celebrating)
                .padding(.bottom, 12)
            if isDoubleWeek {
                Text("Aliyos follow each parsha separately.")
                    .font(.caption)
                    .foregroundStyle(palette.muted)
                    .padding(.bottom, 10)
            }
            VStack(spacing: 6) {
                ForEach([Reading.mikra1, .mikra2, commentary], id: \.self) { reading in
                    ReadingBlock(item: item, reading: reading, progress: progress, open: expanded.contains(reading))
                }
            }
            if celebrating {
                CompletionBanner()
                    .padding(.top, 10)
                    .transition(.asymmetric(insertion: .scale(scale: 0.85).combined(with: .opacity), removal: .opacity))
            }
        }
        .card(EdgeInsets(top: 14, leading: 14, bottom: 14, trailing: 14))
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
                    .padding(6)
            }
            .frame(width: 22, height: 22)
            .scaleEffect(drawn ? 1 : 0.5)
            Text("Yasher koach! Parsha complete.")
                .font(.footnote.weight(.medium))
                .foregroundStyle(palette.ink)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.readingOn, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(palette.readingOnLine))
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

/// One reading: its bulk check, and a fold with seven aliyah checks (.reading-block).
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

        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                Button {
                    withAnimation(.snappy) { app.toggleExpanded(item.id, reading) }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(palette.muted)
                            .frame(width: 16, height: 16)
                            .rotationEffect(.degrees(open ? 90 : 0))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(label).font(.subheadline.weight(.medium)).foregroundStyle(palette.ink)
                            HStack(spacing: 8) {
                                HStack(spacing: 2) {
                                    ForEach(0..<7, id: \.self) { index in
                                        RoundedRectangle(cornerRadius: 2)
                                            .fill(checks[index] ? palette.accent : palette.track)
                                            .frame(width: 9, height: 4)
                                            .animation(.easeOut(duration: 0.14).delay(Double(index) * 0.028), value: checks[index])
                                    }
                                }
                                Text(status)
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(palette.muted)
                                    .contentTransition(.numericText())
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.leading, 10)
                    .padding(.trailing, 2)
                    .padding(.vertical, 8)
                    .frame(minHeight: 56)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("\(open ? "Hide" : "Show") \(label) aliyos, \(status)")

                Button {
                    app.toggleReading(item.id, reading)
                } label: {
                    CheckBox(on: count == 7, mixed: count > 0 && count < 7, size: 28)
                        .frame(width: 52, height: 56)
                }
                .buttonStyle(CheckPressStyle())
                .accessibilityLabel("\(app.titleName(item.names)), \(label), \(status). \(count == 7 ? "Clear" : "Mark") all seven aliyos")
            }

            if open {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(0..<7, id: \.self) { index in
                        if index > 0 { Rectangle().fill(palette.readingLine).frame(height: 1) }
                        Button {
                            app.toggleAliyah(item.id, reading, index)
                        } label: {
                            HStack(spacing: 8) {
                                Text(aliyahNames[index]).font(.subheadline).foregroundStyle(palette.ink)
                                Spacer(minLength: 0)
                                CheckBox(on: checks[index], size: 24)
                            }
                            .padding(.leading, 8)
                            .padding(.trailing, 10)
                            .padding(.vertical, 5)
                            .frame(minHeight: 44)
                        }
                        .buttonStyle(CheckPressStyle())
                        .accessibilityLabel("\(app.titleName(item.names)), \(label), \(aliyahNames[index])")
                        .accessibilityAddTraits(checks[index] ? .isSelected : [])
                    }
                    if reading.isCommentary {
                        Button("Switch to \(app.readingLabel(reading.other)) for this parsha") {
                            withAnimation(.snappy) { app.switchCommentary(item.id) }
                        }
                        .font(.footnote)
                        .underline()
                        .foregroundStyle(palette.accent)
                        .multilineTextAlignment(.leading)
                        .frame(minHeight: 44)
                        .padding(.horizontal, 6)
                    }
                }
                .padding(.leading, 26)
                .padding(.trailing, 6)
                .padding(.bottom, 4)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .background(count == 7 ? palette.readingOn : palette.readingBackground,
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(count == 7 ? palette.readingOnLine : palette.readingLine))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// The web's `.rcheck` press: the check shrinks a little, the row stays put.
struct CheckPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
    }
}

/// This week's and this year's counts (.card.yearly).
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

        VStack(alignment: .leading, spacing: 0) {
            if inThisCycle {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Kicker("This week")
                        Spacer(minLength: 0)
                        Counter(value: weeklySteps, total: weeklyTotal)
                    }
                    HStack(spacing: 4) {
                        ForEach(0..<weeklyTotal, id: \.self) { index in
                            Capsule()
                                .fill(weeklySteps > index ? palette.accent : palette.track)
                                .frame(height: 5)
                                .animation(.easeInOut(duration: 0.26), value: weeklySteps)
                        }
                    }
                    .padding(.top, 8)
                    .accessibilityElement()
                    .accessibilityLabel("\(weeklySteps) of \(weeklyTotal) completed for \(app.titleName(weeklyNames))")
                    Text(app.titleName(weeklyNames)).font(.caption2).foregroundStyle(palette.muted).padding(.top, 5)
                    ForEach(weeklyRows) { row in
                        let detail = app.readingDetail(row.id)
                        if !detail.isEmpty {
                            Text(weeklyRows.count > 1 ? "\(app.titleName(row.names)): \(detail)" : detail)
                                .font(.caption)
                                .foregroundStyle(palette.softInk)
                                .padding(.top, 6)
                        }
                    }
                }
                Rectangle().fill(palette.line).frame(height: 1).padding(.vertical, 10)
            }
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Kicker(inThisCycle ? "This year" : "This cycle")
                    Spacer(minLength: 0)
                    Counter(value: done, total: rows.count)
                }
                Bar(fraction: rows.isEmpty ? 0 : Double(done) / Double(rows.count))
                    .padding(.top, 8)
                    .accessibilityLabel("\(done) of \(rows.count) parshiyos completed")
                Text("Parshiyos completed").font(.caption2).foregroundStyle(palette.muted).padding(.top, 5)
            }
        }
        .card(EdgeInsets(top: 14, leading: 14, bottom: 14, trailing: 14), stretch: true)
    }
}

/// A count that rolls to its new value (.progressvalue).
struct Counter: View {
    @Environment(\.palette) private var palette
    let value: Int
    let total: Int

    var body: some View {
        (Text("\(value)").font(.title3.weight(.bold).monospacedDigit()).foregroundStyle(palette.ink)
            + Text(" / \(total)").font(.footnote.weight(.medium).monospacedDigit()).foregroundStyle(palette.muted))
            .tracking(-0.3)
            .contentTransition(.numericText(value: Double(value)))
            .animation(.snappy, value: value)
            .lineLimit(1)
            .fixedSize()
    }
}

/// The countdown to Shabbos, or which cycle is showing (.card.shabbos).
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
        VStack(alignment: .leading, spacing: 0) {
            Kicker(summary.title)
            Text(summary.main)
                .font(.title2.weight(.bold))
                .tracking(-0.5)
                .foregroundStyle(palette.ink)
                .padding(.top, 8)
            Text(summary.detail).font(.footnote).foregroundStyle(palette.muted).padding(.top, 6)
        }
        .card(EdgeInsets(top: 14, leading: 14, bottom: 14, trailing: 14), stretch: true, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// The five sefarim and their parshiyos (.card.cycle).
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

        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                ForEach(Array(books.enumerated()), id: \.offset) { index, sefer in
                    let sRows = rows.filter { seferOf($0.id) == index }
                    let sDone = sRows.filter { isComplete(app.state($0.id)) }.count
                    Button {
                        withAnimation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.26)) { app.activeSefer = index }
                    } label: {
                        Text(sefer.en)
                            .font(.caption2.weight(.medium))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .foregroundStyle(index == viewSefer ? palette.onAccent : palette.softInk)
                            .padding(.horizontal, 2)
                            .frame(maxWidth: .infinity, minHeight: 34)
                            .background {
                                if index == viewSefer {
                                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                                        .fill(palette.accent)
                                        .matchedGeometryEffect(id: "pill", in: pill)
                                }
                            }
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(sefer.en), \(sDone) of \(sRows.count) completed")
                    .accessibilityAddTraits(index == viewSefer ? .isSelected : [])
                }
            }
            .padding(3)
            .background(palette.tile, in: RoundedRectangle(cornerRadius: 11, style: .continuous))

            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("\(hebrew ? "ספר" : "Sefer") \(books[viewSefer].en)")
                    .font(.title3.weight(.bold))
                    .tracking(-0.45)
                    .foregroundStyle(palette.ink)
                Spacer(minLength: 0)
                Text("\(seferDone)/\(seferRows.count)")
                    .font(.title3.monospacedDigit())
                    .foregroundStyle(palette.softInk)
                    .contentTransition(.numericText())
            }
            .environment(\.layoutDirection, hebrew ? .rightToLeft : .leftToRight)
            .padding(.horizontal, 2)
            .padding(.top, 14)
            .padding(.bottom, 8)

            VStack(spacing: 2) {
                ForEach(Array(seferRows.enumerated()), id: \.element.id) { index, row in
                    let current = weeklyRows.contains { $0.id == row.id }
                    let selected = row.id == item.id
                    // Lines between rows, left out around the selected and current ones.
                    let previous = index > 0 ? seferRows[index - 1] : nil
                    let line = previous.map { previous in
                        !(current || selected || previous.id == item.id || weeklyRows.contains { $0.id == previous.id })
                    } ?? false
                    ParshaListRow(number: index + 1, row: row, current: current, selected: selected)
                        .overlay(alignment: .top) {
                            if line {
                                Rectangle().fill(palette.listLine).frame(height: 1)
                                    .padding(.leading, 12).padding(.trailing, 2)
                                    .offset(y: -1.5)
                            }
                        }
                }
            }
            .id(viewSefer)
            .transition(.opacity)
        }
        .card(EdgeInsets(top: 12, leading: 14, bottom: 8, trailing: 14))
    }
}

/// One parsha in the sefer's list (.parsharow).
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
            HStack(spacing: 8) {
                Text("\(number)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(done ? palette.accent : current ? palette.ink : palette.numberInk)
                    .frame(width: 22, height: 26)
                Text(app.titleName(row.names))
                    .font(.footnote)
                    .foregroundStyle(palette.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .environment(\.layoutDirection, app.naming == .hebrew ? .rightToLeft : .leftToRight)
                HStack(spacing: 5) {
                    if current { Circle().fill(palette.accent).frame(width: 7, height: 7) }
                    Text(partial ? (count > 0 ? "\(count)/3" : "In progress") : current ? "Current" : "")
                        .font(.caption2)
                        .foregroundStyle(palette.ink)
                }
                .frame(width: 84, alignment: .trailing)
                StatusRing(fraction: fraction, done: done)
            }
            .padding(.vertical, 5)
            .padding(.horizontal, 6)
            .frame(minHeight: 44)
            .background(selected ? palette.selected : .clear, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("\(app.titleName(row.names)), \(status)\(current ? ", current parsha" : "")")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
