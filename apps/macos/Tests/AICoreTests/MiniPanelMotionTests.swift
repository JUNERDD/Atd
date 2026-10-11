import CoreGraphics
import Testing

@testable import AICore

@Suite("Mini panel motion")
struct MiniPanelMotionTests {
  typealias Choreography = MiniPanelChoreography

  /// Equal to `expected` to the millisecond, for values scaled by ``MiniPanelChoreography/paceScale``.
  private func near(_ value: Double, _ expected: Double) -> Bool { abs(value - expected) < 0.001 }

  @Test("The pill swells at once in the hot zone, and relaxes without overshoot")
  func swell() {
    let swell = Choreography.shape(.swell)
    #expect(swell.thickness == MiniPanelSpring(0.22, 0.3))
    #expect(swell.length == MiniPanelSpring(0.22, 0.3))
    #expect(swell.thicknessDelay == 0 && swell.lengthDelay == 0)
    let relax = Choreography.shape(.relax)
    #expect(relax.thickness == MiniPanelSpring(0.2, 0) && relax.length == MiniPanelSpring(0.2, 0))
    #expect(relax.thicknessDelay == 0 && relax.lengthDelay == 0)
  }

  @Test("Opening runs each axis on its own island spring at once, the content 20 ms behind")
  func expand() {
    let shape = Choreography.shape(.expand)
    #expect(shape.thickness == MiniPanelSpring(0.34, 0.36))
    #expect(shape.length == MiniPanelSpring(0.42, 0.32))
    #expect(shape.thicknessDelay == 0 && shape.lengthDelay == 0)
    let content = Choreography.content(.expand)
    #expect(content.delay == 0.02)
    #expect(content.hiddenBlur == 6)
    #expect(Choreography.contentOpacity == MiniPanelSpring(0.20, 0))
    #expect(Choreography.followLimit == 1.06)
  }

  @Test("Closing lets the content leave first, then the length at 20 ms, the thickness 30 ms on")
  func collapse() {
    #expect(Choreography.content(.collapse).exit == 0.08)
    let shape = Choreography.shape(.collapse)
    #expect(shape.length == MiniPanelSpring(0.36, 0.26))
    #expect(shape.lengthDelay == 0.02)
    #expect(shape.thickness == MiniPanelSpring(0.30, 0.24))
    #expect(near(shape.thicknessDelay - shape.lengthDelay, 0.03))
  }

  @Test("The invite and the drop card keep motion-v2's bounce at 0.75 of its durations")
  func dragShapes() {
    let pace = Choreography.paceScale
    #expect(pace == 0.75)
    let invite = Choreography.shape(.invite)
    #expect(near(invite.thickness.duration, 0.36 * pace) && invite.thickness.bounce == 0.22)
    #expect(near(invite.length.duration, 0.48 * pace) && invite.length.bounce == 0.32)
    let grow = Choreography.shape(.target)
    #expect(near(grow.thickness.duration, 0.40 * pace) && grow.thickness.bounce == 0.28)
    #expect(near(grow.length.duration, 0.50 * pace) && grow.length.bounce == 0.35)
    let shrink = Choreography.shape(.untarget)
    #expect(near(shrink.thickness.duration, 0.40 * pace) && shrink.thickness.bounce == 0.20)
    #expect(near(shrink.length.duration, 0.40 * pace) && shrink.length.bounce == 0.20)
    // The card's content leaves before it shrinks.
    #expect(shrink.lengthDelay > 0 && shrink.thicknessDelay > 0)
    #expect(near(Choreography.content(.invite).delay, 0.06 * pace))
    #expect(near(Choreography.content(.target).delay, 0.08 * pace))
    for moment in [MiniPanelMoment.invite, .target, .untarget] {
      #expect(near(Choreography.content(moment).exit, 0.10 * pace))
    }
  }

  @Test("The commands card keeps motion-v2's bounce at 0.75 of its durations")
  func card() {
    let pace = Choreography.paceScale
    #expect(near(Choreography.flyoutOpen.duration, 0.42 * pace))
    #expect(Choreography.flyoutOpen.bounce == 0.25)
    #expect(near(Choreography.flyoutClose.duration, 0.30 * pace))
    #expect(Choreography.flyoutClose.bounce == 0.10)
    #expect(near(Choreography.rows.delay, 0.05 * pace))
    #expect(near(Choreography.rows.exit, 0.10 * pace))
    #expect(Choreography.flyoutCloseDelay > 0)
  }

