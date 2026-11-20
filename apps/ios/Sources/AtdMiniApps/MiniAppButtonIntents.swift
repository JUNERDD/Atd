import AppIntents
import Foundation

/// A counter widget's button (`+ 1 杯`): adds to today's value of a daily series, in the widget
/// extension's process, without opening Atd. WidgetKit reloads the widget after `perform()`, and
/// the store's notification tells an open page.
///
/// Hidden from Shortcuts and Spotlight: it only means something on its widget.
public struct MiniAppStepIntent: AppIntent {
  public static let title = LocalizedStringResource("miniAppStep.title", table: "MiniAppIntents")
  public static let isDiscoverable = false
  public static let supportedModes: IntentModes = .background

  @Parameter(title: LocalizedStringResource("miniAppIntent.app", table: "MiniAppIntents"))
  public var appID: String
  @Parameter(title: LocalizedStringResource("miniAppIntent.field", table: "MiniAppIntents"))
  public var field: String
  @Parameter(title: LocalizedStringResource("miniAppStep.amount", table: "MiniAppIntents"))
  public var amount: Double

  public init() {}

  public init(_ step: MiniAppStep) {
    appID = step.appID
    field = step.field
    amount = step.amount
  }

  public func perform() async throws -> some IntentResult {
    try MiniAppButtons.apply(.add(field: field, amount: amount, day: nil), to: appID)
    return .result()
  }
}

/// A checklist widget's row: ticks a record off or back on, in place. A set rather than a
/// toggle, so a tap delivered twice leaves the row as the person saw it.
public struct MiniAppCheckIntent: SetValueIntent {
  public static let title = LocalizedStringResource("miniAppCheck.title", table: "MiniAppIntents")
  public static let isDiscoverable = false
  public static let supportedModes: IntentModes = .background

  @Parameter(title: LocalizedStringResource("miniAppCheck.value", table: "MiniAppIntents"))
  public var value: Bool
  @Parameter(title: LocalizedStringResource("miniAppIntent.app", table: "MiniAppIntents"))
  public var appID: String
  @Parameter(title: LocalizedStringResource("miniAppCheck.list", table: "MiniAppIntents"))
  public var list: String
  @Parameter(title: LocalizedStringResource("miniAppIntent.field", table: "MiniAppIntents"))
  public var field: String
  @Parameter(title: LocalizedStringResource("miniAppCheck.record", table: "MiniAppIntents"))
  public var recordID: String

  public init() {}

  public init(_ toggle: MiniAppToggle, recordID: String, value: Bool) {
    appID = toggle.appID
    list = toggle.list
    field = toggle.field
    self.recordID = recordID
    self.value = value
  }

  public func perform() async throws -> some IntentResult {
    try MiniAppButtons.apply(
      .update(list: list, id: recordID, changes: [field: .bool(value)]), to: appID)
    return .result()
  }
}

/// What both buttons do: one change to the app's stored data, checked against its current
/// version. A button left on a widget after its app was deleted or changed does nothing.
enum MiniAppButtons {
  static func apply(_ operation: MiniAppOperation, to appID: String) throws {
    guard let store = MiniAppStore.current, let app = store.library().app(appID),
      let manifest = store.manifest(app)
    else { return }
    do {
      try store.apply(
        [operation], to: appID, schema: manifest.schema, context: MiniAppChangeContext(now: .now))
    } catch is MiniAppInvalid {
      // The field or record is gone since the widget was drawn; the reload shows what is there.
    }
  }
}
