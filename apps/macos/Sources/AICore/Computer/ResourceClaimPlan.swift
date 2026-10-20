import Foundation

/// Who holds or asks for a set of ``DeviceResource``s.
public enum ClaimOwner: Hashable, Sendable {
  /// A feature the user started in the shell. User claims come first: one never queues behind
  /// another user claim (it is refused, as the busy flags it replaces refused), and a user's
  /// interactive screen is admitted over running background writes, which may not start again
  /// until it is released.
  case user(UserFeature)
  /// One computer operation of a run. Its claims are background claims: they queue behind
  /// conflicting claims in arrival order, and are refused while background admission is closed or
  /// the user holds the interactive screen.
  case computer(ComputerOperation)

  public var isUser: Bool {
    if case .user = self { true } else { false }
  }
}

/// The shell's own native writers, each a ``ClaimOwner/user(_:)``.
public enum UserFeature: String, Sendable {
  /// `text.write` and the answer card's Insert and Replace (TextWriter with ClipboardPaste).
  case textWrite
  /// A summon's simulated ⌘C (CopySelection), including its late restore of the pasteboard.
  case copySelection
  /// A one-shot write of the general pasteboard (clipboard calls, Copy buttons, path copies).
  case clipboardWrite
  /// A screenshot capture or edit session, and its copy of the result.
  case screenshot
  /// An open or save panel.
  case systemPanel
}

/// The identity of one computer operation, which every claim of its actions shares: claims of
/// the same operation are one owner, so they cannot wait on each other.
public struct ComputerOperation: Hashable, Sendable {
  public var runId: String
  public var operationId: String

  public init(runId: String, operationId: String) {
    self.runId = runId
    self.operationId = operationId
  }
}

/// Whether background (computer) claims are admitted at all. Closed while this shell does not
/// hold the computer host lock, while unsettled actions of an earlier host wait for
/// reconciliation, and once the host is stopping. User claims ignore it.
public enum BackgroundAdmission: Equatable, Sendable {
  case open
  case closed(Reason)

  public enum Reason: Equatable, Sendable {
    /// Another shell holds the host lock, or none was taken yet.
    case hostNotHeld
    /// The unsettled marker names actions whose effect is not known yet.
    case unsettled
    /// The host is stopping (quit, stop all) and admits nothing new.
    case stopping
  }
}

/// Why a claim was not granted.
public enum ClaimRefusal: Error, Equatable, Sendable {
  /// Another user feature holds a conflicting resource, or a try-claim would have had to wait.
  case busy(DeviceResource)
  /// The user holds the interactive screen; background writes stay out until it is released.
  case interactiveScreen
  /// The owner already holds a conflicting resource and would wait on itself.
  case reentrant(DeviceResource)
  /// The owner holds a resource ranked after this one (``DeviceResource/acquisitionRank``).
  case outOfOrder(DeviceResource)
  case admissionClosed(BackgroundAdmission.Reason)
  /// The claim's deadline passed while it waited.
  case timeout
  /// The waiting task was cancelled.
  case cancelled
}

/// A claim as the plan sees it, held or waiting.
public struct ClaimEntry: Equatable, Sendable {
  public var owner: ClaimOwner
  public var resources: Set<DeviceResource>

  public init(owner: ClaimOwner, resources: Set<DeviceResource>) {
    self.owner = owner
    self.resources = resources
  }
}

public enum ClaimDecision: Equatable, Sendable {
  case grant
  /// Wait for the first resource, in acquisition order, that something holds or waits for.
  case wait(DeviceResource)
  case refuse(ClaimRefusal)
}

/// The arbiter's rules (D6, plan §6.2), decided from what is held and what waits, so the
/// arbiter only applies the answer. A claim is all of its resources at once or nothing, which
/// together with the acquisition order keeps owners from deadlocking.
public enum ResourceClaimPlan {
  /// The decision for `owner` asking for `resources` while `held` claims are granted and
  /// `queuedAhead` wait before it, in arrival order.
  ///
  /// Refusals come first: closed background admission, a user claim against a user holder,
  /// a background claim against the user's interactive screen, an owner conflicting with
  /// itself, then an owner asking out of order. Otherwise the claim waits on a conflicting
  /// holder, or on a conflicting earlier waiter of at least its own priority (FIFO per resource,
  /// with user waiters ahead of background ones), and is granted when nothing blocks it.
  public static func decide(
    _ resources: Set<DeviceResource>, for owner: ClaimOwner, held: [ClaimEntry],
    queuedAhead: [ClaimEntry], admission: BackgroundAdmission
  ) -> ClaimDecision {
    if !owner.isUser, case .closed(let reason) = admission {
      return .refuse(.admissionClosed(reason))
    }
    let ordered = DeviceResource.acquisitionOrder(resources)
    var blocker: DeviceResource?
    for resource in ordered {
      for entry in held {
        for heldResource in entry.resources where resource.conflicts(with: heldResource) {
          switch interaction(resource, by: owner, held: heldResource, by: entry.owner) {
          case .refuse(let refusal): return .refuse(refusal)
          case .wait: blocker = blocker ?? resource
          case .none: continue
          }
        }
      }
    }
    if let first = ordered.first,
      let ownLast = held.filter({ $0.owner == owner }).flatMap(\.resources).max(),
      first.acquisitionRank < ownLast.acquisitionRank
    {
      return .refuse(.outOfOrder(first))
    }
    if let blocker { return .wait(blocker) }
    for resource in ordered {
      for entry in queuedAhead
      where entry.owner != owner && (entry.owner.isUser || !owner.isUser)
        && entry.resources.contains(where: resource.conflicts(with:))
      {
        return .wait(resource)
      }
    }
    return .grant
  }

  private enum Interaction {
    case none, wait
    case refuse(ClaimRefusal)
  }

  /// What a held resource means for a requested one it conflicts with.
  private static func interaction(
    _ requested: DeviceResource, by owner: ClaimOwner, held: DeviceResource,
    by holder: ClaimOwner
  ) -> Interaction {
    if owner == holder { return .refuse(.reentrant(requested)) }
    switch (owner.isUser, holder.isUser) {
    case (true, true):
      return .refuse(.busy(requested))
    case (true, false):
      // The user takes the screen over background targets; their writes stop at the next claim.
      return requested == .interactiveScreen && !held.isSessionWide ? .none : .wait
    case (false, true):
      return held == .interactiveScreen ? .refuse(.interactiveScreen) : .wait
    case (false, false):
      return .wait
    }
  }
}
