import ShnayimCore
import SwiftUI

/// The Chumash tab: one reading session shown as Cards, Flow or Classic. Ported from src/reader.js.
struct ChumashView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @State private var scrolledID: String?

    var body: some View {
        let reader = app.reader!
        let item = app.item
        VStack(spacing: 0) {
            ReaderHeader(item: item)
            Divider().overlay(palette.line)
            content(reader)
        }
        .background(palette.page)
        .task(id: "\(app.owner ?? "guest"):\(app.year):\(item.id)") { reader.sync(item) }
        .sheet(isPresented: Binding(get: { reader.choosingParsha }, set: { reader.choosingParsha = $0 })) {
            ParshaPicker(current: item.id) { id in
                reader.choosingParsha = false
                reader.chooseParsha(id)
            }
            .environment(app)
            .environment(\.palette, palette)
        }
    }

    @ViewBuilder
    private func content(_ reader: ReaderController) -> some View {
        switch reader.text {
        case .loading:
            stateMessage("Loading \(reader.name)…")
        case .failed:
            VStack(spacing: 12) {
                Text("The text of this parsha couldn’t be read. Your place is saved.")
                    .foregroundStyle(palette.muted)
                    .multilineTextAlignment(.center)
                Button("Try again") { reader.retry() }
                    .buttonStyle(PrimaryButtonStyle(prominent: false))
                    .frame(maxWidth: 260)
            }
            .padding(32)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .ready(let parsha):
            let verses = parsha.aliyot[reader.aliyah].verses
            ScrollView {
                Group {
                    switch reader.mode {
                    case .cards:
                        CardDeck()
                    case .flow:
                        LazyVStack(alignment: .leading, spacing: 10) {
                            ForEach(verses) { verse in
                                ForEach(PasukPart.allCases, id: \.self) { part in
                                    PasukPartView(verse: verse, part: part, showReference: part == .first)
                                        .id("\(verse.ref)|\(part.rawValue)")
                                }
                            }
                            EndActions().id("end").padding(.top, 10)
                        }
                        .scrollTargetLayout()
                    case .classic:
                        ClassicText(verses: verses)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
                ReaderCredit()
                    .padding(16)
                    .frame(maxWidth: 720)
            }
            .scrollPosition(id: $scrolledID, anchor: .top)
            .id("\(parsha.id):\(reader.mode.rawValue):\(reader.aliyah)")
            .onAppear { scrollToPlace(reader, parsha) }
            .onChange(of: reader.scrollRequest) { _, _ in scrollToPlace(reader, parsha) }
            .onChange(of: scrolledID) { _, id in follow(reader, parsha, id) }
        }
    }

    private func stateMessage(_ text: String) -> some View {
        Text(text)
            .foregroundStyle(palette.muted)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Puts the saved place at the top of the screen.
    private func scrollToPlace(_ reader: ReaderController, _ parsha: ParshaText) {
        let position = reader.position
        let verses = parsha.aliyot[position.aliyah].verses
        let target: String?
        switch reader.mode {
        case .cards:
            target = nil
        case .flow:
            target = position.end ? "end" : "\(position.ref ?? verses[0].ref)|\(position.part.rawValue)"
        case .classic:
            if position.end { target = "end" }
            else {
                let paragraphs = HebrewText.classicParagraphs(verses, palette: palette)
                target = paragraphs.firstIndex { $0.verses.contains(position.ref ?? "") }.map { "p\($0)" } ?? "p0"
            }
        }
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) { scrolledID = target }
    }

    /// The topmost reading on screen is where they are.
    private func follow(_ reader: ReaderController, _ parsha: ParshaText, _ id: String?) {
        guard let id, reader.mode != .cards else { return }
        let verses = parsha.aliyot[reader.position.aliyah].verses
        if id == "end" {
            reader.track(ref: verses[verses.count - 1].ref, part: .second, end: true)
        } else if reader.mode == .flow {
            let pieces = id.split(separator: "|").map(String.init)
            guard pieces.count == 2, let part = PasukPart(rawValue: pieces[1]) else { return }
            reader.track(ref: pieces[0], part: part, end: false)
        } else if id.hasPrefix("p"), let index = Int(id.dropFirst()) {
            let paragraphs = HebrewText.classicParagraphs(verses, palette: palette)
            guard paragraphs.indices.contains(index) else { return }
            let shown = paragraphs[index].verses
            // Within a paragraph, keep the exact pasuk they were on.
            if let ref = reader.position.ref, shown.contains(ref), !reader.position.end { return }
            reader.track(ref: shown[0], part: .first, end: false)
        }
    }
}

/// Title, aliyah steps, mode and place. Stays put while the text scrolls.
struct ReaderHeader: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    let item: ParshaRow

    var body: some View {
        let reader = app.reader!
        VStack(alignment: .leading, spacing: 10) {
            Button { reader.choosingParsha = true } label: {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(app.heroName(item.names))
                        .font(.title2.weight(.bold))
                        .foregroundStyle(palette.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Image(systemName: "chevron.down")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(palette.muted)
                    Spacer(minLength: 8)
                    if app.naming != .hebrew {
                        Text(hebrewName(item.names))
                            .font(.subheadline)
                            .foregroundStyle(palette.muted)
                            .lineLimit(1)
                    }
                }
                .environment(\.layoutDirection, app.naming == .hebrew ? .rightToLeft : .leftToRight)
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("\(app.heroName(item.names)). Choose parsha")

            AliyahStrip()

            Picker("Reading mode", selection: Binding(get: { reader.mode }, set: { mode in
                withAnimation(.snappy) { reader.chooseMode(mode) }
            })) {
                ForEach(ReaderMode.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)

            HStack(spacing: 10) {
                Text(reader.locationText)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(palette.muted)
                    .contentTransition(.numericText())
                if let progress = reader.readingProgress {
                    ProgressView(value: Double(progress.value), total: Double(max(progress.total, 1)))
                        .tint(palette.accent)
                        .animation(.easeOut(duration: 0.25), value: progress.value)
                        .accessibilityLabel("Reading position in this parsha")
                        .accessibilityValue(progress.description)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .frame(maxWidth: 720)
        .frame(maxWidth: .infinity)
        .background(palette.page)
    }
}

/// Seven steps: where you are, what's marked, and one tap to get anywhere.
struct AliyahStrip: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Namespace private var current

    var body: some View {
        let reader = app.reader!
        HStack(spacing: 6) {
            ForEach(0..<aliyahCount, id: \.self) { index in
                let count = aliyahMarkCount(reader.progress, index)
                let done = count == shnayimMikraReadings.count
                let here = index == reader.aliyah
                Button {
                    withAnimation(.snappy) { reader.goToAliyah(index) }
                } label: {
                    HStack(spacing: 3) {
                        if done {
                            Image(systemName: "checkmark").font(.system(size: 10, weight: .heavy))
                        }
                        Text(here ? aliyahNames[index] : "\(index + 1)")
                            .font(.caption.weight(.semibold).monospacedDigit())
                            .lineLimit(1)
                            .fixedSize()
                    }
                    .foregroundStyle(here ? palette.onAccent : done ? palette.accent : palette.ink)
                    .padding(.horizontal, here ? 10 : 0)
                    .frame(minWidth: 30, maxWidth: here ? nil : .infinity, minHeight: 30)
                    .background {
                        ZStack {
                            Capsule().fill(count > 0 && !done ? palette.readingOn : palette.readingBackground)
                            Capsule().strokeBorder(done ? palette.readingOnLine : palette.line)
                            if here {
                                Capsule().fill(palette.accent).matchedGeometryEffect(id: "here", in: current)
                            }
                        }
                    }
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("Aliyah \(index + 1), \(aliyahNames[index]), \(done ? "complete" : "\(count) of 3 marked")")
                .accessibilityAddTraits(here ? .isSelected : [])
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: reader.aliyah)
    }
}

/// One reading of a pasuk: Mikra I, Targum Onkelos, or Mikra II.
struct PasukPartView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    let verse: Verse
    let part: PasukPart
    var showReference = false

    var body: some View {
        let parts = part == .targum ? verse.onkelos : verse.torah
        VStack(alignment: .leading, spacing: 6) {
            if showReference {
                Text(app.reader.pasukReference(verse))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(palette.softInk)
                    .environment(\.layoutDirection, app.naming == .hebrew ? .rightToLeft : .leftToRight)
            }
            Text(part.label.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(0.5)
                .foregroundStyle(part == .targum ? palette.accent : palette.muted)
            if let parts {
                Text(HebrewText.inline(parts, palette: palette))
                    .foregroundStyle(palette.ink)
                    .lineSpacing(6)
                    // Always the full pasuk: on a card, layout could otherwise cut it to one line.
                    .fixedSize(horizontal: false, vertical: true)
                    .rightToLeft()
                    .textSelection(.enabled)
            } else {
                Text(part == .targum ? "Targum Onkelos is not available for this pasuk." : "This pasuk’s text is not available.")
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(part == .targum ? palette.readingBackground : palette.card,
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(palette.line))
        .padding(.top, showReference ? 8 : 0)
        .accessibilityElement(children: .combine)
    }
}

/// A whole pasuk, as one card shows it.
struct PasukGroup: View {
    let verse: Verse
    var body: some View {
        VStack(spacing: 10) {
            ForEach(PasukPart.allCases, id: \.self) { part in
                PasukPartView(verse: verse, part: part, showReference: part == .first)
            }
        }
    }
}

struct ClassicText: View {
    @Environment(\.palette) private var palette
    let verses: [Verse]

    var body: some View {
        let paragraphs = HebrewText.classicParagraphs(verses, palette: palette)
        LazyVStack(alignment: .leading, spacing: 16) {
            ForEach(Array(paragraphs.enumerated()), id: \.offset) { index, paragraph in
                Text(paragraph.text)
                    .foregroundStyle(palette.ink)
                    .lineSpacing(8)
                    .fixedSize(horizontal: false, vertical: true)
                    .rightToLeft()
                    .textSelection(.enabled)
                    .id("p\(index)")
            }
            EndActions().id("end").padding(.top, 10)
        }
        .scrollTargetLayout()
        .padding(16)
        .background(palette.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

/// The end of an aliyah: what's marked, the marking buttons, and the way on.
struct EndActions: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette

    var body: some View {
        let reader = app.reader!
        let index = reader.aliyah
        let last = index == aliyahCount - 1
        let progress = reader.progress
        VStack(alignment: .leading, spacing: 12) {
            Text(last ? "End of \(reader.name)" : "End of \(aliyahNames[index])")
                .font(.headline)
                .foregroundStyle(palette.ink)
                .accessibilityAddTraits(.isHeader)
            if reader.mode == .classic {
                HStack(spacing: 8) {
                    ForEach([Reading.mikra1, .mikra2], id: \.self) { reading in
                        let done = progress[aliyahField(reading, index)] == true
                        MarkButton(done: done, label: done ? "\(app.readingLabel(reading)) marked" : "Mark \(app.readingLabel(reading))") {
                            reader.mark(mikraPatch(reading, index))
                        }
                    }
                }
                note("Each marks one reading of this aliyah. To uncheck one, use the Tracker.")
            } else {
                HStack(spacing: 14) {
                    ForEach(shnayimMikraReadings, id: \.self) { reading in
                        let on = progress[aliyahField(reading, index)] == true
                        HStack(spacing: 5) {
                            CheckCircle(on: on, size: 18)
                            Text(app.readingLabel(reading)).font(.footnote).foregroundStyle(palette.ink)
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(app.readingLabel(reading)) \(on ? "marked" : "not marked")")
                    }
                }
                let done = isMarked(progress, aliyahCompletionPatch(index))
                MarkButton(done: done, label: done ? "Aliyah complete" : "Mark aliyah complete") {
                    reader.mark(aliyahCompletionPatch(index))
                }
                note("Marks Mikra I, Mikra II and Targum for this aliyah only. To uncheck, use the Tracker.")
                if app.commentaryOf(reader.location?.id ?? "") == .rashi {
                    note("Your tracker is showing \(app.readingLabel(.rashi)) for this parsha. Targum marks are saved separately and don’t change that choice.")
                }
            }
            if !reader.saveNote.isEmpty {
                Text(reader.saveNote).font(.footnote).foregroundStyle(palette.warning)
            }
            let lead = reader.marksDone
            if last {
                if let following = reader.nextParsha {
                    Button("Continue to \(app.titleName(following.names))") {
                        withAnimation(.snappy) { reader.chooseParsha(following.id) }
                    }
                    .buttonStyle(PrimaryButtonStyle(prominent: lead))
                }
                Button("Choose another parsha") { reader.choosingParsha = true }
                    .buttonStyle(PrimaryButtonStyle(prominent: false))
            } else {
                Button {
                    withAnimation(.snappy) { reader.goToAliyah(index + 1) }
                } label: {
                    HStack {
                        Text("Continue to next aliyah")
                        Text(aliyahNames[index + 1]).opacity(0.7)
                    }
                }
                .buttonStyle(PrimaryButtonStyle(prominent: lead))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(palette.line))
        .animation(.snappy, value: progress)
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.caption).foregroundStyle(palette.muted)
    }
}

struct MarkButton: View {
    @Environment(\.palette) private var palette
    let done: Bool
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if done { Image(systemName: "checkmark").font(.footnote.weight(.bold)).transition(.scale.combined(with: .opacity)) }
                Text(label)
            }
            .font(.subheadline.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: 44)
            .foregroundStyle(done ? palette.accent : palette.onAccent)
            .background(done ? palette.readingOn : palette.accent, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(done ? palette.readingOnLine : .clear))
        }
        .buttonStyle(PressableStyle())
        .disabled(done)
        .animation(.spring(response: 0.35, dampingFraction: 0.6), value: done)
    }
}

struct ReaderCredit: View {
    @Environment(\.palette) private var palette

    var body: some View {
        Text(LocalizedStringKey("Torah: [Miqra according to the Masorah](https://en.wikisource.org/wiki/User:Dovi/Miqra_according_to_the_Masorah), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Targum Onkelos: Torat Emet, public domain. Both via [Sefaria](https://www.sefaria.org), with layout adapted. Every parsha is included in the app, so reading works offline."))
            .font(.caption2)
            .foregroundStyle(palette.muted)
            .tint(palette.softInk)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Every parsha of the cycle, by sefer.
struct ParshaPicker: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    let current: String
    let choose: (String) -> Void

    var body: some View {
        let rows = app.rows
        NavigationStack {
            ScrollViewReader { proxy in
                List {
                    ForEach(Array(sefarim(for: app.naming).enumerated()), id: \.offset) { index, sefer in
                        Section(sefer.en) {
                            ForEach(rows.filter { seferOf($0.id) == index }) { row in
                                Button { choose(row.id) } label: {
                                    HStack {
                                        Text(app.titleName(row.names)).foregroundStyle(palette.ink)
                                        Spacer()
                                        if row.id == current { Image(systemName: "checkmark").foregroundStyle(palette.accent) }
                                        StatusRing(fraction: Double(aliyahSteps(app.state(row.id))) / 21, done: isComplete(app.state(row.id)))
                                    }
                                }
                                .id(row.id)
                                .listRowBackground(palette.card)
                            }
                        }
                    }
                }
                .scrollContentBackground(.hidden)
                .background(palette.page)
                .onAppear { proxy.scrollTo(current, anchor: .center) }
            }
            .navigationTitle("Choose parsha")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
        .tint(palette.accent)
        .presentationDetents([.medium, .large])
    }
}
