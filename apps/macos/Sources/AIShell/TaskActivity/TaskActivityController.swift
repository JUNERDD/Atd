import AICore
import AppKit
import SwiftUI

/// Activity shares the Mini Panel's window and pointer lifecycle, with independent callbacks.
@MainActor
final class TaskActivityController {
  var onStop: (TaskActivityRunKey) -> Void = { _ in }
  var onOpen: (TaskActivityRunKey) -> Void = { _ in }
  var onMonitor: (TaskActivityRunKey) -> Void = { _ in }
  var onAnswer: (TaskActivityRunKey, TaskActivityDecision) -> Void = { _, _ in }
  var onOpenView: (TaskActivityRunKey, TaskActivityPendingRequest) -> Void = { _, _ in }
  var isOpen: Bool { model.isOpen }
  /// Open, or still leaving: its content must not change until it has gone.
  var cardShown: Bool { model.popover.visible }

  let mini: MiniPanelController
  let model = TaskActivityModel()
  /// Ended rows the open card showed; the shell drops them from the list once it closes.
  let reads = TaskActivityReads()
  var measuredCardSize = CGSize(width: TaskActivityMetrics.cardWidth, height: 120)
  private var measurement: Measurement?
  /// The items as the shell supplied them; the model shows them without retired requests.
  var supplied: [TaskActivityItem] = []
  /// Requests the service said were settled or replaced elsewhere, at the revision answered.
  /// They leave the card at once and stay out until the service's snapshot drops them.
  var retired: Set<TaskActivityRequestRevision> = []

  private struct Measurement: Equatable {
    let content: TaskActivityLayoutKey
    let width: Double
    let height: Double
    let labels: TaskActivityLabels
  }

  var entryRect: CGRect {
    model.entryVisible ? translatedGlobal(entryLocal) : .zero
  }
  var cardRect: CGRect {
    guard model.popover.visible else { return .zero }
    return translatedGlobal(model.popover.shape.frame)
  }
  private func translatedGlobal(_ rect: CGRect) -> CGRect {
    mini.global(
      rect.offsetBy(
        dx: mini.model.bodyFactors.shift.width, dy: mini.model.bodyFactors.shift.height))
  }
  /// Canonical glass coordinates. Snap compensation is applied only at rendering/hit testing.
  var entryLocal: CGRect {
    let body =
      model.reducedMotion
      ? mini.model.frame(.capsule) : mini.model.body.drawn(mini.model.bodyFactors)
    let side = TaskActivityMetrics.entrySide
    return CGRect(
      x: body.midX - side / 2,
      y: model.below
        ? body.maxY + TaskActivityMetrics.gap
        : body.minY - TaskActivityMetrics.gap - side,
      width: side, height: side
    )
  }

  init(panel: MiniPanelController) {
    self.mini = panel
    let mini = panel
    mini.model.activity = model
    mini.activityEntryContains = { [weak self] point in
      guard let self, model.entryInteractive else { return false }
      let rect = entryRect
      return hypot(point.x - rect.midX, point.y - rect.midY) <= rect.width / 2
    }
    mini.activityLayoutChanged = { [weak self] in self?.layoutChanged() }
    mini.activityPhaseChanged = { [weak self] in self?.phaseChanged() }
    mini.activityEnvironmentChanged = { [weak self] in self?.refreshLabels() }
    mini.activityContains = { [weak self] point, margin in
      guard let self else { return false }
      let entry =
        model.entry.desired && !entryRect.isEmpty
        && entryRect.insetBy(dx: -margin, dy: -margin).contains(point)
      let card =
        model.popover.isOpen && !cardRect.isEmpty
        && cardRect.insetBy(dx: -margin, dy: -margin).contains(point)
      return entry || card
    }
    model.toggle = { [weak self] in self?.activateEntry() }
    model.close = { [weak self] in self?.close() }
    model.stop = { [weak self] id in
      guard let self, model.items.contains(where: { $0.id == id && $0.canStop })
      else { return }
      onStop(id)
    }
    model.open = { [weak self] id in
      guard let self, model.items.contains(where: { $0.id == id }) else { return }
      close()
      onOpen(id)
    }
    model.monitor = { [weak self] id in
      guard let self, model.items.contains(where: { $0.id == id && $0.canShowPreview }) else {
        return
      }
      close()
      onMonitor(id)
    }
    wireRequests()
    model.reducedMotion = mini.model.reduceMotion
    if mini.window != nil { mini.relayout() }
  }

  func update(items: [TaskActivityItem], ongoingWork: IslandGlowPalette?) {
    if mini.model.ongoingWork != ongoingWork { mini.model.ongoingWork = ongoingWork }
    supplied = items
    show()
  }

