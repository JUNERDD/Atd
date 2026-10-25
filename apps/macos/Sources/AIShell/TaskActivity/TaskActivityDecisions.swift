import AICore
import SwiftUI

/// Where a request's decisions are drawn, which decides what they offer: the row's action bar
/// (with the Return default), a request's own line in a spread stack (no default), or the
/// request's page (every decision, with the Return default).
enum TaskActivityDecisionPlacement {
  case bar
  case line
  case page
}

/// A request's decisions. An approval offers Decline (Deny for a terminal command) and Allow
/// once (Allow access for computer access) as its one prominent action, with the broader grant
/// in a menu on the chevron beside it; on its page the broader grant is a button of its own. An
/// approval that needs reading first offers Details… in place of allowing. A question offers
/// Skip, and Answer… on its own line; a view offers Skip and Open view.
struct TaskActivityDecisions: View {
  let item: TaskActivityItem
  let request: TaskActivityPendingRequest
  let index: Int
  let placement: TaskActivityDecisionPlacement
  let model: TaskActivityModel
  /// The keyboard is on this request: its default decision shows ↩.
  var keyboard = false
  private var labels: TaskActivityLabels { model.labels }
  private var sending: TaskActivitySending? { model.sending[item.key] }

  var body: some View {
    if case .approval(let approval) = request.kind, placement == .page {
      pageFooter(approval).accessibilityElement(children: .contain)
    } else {
      row
    }
  }

  private var row: some View {
    HStack(spacing: 4) {
      switch request.kind {
      case .approval(let approval):
        approvalDecisions(approval)
      case .question:
        if placement == .page { Spacer(minLength: 0) }
        decision(.skip, labels.text(.activitySkip), kind: .plain)
        if placement == .line {
          decision(.details, labels.text(.activityAnswerButton), kind: .prominent)
        }
      case .view:
        if placement == .page { Spacer(minLength: 0) }
        decision(.skip, labels.text(.activitySkip), kind: .plain)
        decision(.openView, labels.text(.activityOpenView), kind: .prominent)
      }
    }
    .accessibilityElement(children: .contain)
  }

  @ViewBuilder
  private func approvalDecisions(_ approval: TaskActivityApproval) -> some View {
    let decline = labels.text(approval.isBash ? .activityDeny : .activityDecline)
    decision(.decline, decline, kind: .plain, tooltip: labels.text(.activityDeclineTooltip))
    if placement != .page && approval.needsDetail {
      decision(.details, labels.text(.activityDetails), kind: .prominent)
    } else if let broader = approval.broader {
      split(approval, broader: broader)
    } else {
      decision(.allow, allowTitle(approval), kind: .prominent)
    }
  }

  /// The page's footer: the decline on the leading edge, the broader grant as a button of its
  /// own, Allow once on the trailing edge. Too wide for one line, Allow once moves to a line of
  /// its own, still trailing, and a long grant is cut before anything else is.
  private func pageFooter(_ approval: TaskActivityApproval) -> some View {
    let allow = decision(.allow, allowTitle(approval), kind: .prominent)
    return ViewThatFits(in: .horizontal) {
      HStack(spacing: 4) {
        pageFirstLine(approval)
        allow
      }
      VStack(alignment: .trailing, spacing: 4) {
        HStack(spacing: 4) { pageFirstLine(approval) }
        allow
      }
    }
  }

  @ViewBuilder
  private func pageFirstLine(_ approval: TaskActivityApproval) -> some View {
    let decline = labels.text(approval.isBash ? .activityDeny : .activityDecline)
    decision(.decline, decline, kind: .plain, tooltip: labels.text(.activityDeclineTooltip))
    Spacer(minLength: 8)
    if let broader = approval.broader {
      let grant = grant(broader, approval)
      decision(broader, grant.title, kind: .bordered, tooltip: grant.hint, fixed: false)
    }
  }

