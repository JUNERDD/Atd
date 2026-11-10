import AICore
import AppKit

/// The selection toolbar's window (visual spec, contracts §6): a borderless, non-activating
/// panel that never becomes key, so the app with the selection keeps the keyboard and its
/// selection while the user clicks. The Liquid Glass capsule (``AnnotationGlassBar``) owns the
/// edge and shadow; the window draws nothing of its own. The window reaches ``inset`` past the
/// capsule on every side, so the glass's shadow and the entrance's movement are never cut off
/// at its edge; that margin is transparent, so clicks there go to the app below.
///
/// Ask Atd comes first, then a button per command while the capsule stays within
/// ``SelectionToolbarLayout/maxWidth``, then More, which opens the remaining commands in a menu
/// and closes it again. A command with options (``CommandOptionsCatalog``) is a split button:
/// its own part runs it with its remembered values, a chevron (``ToolbarOptionsChevron``) opens
/// its options menu below the capsule and shows pressed while it is open; the split's whole width
/// counts toward the capsule's, so it overflows into More like any other command. The menus
/// (``ToolbarOptionsCascade``, ``ToolbarOptionsContent``) go whenever the toolbar does, and when
/// a drag of the toolbar starts. Command names are user data and stay untranslated; the rest of
/// the copy is read in the current shell language each time the toolbar shows.
///
/// With a small icon set (``SelectionToolbarIconMode``), the same window shows the icon
/// (``SelectionToolbarSmallIcon``) first, by the pointer; the toolbar then replaces it, placed by
/// the pointer rule too, so its glass grows out of the icon's in place (``SelectionToolbarMorph``),
/// carried along with the icon when the `click` mode's icon was dragged first.
/// Without one the toolbar comes up at once where the setting's ``SelectionToolbarPosition`` puts
/// it.
final class SelectionToolbarPanel: NSObject {
  var onAsk: (() -> Void)?
  var onCommand: ((CommandLaunch) -> Void)?
  /// A value of command `id` changed in its options menu (``ToolbarOptionsContent/onPick``).
  var onPick: ((String, CommandArguments) -> Void)?

  /// The transparent margin around the capsule.
  static let inset: CGFloat = 24

  private let window = ToolbarWindow.selectionToolbar()
  private var commands: [SelectionToolbarSettings.Command] = []
  private var iconMode = SelectionToolbarIconMode.off
  private var position = SelectionToolbarPosition.pointer
  /// What the toolbar was asked for beside: the selection (Cocoa points, nil when unknown) and
  /// the pointer. The toolbar an icon grows into is placed by them too.
  private var anchor: (selection: ScreenRect?, pointer: CGPoint)?
  /// The small icon while it stands in for the toolbar.
  private var icon: SelectionToolbarSmallIcon?
  /// The toolbar growing out of the small icon, while it does.
  private var morph: SelectionToolbarMorph?
  /// The commands behind More, in order.
  private var overflow: [SelectionToolbarSettings.Command] = []
  /// Follows the pointer over the capsule and, while they are open, the menus.
  private let hover: SelectionToolbarHover
  private let menus: ToolbarOptionsCascade
  private let options: ToolbarOptionsContent
  /// The chevron whose options menu is open.
  private weak var activeChevron: ToolbarOptionsChevron?
  private lazy var mover = SelectionToolbarMover(window: window, inset: Self.inset)

  override init() {
    let hover = SelectionToolbarHover()
    self.hover = hover
    let menus = ToolbarOptionsCascade(hover: hover)
    self.menus = menus
    options = ToolbarOptionsContent(cascade: menus)
    super.init()
    hover.onFrame = { [weak self] view in
      self?.menus.pointerAt(view)
      self?.icon?.pointerAt(view)
    }
    options.onLaunch = { [weak self] launch in
      self?.hide()
      self?.onCommand?(launch)
    }
    options.onPick = { [weak self] id, values in self?.onPick?(id, values) }
    menus.onClose = { [weak self] in
      self?.activeChevron?.isActive = false
      self?.activeChevron = nil
      self?.options.reset()
    }
  }