  /// Shows the supplied items without retired requests, and keeps the card's own state (its
  /// page, spread stacks, answers on their way and notices) to what is still there.
  func show() {
    retired.formIntersection(supplied.flatMap { $0.requests.map(TaskActivityRequestRevision.init) })
    let items = supplied.map { item in
      var shown = item
      shown.requests.removeAll { retired.contains(.init($0)) }
      return shown
    }
    reconcile(items)
    if model.items != items {
      model.items = items
      if model.isOpen { reads.shown(items) }
    }
    // Rows keep one-line labels and a stable action slot, so a lifecycle or detail change
    // within a section cannot change the card's height, restart it, or replace its scroll
    // container. Only a change of what the card lays out remeasures it.
    if measurement?.content != model.contentLayout { layoutChanged() } else { phaseChanged() }
  }

  /// MiniPanel's language and accessibility observers call this without a polling timer.
  func refreshLabels() {
    model.labels = .current()
    model.reducedMotion = mini.model.reduceMotion
    layoutChanged()
  }

  func toggle() {
    if model.isOpen { return close() }
    guard mini.model.phase == .expanded, !model.items.isEmpty, !mini.menuOpen else { return }
    // The card opens on its list; a request's page is opened from there.
    model.page = nil
    measureCard()
    layoutChanged()
    guard model.cardAvailable, model.interactionAllowed else { return }
    model.popover.open()
    reads.shown(model.items)
    syncKeyboard()
  }

  private func activateEntry() {
    guard model.entryInteractive else { return }
    let wasOpen = model.isOpen
    toggle()
    guard wasOpen != model.isOpen else { return }
    NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .now)
  }

  func close() {
    model.popover.close()
    reads.closed()
    syncKeyboard()
  }

  /// The card can take the keyboard only while it is open; the window then becomes key only when
  /// a reply field is clicked or a request's page is opened, and gives the keyboard back as the
  /// card closes.
  func syncKeyboard() {
    mini.window?.keyCapable = model.isOpen
  }

  func measureCard() {
    guard let screen = mini.screen(), let layout = mini.layout else { return }
    let work = screen.visibleFrame
      .insetBy(dx: MiniPanelMetrics.margin, dy: MiniPanelMetrics.margin)
      .intersection(NSRect(layout.canvas))
    let width = min(
      TaskActivityMetrics.cardWidth,
      work.width - TaskActivityMetrics.entrySide - TaskActivityMetrics.gap
    )
    guard width > 0 else { return }
    let next = Measurement(
      content: model.contentLayout, width: width, height: work.height, labels: model.labels)
    guard measurement != next else { return }
    measurement = next
    model.cardWidth = width
    let content = NSHostingView(
      rootView: TaskActivityContent(model: model)
        .frame(width: width - 16).fixedSize(horizontal: false, vertical: true))
    model.contentHeight = content.fittingSize.height
    let viewport = min(
      model.contentHeight,
      max(
        48,
        min(TaskActivityMetrics.maximumHeight, work.height)
          - TaskActivityMetrics.cardChromeHeight))
    // The open card's scrolling region follows its glass on the glass's spring
    // (``placePopover``), so neither cuts the content before the other.
    let resize = model.popover.isOpen && !model.reducedMotion ? TaskActivityMotion.resize : nil
    if model.contentViewport != viewport {
      withAnimation(resize) { model.contentViewport = viewport }
    }
    measuredCardSize =
      NSHostingView(rootView: TaskActivityCard(model: model).fixedSize()).fittingSize
    if model.cardSize != measuredCardSize { model.cardSize = measuredCardSize }
  }

  func hide() {
    model.interactionAllowed = false
    model.entry.setShown(false, reducedMotion: model.reducedMotion, immediate: true)
    model.popover.hide()
    reads.closed()
    syncKeyboard()
  }

  func phaseChanged() {
    let phase = mini.model.phase
    if phase == .hidden { return hide() }
    let eligible =
      (phase == .expanded || phase == .dragging)
      && !model.items.isEmpty && !mini.menuOpen && mini.dragWatch.session == nil
    model.interactionAllowed = eligible && phase == .expanded
    if !eligible || phase == .dragging || !model.cardAvailable {
      let into =
        phase == .expanded || phase == .dragging
        ? nil : MiniPanelController.shape(for: phase).flatMap(mini.restRect(of:))
      model.popover.close(into: into)
      reads.closed()
      syncKeyboard()
    }
    model.entry.setShown(eligible && model.entryAvailable, reducedMotion: model.reducedMotion)
  }
}
