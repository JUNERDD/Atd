import AIWidgetModel
import WidgetKit

extension AIWidgetModel.WidgetFamily {
  /// The contract's family for a WidgetKit one; nil for families the widget does not declare.
  public init?(_ family: WidgetKit.WidgetFamily) {
    switch family {
    case .systemSmall: self = .systemSmall
    case .systemMedium: self = .systemMedium
    case .systemLarge: self = .systemLarge
    default: return nil
    }
  }
}
