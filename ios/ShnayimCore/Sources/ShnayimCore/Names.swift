// Ported from src/names.js.

public enum Naming: String, CaseIterable, Sendable {
    case ashkenazi, sephardi, hebrew

    public var label: String {
        switch self {
        case .ashkenazi: "Ashkenazi"
        case .sephardi: "Sephardi"
        case .hebrew: "Hebrew"
        }
    }
}

public struct Sefer: Sendable, Equatable {
    public let en: String
    public let he: String
}

public let sefarim: [Sefer] = [
    Sefer(en: "Bereishis", he: "בראשית"),
    Sefer(en: "Shemos", he: "שמות"),
    Sefer(en: "Vayikra", he: "ויקרא"),
    Sefer(en: "Bamidbar", he: "במדבר"),
    Sefer(en: "Devarim", he: "דברים"),
]
private let sephardiSefarim = ["Bereshit", "Shemot", "Vayikra", "Bamidbar", "Devarim"]

public func sefarim(for naming: Naming) -> [Sefer] {
    sefarim.enumerated().map { index, sefer in
        Sefer(en: naming == .hebrew ? sefer.he : naming == .sephardi ? sephardiSefarim[index] : sefer.en, he: sefer.he)
    }
}

// Keys are exact Hebcal English names (full id first, so hyphenated names like Lech-Lecha resolve).
private let seferOfName: [String: Int] = {
    let groups: [[String]] = [
        ["Bereshit", "Noach", "Lech-Lecha", "Vayera", "Chayei Sara", "Toldot", "Vayetzei", "Vayishlach", "Vayeshev", "Miketz", "Vayigash", "Vayechi"],
        ["Shemot", "Vaera", "Bo", "Beshalach", "Yitro", "Mishpatim", "Terumah", "Tetzaveh", "Ki Tisa", "Vayakhel", "Pekudei"],
        ["Vayikra", "Tzav", "Shmini", "Tazria", "Metzora", "Tazria-Metzora", "Achrei Mot", "Kedoshim", "Achrei Mot-Kedoshim", "Emor", "Behar", "Bechukotai", "Behar-Bechukotai"],
        ["Bamidbar", "Nasso", "Beha'alotcha", "Sh'lach", "Korach", "Chukat", "Balak", "Pinchas", "Matot", "Masei", "Matot-Masei"],
        ["Devarim", "Vaetchanan", "Eikev", "Re'eh", "Shoftim", "Ki Teitzei", "Ki Tavo", "Nitzavim", "Vayeilech", "Ha'azinu", "Vezot Haberakhah"],
    ]
    var result: [String: Int] = [:]
    for (index, names) in groups.enumerated() { for name in names { result[name] = index } }
    return result
}()

public func seferOf(_ id: String) -> Int {
    seferOfName[id] ?? seferOfName[String(id.split(separator: "-").first ?? "")] ?? 0
}

// Ashkenazi (Yeshivish) transliteration of Hebcal's Sephardi/Modern Hebrew names.
private let ashkenazi: [String: String] = [
    "Bereshit": "Bereishis", "Noach": "Noach", "Lech": "Lech", "Lecha": "Lecha", "Lech-Lecha": "Lech Lecha",
    "Vayera": "Vayeira", "Chayei Sara": "Chayei Sarah", "Toldot": "Toldos", "Vayetzei": "Vayeitzei",
    "Vayishlach": "Vayishlach", "Vayeshev": "Vayeishev", "Miketz": "Mikeitz", "Vayigash": "Vayigash",
    "Vayechi": "Vayechi", "Shemot": "Shemos", "Vaera": "Va'eira", "Bo": "Bo", "Beshalach": "Beshalach",
    "Yitro": "Yisro", "Mishpatim": "Mishpatim", "Terumah": "Terumah", "Tetzaveh": "Tetzaveh", "Ki Tisa": "Ki Sisa",
    "Vayakhel": "Vayakhel", "Pekudei": "Pekudei", "Vayikra": "Vayikra", "Tzav": "Tzav", "Shmini": "Shemini",
    "Tazria": "Tazria", "Metzora": "Metzora", "Achrei Mot": "Acharei Mos", "Kedoshim": "Kedoshim", "Emor": "Emor",
    "Behar": "Behar", "Bechukotai": "Bechukosai", "Bamidbar": "Bamidbar", "Nasso": "Nasso",
    "Beha'alotcha": "Beha'aloscha", "Sh'lach": "Shelach", "Korach": "Korach", "Chukat": "Chukas", "Balak": "Balak",
    "Pinchas": "Pinchas", "Matot": "Matos", "Masei": "Masei", "Devarim": "Devarim", "Vaetchanan": "Va'eschanan",
    "Eikev": "Eikev", "Re'eh": "Re'eh", "Shoftim": "Shoftim", "Ki Teitzei": "Ki Seitzei", "Ki Tavo": "Ki Savo",
    "Nitzavim": "Nitzavim", "Vayeilech": "Vayeilech", "Ha'azinu": "Ha'azinu", "Vezot Haberakhah": "Vezos Habrachah",
]

private func hebrewParshaName(_ names: [String]) -> String {
    names.map { hebrewParshaNames[$0] ?? $0 }.joined(separator: "־")
}

public func fixName(_ name: String, _ naming: Naming = .ashkenazi) -> String {
    switch naming {
    case .hebrew: return hebrewParshaName([name])
    case .sephardi: return name.replacingOccurrences(of: "-", with: " ")
    case .ashkenazi:
        return ashkenazi[name] ?? name.split(separator: "-").map { ashkenazi[String($0)] ?? String($0) }.joined(separator: " ")
    }
}

public func titleName(_ names: [String], _ naming: Naming = .ashkenazi) -> String {
    names.map { fixName($0, naming) }.joined(separator: " – ")
}

public func heroName(_ names: [String], _ naming: Naming = .ashkenazi) -> String {
    if naming == .hebrew { return hebrewName(names) }
    return "\(naming == .sephardi ? "Parashat" : "Parshas") \(names.map { fixName($0, naming) }.joined(separator: "–"))"
}

public func hebrewName(_ names: [String]) -> String { "פרשת \(hebrewParshaName(names))" }

private let hebrewOnes = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"]
private let hebrewTens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"]
/// Chapter and verse numbers up to 99, in Hebrew letters.
public func hebrewNumber(_ number: Int) -> String {
    if number == 15 { return "טו" }
    if number == 16 { return "טז" }
    return hebrewTens[(number / 10) % 10] + hebrewOnes[number % 10]
}
