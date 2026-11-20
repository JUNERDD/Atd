import AppIntents

/// An automation as Shortcuts and Siri pick it: its name, with its trigger under it.
public struct AutomationEntity: AppEntity {
  public static let typeDisplayRepresentation = TypeDisplayRepresentation(
    name: LocalizedStringResource("automation.type", table: "AutomationIntents"))
  public static let defaultQuery = AutomationQuery()

  public let id: String
  public let name: String
  public let trigger: String

  public init(_ automation: Automation) {
    id = automation.id
    name = automation.name
    trigger = automation.trigger.title
  }

  /// One Shortcuts still names although it was deleted in Atd, so running it says so instead of
  /// failing to find it.
  init(deletedID id: String) {
    self.id = id
    name = StepText.text("automation.deleted")
    trigger = ""
  }

  public var displayRepresentation: DisplayRepresentation {
    trigger.isEmpty
      ? DisplayRepresentation(title: "\(name)")
      : DisplayRepresentation(title: "\(name)", subtitle: "\(trigger)")
  }
}

/// The automations in Atd's book, read from the App Group.
public struct AutomationQuery: EntityStringQuery {
  public init() {}

  public func entities(for identifiers: [String]) async throws -> [AutomationEntity] {
    let book = Self.book
    return identifiers.map { id in
      book.automation(id).map(AutomationEntity.init) ?? AutomationEntity(deletedID: id)
    }
  }

  public func suggestedEntities() async throws -> [AutomationEntity] {
    Self.book.automations.map(AutomationEntity.init)
  }

  public func entities(matching string: String) async throws -> [AutomationEntity] {
    Self.book.automations
      .filter {
        $0.name.localizedStandardContains(string)
          || $0.trigger.title.localizedStandardContains(string)
      }
      .map(AutomationEntity.init)
  }

  private static var book: AutomationBook {
    AutomationStore.live()?.load(AutomationBook.self).document ?? .initial()
  }
}
