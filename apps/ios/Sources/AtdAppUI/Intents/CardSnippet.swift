import AtdModel
import SwiftUI

/// A result in Siri's and Shortcuts' snippet: the command's symbol and name, then the result line
/// by line, in the system's own look, since the snippet sits on the system's platter.
struct CardSnippet: View {
  let name: String
  let symbol: String
  let lines: [String]

  init(command: Command, lines: [String]) {
    name = command.name
    symbol = command.symbol
    self.lines = lines
  }

  init(name: String, symbol: String, lines: [String]) {
    self.name = name
    self.symbol = symbol
    self.lines = lines
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label(name, systemImage: symbol)
        .font(.headline)
        .accessibilityAddTraits(.isHeader)
      ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
        Text(line)
          .font(.body)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding()
  }
}