  @Test("Touch, the snap and the drop keep motion-v2's values; the label hover-label-v2's")
  func fixedMoments() {
    #expect(Choreography.bodyPressScale == 0.96)
    #expect(Choreography.bodyPress == .easeOut(0.08))
    #expect(Choreography.bodyRelease == MiniPanelSpring(0.35, 0.45))
    #expect(Choreography.controlPressScale == 0.86)
    #expect(Choreography.controlPress == .easeOut(0.08))
    #expect(Choreography.controlRelease == MiniPanelSpring(0.30, 0.40))
    #expect(Choreography.liftScale == 1.04)
    #expect(Choreography.lift == MiniPanelSpring(0.30, 0.30))
    #expect(Choreography.snap == MiniPanelSpring(0.55, 0.30))
    #expect(Choreography.absorbLength == 0.92 && Choreography.absorbThickness == 1.06)
    #expect(Choreography.absorbSquash == .easeOut(0.10))
    #expect(Choreography.absorbRelease == MiniPanelSpring(0.35, 0.50))
    #expect(Choreography.absorbHold == 0.25)
    #expect(Choreography.labelAppear == MiniPanelSpring(0.30, 0.25))
    #expect(Choreography.labelText.delay == 0.04 && Choreography.labelText.exit == 0.1)
    #expect(Choreography.labelText.hiddenBlur == 3)
    #expect(Choreography.labelGlide == MiniPanelSpring(0.35, 0.30))
    // The shape draws back once the text has faded, without overshoot.
    #expect(Choreography.labelRetractDelay == Choreography.labelText.exit)
    #expect(Choreography.labelRetract == MiniPanelSpring(0.28, 0))
  }

  @Test("Reduce Motion keeps every timing, without bounce")
  func reduceMotion() {
    for moment in MiniPanelMoment.allCases {
      let full = Choreography.shape(moment)
      let reduced = Choreography.shape(moment, reduceMotion: true)
      #expect(reduced.thickness.bounce == 0 && reduced.length.bounce == 0)
      #expect(reduced.thickness.duration == full.thickness.duration)
      #expect(reduced.length.duration == full.length.duration)
      #expect(reduced.thicknessDelay == full.thicknessDelay)
      #expect(reduced.lengthDelay == full.lengthDelay)
    }
    #expect(Choreography.snap.reduced(true) == MiniPanelSpring(0.55, 0))
    #expect(MiniPanelCurve.easeIn(0.12).reduced(true) == .easeIn(0.12))
    #expect(MiniPanelCurve.spring(.init(0.3, 0.4)).reduced(true).duration == 0.3)
  }

  @Test("The stretch grows with speed and is full from 3000 pt/s")
  func stretchIntensity() {
    #expect(MiniPanelStretch.intensity(speed: 0) == 0)
    #expect(MiniPanelStretch.intensity(speed: 1500) == 0.5)
    #expect(MiniPanelStretch.intensity(speed: 3000) == 1)
    #expect(MiniPanelStretch.intensity(speed: 9000) == 1)
    #expect(MiniPanelStretch.intensity(speed: .nan) == 0)
  }

  @Test("The shape stretches 8 % along the motion and narrows half that across it")
  func stretchFactors() {
    let still = MiniPanelStretch.factors(velocity: .zero)
    #expect(still.x == 1 && still.y == 1)
    let sideways = MiniPanelStretch.factors(velocity: CGVector(dx: -3000, dy: 0))
    #expect(abs(sideways.x - 1.08) < 1e-9 && abs(sideways.y - 0.96) < 1e-9)
    let falling = MiniPanelStretch.factors(velocity: CGVector(dx: 0, dy: 6000))
    #expect(abs(falling.x - 0.96) < 1e-9 && abs(falling.y - 1.08) < 1e-9)
    let half = MiniPanelStretch.factors(velocity: CGVector(dx: 1500, dy: 0))
    #expect(abs(half.x - 1.04) < 1e-9 && abs(half.y - 0.98) < 1e-9)
    let diagonal = MiniPanelStretch.factors(velocity: CGVector(dx: 3000, dy: 3000))
    #expect(abs(diagonal.x - diagonal.y) < 1e-9)
    #expect(abs(diagonal.x - 1.02) < 1e-9)
    #expect(MiniPanelStretch.horizontalShare(.zero) == nil)
  }