  var isVisible: Bool { window.isVisible }

  /// The commands, the small icon and the position, from the next time the toolbar shows.
  func configure(_ settings: SelectionToolbarSettings) {
    commands = settings.commands
    iconMode = settings.smallIcon
    position = settings.position
  }

  /// The commands with options, which get split buttons from the next time the toolbar shows.
  func setCommandOptions(_ catalog: CommandOptionsCatalog) {
    options.catalog = catalog
  }

  /// Shows the toolbar, or the small icon the setting puts first, beside `selection` (Quartz
  /// points from Accessibility), or at the pointer when the app gave no bounds.
  func show(selection quartz: CGRect?, pointer: CGPoint) {
    // A menu still open belongs to the buttons this replaces.
    menus.close()
    icon = nil
    let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
    let selection = quartz.map {
      ScreenRect(CaptureCoordinates.flip($0, primaryHeight: primaryHeight))
    }
    anchor = (selection, pointer)
    guard iconMode != .off else { return showToolbar(position: position, from: nil) }
    guard
      let frame = SelectionToolbarPlacement.iconFrame(
        side: SelectionToolbarSmallIcon.side,
        toolbarHeight: SelectionToolbarSmallIcon.toolbarHeight,
        selection: selection, pointer: pointer, displays: Self.displays())
    else { return }
    let icon = SelectionToolbarSmallIcon(mode: iconMode)
    icon.onExpand = { [weak self] in self?.expand() }
    icon.onDrag = { [weak self] in self?.mover.handle($0) }
    let (container, upward) = present(icon.view, at: frame)
    mover.placed = window.frame
    self.icon = icon
    SelectionToolbarEntrance.play(on: container, capsule: icon.view.frame, upward: upward)
    hover.start(icon.controls, grip: nil, in: container)
  }

  /// The small icon grows into the toolbar, placed by the pointer rule like the icon, so the icon
  /// lies inside it, and carried along with the icon wherever it was dragged.
  private func expand() {
    guard let icon else { return }
    self.icon = nil
    showToolbar(position: .pointer, from: icon)
  }

  /// Builds the row and shows it where `position` puts it: entering like a toolbar of its own,
  /// or growing out of `icon`, the small icon the window shows now.
  private func showToolbar(
    position: SelectionToolbarPosition, from icon: SelectionToolbarSmallIcon?
  ) {
    let (bar, buttons, grip) = makeContent()
    let size = bar.fittingSize
    guard let anchor,
      var frame = SelectionToolbarPlacement.frame(
        size: WindowSize(width: size.width, height: size.height), selection: anchor.selection,
        pointer: anchor.pointer, position: position, displays: Self.displays())
    else { return }
    // The icon's circle, read before the window moves to the toolbar's place: the toolbar follows
    // it from where it came up (``mover``'s placement), and the glass grows out of it.
    let circle = window.frame.insetBy(dx: Self.inset, dy: Self.inset)
    if icon != nil, let placed = mover.placed?.insetBy(dx: Self.inset, dy: Self.inset) {
      frame = SelectionToolbarPlacement.frame(
        frame, aroundIcon: ScreenRect(placed), movedTo: ScreenRect(circle),
        displays: Self.displays())
    }
    let morph = icon.map {
      SelectionToolbarMorph(
        bar: bar, rest: NSSize(width: frame.width, height: frame.height),
        icon: circle.offsetBy(dx: -frame.x, dy: -frame.y), face: $0.face)
    }
    let (container, upward) = present(bar, at: frame)
    mover.placed = window.frame
    if let morph {
      morph.run(in: container)
      self.morph = morph
    } else {
      SelectionToolbarEntrance.play(on: container, capsule: bar.frame, upward: upward)
    }
    hover.start(buttons, grip: grip, in: container)
  }

