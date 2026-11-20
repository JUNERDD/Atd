import AtdModel
import Foundation

/// The mini apps every library starts with: 记账本 over the shared expense ledger, 喝水 and
/// 露营清单. They are ordinary packages on the same kit and bridge as generated apps, so 改一改
/// works on them for real; they are added in the language Atd first runs in, like the built-in
/// commands, and cannot be deleted.
public enum MiniAppBuiltins {
  public static let ledgerID = "ledger"
  public static let waterID = "water"
  public static let campID = "camp"
  public static let ids: [String] = [ledgerID, waterID, campID]

  /// Each built-in app at its first version, in the tab's order.
  public static func all(now: Date = .now) -> [(app: MiniApp, package: MiniAppPackage)] {
    [ledger(now), water(now), camp(now)]
  }

  /// 喝水 with five of eight cups today: what the widget gallery shows before a widget is added.
  public static func sampleGlance(now: Date = .now) -> MiniAppGlance {
    let (app, package) = water(now)
    let schema = package.manifest.schema
    var data = MiniAppData(schema: schema, stored: [:])
    _ = try? data.apply(
      .put(field: "cups", value: 5, day: nil), schema: schema,
      context: MiniAppChangeContext(now: now))
    return MiniAppGlance.make(app: app, manifest: package.manifest, data: data, now: now)
  }

  private static func ledger(_ now: Date) -> (app: MiniApp, package: MiniAppPackage) {
    let app = MiniApp(
      id: ledgerID, name: text("builtin.ledger.name"), symbol: "wallet.bifold", tint: .orange,
      builtin: true,
      ideas: [text("builtin.ledger.idea.pie"), text("builtin.ledger.idea.budget")],
      createdAt: now)
    let manifest = MiniAppManifest(schema: MiniAppSchema(fields: [], ledger: true), widget: .ledger)
    return (app, MiniAppPackage(manifest: manifest, page: page("MiniAppLedger")))
  }

  private static func water(_ now: Date) -> (app: MiniApp, package: MiniAppPackage) {
    let app = MiniApp(
      id: waterID, name: text("builtin.water.name"), symbol: "drop", tint: .cyan, builtin: true,
      ideas: [text("builtin.water.idea.cups"), text("builtin.water.idea.goal")], createdAt: now)
    let schema = MiniAppSchema(fields: [
      MiniAppField("goal", .number, defaultValue: 8, min: 1, max: 30, step: 1),
      MiniAppField("cups", .daily, min: 0, max: 50, step: 1),
    ])
    let widget = MiniAppWidgetSpec.counter(
      .init(
        series: "cups", goal: .field("goal"), unit: text("builtin.water.unit"), step: 1,
        button: text("builtin.water.button")))
    let manifest = MiniAppManifest(schema: schema, widget: widget)
    return (app, MiniAppPackage(manifest: manifest, page: page("MiniAppWater")))
  }

  private static func camp(_ now: Date) -> (app: MiniApp, package: MiniAppPackage) {
    let app = MiniApp(
      id: campID, name: text("builtin.camp.name"), symbol: "tent", tint: .green, builtin: true,
      ideas: [text("builtin.camp.idea.add"), text("builtin.camp.idea.groups")], createdAt: now)
    let schema = MiniAppSchema(fields: [
      MiniAppField(
        "items", .list, max: 200,
        fields: [
          MiniAppField("label", .text, max: 40),
          MiniAppField("group", .text, max: 12),
          MiniAppField("packed", .bool, defaultValue: false),
        ])
    ])
    let sleep = text("builtin.camp.group.sleep")
    let carry = text("builtin.camp.group.carry")
    let cooking = text("builtin.camp.group.cooking")
    let other = text("builtin.camp.group.other")
    let gear: [(String, String)] = [
      (text("builtin.camp.item.tent"), sleep), (text("builtin.camp.item.mat"), sleep),
      (text("builtin.camp.item.bag"), sleep), (text("builtin.camp.item.lamp"), carry),
      (text("builtin.camp.item.stove"), cooking), (text("builtin.camp.item.table"), cooking),
      (text("builtin.camp.item.flask"), cooking), (text("builtin.camp.item.bug"), carry),
      (text("builtin.camp.item.aid"), carry), (text("builtin.camp.item.power"), carry),
      (text("builtin.camp.item.rain"), carry), (text("builtin.camp.item.trash"), other),
    ]
    let items = MiniAppJSON.array(
      gear.map { label, group in
        ["label": .string(label), "group": .string(group), "packed": false]
      })
    let widget = MiniAppWidgetSpec.checklist(
      .init(
        list: "items", done: "packed", label: "label", kicker: text("builtin.camp.kicker"),
        next: text("builtin.camp.next"), finished: text("builtin.camp.finished")))
    let manifest = MiniAppManifest(schema: schema, initial: ["items": items], widget: widget)
    return (app, MiniAppPackage(manifest: manifest, page: page("MiniAppCamp")))
  }

  private static func text(_ key: String.LocalizationValue) -> String {
    String(localized: key, bundle: .module)
  }

  /// A built-in page, shipped in this module's bundle.
  private static func page(_ name: String) -> String {
    guard let url = Bundle.module.url(forResource: name, withExtension: "html"),
      let page = try? String(contentsOf: url, encoding: .utf8)
    else {
      // The pages ship in this module's bundle; without them the build itself is broken.
      fatalError("\(name).html is missing from the app")
    }
    return page
  }
}
