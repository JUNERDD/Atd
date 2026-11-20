import AICore
import AppKit

/// Non-focus-stealing table view with press-and-release row tracking.
@MainActor
final class NonFocusingTableView: NSTableView {
  var canSelectRow: ((Int) -> Bool)?
  var onClickRow: ((Int) -> Void)?
  private var pressedRowIndex: Int?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    refusesFirstResponder = true
  }

  convenience init() { self.init(frame: .zero) }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var acceptsFirstResponder: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func mouseDown(with event: NSEvent) {
    let rowIndex = row(at: convert(event.locationInWindow, from: nil))
    guard rowIndex >= 0, canSelectRow?(rowIndex) ?? true else {
      pressedRowIndex = nil
      return
    }
    pressedRowIndex = rowIndex
    setRowPressed(rowIndex, pressed: true)
  }

  override func mouseDragged(with event: NSEvent) {
    guard let rowIndex = pressedRowIndex else { return }
    let point = convert(event.locationInWindow, from: nil)
    setRowPressed(rowIndex, pressed: rect(ofRow: rowIndex).contains(point))
  }

  override func mouseUp(with event: NSEvent) {
    guard let rowIndex = pressedRowIndex else { return }
    pressedRowIndex = nil
    setRowPressed(rowIndex, pressed: false)
    let point = convert(event.locationInWindow, from: nil)
    if rect(ofRow: rowIndex).contains(point) { onClickRow?(rowIndex) }
  }

  private func setRowPressed(_ rowIndex: Int, pressed: Bool) {
    guard rowIndex >= 0, rowIndex < numberOfRows else { return }
    let cell = view(atColumn: 0, row: rowIndex, makeIfNecessary: false) as? FontRowCellView
    cell?.setPressed(pressed)
  }
}

extension CaptureFontPickerPopover {
  func handleSearchCommand(textView: NSTextView, selector: Selector) -> Bool {
    guard !textView.hasMarkedText() else { return false }
    switch selector {
    case #selector(NSResponder.moveDown(_:)):
      moveKeyboardHighlight(by: 1)
      return true
    case #selector(NSResponder.moveUp(_:)):
      moveKeyboardHighlight(by: -1)
      return true
    case #selector(NSResponder.insertNewline(_:)):
      if let target = activationRowForReturn() { handleRowClick(target) }
      return true
    case #selector(NSResponder.cancelOperation(_:)):
      if !query.isEmpty {
        query = ""
        searchField.query = ""
        reloadList()
      } else {
        dismissPopover()
      }
      return true
    default:
      return false
    }
  }

  private func moveKeyboardHighlight(by delta: Int) {
    let selectable = rows.indices.filter { isSelectableRow($0) }
    guard !selectable.isEmpty else {
      setKeyboardHighlight(nil)
      return
    }
    let next: Int
    if let current = highlightedRowIndex, let pos = selectable.firstIndex(of: current) {
      next = selectable[max(0, min(selectable.count - 1, pos + delta))]
    } else {
      next = delta > 0 ? selectable[0] : selectable[selectable.count - 1]
    }
    setKeyboardHighlight(next)
    tableView.scrollRowToVisible(next)
  }

  func setKeyboardHighlight(_ next: Int?) {
    let previous = highlightedRowIndex
    guard previous != next else { return }
    highlightedRowIndex = next
    forEachVisibleFontCell { row, cell in
      if row == previous || row == next { cell.setKeyboardHighlighted(row == next) }
    }
  }

  private func activationRowForReturn() -> Int? {
    if let highlighted = highlightedRowIndex, isSelectableRow(highlighted) { return highlighted }
    let selectable = rows.indices.filter { isSelectableRow($0) }
    if selectable.count == 1 { return selectable[0] }
    if let customIdx = rows.firstIndex(where: {
      if case .loadCustomGoogle = $0 { return true }
      return false
    }) {
      return customIdx
    }
    return selectable.first
  }

  func isSelectableRow(_ row: Int) -> Bool {
    guard rows.indices.contains(row) else { return false }
    if case .empty = rows[row] { return false }
    return true
  }

