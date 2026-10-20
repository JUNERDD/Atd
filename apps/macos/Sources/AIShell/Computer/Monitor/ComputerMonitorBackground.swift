import AppKit

/// The monitor window's background: the titled-window material (``NativeMaterialView`` `.window`,
/// Liquid Glass on macOS 26, the behind-window material on macOS 15), laid out as
/// ``GlassBackground`` lays it, but standing on the shell's base surface fill
/// (``GlassSurface/fill(reduceTransparency:)``) like the main panel, so the pictures, captions and
/// status text stay readable over any desktop. The window's corners, edge and shadow stay the
/// material's and the system's; nothing here rounds or outlines.
///
/// The fill lies on one plain wrapper inside the material: on macOS 26 the rim clip
/// (``GlassRimClipView``), whose mask keeps the fill off the glass's rim and inside the window's
/// corners; on macOS 15 a plain view, inside the corners the system rounds. ``GlassSurface``
/// pins the material to the app's scheme with its adaptation off and repaints the fill when the
/// scheme changes; Reduce Transparency, which the scheme owner does not report, repaints it
/// through ``ReduceTransparencyObserver``.
final class ComputerMonitorBackground {
  /// The window's content view.
  let view: NSView
  private var reduceTransparency: ReduceTransparencyObserver?

  init(content: NSView) {
    let material = NativeMaterialView(.window)
    let surface: NSView
    if #available(macOS 26, *) {
      surface = GlassRimClipView(content: content)
    } else {
      surface = NSView()
      content.frame = surface.bounds
      content.autoresizingMask = [.width, .height]
      surface.addSubview(content)
    }
    GlassSurface.attach(material, content: surface)
    view = material.view
    reduceTransparency = ReduceTransparencyObserver { [weak surface] reduce in
      surface?.layer?.backgroundColor = GlassSurface.fill(reduceTransparency: reduce).cgColor
    }
  }

  isolated deinit { reduceTransparency?.stop() }
}
