import AICore
import AppKit
import ApplicationServices

/// An allow-list of window-system facts. Never reads window titles, AX text, URLs or key input.
enum FocusDiagnosticSnapshot {
  static func rect(_ rect: CGRect) -> JSONValue {
    .array([rect.origin.x, rect.origin.y, rect.width, rect.height].map { .number(Double($0)) })
  }

  static func application(_ app: NSRunningApplication?) -> JSONValue {
    guard let app else { return .null }
    return .object([
      "pid": .number(Double(app.processIdentifier)),
      "bundleId": app.bundleIdentifier.map(JSONValue.string) ?? .null,
      "active": .bool(app.isActive), "hidden": .bool(app.isHidden),
      "activationPolicy": .number(Double(app.activationPolicy.rawValue)),
    ])
  }

  static func read(system: Bool) -> JSONValue {
    let mouse = NSEvent.mouseLocation
    var result: [String: JSONValue] = [
      "appActive": .bool(NSApp.isActive), "appHidden": .bool(NSApp.isHidden),
      "activationPolicy": .number(Double(NSApp.activationPolicy().rawValue)),
      "frontmost": application(NSWorkspace.shared.frontmostApplication),
      "keyWindow": NSApp.keyWindow.map { .number(Double($0.windowNumber)) } ?? .null,
      "mainWindow": NSApp.mainWindow.map { .number(Double($0.windowNumber)) } ?? .null,
      "modalWindow": NSApp.modalWindow.map { .number(Double($0.windowNumber)) } ?? .null,
      "cocoaPointer": .array([.number(mouse.x), .number(mouse.y)]),
      "windowAtPointer": .number(
        Double(NSWindow.windowNumber(at: mouse, belowWindowWithWindowNumber: 0))),
      "windows": .array(NSApp.windows.prefix(24).map(window)),
    ]
    if system {
      result["windowServer"] = windowServer(mouse: mouse)
      result["axFocus"] = accessibilityFocus()
    }
    return .object(result)
  }

  private static func window(_ window: NSWindow) -> JSONValue {
    let point = window.convertPoint(fromScreen: NSEvent.mouseLocation)
    let hit = window.contentView.flatMap { view in
      // AppKit hitTest takes coordinates in the receiver's superview.
      view.hitTest(view.superview?.convert(point, from: nil) ?? point)
    }
    var values: [String: JSONValue] = [
      "number": .number(Double(window.windowNumber)),
      "class": .string(NSStringFromClass(type(of: window))),
      "frame": rect(window.frame), "level": .number(Double(window.level.rawValue)),
      "styleMask": .number(Double(window.styleMask.rawValue)),
      "collectionBehavior": .number(Double(window.collectionBehavior.rawValue)),
      "visible": .bool(window.isVisible), "onActiveSpace": .bool(window.isOnActiveSpace),
      "occlusionVisible": .bool(window.occlusionState.contains(.visible)),
      "alpha": .number(window.alphaValue), "ignoresMouse": .bool(window.ignoresMouseEvents),
      "key": .bool(window.isKeyWindow), "main": .bool(window.isMainWindow),
      "canBecomeKey": .bool(window.canBecomeKey), "canBecomeMain": .bool(window.canBecomeMain),
      "miniaturized": .bool(window.isMiniaturized),
      "hidesOnDeactivate": .bool(window.hidesOnDeactivate),
      "firstResponderClass": window.firstResponder.map { .string(NSStringFromClass(type(of: $0))) }
        ?? .null,
      "hitViewClass": hit.map { .string(NSStringFromClass(type(of: $0))) } ?? .null,
    ]
    if let panel = window as? NSPanel {
      values["floating"] = .bool(panel.isFloatingPanel)
      values["becomesKeyOnlyIfNeeded"] = .bool(panel.becomesKeyOnlyIfNeeded)
    }
    if let panel = window as? ShellPanel {
      values["nativeClickActivation"] = .bool(panel.nativeClickActivation)
    }
    return .object(values)
  }

  private static func accessibilityFocus() -> JSONValue {
    guard AXIsProcessTrusted() else { return .object(["status": .string("notTrusted")]) }
    let system = AXUIElementCreateSystemWide()
    AXUIElementSetMessagingTimeout(system, 0.05)
    var value: CFTypeRef?
    let status = AXUIElementCopyAttributeValue(
      system, kAXFocusedApplicationAttribute as CFString, &value)
    var result: [String: JSONValue] = ["status": .number(Double(status.rawValue))]
    if status == .success, let value, CFGetTypeID(value) == AXUIElementGetTypeID() {
      // The CF type ID check establishes the opaque AX element contract.
      let app = unsafeDowncast(value, to: AXUIElement.self)
      var pid: pid_t = 0
      result["pidStatus"] = .number(Double(AXUIElementGetPid(app, &pid).rawValue))
      result["application"] = application(NSRunningApplication(processIdentifier: pid))
    }
    return .object(result)
  }

  private static func windowServer(mouse: NSPoint) -> JSONValue {
    guard
      let list = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]]
    else { return .object(["available": .bool(false)]) }
    let primaryTop = NSScreen.screens.first?.frame.maxY ?? 0
    let quartzPoint = CGPoint(x: mouse.x, y: primaryTop - mouse.y)
    let ownPID = ProcessInfo.processInfo.processIdentifier
    var windows: [JSONValue] = []
    var matching = 0
    for (order, item) in list.enumerated() {
      guard let pid = item[kCGWindowOwnerPID as String] as? Int32,
        let number = item[kCGWindowNumber as String] as? Int,
        let bounds = item[kCGWindowBounds as String] as? [String: CGFloat],
        let x = bounds["X"], let y = bounds["Y"], let width = bounds["Width"],
        let height = bounds["Height"]
      else { continue }
      let frame = CGRect(x: x, y: y, width: width, height: height)
      let app = NSRunningApplication(processIdentifier: pid)
      let bundle = app?.bundleIdentifier ?? ""
      let owner = item[kCGWindowOwnerName as String] as? String ?? ""
      let system =
        bundle.hasPrefix("com.apple.Spotlight") || bundle == "com.apple.dock"
        || bundle == "com.apple.controlcenter" || bundle == "com.apple.WindowManager"
        || owner == "Spotlight" || owner == "Dock" || owner == "WindowManager"
      let onScreen = item[kCGWindowIsOnscreen as String] as? Bool ?? false
      // Include every visible owner: a new OS can move the Apps surface to another process.
      guard pid == ownPID || system || onScreen else { continue }
      matching += 1
      guard windows.count < 64 else { continue }
      windows.append(
        .object([
          "number": .number(Double(number)), "pid": .number(Double(pid)),
          "order": .number(Double(order)),
          "bundleId": app?.bundleIdentifier.map(JSONValue.string) ?? .null,
          "systemSurface": .bool(system), "onScreen": .bool(onScreen), "bounds": rect(frame),
          "layer": .number(Double(item[kCGWindowLayer as String] as? Int ?? 0)),
          "alpha": .number(item[kCGWindowAlpha as String] as? Double ?? 1),
          "containsPointer": .bool(frame.contains(quartzPoint)),
        ]))
    }
    return .object([
      "available": .bool(true), "coordinateSystem": .string("quartz-top-left"),
      "matchingCount": .number(Double(matching)), "windows": .array(windows),
    ])
  }

}