  /// Every display as the toolbar's placement, and its menus', take them: frame and work area.
  static func displays() -> [SelectionToolbarPlacement.Display] {
    NSScreen.screens.map {
      .init(frame: ScreenRect($0.frame), workArea: ScreenRect($0.visibleFrame))
    }
  }

  /// Shows `content` in the window at `frame` (its frame on screen), inside the transparent
  /// margin, and returns its container, whose layer carries the entrance, and whether it sits
  /// above what it belongs to.
  private func present(_ content: NSView, at frame: ScreenRect)
    -> (container: NSView, upward: Bool)
  {
    morph?.stop()
    morph = nil
    let windowFrame = NSRect(frame).insetBy(dx: -Self.inset, dy: -Self.inset)
    // A plain layer-backed container under the glass carries the entrance transform, so the
    // glass view's own layer is never touched.
    let container = NSView(frame: NSRect(origin: .zero, size: windowFrame.size))
    container.wantsLayer = true
    content.frame = container.bounds.insetBy(dx: Self.inset, dy: Self.inset)
    container.addSubview(content)
    window.contentView = container
    window.setFrame(windowFrame, display: true)
    window.orderFrontRegardless()
    let middle = anchor.map { $0.selection.map { $0.y + $0.height / 2 } ?? Double($0.pointer.y) }
    return (container, frame.y >= middle ?? frame.y)
  }

  /// Takes the toolbar and its menu off the screen.
  func hide() {
    hover.stop()
    menus.close()
    morph?.stop()
    morph = nil
    icon = nil
    anchor = nil
    mover.reset()
    guard window.isVisible else { return }
    window.orderOut(nil)
    window.contentView = nil
  }

  // MARK: Content

