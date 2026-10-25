import Foundation

/// One accessibility element of a `snapshot`, flattened into an index-addressed list.
///
/// Atd's own driver owns the AX read, so this shape is Atd's contract rather than a third party's
/// output. `index` is the element's
/// position in the snapshot's flat array; `parentIndex` points back into the same array (nil for
/// the root). The host forms an element token as `<snapshotId>.e<index>` and the driver maps it
/// back to a live `AXUIElement` through a store that invalidates on the next snapshot generation.
public struct DriverElement: Codable, Equatable, Sendable {
  /// Position in the snapshot's flat element array; `parentIndex` references the same space.
  public var index: Int
  /// The containing element's `index`, or nil for the snapshot root.
  public var parentIndex: Int?
  /// `AXRole` (for example `AXButton`). Always present; a missing role drops the element.
  public var role: String
  /// `AXSubrole` when the element advertises one (for example `AXCloseButton`).
  public var subrole: String?
  /// `AXIdentifier`: a stable, developer-assigned id when present.
  public var identifier: String?
  /// The human-facing label: `AXTitle`, else `AXDescription`.
  public var label: String?
  /// `AXValue` rendered as text (numbers and booleans are stringified), bounded in length so a
  /// large text field cannot blow up the frame. `valueTruncated` marks a clamped value.
  public var value: String?
  /// Whether `value` was clamped to the length bound.
  public var valueTruncated: Bool
  /// `AXEnabled`; nil when the element does not expose it.
  public var enabled: Bool?
  /// `AXFocused`; nil when the element does not expose it.
  public var focused: Bool?
  /// Frame in global top-left screen points; nil when the element reports no position/size.
  public var frame: DriverRect?
  /// The AX actions the element advertises (for example `AXPress`), unprefixed where the raw
  /// attribute carries the `AX` prefix. The host uses these to decide the route ladder.
  public var actions: [String]
  /// The attributes the element reports as settable (for example `AXValue`, `AXFocused`), so the
  /// host knows whether a background set-value or focus write is even possible before trying.
  public var settableAttributes: [String]

  public init(
    index: Int, parentIndex: Int? = nil, role: String, subrole: String? = nil,
    identifier: String? = nil, label: String? = nil, value: String? = nil,
    valueTruncated: Bool = false, enabled: Bool? = nil, focused: Bool? = nil,
    frame: DriverRect? = nil, actions: [String] = [], settableAttributes: [String] = []
  ) {
    self.index = index
    self.parentIndex = parentIndex
    self.role = role
    self.subrole = subrole
    self.identifier = identifier
    self.label = label
    self.value = value
    self.valueTruncated = valueTruncated
    self.enabled = enabled
    self.focused = focused
    self.frame = frame
    self.actions = actions
    self.settableAttributes = settableAttributes
  }
}
