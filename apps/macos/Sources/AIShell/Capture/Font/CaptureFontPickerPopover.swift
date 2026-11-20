import AICore
import AppKit

/// Virtualized, non-focus-stealing font picker popover (`308 × 392 pt`) with Curated,
/// Google Fonts (lazy `.process`-scoped download), Local CoreText families, and Recent tabs.
@MainActor
final class CaptureFontPickerPopover: NSObject, NSTableViewDataSource, NSTableViewDelegate {
  static let popoverSize = NSSize(width: 308, height: 392)

  var selectedFamily: String? {
    didSet {
      if selectedFamily != oldValue { refreshSelectionStates() }
    }
  }
  var recentFamilies: [String] = [] {
    didSet {
      if recentFamilies != oldValue, activeTab == .recent { reloadList() }
    }
  }
  var activeFamiliesInDocument: (() -> Set<String>)? {
    didSet { syncActiveFamiliesProvider() }
  }
  var onSelectFont: ((AnnotationFontChoice) -> Void)?
  var isShown: Bool { panel.isShown }

  private let panel = CapturePopoverPanel()
  private var displayObserver: NSObjectProtocol?
  private var isViewLoaded = false
  private lazy var contentView = FontPickerFlippedView(
    frame: NSRect(origin: .zero, size: Self.popoverSize))

  var activeTab: CaptureFontTab = .curated
  var query = ""
  var rows: [CaptureFontPickerItem] = []
  var highlightedRowIndex: Int?
  let catalog = CaptureFontCatalog.shared
  let loader = CaptureGoogleFontLoader.shared

  let tabs = CaptureFontTabBar(segmentCount: CaptureFontTab.allCases.count)
  let searchField = CaptureFontSearchField()
  private let divider = NSView()
  let scrollView = FloatingNativeScrollView()
  let tableView = NonFocusingTableView()

  override init() {
    super.init()
    panel.onDidClose = { [weak self] in self?.handlePanelDidClose() }
  }

  isolated deinit {
    if let displayObserver {
      NSWorkspace.shared.notificationCenter.removeObserver(displayObserver)
    }
    NotificationCenter.default.removeObserver(self)
  }

  func show(
    relativeTo positioningRect: NSRect, of positioningView: NSView,
    preferredEdge: NSRectEdge = .minY
  ) {
    let wasLoaded = isViewLoaded
    ensureLoaded()
    syncActiveFamiliesProvider()
    loader.onStatusChanged = { [weak self] _ in self?.refreshVisibleCells() }

    if displayObserver == nil {
      displayObserver = NSWorkspace.shared.notificationCenter.addObserver(
        forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated { self?.refreshDisplayOptions() }
      }
    }

    _ = catalog.localFontFamilies()
    if wasLoaded {
      applyStrings()
      reloadList()
    }
    panel.show(
      contentView: contentView,
      contentSize: Self.popoverSize,
      relativeTo: positioningRect,
      of: positioningView,
      preferredEdge: preferredEdge)
    refreshDisplayOptions()
  }

  func dismissPopover() {
    panel.dismissPopover()
  }