  /// The glass row, its buttons in order, and its drag handle.
  private func makeContent() -> (AnnotationGlassBar, [any ToolbarHoverable], NSView) {
    let strings = ShellStrings.shared
    let grip = AnnotationBarGrip()
    grip.image = AnnotationIcons.glyph(AnnotationIcons.grip, label: "")
    grip.toolTip = strings.text(.captureToolbarMove)
    let ask = AnnotationToolbarButton(
      label: strings.text(.selectionToolbarAsk),
      image: AnnotationIcons.glyph(SelectionToolbarIcons.ask, label: ""),
      action: #selector(askClicked))
    ask.toolTip = strings.text(.selectionToolbarAskTooltip)
    let units = commands.enumerated().map { index, command in commandUnit(command, index) }
    let widths = units.map { Double($0.view.fittingSize.width) }
    let extra = Double(ToolbarOptionsChevron.endingWidth - ToolbarOptionsChevron.width)
    let visible = SelectionToolbarLayout.visibleCommandCount(
      askWidth: ask.fittingSize.width, commandWidths: widths,
      endingWidths: zip(units, widths).map { unit, width in
        unit.controls.contains { $0 is ToolbarOptionsChevron } ? width + extra : width
      })
    overflow = Array(commands.dropFirst(visible))
    // The last command's chevron ends the capsule when no More follows it.
    if overflow.isEmpty, visible > 0,
      let chevron = units[visible - 1].controls.last as? ToolbarOptionsChevron
    {
      chevron.endsCapsule = true
    }
    var views: [NSView] = [ask] + units.prefix(visible).map(\.view)
    var items: [any ToolbarHoverable] = [ask] + units.prefix(visible).flatMap(\.controls)
    if !overflow.isEmpty {
      let more = AnnotationToolbarButton(selection: nil, action: #selector(moreClicked))
      more.image = AnnotationIcons.glyph(
        SelectionToolbarIcons.more, label: strings.text(.selectionToolbarMore))
      more.setAccessibilityLabel(strings.text(.selectionToolbarMore))
      more.toolTip = strings.text(.selectionToolbarMoreTooltip)
      views.append(more)
      items.append(more)
    }
    for control in items { control.target = self }
    let bar = AnnotationGlassBar(
      groups: [[grip] + views], blending: .behindWindow,
      padding: SelectionToolbarLayout.padding)
    bar.onDrag = { [weak self] drag in
      // A press there closes the menu, which would otherwise be left behind.
      if case .began = drag { self?.menus.close() }
      self?.mover.handle(drag)
    }
    bar.setAccessibilityElement(true)
    bar.setAccessibilityRole(.toolbar)
    bar.setAccessibilityLabel(strings.text(.selectionToolbar))
    return (bar, items, grip)
  }

  /// Command `index`'s place on the capsule and the controls in it: its button, or for a command
  /// with options its button and chevron side by side as one split button.
  private func commandUnit(_ command: SelectionToolbarSettings.Command, _ index: Int)
    -> (view: NSView, controls: [any ToolbarHoverable])
  {
    let button = AnnotationToolbarButton(
      label: command.name, image: nil, action: #selector(commandClicked))
    button.tag = index
    button.toolTip = command.name
    guard options.catalog.contains(command.id) else { return (button, [button]) }
    let chevron = ToolbarOptionsChevron(action: #selector(optionsClicked))
    chevron.tag = index
    let label = ShellStrings.shared.text(.commandOptionsMenu, command.name)
    chevron.toolTip = label
    chevron.setAccessibilityLabel(label)
    let split = NSStackView(views: [button, chevron])
    split.spacing = 0
    return (split, [button, chevron])
  }

  @objc private func askClicked() {
    hide()
    onAsk?()
  }

  @objc private func commandClicked(_ sender: NSButton) {
    guard commands.indices.contains(sender.tag) else { return }
    let id = commands[sender.tag].id
    hide()
    onCommand?(CommandLaunch(id: id))
  }

  /// Opens the More menu under (or over) the capsule, aligned with More, or closes it if it is
  /// open.
  @objc private func moreClicked(_ sender: NSButton) {
    guard menus.opener !== sender else { return menus.close() }
    let commands = overflow
    menus.open(
      from: sender, anchor: column(of: sender),
      label: ShellStrings.shared.text(.selectionToolbarMore)
    ) { [weak self] in self?.options.moreItems(commands) ?? [] }
  }

  /// Opens a command's options menu under (or over) the capsule, aligned with its split button,
  /// or closes it if it is open.
  @objc private func optionsClicked(_ sender: ToolbarOptionsChevron) {
    guard menus.opener !== sender else { return menus.close() }
    guard commands.indices.contains(sender.tag) else { return }
    let command = commands[sender.tag]
    menus.open(
      from: sender, anchor: column(of: sender.superview ?? sender),
      label: ShellStrings.shared.text(.commandOptionsMenu, command.name)
    ) { [weak self] in self?.options.items(for: command.id) ?? [] }
    guard menus.isOpen else { return }
    sender.isActive = true
    activeChevron = sender
  }

  /// `view`'s column through the capsule on screen: its leading edge and width, the capsule's
  /// bottom and height, which the menu's gap is measured from.
  private func column(of view: NSView) -> NSRect {
    let frame = window.convertToScreen(view.convert(view.bounds, to: nil))
    let capsule = window.frame.insetBy(dx: Self.inset, dy: Self.inset)
    return NSRect(x: frame.minX, y: capsule.minY, width: frame.width, height: capsule.height)
  }
}

/// The toolbar's Lucide glyphs, template image sets in the App target's asset catalog
/// (`App/Assets.xcassets/Selection/lucide-<name>.imageset`), found like ``AnnotationIcons``'s.
/// Source: the icon nodes of `lucide-react` 1.49.0 (ISC), the version pinned in
/// `pnpm-workspace.yaml`, written out as unmodified 24 × 24 SVGs.
enum SelectionToolbarIcons {
  static let ask = "sparkles"
  static let more = "ellipsis"
}