  /// Allow once with its broader grant in the chevron's menu. While the broader grant's answer
  /// is on its way, Allow once shows it, since the menu that took it is gone.
  private func split(_ approval: TaskActivityApproval, broader: TaskActivityControl) -> some View {
    let grant = grant(broader, approval)
    let pending = sending?.requestID == request.id ? sending?.control : nil
    let shown: TaskActivityControl = pending == broader ? broader : .allow
    return HStack(spacing: 0) {
      decision(.allow, allowTitle(approval), kind: .prominent, side: .leading, busyAs: shown)
      TaskActivityMenuButton(
        glyph: "chevron-down", label: labels.text(.activityAllowMore), side: .trailing
      ) {
        [
          TaskActivityMenuEntry(title: grant.title, tooltip: grant.hint) {
            model.perform(broader, on: request, at: index, of: item.key)
          }
        ]
      }
      .overlay(alignment: .leading) {
        Rectangle().fill(Color.primary.opacity(0.14)).frame(width: 1).allowsHitTesting(false)
      }
      .disabled(sending != nil)
      .accessibilityIdentifier(identifier("allowMore"))
    }
    .fixedSize()
  }

  private func decision(
    _ control: TaskActivityControl, _ title: String, kind: TaskActivityButtonKind,
    tooltip: String? = nil, side: TaskActivityCapsuleSide = .whole,
    busyAs: TaskActivityControl? = nil, fixed: Bool = true
  ) -> some View {
    let progress = busyAs ?? control
    let busy =
      sending?.requestID == request.id && sending?.control == progress
      ? labels.busy(progress) : nil
    return TaskActivityDecisionButton(
      title: title, tooltip: tooltip, kind: kind, side: side, busy: busy,
      returnHint: keyboard && sending == nil && isDefault(control)
    ) {
      model.perform(control, on: request, at: index, of: item.key)
    }
    .disabled(sending != nil && busy == nil)
    .fixedSize(horizontal: fixed, vertical: true)
    .accessibilityIdentifier(identifier("\(control)"))
  }

  private func isDefault(_ control: TaskActivityControl) -> Bool {
    switch placement {
    case .bar: request.rowDefault == control
    case .page: request.pageDefault == control
    case .line: false
    }
  }

  private func allowTitle(_ approval: TaskActivityApproval) -> String {
    labels.text(approval.access == nil ? .activityAllowOnce : .activityAllowAccess)
  }

  private func grant(
    _ control: TaskActivityControl, _ approval: TaskActivityApproval
  ) -> (title: String, hint: String) {
    if control == .always, let entry = approval.allowlistEntry {
      return (
        labels.format(.activityAlwaysAllow, entry), labels.format(.activityAlwaysAllowHint, entry)
      )
    }
    return (labels.text(.activityAllowSession), labels.text(.activityAllowSessionHint))
  }

  private func identifier(_ action: String) -> String {
    "activity.decision.\(action).\(item.key.taskID)/\(item.key.runID)/\(request.id)"
  }
}

extension TaskActivityModel {
  /// Takes `control` for a task's request: answers it, opens it on the card's page, or opens
  /// the view it waits in. A typed reply goes through ``reply(_:to:of:)``.
  func perform(
    _ control: TaskActivityControl, on request: TaskActivityPendingRequest, at index: Int,
    of key: TaskActivityRunKey
  ) {
    let answer: TaskActivityDecision.Answer
    switch (control, request.kind) {
    case (.details, _): return openPage(key, index)
    case (.openView, _): return openView(key, request)
    case (.allow, _): answer = .once
    case (.session, _): answer = .session
    case (.always, .approval(let approval)):
      guard let entry = approval.allowlistEntry else { return }
      answer = .always(entry: entry)
    case (.decline, _): answer = .declined
    case (.skip, _): answer = .skipped
    case (.option(let option), .question(let question)):
      guard question.options.indices.contains(option) else { return }
      answer = .text(question.options[option])
    case (.always, _), (.option, _), (.reply, _): return
    }
    self.answer(
      key,
      TaskActivityDecision(
        requestID: request.id, revision: request.revision, control: control, answer: answer))
  }

  /// Sends a question's typed reply.
  func reply(_ text: String, to request: TaskActivityPendingRequest, of key: TaskActivityRunKey) {
    let typed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !typed.isEmpty else { return }
    answer(
      key,
      TaskActivityDecision(
        requestID: request.id, revision: request.revision, control: .reply, answer: .text(typed)))
  }
}
