import AtdInk
import SwiftUI

/// What stands in a mini app's place while its page opens: the kit's layout in placeholders, a
/// card with the app's figure, a card of rows and the page's main button, at the kit's insets, so
/// the page fades in where its shapes already were.
struct MiniAppPagePlaceholder: View {
  /// Each row's title width, so the rows don't read as a pattern.
  private static let rows: [CGFloat] = [148, 112, 132]

  var body: some View {
    VStack(spacing: 14) {
      VStack(alignment: .leading, spacing: 12) {
        InkPlaceholder(width: 72, seed: 1)
        InkPlaceholder(width: 140, height: 40, seed: 2)
        InkPlaceholder(height: 10, seed: 3)
      }
      .padding(16)
      .inkCard(seed: 4)
      VStack(alignment: .leading, spacing: 16) {
        ForEach(Self.rows.indices, id: \.self) { index in
          HStack(spacing: 12) {
            InkPlaceholder(.round, width: 22, seed: 10 + index)
            InkPlaceholder(width: Self.rows[index], seed: 20 + index)
            Spacer(minLength: 0)
            InkPlaceholder(width: 36, seed: 30 + index)
          }
        }
      }
      .padding(16)
      .inkCard(seed: 6)
      InkPlaceholder(.block, height: 48, seed: 8)
    }
    .padding(.horizontal, 16)
    .padding(.top, 4)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .clipped()
    .inkLoading(MiniAppText.string("page.loading"))
  }
}

/// Why there is no page, in its place: 这个小应用打不开了, or 没能打开这个小应用 with 重试.
struct MiniAppPageNote: View {
  let text: String
  var retry: (() -> Void)?

  var body: some View {
    VStack(spacing: 14) {
      Text(text)
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
      if let retry {
        Button(action: retry) {
          Label(AppText.string("action.retry"), systemImage: "arrow.counterclockwise")
        }
        .buttonStyle(InkButtonStyle())
      }
    }
    .padding(.horizontal, 32)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
