import AICore
import AppKit
import SwiftUI

/// The requests the card decides in place: answering them, opening one on the card's page,
/// spreading a stack out, and what an answer that did not land leaves behind.
extension TaskActivityController {
  func wireRequests() {
    model.answer = { [weak self] key, decision in self?.answer(decision, for: key) }
    model.openView = { [weak self] key, request in
      guard let self,
        model.items.contains(where: { $0.key == key && $0.requests.contains(request) })
      else { return }
      onOpenView(key, request)
    }
    model.openPage = { [weak self] key, index in self?.openPage(key, index: index) }
    model.back = { [weak self] keyboard in self?.showPage(nil, keyboard: keyboard) }
    model.setExpanded = { [weak self] key, expanded in self?.setExpanded(key, expanded) }
  }

  /// An answer leaves for the request at the revision on screen. One answer per task is on its
  /// way at a time; the service's next snapshot settles it.
  private func answer(_ decision: TaskActivityDecision, for key: TaskActivityRunKey) {
    guard model.cardInteractive, model.sending[key] == nil,
      let item = model.items.first(where: { $0.key == key }),
      item.requests.contains(where: {
        $0.id == decision.requestID && $0.revision == decision.revision
      })
    else { return }
    model.sending[key] = TaskActivitySending(
      requestID: decision.requestID, control: decision.control)
    // A notice from an earlier answer goes, and the card fits the row without it.
    if model.notices.removeValue(forKey: key) != nil { layoutChanged() }
    onAnswer(key, decision)
  }

  /// The service did not take an answer. A request settled or replaced elsewhere leaves the
  /// card at once, with a note, and the task's next request takes its place; any other failure
  /// keeps the request pending under an inline error.
  func answerFailed(
    _ key: TaskActivityRunKey, request: TaskActivityRequestRevision, notice: TaskActivityNotice
  ) {
    guard supplied.contains(where: { $0.key == key }) else { return }
    if model.sending[key]?.requestID == request.id { model.sending[key] = nil }
    if notice == .stale { retired.insert(request) }
    model.notices[key] = notice
    show()
  }

  /// Keeps the card's own state to what the items still hold: an answer's progress until its
  /// request leaves or changes, a spread stack while it holds several requests, a notice while
  /// its task waits, and the page while its task still has requests (on the same position,
  /// which the next request takes once one is settled).
  func reconcile(_ items: [TaskActivityItem]) {
    let byKey = Dictionary(items.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })
    for (key, sending) in model.sending
    where byKey[key]?.requests.contains(where: { $0.id == sending.requestID }) != true {
      model.sending[key] = nil
    }
    for key in model.notices.keys where byKey[key]?.decidesInPlace != true {
      model.notices[key] = nil
    }
    let spread = model.expanded.filter { (byKey[$0]?.requests.count ?? 0) > 1 }
    if spread != model.expanded { model.expanded = spread }
    guard let page = model.page else { return }
    let count = byKey[page.key]?.requests.count ?? 0
    if count == 0 {
      // The page's last request was settled: the list takes the keyboard back from the page
      // when it was answered with the keyboard.
      showPage(nil, keyboard: model.pageAnsweredByKeyboard)
    } else if page.index >= count {
      model.page?.index = count - 1
    }
  }

  /// A click on a request opens it on the card's page. The click is the person's reason for the
  /// card to take the keyboard, as a click in a reply field is; it gives it back as it closes.
  private func openPage(_ key: TaskActivityRunKey, index: Int) {
    guard model.cardInteractive,
      model.items.first(where: { $0.key == key })?.requests.indices.contains(index) == true
    else { return }
    model.notices[key] = nil
    model.pageAnsweredByKeyboard = false
    syncKeyboard()
    mini.window?.takeKeyboard()
    showPage(TaskActivityPage(key: key, index: index))
  }

  /// Opens a request's page, or goes back to the list (`page` nil). Back on the list, the task's
  /// card is brought into view and, when the page was left with the keyboard, takes it.
  private func showPage(_ page: TaskActivityPage?, keyboard: Bool = false) {
    guard model.page != page else { return }
    model.returning = page == nil ? model.page.map { .init(key: $0.key, focus: keyboard) } : nil
    withAnimation(TaskActivityMotion.page) { model.page = page }
    layoutChanged()
  }

  /// Spreads a task's stacked requests out, or folds them back. The requests, the card's
  /// scrolling region and its glass move on one spring (``placePopover``).
  private func setExpanded(_ key: TaskActivityRunKey, _ expanded: Bool) {
    guard model.cardInteractive, model.expanded.contains(key) != expanded,
      (model.items.first(where: { $0.key == key })?.requests.count ?? 0) > 1
    else { return }
    model.notices[key] = nil
    withAnimation(TaskActivityMotion.stack(reduced: model.reducedMotion)) {
      if expanded { model.expanded.insert(key) } else { model.expanded.remove(key) }
    }
    layoutChanged()
  }
}