  private func ensureLoaded() {
    guard !isViewLoaded else { return }
    isViewLoaded = true
    contentView.onAppearanceChange = { [weak self] in self?.refreshDisplayOptions() }
    setupUI(in: contentView)
    applyStrings()
    reloadList()
    NotificationCenter.default.addObserver(
      self, selector: #selector(stringsDidChange), name: ShellStrings.didChange, object: nil)
  }

  private func handlePanelDidClose() {
    if let displayObserver {
      NSWorkspace.shared.notificationCenter.removeObserver(displayObserver)
      self.displayObserver = nil
    }
    query = ""
    searchField.query = ""
    searchField.endEditingIfNeeded()
    highlightedRowIndex = nil
    catalog.clearPreviewCache()
    loader.onStatusChanged = nil
    restoreEditorFocusIfNeeded()
  }

  private func setupUI(in root: NSView) {
    let inset: CGFloat = 12
    let contentWidth = Self.popoverSize.width - inset * 2

    tabs.frame = NSRect(x: inset, y: inset, width: contentWidth, height: 30)
    tabs.setSelectedSegment(activeTab.rawValue, animated: false)
    tabs.onSelectSegment = { [weak self] index in self?.tabChanged(to: index) }

    searchField.frame = NSRect(x: inset, y: 48, width: contentWidth, height: 30)
    searchField.onQueryChanged = { [weak self] newQuery in
      guard let self else { return }
      query = newQuery
      reloadList()
    }
    searchField.onCommand = { [weak self] textView, selector in
      self?.handleSearchCommand(textView: textView, selector: selector) ?? false
    }
    searchField.onFocusChanged = { [weak self] focused in
      if !focused { self?.setKeyboardHighlight(nil) }
    }

    divider.wantsLayer = true
    divider.frame = NSRect(x: inset, y: 85, width: contentWidth, height: 1)

    let scrollRect = NSRect(x: inset, y: 90, width: contentWidth, height: 294)
    let column = NSTableColumn(identifier: .init("FontColumn"))
    column.width = contentWidth
    column.minWidth = contentWidth
    column.maxWidth = contentWidth
    tableView.addTableColumn(column)
    tableView.headerView = nil
    tableView.rowHeight = 34
    tableView.intercellSpacing = .zero
    tableView.selectionHighlightStyle = .none
    tableView.backgroundColor = .clear
    tableView.style = .plain
    tableView.columnAutoresizingStyle = .uniformColumnAutoresizingStyle
    tableView.dataSource = self
    tableView.delegate = self
    tableView.canSelectRow = { [weak self] row in self?.isSelectableRow(row) ?? false }
    tableView.onClickRow = { [weak self] row in self?.handleRowClick(row) }

    scrollView.borderType = .noBorder
    scrollView.drawsBackground = false
    scrollView.automaticallyAdjustsContentInsets = false
    scrollView.documentView = tableView
    scrollView.frame = scrollRect
    tableView.sizeLastColumnToFit()

    root.addSubview(tabs)
    root.addSubview(searchField)
    root.addSubview(divider)
    root.addSubview(scrollView)
    updateDividerAppearance()
  }

  private func applyStrings() {
    guard isViewLoaded else { return }
    let strings = ShellStrings.shared
    let tabKeys: [CaptureToolsStringKey] = [
      .fontTabCurated, .fontTabGoogle, .fontTabLocal, .fontTabRecent,
    ]
    for (idx, key) in tabKeys.enumerated() { tabs.setLabel(strings.text(key), forSegment: idx) }
    searchField.placeholder = strings.text(CaptureToolsStringKey.fontSearchPlaceholder)
    searchField.clearAccessibilityLabel = strings.text(CaptureToolsStringKey.fontSearchClear)
  }

  func reloadList(preserveScroll: Bool = false) {
    guard isViewLoaded else { return }
    if !preserveScroll { highlightedRowIndex = nil }
    rows = catalog.pickerItems(tab: activeTab, query: query, recent: recentFamilies)
    let savedOrigin = scrollView.contentView.bounds.origin
    tableView.reloadData()
    scrollView.contentView.scroll(to: preserveScroll ? savedOrigin : .zero)
    scrollView.reflectScrolledClipView(scrollView.contentView)
  }

  func forEachVisibleFontCell(_ body: (Int, FontRowCellView) -> Void) {
    guard isViewLoaded else { return }
    let visible = tableView.rows(in: tableView.visibleRect)
    guard visible.length > 0 else { return }
    for row in visible.location..<(visible.location + visible.length) {
      if let cell = tableView.view(atColumn: 0, row: row, makeIfNecessary: false)
        as? FontRowCellView
      {
        body(row, cell)
      }
    }
  }

  func refreshVisibleCells() {
    guard isViewLoaded else { return }
    let visible = tableView.rows(in: tableView.visibleRect)
    guard visible.length > 0 else { return }
    tableView.reloadData(
      forRowIndexes: IndexSet(integersIn: visible.location..<(visible.location + visible.length)),
      columnIndexes: IndexSet(integer: 0))
  }

  func restoreEditorFocusIfNeeded() {
    searchField.endEditingIfNeeded()
    panel.releaseKeyFocus()
  }

  private func syncActiveFamiliesProvider() {
    loader.activeFamiliesProvider = { [weak self] in self?.activeFamiliesInDocument?() ?? [] }
  }

  private func refreshDisplayOptions() {
    updateDividerAppearance()
    forEachVisibleFontCell { _, cell in cell.refreshHighlightAppearance() }
  }

  private func updateDividerAppearance() {
    guard isViewLoaded else { return }
    contentView.effectiveAppearance.performAsCurrentDrawingAppearance {
      divider.layer?.backgroundColor = NSColor.separatorColor.withAlphaComponent(0.35).cgColor
    }
  }

  private func refreshSelectionStates() {
    forEachVisibleFontCell { row, cell in cell.setSelected(isRowSelected(row)) }
  }

  @objc private func stringsDidChange() {
    applyStrings()
    reloadList(preserveScroll: true)
  }

  private func tabChanged(to index: Int) {
    activeTab = CaptureFontTab(rawValue: index) ?? .curated
    reloadList()
    restoreEditorFocusIfNeeded()
  }
}

@MainActor
private final class FontPickerFlippedView: NSView {
  var onAppearanceChange: (() -> Void)?
  override var isFlipped: Bool { true }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    onAppearanceChange?()
  }
}