  func isRowSelected(_ row: Int) -> Bool {
    guard rows.indices.contains(row) else { return false }
    switch rows[row] {
    case .systemDefault: return selectedFamily == nil
    case .font(let family, _, _, _):
      return selectedFamily?.caseInsensitiveCompare(family) == .orderedSame
    case .loadCustomGoogle, .empty: return false
    }
  }

  func handleRowClick(_ row: Int) {
    guard rows.indices.contains(row) else { return }
    switch rows[row] {
    case .empty:
      return
    case .systemDefault:
      selectedFamily = nil
      onSelectFont?(.system)
    case .font(let family, _, _, let isGoogle):
      let cached = loader.status(for: family) == .cached
      if !isGoogle || catalog.isLocallyAvailable(family) || cached {
        _ = loader.registerCachedFontIfPresent(family: family)
        selectedFamily = family
        onSelectFont?(.family(family))
      } else {
        Task { [weak self] in await self?.downloadAndSelect(family: family) }
      }
    case .loadCustomGoogle(let rawQuery):
      Task { [weak self] in await self?.downloadAndSelect(family: rawQuery) }
    }
    restoreEditorFocusIfNeeded()
  }

  private func downloadAndSelect(family: String) async {
    guard let canonical = await loader.loadFont(family: family) else {
      refreshVisibleCells()
      return
    }
    selectedFamily = canonical
    onSelectFont?(.family(canonical))
    reloadList(preserveScroll: true)
  }

  func numberOfRows(in tableView: NSTableView) -> Int { rows.count }
  func tableView(_ tableView: NSTableView, shouldSelectRow row: Int) -> Bool { false }

  func tableView(_ tableView: NSTableView, heightOfRow row: Int) -> CGFloat {
    guard rows.indices.contains(row) else { return 34 }
    if case .empty = rows[row] { return 112 }
    return 34
  }

  func tableView(_ tv: NSTableView, viewFor col: NSTableColumn?, row: Int) -> NSView? {
    let strings = ShellStrings.shared
    let highlighted = highlightedRowIndex == row
    switch rows[row] {
    case .empty(let reason):
      let id = NSUserInterfaceItemIdentifier("EmptyFontRowCell")
      let cell =
        (tv.makeView(withIdentifier: id, owner: self) as? EmptyFontRowCellView)
        ?? EmptyFontRowCellView(identifier: id)
      let symbol = reason == .recent ? "clock" : "magnifyingglass"
      let key: CaptureToolsStringKey = reason == .recent ? .fontEmptyRecent : .fontEmptySearch
      cell.configure(symbolName: symbol, message: strings.text(key))
      return cell
    case .systemDefault:
      let cell = reusableFontCell(in: tv)
      cell.configure(
        title: strings.text(CaptureToolsStringKey.fontSystemDefault), font: .systemFont(ofSize: 14),
        badge: strings.text(CaptureToolsStringKey.fontBadgeSystem), selected: selectedFamily == nil,
        keyboardHighlighted: highlighted)
      return cell
    case .font(let family, let displayTitle, let badge, let isGoogle):
      let cell = reusableFontCell(in: tv)
      let status = isGoogle ? loader.status(for: family) : nil
      let font = !isGoogle || status == .cached ? catalog.previewFont(for: family, size: 14) : nil
      cell.configure(
        title: displayTitle, font: font ?? .systemFont(ofSize: 14), badge: badge, status: status,
        selected: selectedFamily?.caseInsensitiveCompare(family) == .orderedSame,
        keyboardHighlighted: highlighted)
      return cell
    case .loadCustomGoogle(let queryText):
      let cell = reusableFontCell(in: tv)
      cell.configure(
        title: strings.text(CaptureToolsStringKey.fontLoadCustomGoogle, queryText),
        font: .systemFont(ofSize: 13.5, weight: .medium), color: .controlAccentColor,
        status: loader.status(for: queryText), keyboardHighlighted: highlighted)
      return cell
    }
  }

  private func reusableFontCell(in tv: NSTableView) -> FontRowCellView {
    let id = NSUserInterfaceItemIdentifier("FontRowCell")
    let reused = tv.makeView(withIdentifier: id, owner: self) as? FontRowCellView
    return reused ?? FontRowCellView(identifier: id)
  }
}
