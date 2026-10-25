import AICore
import AppKit
import SwiftUI

enum TaskActivityMetrics {
  static let entrySide = MiniPanelMetrics.capsuleWidth
  static let gap = MiniPanelMetrics.flyoutGap
  static let cardWidth = 352.0
  static let shadow = MiniPanelMetrics.shadowRoom
  static let maximumHeight = 440.0
  static let cardChromeHeight = 52.0
  static let artworkSide = 32.0
  /// The card's inset and its run cards' padding; run cards stay concentric with its corner.
  static let cardPadding = 8.0
  static let rowRadius = MiniPanelMetrics.cardRadius - cardPadding
}

/// The header stays reachable while the activity list yields to the display's work area. With a
/// request open on the card's page, the header leads back to the list and names the task and
/// the request's place among its requests. The list or the page is the card's one scrolling
/// region; it keeps its container across content changes, so a stack spreading out keeps its
/// scroll position, and the page replaces the list with its own.
struct TaskActivityCard: View {
  let model: TaskActivityModel
  /// The card on screen, not a copy laid out to measure it: only it scrolls and moves focus.
  var live = false

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      header
      IslandFadingScroll(reduceMotion: model.reducedMotion) {
        ScrollViewReader { proxy in
          TaskActivityContent(model: model)
            .task(id: model.returning) { await bringBack(with: proxy) }
        }
      }
      .scrollIndicators(.never)
      .scrollBounceBehavior(.basedOnSize)
      .frame(height: model.contentViewport)
      .id(model.page.map { "page/\($0.key.taskID)/\($0.key.runID)" } ?? "list")
      .transition(
        model.page == nil
          ? .opacity : TaskActivityMotion.pageTransition(reduced: model.reducedMotion))
    }
    .padding(TaskActivityMetrics.cardPadding)
    // Pinned to the top: the card's glass may still be resizing around a change of its content.
    .frame(width: model.cardWidth, alignment: .topLeading)
    .frame(maxHeight: .infinity, alignment: .top)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(model.labels.text(.activityTitle))
    .accessibilityIdentifier("activity.card")
  }

  /// Back on the list from a task's page: the list shows that task's card, scrolling only as
  /// far as it needs to, and gives it the keyboard when the page was left with the keyboard.
  private func bringBack(with proxy: ScrollViewProxy) async {
    guard live, model.page == nil, let back = model.returning else { return }
    await Task.yield()
    guard !Task.isCancelled else { return }
    proxy.scrollTo(TaskActivityListEntry.ID.row(back.key))
    model.returning = nil
    if back.focus { model.focusedRow = back.key }
  }

  private var header: some View {
    HStack(spacing: 8) {
      if let page = model.pageContent {
        IslandIconButton(glyph: "chevron-left", label: model.labels.text(.activityBack)) {
          model.back(false)
        }
        .padding(.leading, -6)
        .accessibilityIdentifier("activity.back")
        Text(page.item.conversationTitle).font(.body.weight(.semibold)).lineLimit(1)
        if page.item.requests.count > 1 {
          Text(
            model.labels.format(
              .activityRequestPosition, page.index + 1, page.item.requests.count)
          )
          .font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1).fixedSize()
        }
      } else {
        Text(model.labels.text(.activityTitle)).font(.body.weight(.semibold)).lineLimit(1)
        if !model.items.isEmpty {
          Text(model.overviewSummary).font(.system(size: 11)).foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 0)
      IslandIconButton(glyph: "x", label: model.labels.text(.activityClose), action: model.close)
    }
    .padding(.leading, TaskActivityMetrics.cardPadding)
  }
}

/// The runs, grouped by what they ask of the person (``TaskActivityListEntry``), or the request
/// open on the card's page. A run's phase change springs the layout it moves, such as the card
/// moving to another section.
struct TaskActivityContent: View {
  let model: TaskActivityModel

  var body: some View {
    let page = model.pageContent
    let request = page.map { $0.item.requests[$0.index].id }
    // The task's next request replaces a settled one as a page opening does.
    ZStack(alignment: .topLeading) {
      if let page {
        TaskActivityRequestPage(item: page.item, index: page.index, model: model)
          .id(request)
          .transition(TaskActivityMotion.pageTransition(reduced: model.reducedMotion))
      } else {
        list
      }
    }
    .animation(TaskActivityMotion.page, value: request)
  }

  private var list: some View {
    VStack(alignment: .leading, spacing: 6) {
      if model.items.isEmpty {
        Text(model.labels.text(.activityEmpty))
          .font(.system(size: 13)).foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, minHeight: 64)
      }
      ForEach(model.entries) { entry in
        switch entry {
        case .header(let kind, let count, let first):
          TaskActivitySectionHeader(
            title: model.labels.section(kind), count: count, first: first)
        case .row(let item):
          TaskActivityTask(item: item, model: model)
        }
      }
    }
    .animation(
      TaskActivityMotion.layout(reduced: model.reducedMotion), value: model.items.map(\.phase)
    )
    .animation(TaskActivityMotion.layout(reduced: model.reducedMotion), value: model.layoutKey)
  }
}

/// A section's name and how many runs it holds, aligned with the cards' content; it sits apart
/// from the section above and close to its own cards.
private struct TaskActivitySectionHeader: View {
  let title: String
  let count: Int
  let first: Bool

  var body: some View {
    HStack(spacing: 5) {
      Text(verbatim: title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
      Text(count, format: .number).font(.system(size: 11)).monospacedDigit()
        .foregroundStyle(.tertiary)
    }
    .contentTransition(.identity)
    .lineLimit(1)
    .padding(.leading, TaskActivityMetrics.cardPadding)
    .padding(.top, first ? 0 : 6)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isHeader)
  }
}
