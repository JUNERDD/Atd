import AICore
import AIShell
import AppKit
import ApplicationServices
import WebKit

@MainActor
enum SelectionAXTextCases {
  static func run() async throws -> [String: String] {
    var results: [String: String] = [:]
    try await runNativeCases(into: &results)
    try await runWebCases(into: &results)
    return results
  }

  private static func runNativeCases(into results: inout [String: String]) async throws {
    let window = NSWindow(
      contentRect: CGRect(x: -2500, y: -2500, width: 420, height: 320),
      styleMask: [.titled], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    defer { window.close() }

    let content = NSView(frame: CGRect(x: 0, y: 0, width: 420, height: 320))
    let delegate = TokenDelegate()
    let tokenField = NSTokenField(frame: CGRect(x: 20, y: 240, width: 320, height: 32))
    tokenField.delegate = delegate
    tokenField.objectValue = [TokenChip("alice@example.com"), TokenChip("  "), "hello"]

    let textView = NSTextView(frame: CGRect(x: 20, y: 20, width: 320, height: 180))
    let imageAttachment = NSTextAttachment()
    imageAttachment.image = NSImage(size: NSSize(width: 24, height: 24))
    let wrapper = FileWrapper(regularFileWithContents: Data("abc".utf8))
    wrapper.preferredFilename = "note.txt"
    let fileAttachment = NSTextAttachment(fileWrapper: wrapper)
    let storage = NSMutableAttributedString(string: "ab")
    storage.append(NSAttributedString(attachment: imageAttachment))
    storage.append(NSAttributedString(attachment: fileAttachment))
    storage.append(NSAttributedString(string: "  cd"))
    textView.textStorage?.setAttributedString(storage)

    content.addSubview(tokenField)
    content.addSubview(textView)
    window.contentView = content
    window.makeKeyAndOrderFront(nil)

    window.makeFirstResponder(tokenField)
    if let editor = tokenField.currentEditor() as? NSTextView {
      editor.setSelectedRange(NSRange(location: 0, length: 1))
      try await waitFocusedSelection(location: 0, length: 1)
      results["nativeToken"] = await probeCurrent()
      editor.setSelectedRange(NSRange(location: 1, length: 1))
      try await waitFocusedSelection(location: 1, length: 1)
      results["nativeBlankToken"] = await probeCurrent()
    }

    window.makeFirstResponder(textView)
    let nativeSlices: [(String, NSRange)] = [
      ("nativeImageAttachment", NSRange(location: 2, length: 1)),
      ("nativeFileAttachment", NSRange(location: 3, length: 1)),
      ("nativeWhitespace", NSRange(location: 4, length: 2)),
      ("nativeAttachmentAndSpaces", NSRange(location: 2, length: 4)),
      ("nativeText", NSRange(location: 6, length: 2)),
    ]
    for (name, range) in nativeSlices {
      textView.setSelectedRange(range)
      try await waitFocusedSelection(location: range.location, length: range.length)
      results[name] = await probeCurrent()
    }
  }

  private static func runWebCases(into results: inout [String: String]) async throws {
    let window = NSWindow(
      contentRect: CGRect(x: -2500, y: -2500, width: 420, height: 360),
      styleMask: [.titled], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    defer { window.close() }

    let navigation = NavigationWaiter()
    let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 420, height: 360))
    webView.navigationDelegate = navigation
    window.contentView = webView
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(webView)
    webView.loadHTMLString(Self.html, baseURL: nil)
    try await navigation.wait()
    try await waitWebArea()

    let scripts: [(String, String, String)] = [
      (
        "webEditableWrappedImage", "#ce",
        "const ce=document.getElementById('ce'); ce.focus();"
          + "const r=document.createRange(); r.selectNode(document.getElementById('wImg'));"
          + "const s=getSelection(); s.removeAllRanges(); s.addRange(r);"
      ),
      (
        "webEditableMentionChip", "#ce",
        "const ce=document.getElementById('ce'); ce.focus();"
          + "const r=document.createRange(); r.selectNode(document.getElementById('wMention'));"
          + "const s=getSelection(); s.removeAllRanges(); s.addRange(r);"
      ),
      (
        "webTwoImages", "AXWebArea",
        "document.activeElement?.blur();"
          + "const r=document.createRange(); r.setStartBefore(document.getElementById('imA'));"
          + "r.setEndAfter(document.getElementById('imB'));"
          + "const s=getSelection(); s.removeAllRanges(); s.addRange(r);"
      ),
      (
        "webSpaceAndImage", "AXWebArea",
        "document.activeElement?.blur();"
          + "const p=document.getElementById('pSpace'); const r=document.createRange();"
          + "r.setStart(p.firstChild, 1); r.setEndAfter(document.getElementById('imSpace'));"
          + "const s=getSelection(); s.removeAllRanges(); s.addRange(r);"
      ),
      (
        "webInputWhitespace", "AXTextField",
        "const i=document.getElementById('in1'); i.focus(); i.setSelectionRange(0, 2);"
      ),
      (
        "webInputText", "AXTextField",
        "const i=document.getElementById('in1'); i.focus(); i.setSelectionRange(2, 5);"
      ),
      (
        "webRoleImgText", "AXWebArea",
        "document.activeElement?.blur();"
          + "const r=document.createRange(); r.selectNodeContents(document.getElementById('rImg'));"
          + "const s=getSelection(); s.removeAllRanges(); s.addRange(r);"
      ),
      (
        "webHiddenTextareaDomSelection", "#hta",
        "const h=document.getElementById('hta'); h.focus();"
          + "const r=document.createRange(); r.selectNodeContents(document.getElementById('domText'));"
          + "const s=getSelection(); s.removeAllRanges(); s.addRange(r);"
      ),
    ]
    for (name, selector, script) in scripts {
      _ = try await webView.evaluateJavaScript("(()=>{\(script); return 1;})()")
      try await Task.sleep(for: .milliseconds(80))
      results[name] = await probeWebTarget(selector)
    }
  }