  @Test("The mini panel's thickness runs across the screen; the island's is its height")
  func shapeAxis() {
    // Horizontal is the mini panel's split, as it was: x, width and corner on the thickness.
    let across = MiniPanelShapeAxis.horizontal.progress(across: 0.25, along: 0.75)
    #expect(across == .init(x: 0.25, y: 0.75, width: 0.25, height: 0.75, corner: 0.25))
    let tall = MiniPanelShapeAxis.vertical.progress(across: 0.25, along: 0.75)
    #expect(tall == .init(x: 0.75, y: 0.25, width: 0.75, height: 0.25, corner: 0.25))
    let change = MiniPanelShapeAxis.Components(x: -10, y: 4, width: 30, height: -12, corner: 25)
    let horizontal = MiniPanelShapeAxis.horizontal.extent(of: change)
    #expect(horizontal.across == 25 && horizontal.along == 8)
    let vertical = MiniPanelShapeAxis.vertical.extent(of: change)
    #expect(vertical.across == 25 && vertical.along == 20)
  }

  @Test("The island morphs like the capsule growing and the drop card shrinking, with no pill")
  func island() {
    let capsule = WindowSize(width: 200, height: 44)
    let card = WindowSize(width: 320, height: 200)
    #expect(IslandChoreography.shape(from: capsule, to: card) == Choreography.shape(.expand))
    #expect(IslandChoreography.shape(from: card, to: capsule) == Choreography.shape(.untarget))
    let reduced = IslandChoreography.shape(from: capsule, to: card, reduceMotion: true)
    #expect(reduced.thickness.bounce == 0 && reduced.length.bounce == 0)
    // Content that replaces other content arrives once that has left; the first arrives with
    // the entrance itself, never into an empty shape.
    #expect(IslandChoreography.replacing.delay == Choreography.content(.expand).exit)
    #expect(IslandChoreography.entering.delay == 0)
    #expect(IslandChoreography.entering.hiddenBlur == Choreography.content(.expand).hiddenBlur)
    // Leaving, the island shrinks and fades as one piece, quicker than it entered.
    #expect(IslandChoreography.exitDuration == 0.18)
    #expect(IslandMetrics.corner(capsule, card: false) == 22)
    // Capsules keep the progress HUD's toolbar row: 28 pt controls in 4 pt, 2 pt apart.
    #expect(IslandMetrics.capsuleHeight == 36 && IslandMetrics.controlSide == 28)
    #expect(IslandMetrics.padding == 4 && IslandMetrics.gap == 2 && IslandMetrics.gripWidth == 16)
    #expect(IslandMetrics.corner(card, card: true) == 18 && IslandMetrics.rowHeight == 28)
    // The canvas holds the largest shape at its overshoot.
    let canvas = IslandMetrics.canvas
    #expect(canvas.width >= IslandMetrics.maxShape.width * Choreography.followLimit)
    #expect(canvas.height >= IslandMetrics.maxShape.height * Choreography.followLimit)
  }

  @Test("The island's spinner keeps the system small spinner's shape and stepped wave")
  func islandSpinner() {
    typealias Style = IslandSpinnerStyle
    #expect(Style.side == 16 && Style.spokes == 8 && Style.spokeWidth == 2)
    #expect(Style.innerRadius + Style.spokeLength == Style.side / 2)
    #expect(Style.period == 0.8 && Style.steps == 24 && Style.reducedPeriod > Style.period)
    #expect(abs(Style.spokeDelay(period: Style.period) - 0.1) < 1e-12)
    let opacities = Style.opacities()
    #expect(opacities.count == Style.steps)
    // Up to full over the ramp, then down to the trailing share by the end of the turn.
    #expect(opacities[0] == Style.trailingAlpha && opacities[Style.rampSteps] == 1)
    let fade = Array(opacities[Style.rampSteps...])
    #expect(zip(fade, fade.dropFirst()).allSatisfy { $0 > $1 })
    #expect(opacities.last! > Style.trailingAlpha && opacities.last! < 0.2)
    // One spoke behind the peak, as the system draws it: about 0.84 of it.
    #expect(abs(opacities[Style.rampSteps + Style.steps / Style.spokes] - 0.84) < 0.05)
  }
}
