import AppIntents
import AtdInk
import AtdIntents
import AtdModel
import SwiftUI
import WidgetKit

/// The Live Activity on the Lock Screen: the command's sticker, name and day, then where the run
/// stands.
struct BriefingActivityLockView: View {
  let attributes: BriefingActivityAttributes
  let state: BriefingActivityAttributes.ContentState
  let isStale: Bool

  var body: some View {
    // Three results of two rows each fill the 160 points the Lock Screen gives an activity.
    VStack(alignment: .leading, spacing: 8) {
      BriefingActivityHeader(attributes: attributes)
      BriefingActivityBody(attributes: attributes, state: state, isStale: isStale)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
  }
}

/// The sticker, the command's name and the day it ran (11月21日 周六).
struct BriefingActivityHeader: View {
  let attributes: BriefingActivityAttributes

  var body: some View {
    HStack(spacing: 8) {
      BriefingActivitySticker(attributes: attributes, size: 26)
      Text(attributes.name)
        .font(.system(size: 15, weight: .semibold))
        .lineLimit(1)
      Spacer(minLength: 8)
      Text(Self.dayText(attributes.day))
        .font(.system(size: 12))
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
    .accessibilityElement(children: .combine)
  }

  static func dayText(_ day: Date) -> String {
    day.formatted(.dateTime.month(.abbreviated).day().weekday(.abbreviated))
  }
}

/// The command's sticker, which identifies the activity in every place it shows.
struct BriefingActivitySticker: View {
  let attributes: BriefingActivityAttributes
  let size: CGFloat

  var body: some View {
    Sticker(
      symbol: attributes.symbol, tint: attributes.tint, seed: attributes.commandID, size: size)
  }
}

/// Where the run stands: writing, its lines, or what it is waiting for with the one button that
/// helps. A run that stops reporting before its end turns stale and offers to try again.
struct BriefingActivityBody: View {
  let attributes: BriefingActivityAttributes
  let state: BriefingActivityAttributes.ContentState
  let isStale: Bool

  var body: some View {
    switch state.phase {
    case .working where isStale:
      problem(EntryCopy.string("activity.stale"), retry: true)
    case .working:
      HStack(spacing: 8) {
        ProgressView()
          .controlSize(.small)
        Text(EntryCopy.string("activity.working"))
          .foregroundStyle(.secondary)
      }
      .font(.system(size: 14))
    case .done:
      VStack(alignment: .leading, spacing: 2) {
        ForEach(Array(state.lines.enumerated()), id: \.offset) { _, line in
          Text(line)
            .font(.system(size: 13))
            .lineLimit(2)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
    case .needsAccess:
      Button(intent: GrantAgendaAccessIntent()) {
        Label(EntryCopy.string("access.allow"), systemImage: "calendar")
      }
      .buttonStyle(InkButtonStyle())
    case .noModel:
      if let url = AtdRoute.models.url() {
        Link(destination: url) {
          Label(EntryCopy.string("activity.addModel"), systemImage: "plus")
        }
        .buttonStyle(InkButtonStyle())
      }
    case .failed:
      problem(state.message ?? EntryCopy.string("activity.stale"), retry: state.canRetry)
    }
  }

  /// Why the run stopped, with 重试 when trying again can help.
  private func problem(_ message: String, retry: Bool) -> some View {
    HStack(spacing: 10) {
      Text(message)
        .font(.system(size: 14))
        .foregroundStyle(.secondary)
        .lineLimit(2)
        .frame(maxWidth: .infinity, alignment: .leading)
      if retry {
        Button(intent: RunControlIntent(commandID: attributes.commandID)) {
          Label(EntryCopy.string("activity.retry"), systemImage: "arrow.clockwise")
        }
        .buttonStyle(InkButtonStyle())
      }
    }
  }
}

/// The compact Dynamic Island's trailing mark: a spinner while writing, a check once done, and an
/// exclamation mark when the run needs something.
struct BriefingActivityStatus: View {
  let state: BriefingActivityAttributes.ContentState
  let isStale: Bool

  var body: some View {
    switch state.phase {
    case .working where !isStale:
      ProgressView()
        .controlSize(.mini)
        .accessibilityLabel(Text(EntryCopy.string("activity.working")))
    case .done:
      Image(systemName: "checkmark")
        .font(.system(size: 14, weight: .semibold))
        .accessibilityHidden(true)
    default:
      Image(systemName: "exclamationmark")
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(InkColor.alert)
        .accessibilityHidden(true)
    }
  }
}