  private static func probeCurrent() async -> String {
    let pid = getpid()
    return await Task.detached {
      SelectionAXFixture.kind(SelectionPresence(pid: pid).probe())
    }.value
  }

  private static func probeWebTarget(_ selector: String) async -> String {
    let pid = getpid()
    return await Task.detached {
      let app = AXUIElementCreateApplication(pid)
      AXUIElementSetMessagingTimeout(app, 0.1)
      let target =
        selector.hasPrefix("#")
        ? findElement(in: app, attribute: "AXDOMIdentifier", matching: String(selector.dropFirst()))
        : findElement(in: app, attribute: kAXRoleAttribute, matching: selector)
      guard let target else { return "missing" }
      let probe = SelectionTextProbe.probe(target, in: app) ?? .none
      return SelectionAXFixture.kind(probe)
    }.value
  }

  private static func waitWebArea() async throws {
    let pid = getpid()
    let deadline = ContinuousClock.now + .seconds(5)
    while ContinuousClock.now < deadline {
      let ready = await Task.detached {
        let app = AXUIElementCreateApplication(pid)
        return Self.findElement(in: app, attribute: kAXRoleAttribute, matching: "AXWebArea") != nil
      }.value
      if ready { return }
      try await Task.sleep(for: .milliseconds(25))
    }
    throw FixtureTimeout.webAreaNotReady
  }

  private nonisolated static func findElement(
    in root: AXUIElement, attribute targetAttribute: String, matching expected: String,
    depth: Int = 0
  ) -> AXUIElement? {
    guard depth <= 12 else { return nil }
    var valueRef: CFTypeRef?
    if AXUIElementCopyAttributeValue(root, targetAttribute as CFString, &valueRef) == .success,
      valueRef as? String == expected
    {
      return root
    }
    let attributes =
      depth == 0 ? [kAXWindowsAttribute, kAXChildrenAttribute] : [kAXChildrenAttribute]
    for attribute in attributes {
      var childrenRef: CFTypeRef?
      guard
        AXUIElementCopyAttributeValue(root, attribute as CFString, &childrenRef) == .success,
        let children = childrenRef as? [AXUIElement]
      else { continue }
      for child in children {
        if let match = findElement(
          in: child, attribute: targetAttribute, matching: expected, depth: depth + 1)
        {
          return match
        }
      }
    }
    return nil
  }

  private static func waitFocusedSelection(location: Int, length: Int) async throws {
    let pid = getpid()
    let deadline = ContinuousClock.now + .seconds(5)
    while ContinuousClock.now < deadline {
      let matched = await Task.detached {
        guard let range = Self.focusedSelectionRange(pid: pid) else { return false }
        return range.location == location && range.length == length
      }.value
      if matched { return }
      try await Task.sleep(for: .milliseconds(15))
    }
    throw FixtureTimeout.selectionNotReady
  }

  private nonisolated static func focusedSelectionRange(pid: pid_t) -> CFRange? {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.1)
    var focused: CFTypeRef?
    guard
      AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focused)
        == .success,
      let focused, CFGetTypeID(focused) == AXUIElementGetTypeID()
    else { return nil }
    var rangeValue: CFTypeRef?
    guard
      AXUIElementCopyAttributeValue(
        focused as! AXUIElement, kAXSelectedTextRangeAttribute as CFString, &rangeValue)
        == .success,
      let rangeValue, CFGetTypeID(rangeValue) == AXValueGetTypeID()
    else { return nil }
    var range = CFRange()
    return AXValueGetValue(rangeValue as! AXValue, .cfRange, &range) ? range : nil
  }

  private enum FixtureTimeout: Error { case selectionNotReady, webAreaNotReady }

  private static let pixel =
    "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="

  private static let html = """
    <!doctype html><html><body>
    <div id="ce" contenteditable="true">xy<span id="wImg" contenteditable="false"><img src="\(pixel)" width="12" height="12"></span><span id="wMention" contenteditable="false">@Alice</span>zw</div>
    <p>m<img id="imA" src="\(pixel)" width="12" height="12"><img id="imB" src="\(pixel)" width="12" height="12">n</p>
    <p id="pSpace">u <img id="imSpace" src="\(pixel)" width="12" height="12">v</p>
    <p><span id="rImg" role="img" aria-label="rocket">a</span></p>
    <textarea id="hta" style="width:1px;height:1px;opacity:0"></textarea>
    <div id="domText">selected terminal text</div>
    <input id="in1" value="  abc">
    </body></html>
    """
}

private final class TokenChip: NSObject {
  let label: String
  init(_ label: String) { self.label = label }
}

private final class TokenDelegate: NSObject, NSTokenFieldDelegate {
  func tokenField(
    _ tokenField: NSTokenField, displayStringForRepresentedObject representedObject: Any
  ) -> String? {
    (representedObject as? TokenChip)?.label ?? "\(representedObject)"
  }
}

@MainActor
private final class NavigationWaiter: NSObject, WKNavigationDelegate {
  private var finished = false

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    finished = true
  }

  func wait() async throws {
    let deadline = ContinuousClock.now + .seconds(10)
    while !finished {
      guard ContinuousClock.now < deadline else { throw CancellationError() }
      try await Task.sleep(for: .milliseconds(20))
    }
  }
}
