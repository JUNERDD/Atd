import SwiftUI

/// The Lock Screen circle: a gauge of the goal around the app's symbol and its number, or the two
/// alone when the value has no goal. Monochrome: the system draws it over the wallpaper.
struct CircularGlance: View {
  let glance: MiniAppGlance

  var body: some View {
    ZStack {
      if let fraction = glance.accessory.fraction {
        Circle()
          .stroke(Color.primary.opacity(0.3), lineWidth: 5)
          .padding(2.5)
        Circle()
          .trim(from: 0, to: min(1, max(0, fraction)))
          .stroke(Color.primary, style: StrokeStyle(lineWidth: 5, lineCap: .round))
          .rotationEffect(.degrees(-90))
          .padding(2.5)
      }
      VStack(spacing: 1) {
        Image(systemName: glance.head.symbol)
          .font(.system(size: glance.accessory.fraction == nil ? 15 : 12, weight: .semibold))
        Text(glance.accessory.value)
          .font(.system(size: glance.accessory.fraction == nil ? 16 : 13, weight: .bold))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.5)
      }
      .padding(.horizontal, 8)
    }
    .glanceLabel(glance.label)
  }
}

/// The Lock Screen rectangle: the app's name, then its value and one more line.
struct RectangularGlance: View {
  let glance: MiniAppGlance

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      HStack(spacing: 4) {
        Image(systemName: glance.head.symbol)
        Text(glance.head.name).lineLimit(1)
      }
      .font(.system(size: 13, weight: .semibold))
      Text(glance.accessory.line)
        .font(.system(size: 16, weight: .bold))
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.7)
      if let detail = glance.accessory.detail {
        Text(detail)
          .font(.system(size: 14, weight: .medium))
          .lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .glanceLabel(glance.label)
  }
}

/// One line beside the clock.
struct InlineGlance: View {
  let glance: MiniAppGlance

  var body: some View {
    Label(glance.accessory.inline, systemImage: glance.head.symbol)
      .accessibilityLabel(glance.label)
  }
}
