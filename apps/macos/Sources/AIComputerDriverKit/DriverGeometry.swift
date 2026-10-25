import Foundation

/// The frozen wire protocol version. The shell sends it in `hello`; the driver echoes the
/// version it speaks. A client that sees a different major refuses to drive the process rather
/// than guessing at an incompatible frame layout. Version 2 reports `prepare` outcomes
/// (``DriverPrepareResult``) instead of two flags.
public let driverProtocolVersion = 2

/// A point in global, top-left-origin screen points (y grows downward), the same convention the
/// host already uses for `NativeCapture` geometry. Declared here, rather than reusing `CGPoint`,
/// so the kit stays Foundation-only and the JSON shape is explicit and stable across the wire.
public struct DriverPoint: Codable, Equatable, Sendable {
  public var x: Double
  public var y: Double

  public init(x: Double, y: Double) {
    self.x = x
    self.y = y
  }
}

/// A rectangle in global, top-left-origin screen points. Used for element frames and window
/// bounds. Width and height are never negative; a zero-area frame means "position only".
public struct DriverRect: Codable, Equatable, Sendable {
  public var x: Double
  public var y: Double
  public var width: Double
  public var height: Double

  public init(x: Double, y: Double, width: Double, height: Double) {
    self.x = x
    self.y = y
    self.width = width
    self.height = height
  }
}
