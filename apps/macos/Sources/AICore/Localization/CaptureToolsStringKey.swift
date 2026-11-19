/// Strings for the upgraded capture and annotation UX: toolbar/style controls, color and font
/// popovers, selection aspect ratio and size HUD, loupe color copy, annotation context menu, and
/// pinned floating windows.
public enum CaptureToolsStringKey: String, CaseIterable, ShellCatalogKey {
  // MARK: Toolbar & Pickers
  case pin = "capture.pin"
  case pinLabel = "capture.pin.label"
  case eyedropper = "capture.eyedropper"
  case colorWheel = "capture.color.wheel"
  case fontPicker = "capture.font.picker"

  // MARK: Color Popover
  case colorHex = "capture.color.hex"
  case colorOpacity = "capture.color.opacity"
  /// One `%lld`: slider percentage, e.g. `Opacity 85%`.
  case opacityPercent = "capture.opacity.value"
  case colorSystem = "capture.color.system"
  case colorPalette = "capture.color.palette"
  case colorRecent = "capture.color.recent"

  // MARK: Font Popover
  case fontTabCurated = "capture.font.tab.curated"
  case fontTabGoogle = "capture.font.tab.google"
  case fontTabLocal = "capture.font.tab.local"
  case fontTabRecent = "capture.font.tab.recent"
  case fontSearchPlaceholder = "capture.font.search"
  case fontSystemDefault = "capture.font.systemDefault"
  case fontSystemLabel = "capture.font.systemLabel"
  case fontBadgeSystem = "capture.font.badge.system"
  case fontBadgeLocal = "capture.font.badge.local"
  case fontEmptyRecent = "capture.font.emptyRecent"
  case fontSearchClear = "capture.font.searchClear"
  case fontEmptySearch = "capture.font.emptySearch"
  case fontCategorySans = "capture.font.category.sans"
  case fontCategorySerif = "capture.font.category.serif"
  case fontCategoryHandwriting = "capture.font.category.handwriting"
  case fontCategoryMono = "capture.font.category.mono"
  case fontCategoryCJK = "capture.font.category.cjk"
  /// One `%@`: typed custom font family query.
  case fontLoadCustomGoogle = "capture.font.loadCustomGoogle"

  // MARK: Style Controls
  case mosaicRegion = "capture.mosaic.region"
  case mosaicBrush = "capture.mosaic.brush"
  case fillOutline = "capture.fill.outline"
  case fillSoft = "capture.fill.soft"
  case fillSolid = "capture.fill.solid"
  case cornerSharp = "capture.corner.sharp"
  case cornerRounded = "capture.corner.rounded"
  case cornerRadius = "capture.corner.radius"
  /// One `%lld`: corner radius in points, e.g. `Radius 12 pt`.
  case cornerRadiusValue = "capture.corner.radiusValue"
  /// One `%lld`: compact corner radius badge, e.g. `12 pt`.
  case cornerRadiusShort = "capture.corner.radiusShort"
  case cornerSharpBadge = "capture.corner.sharpBadge"
  case captureCornerSection = "capture.corner.section"
  case arrowTapered = "capture.arrow.tapered"
  case arrowClassic = "capture.arrow.classic"
  case arrowDouble = "capture.arrow.double"
  case strokeDashed = "capture.stroke.dashed"
  case textPlateNone = "capture.textPlate.none"
  case textPlateSolid = "capture.textPlate.solid"
  case textPlateFrosted = "capture.textPlate.frosted"
  case textPlateOutlined = "capture.textPlate.outlined"
  case spotlightShape = "capture.spotlight.shape"
  case spotlightDim = "capture.spotlight.dim"
  case stepFormat = "capture.step.format"
  case stepStartDecrease = "capture.step.startDecrease"
  case stepStartIncrease = "capture.step.startIncrease"

  // MARK: Session Chrome, Loupe & Context Menu
  case aspectRatio = "capture.aspect.ratio"
  case aspectFree = "capture.aspect.free"
  case sizePrefix = "capture.size.prefix"
  case loupeCopied = "capture.loupe.copied"
  case loupeCopyColor = "capture.loupe.copyColor"
  case menuDuplicate = "capture.menu.duplicate"
  case menuCopyAnnotation = "capture.menu.copyAnnotation"
  case menuPasteAnnotation = "capture.menu.pasteAnnotation"
  case menuBringToFront = "capture.menu.bringToFront"
  case menuSendToBack = "capture.menu.sendToBack"
  case menuStraightenCurve = "capture.menu.straightenCurve"
  case menuDelete = "capture.menu.delete"
  case toastCopiedAnnotation = "capture.toast.copiedAnnotation"

  // MARK: Pinned Window
  case pinCopyImage = "capture.pin.copyImage"
  case pinCopyAccessibility = "capture.pin.copyAccessibility"
  case pinZoomTooltip = "capture.pin.zoomTooltip"
  case pinZoomAccessibility = "capture.pin.zoomAccessibility"
  case pinZoomPercent = "capture.pin.zoomPercent"
  case pinBorder = "capture.pin.border"
  case pinBorderTooltip = "capture.pin.borderTooltip"
  case pinBorderOn = "capture.pin.borderOn"
  case pinBorderOff = "capture.pin.borderOff"
  case pinShadow = "capture.pin.shadow"
  case pinShadowTooltip = "capture.pin.shadowTooltip"
  case pinShadowOn = "capture.pin.shadowOn"
  case pinShadowOff = "capture.pin.shadowOff"
  case pinCloseTooltip = "capture.pin.closeTooltip"
  case pinCloseAccessibility = "capture.pin.closeAccessibility"
  case pinOpacity = "capture.pin.opacity"
  case pinOpacityToggle = "capture.pin.opacityToggle"
}
