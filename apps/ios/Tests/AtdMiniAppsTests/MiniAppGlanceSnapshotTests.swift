import AtdInk
import AtdModel
import SwiftUI
import Testing

@testable import AtdMiniApps

/// Every widget template in every size, light and dark, as PNG attachments of the test results:
/// the widget extension draws these same views.
@MainActor @Suite struct MiniAppGlanceSnapshotTests {
  private let now = Fixture.day(21, hour: 18)

  /// One app per template, with a few days of data.
  private func glances() throws -> [(name: String, glance: MiniAppGlance)] {
    var glances: [(String, MiniAppGlance)] = []
    let context = Fixture.context()
    for (app, package) in MiniAppBuiltins.all(now: now) {
      let schema = package.manifest.schema
      var data = try MiniAppData.initial(schema: schema, initial: package.manifest.initial)
      if app.id == MiniAppBuiltins.waterID {
        try data.apply(
          (15...21).map {
            MiniAppOperation.put(field: "cups", value: Double($0 % 9), day: "2026-11-\($0)")
          },
          schema: schema, context: context)
      }
      for record in data.records("items").prefix(4) {
        try data.apply(
          .update(list: "items", id: record.recordID ?? "", changes: ["packed": true]),
          schema: schema, context: context)
      }
      glances.append(
        (
          app.id,
          MiniAppGlance.make(
            app: app, manifest: package.manifest, data: data, ledger: ledger, now: now,
            calendar: Fixture.shanghai)
        ))
    }
    let reading = try MiniAppDraft(answer: MiniAppAnswer(Answers.reading)) { _ in true }
    var data = MiniAppData(schema: Fixture.reading, stored: [:])
    try data.apply(
      (16...21).map {
        MiniAppOperation.put(field: "pages", value: Double($0 * 3), day: "2026-11-\($0)")
      }
        + [
          .insert(list: "books", record: ["name": "Dune", "done": true]),
          .insert(list: "books", record: ["name": "Emma"]),
        ], schema: Fixture.reading, context: context)
    let specs: [(String, MiniAppWidgetSpec)] = [
      ("streak", reading.package.manifest.widget),
      (
        "stat",
        .stat(
          .init(value: .series("pages", .week), unit: "pages", kicker: "This week", bars: "pages"))
      ),
    ]
    for (name, widget) in specs {
      try widget.validate(against: Fixture.reading)
      let manifest = MiniAppManifest(schema: Fixture.reading, widget: widget)
      glances.append(
        (
          name,
          MiniAppGlance.make(
            app: reading.app, manifest: manifest, data: data, now: now,
            calendar: Fixture.shanghai)
        ))
    }
    glances.append(("list", try runs(app: reading.app)))
    return glances
  }

  /// The list template: the latest runs, each with its distance.
  private func runs(app: MiniApp) throws -> MiniAppGlance {
    var app = app
    app.name = "Runs"
    app.symbol = "figure.run"
    let schema = MiniAppSchema(fields: [
      MiniAppField(
        "runs", .list, max: 50,
        fields: [
          MiniAppField("route", .text, max: 40), MiniAppField("km", .number, min: 0, max: 100),
        ])
    ])
    let widget = MiniAppWidgetSpec.list(
      .init(list: "runs", title: "route", trailing: "km", kicker: "Latest"))
    try widget.validate(against: schema)
    var data = MiniAppData(schema: schema, stored: [:])
    let runs: [(String, Double)] = [
      ("River loop", 5.2), ("Hill repeats", 7), ("The long way round the lake and back", 21.1),
      ("Park", 3.5),
    ]
    try data.apply(
      runs.map { .insert(list: "runs", record: ["route": .string($0), "km": .number($1)]) },
      schema: schema, context: Fixture.context())
    return MiniAppGlance.make(
      app: app, manifest: MiniAppManifest(schema: schema, widget: widget), data: data, now: now,
      calendar: Fixture.shanghai)
  }

  private var ledger: Ledger {
    Ledger(
      expenses: [(46.5, ExpenseCategory.dining, 21), (32, .transport, 21), (128, .shopping, 19)]
        .map { amount, category, day in
          Expense(
            amount: Decimal(amount), currency: "CNY", category: category, book: "日常",
            date: Fixture.day(day), createdAt: Fixture.day(day), source: .manual)
        })
  }

  @Test(arguments: MiniAppGlanceFamily.allCases)
  func everyTemplateDraws(_ family: MiniAppGlanceFamily) throws {
    let home = family == .small || family == .medium
    for (name, glance) in try glances() {
      var surfaces: [(String, Snapshot.Surface)] = [("light", .light), ("dark", .dark)]
      // A tinted or clear Home Screen draws the widget without its colors.
      if home { surfaces.append(("tinted", .tinted)) }
      for (surface, look) in surfaces {
        let renderer = ImageRenderer(content: Snapshot(glance: glance, family: family, look: look))
        renderer.scale = 3
        let png = try #require(renderer.uiImage?.pngData(), "\(name) \(family) did not render")
        Attachment.record(png, named: "glance-\(name)-\(family)-\(surface).png")
      }
    }
  }
}

/// A glance at its family's size on its surface: paper on the Home Screen, the monochrome style
/// on a tinted Home Screen and on the Lock Screen.
private struct Snapshot: View {
  enum Surface { case light, dark, tinted }

  let glance: MiniAppGlance
  let family: MiniAppGlanceFamily
  let look: Surface

  var body: some View {
    switch family {
    case .small, .medium:
      let view = MiniAppGlanceView(glance: glance, family: family)
        .padding(16)
        .frame(width: family == .medium ? 338 : 158, height: 158)
      switch look {
      case .light, .dark:
        view.background(InkColor.paper).environment(\.colorScheme, look == .dark ? .dark : .light)
      case .tinted:
        monochrome(view, on: Color(white: 0.2))
      }
    case .circular, .rectangular, .inline:
      monochrome(
        MiniAppGlanceView(glance: glance, family: family)
          .frame(width: size.width, height: size.height)
          .padding(8),
        on: .black)
    }
  }

  private func monochrome(_ view: some View, on background: Color) -> some View {
    view
      .environment(\.miniAppGlanceStyle, .monochrome)
      .foregroundStyle(.white)
      .background(background)
      .environment(\.colorScheme, .dark)
  }

  private var size: CGSize {
    switch family {
    case .circular: CGSize(width: 72, height: 72)
    case .rectangular: CGSize(width: 160, height: 72)
    default: CGSize(width: 234, height: 20)
    }
  }
}
