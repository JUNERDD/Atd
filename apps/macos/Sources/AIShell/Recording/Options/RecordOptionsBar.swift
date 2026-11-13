import AICore
import AppKit

/// The record bar beside a committed selection in record mode (architecture R1–R3): a grip,
/// Sound ⌄ and Options ⌄, then cancel and Start Recording, on the annotation toolbar's glass
/// capsule (``AnnotationGlassBar``: 40 pt tall, 20 pt corners on 6 pt padding, 28 pt controls),
/// whose surface lets ``AnnotationHostView`` pass presses to its controls. Sound and Options
/// share one anatomy (glyph, a fixed title, chevron), so neither ever changes width and the bar
/// keeps one ``size``; Sound's glyph and description say what will be heard.
///
/// The session places it (``place(in:frame:)``) as it places the annotation toolbar; once the
/// user drags it by its grip or surface it stays where it was dropped on that display, kept
/// inside it, until a double-click puts it back or the selection moves to another display. Its
/// menus (``RecordOptionsMenus``) change the remembered settings, which the recording reads
/// when it starts (``RecordingSettingsMemory/load(from:folderExists:)``, or ``settings``).
final class RecordOptionsBar: NSView, CaptureRecordAccessory {
  var onStart: (() -> Void)?
  var onCancel: (() -> Void)?

  private let menus: RecordOptionsMenus
  private let grip = AnnotationBarGrip()
  private let soundButton: RecordBarButton
  private let optionsButton: RecordBarButton
  private let cancelButton = AnnotationToolbarButton(
    selection: nil, action: #selector(cancelClicked))
  private let startButton: RecordBarButton
  private let bar: AnnotationGlassBar
  /// The frame the session last gave, and where a drag put the bar instead.
  private var placed: CGRect?
  private var movedOrigin: CGPoint?
  private var dragOrigin = CGPoint.zero

  /// `defaults` holds the remembered settings (``RecordingSettingsMemory``), read now.
  init(defaults: UserDefaults = .standard) {
    let copy = RecordOptionsCopy.self
    menus = RecordOptionsMenus(defaults: defaults)
    soundButton = RecordBarButton(
      style: .menu, title: copy.text(.sound), glyph: nil, action: #selector(soundClicked))
    optionsButton = RecordBarButton(
      style: .menu, title: copy.text(.options),
      glyph: AnnotationIcons.glyph(RecordOptionsIcons.options, label: ""),
      action: #selector(optionsClicked))
    startButton = RecordBarButton(
      style: .primary, title: copy.text(.start),
      glyph: AnnotationIcons.glyph(RecordOptionsIcons.start, label: ""),
      action: #selector(startClicked))
    let bar = AnnotationGlassBar(
      groups: [[grip, soundButton, optionsButton], [cancelButton, startButton]],
      blending: .withinWindow)
    self.bar = bar
    super.init(frame: CGRect(origin: .zero, size: bar.fittingSize))
    for button in [soundButton, optionsButton, startButton] { button.target = self }
    cancelButton.target = self
    bar.onDrag = { [weak self] drag in self?.moved(drag) }
    menus.onChange = { [weak self] in self?.showSound() }
    addSubview(bar)
    describe()
    showSound()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  /// The settings as the bar shows them, saved with every change.
  var settings: RecordingSettings { menus.settings }

  var size: CGSize { bar.fittingSize }

  override var fittingSize: NSSize { bar.fittingSize }

  override func layout() {
    super.layout()
    bar.frame = bounds
  }

  func place(in host: AnnotationHostView, frame: CGRect) {
    if superview !== host {
      if superview != nil { movedOrigin = nil }
      host.addSubview(self)
    }
    placed = frame
    reposition()
  }

  var isModal: Bool { menus.isModal }

  func dismissMenus() -> Bool {
    menus.closeDeepest()
  }

  func hide() {
    menus.dismiss()
    removeFromSuperview()
  }

  // MARK: Placement

  /// Where the session put the bar, or where it was dragged, kept inside its display; a move
  /// closes the menus, which would no longer hang from it.
  private func reposition() {
    guard let host = superview, let placed else { return }
    let target =
      movedOrigin.map {
        AnnotationToolbarLayout.frames(
          toolbar: placed.size, styleBar: .zero, at: $0, within: host.bounds
        ).toolbar
      } ?? placed
    guard target != frame else { return }
    menus.close()
    frame = target
  }

  private func moved(_ drag: AnnotationGlassBar.Drag) {
    menus.close()
    switch drag {
    case .began: dragOrigin = frame.origin
    case .moved(let travel):
      movedOrigin = CGPoint(x: dragOrigin.x + travel.dx, y: dragOrigin.y + travel.dy)
    case .reset: movedOrigin = nil
    }
    reposition()
  }

  // MARK: Content

  /// Names and tooltips, in the shell language as the bar opens.
  private func describe() {
    let copy = RecordOptionsCopy.self
    let strings = ShellStrings.shared
    setAccessibilityElement(true)
    setAccessibilityRole(.toolbar)
    setAccessibilityLabel(copy.text(.title))
    grip.image = AnnotationIcons.glyph(AnnotationIcons.grip, label: "")
    grip.toolTip = strings.text(.captureToolbarMove)
    optionsButton.toolTip = copy.text(.title)
    let cancel = strings.text(.cancel)
    cancelButton.image = AnnotationIcons.glyph(AnnotationIcons.cancel, label: cancel)
    cancelButton.toolTip = copy.tooltip(cancel, key: "Esc")
    cancelButton.setAccessibilityLabel(cancel)
    startButton.toolTip = copy.tooltip(copy.text(.start), key: "↩")
  }

  /// Sound's glyph, tooltip and VoiceOver name for what will be heard.
  private func showSound() {
    let sound = RecordOptionsCopy.sound(
      microphone: menus.microphone, systemAudio: menus.settings.systemAudio)
    soundButton.glyph = AnnotationIcons.glyph(sound.glyph, label: "")
    soundButton.toolTip = sound.description
    soundButton.setAccessibilityLabel(sound.description)
  }

  @objc private func soundClicked(_ sender: RecordBarButton) {
    menus.toggle(.sound, from: sender, capsule: bar)
  }

  @objc private func optionsClicked(_ sender: RecordBarButton) {
    menus.toggle(.options, from: sender, capsule: bar)
  }

  @objc private func cancelClicked() {
    menus.dismiss()
    onCancel?()
  }

  @objc private func startClicked() {
    menus.dismiss()
    onStart?()
  }
}
