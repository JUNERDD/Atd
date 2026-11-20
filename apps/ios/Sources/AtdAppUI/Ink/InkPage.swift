import AtdInk
import SwiftUI

/// The app's copy, from this module's String Catalog.
enum AppText {
  static func string(_ key: String.LocalizationValue) -> String {
    String(localized: key, bundle: .module)
  }
}

/// A labeled action, such as a tab's 新建.
struct InkAction {
  let label: String
  let action: () -> Void
}

/// A tab's page on the paper: a large title with the tab's 新建 under it and the tab's
/// illustration beside them, then the page's content.
struct InkPage<Content: View>: View {
  let title: String
  let art: InkArt.Name
  var add: InkAction?
  @ViewBuilder let content: Content
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        HStack(alignment: .bottom, spacing: 4) {
          VStack(alignment: .leading, spacing: 10) {
            Text(title)
              .font(.largeTitle.bold())
              .accessibilityAddTraits(.isHeader)
            if let add {
              Button(action: add.action) {
                Label(add.label, systemImage: "plus")
              }
              .buttonStyle(InkButtonStyle())
            }
          }
          Spacer(minLength: 0)
          // At the largest text sizes the title needs the width.
          if !typeSize.isAccessibilitySize {
            Doodle(art).padding(.top, -6)
          }
        }
        .frame(minHeight: 96, alignment: .bottom)
        .padding(.leading, 20)
        .padding(.trailing, 12)
        .padding(.bottom, 12)
        content
      }
      .padding(.top, 14)
      .padding(.bottom, 24)
    }
    .background(InkColor.paper)
    .overlay(alignment: .top) { StatusBarFade() }
  }
}

/// Paper behind the status bar, fading into the page, so text scrolling up never runs under it.
private struct StatusBarFade: View {
  var body: some View {
    VStack(spacing: 0) {
      InkColor.paper.frame(height: 0).ignoresSafeArea(edges: .top)
      LinearGradient(
        colors: [InkColor.paper, InkColor.paper.opacity(0)], startPoint: .top, endPoint: .bottom
      )
      .frame(height: 14)
    }
    .allowsHitTesting(false)
  }
}

/// The head of a sheet on the paper: a button on either side and the title between them.
struct SheetHeader<Leading: View, Trailing: View>: View {
  let title: String
  /// Hidden when the content's first row already names what the sheet shows; it stays for
  /// VoiceOver.
  var showsTitle = true
  @ViewBuilder let leading: Leading
  @ViewBuilder let trailing: Trailing

  var body: some View {
    SheetHeaderLayout(gap: 12) {
      HStack(spacing: 0) { leading }
      Text(title)
        .font(.headline)
        .lineLimit(1)
        .opacity(showsTitle ? 1 : 0)
        .accessibilityAddTraits(.isHeader)
      HStack(spacing: 0) { trailing }
    }
    .padding(.horizontal, 10)
    .padding(.top, 10)
  }
}

/// Lays out a sheet header's three parts (leading side, title, trailing side) the way a
/// navigation bar does: the sides at the edges and the title centered on the sheet, `gap` clear
/// of the wider side. A side that grows with Dynamic Type, such as a 保存 text button, narrows
/// the title instead of covering it, and a side that comes and goes never moves the title while
/// the other side is the wider.
private struct SheetHeaderLayout: Layout {
  let gap: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.replacingUnspecifiedDimensions().width
    let sides = [subviews[0], subviews[2]].map { $0.sizeThatFits(.unspecified) }
    let title = subviews[1].sizeThatFits(titleProposal(width: width, sides: sides))
    return CGSize(width: width, height: max(title.height, sides[0].height, sides[1].height))
  }

  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    let sides = [subviews[0], subviews[2]].map { $0.sizeThatFits(.unspecified) }
    subviews[0].place(
      at: CGPoint(x: bounds.minX, y: bounds.midY), anchor: .leading, proposal: .unspecified)
    subviews[2].place(
      at: CGPoint(x: bounds.maxX, y: bounds.midY), anchor: .trailing, proposal: .unspecified)
    subviews[1].place(
      at: CGPoint(x: bounds.midX, y: bounds.midY), anchor: .center,
      proposal: titleProposal(width: bounds.width, sides: sides))
  }

  /// The title's width: the whole width less the wider side and its gap on each side, so the
  /// centered title stays clear of both.
  private func titleProposal(width: CGFloat, sides: [CGSize]) -> ProposedViewSize {
    let inset = (sides.map(\.width).max() ?? 0) + gap
    return ProposedViewSize(width: max(width - 2 * inset, 0), height: nil)
  }
}

/// The ✕ that closes a sheet.
struct CloseButton: View {
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: "xmark").font(.system(size: 16, weight: .semibold))
    }
    .buttonStyle(InkButtonStyle(form: .round))
    .accessibilityLabel(AppText.string("action.close"))
  }
}

/// Plain rows on the paper with a hairline between them, starting at the text edge.
struct InkList<Content: View>: View {
  /// Where the hairline starts.
  var inset: CGFloat = 20
  @ViewBuilder let content: Content

  var body: some View {
    VStack(spacing: 0) {
      Group(subviews: content) { rows in
        ForEach(rows.indices, id: \.self) { index in
          if index > 0 {
            Divider().padding(.leading, inset)
          }
          rows[index]
        }
      }
    }
  }
}

/// A section's title above its rows.
struct SectionHeader: View {
  let title: String

  init(_ title: String) {
    self.title = title
  }

  var body: some View {
    Text(title)
      .font(.subheadline.weight(.semibold))
      .foregroundStyle(.secondary)
      .padding(.horizontal, 20)
      .padding(.top, 26)
      .padding(.bottom, 2)
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityAddTraits(.isHeader)
  }
}

/// One line under a section, only for a consequence the rows do not show.
struct SectionFooter: View {
  let text: String
  var leading: CGFloat = 20

  init(_ text: String, leading: CGFloat = 20) {
    self.text = text
    self.leading = leading
  }

  var body: some View {
    Text(text)
      .font(.footnote)
      .foregroundStyle(.secondary)
      .padding(.leading, leading)
      .padding(.trailing, 20)
      .padding(.top, 6)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// A settings row: an inked symbol, the title, its value and a chevron when it leads somewhere.
struct SettingsRow: View {
  let symbol: String
  let title: String
  var value: String?
  var valueColor: Color = .secondary
  var chevron = true

  var body: some View {
    HStack(spacing: 14) {
      Glyph(symbol: symbol)
      Text(title)
        .foregroundStyle(.primary)
        .frame(maxWidth: .infinity, alignment: .leading)
      if let value {
        Text(value)
          .foregroundStyle(valueColor)
          .lineLimit(1)
      }
      if chevron {
        Image(systemName: "chevron.right")
          .font(.footnote.weight(.semibold))
          .foregroundStyle(.tertiary)
          .accessibilityHidden(true)
      }
    }
    .padding(.horizontal, 20)
    .padding(.vertical, 8)
    .frame(minHeight: 52)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }
}
