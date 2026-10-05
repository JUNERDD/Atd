import SwiftUI

/// A widget state that is a message rather than content (no app widget chosen, no apps yet, an
/// unreadable file): a symbol at the top and the text at the bottom, the arrangement every Atd
/// widget shares. It takes copy already localized from the extension's String Catalog.
public struct WidgetMessageView: View {
  private let symbol: String
  private let title: String?
  private let message: String

  public init(symbol: String, title: String?, message: String) {
    self.symbol = symbol
    self.title = title
    self.message = message
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Image(systemName: symbol).font(.title2).foregroundStyle(.secondary)
      Spacer(minLength: 0)
      if let title {
        Text(verbatim: title).font(.headline)
      }
      Text(verbatim: message).font(.footnote)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}
