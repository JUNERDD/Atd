/// The command island's activity indicator: the macOS small indeterminate spinner's shape and
/// rhythm, drawn in the label colour at full strength rather than the system's faint ink. Read
/// from the system control's own artwork (`NSProgressIndicator`, spinning, small): 8 spokes in a
/// 16 pt square, each about 2 pt wide from 3.5 pt out to the edge; a brightness wave that steps
/// clockwise one spoke every ``spokeDelay``, a full turn every ``period``, in ``steps`` discrete
/// frames. A spoke brightens to its peak over the first ``rampSteps`` frames and fades linearly to
/// ``trailingAlpha`` of it over the rest. The system draws that peak at about a third of the
/// label colour whether or not its window is key, which reads faint on glass; here the peak is
/// the label colour itself.
public enum IslandSpinnerStyle {
  public static let side = 16.0
  public static let spokes = 8
  public static let spokeWidth = 2.0
  public static let innerRadius = 3.5
  /// From the inner radius to the square's edge.
  public static var spokeLength: Double { side / 2 - innerRadius }
  /// One turn of the wave.
  public static let period = 0.8
  /// Under Reduce Motion the wave turns at half the pace.
  public static let reducedPeriod = 1.6
  /// Frames per turn, as the system's artwork steps.
  public static let steps = 24
  public static let rampSteps = 3
  /// The faintest spoke, as a share of the peak.
  public static let trailingAlpha = 0.13

  /// The time between one spoke's peak and the next one's, clockwise.
  public static func spokeDelay(period: Double) -> Double { period / Double(spokes) }

  /// A spoke's opacity at each of the ``steps`` frames of a turn, from the frame its ramp
  /// starts: up to 1 over ``rampSteps`` frames, then down to ``trailingAlpha`` by the turn's end.
  public static func opacities() -> [Double] {
    (0..<steps).map { step in
      if step <= rampSteps {
        return trailingAlpha + (1 - trailingAlpha) * Double(step) / Double(rampSteps)
      }
      let fade = Double(step - rampSteps) / Double(steps - rampSteps)
      return 1 - (1 - trailingAlpha) * fade
    }
  }
}
