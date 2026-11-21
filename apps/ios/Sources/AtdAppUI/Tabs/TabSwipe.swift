import UIKit

/// Swiping a page sideways to the tab beside it. The pages lie side by side in bar order: the page
/// follows the finger, its neighbor comes in from the edge, and on release the pages settle where
/// the swipe's momentum would carry them: onto the neighbor past halfway, back otherwise. Toward a
/// side with no tab, the page gives a little and springs back, as a scroll view does at its end;
/// 问 Atd opens the panel rather than showing a page, so the last tab has no page after it.
///
/// The swipe belongs to the page itself. A touch on the tab bar keeps the bar's own press and
/// slide; a pushed page keeps the back swipe, since only a tab's first page swipes; a mostly
/// vertical drag scrolls; and content that scrolls sideways keeps its sideways swipes. A sideways
/// swipe the page takes never reaches a row under the finger as a tap.
final class TabSwipe: NSObject, UIGestureRecognizerDelegate {
  private unowned let controller: AppTabBarController
  /// The slide the swipe in progress drives; nil between swipes.
  private(set) var transition: TabSlideTransition?
  /// The page a swipe toward a side with no tab pulls on; nil otherwise.
  private var pulled: UIView?

  init(controller: AppTabBarController) {
    self.controller = controller
  }

  var isSwiping: Bool { transition != nil }

  func attach(to view: UIView) {
    let pan = UIPanGestureRecognizer(target: self, action: #selector(panned(_:)))
    pan.delegate = self
    view.addGestureRecognizer(pan)
  }

  func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
    guard let pan = gesture as? UIPanGestureRecognizer, let view = pan.view else { return false }
    // Velocity rather than translation says where the finger is going: UIKit may already have
    // taken the slack it needed to recognize the pan out of the translation.
    let velocity = pan.velocity(in: view)
    guard abs(velocity.x) > abs(velocity.y) else { return false }
    // A sideways swipe while the last slide is still settling takes over from it, as a quick run
    // of flicks expects: the slide ends at once where it was going.
    transition?.settleNow()
    guard transition == nil, controller.transitionCoordinator == nil,
      let page = controller.selectedViewController, page.showsFirstPage
    else { return false }
    let moved = pan.translation(in: view)
    let location = pan.location(in: view)
    let start = CGPoint(x: location.x - moved.x, y: location.y - moved.y)
    let bar = controller.tabBar
    if !bar.isHidden, bar.bounds.contains(view.convert(start, to: bar)) { return false }
    return !scrollsSideways(at: view.hitTest(start, with: nil), within: page.view)
  }

  /// A scroll view that only scrolls vertically waits until the swipe has failed, so a sideways
  /// drag never scrolls the page as well. One that scrolls sideways never waits: the swipe does
  /// not start on it.
  func gestureRecognizer(
    _ gesture: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer
  ) -> Bool {
    guard let scroller = other.view as? UIScrollView else { return false }
    return other === scroller.panGestureRecognizer && !scroller.scrollsSideways
  }

  @objc private func panned(_ pan: UIPanGestureRecognizer) {
    guard let view = pan.view else { return }
    let width = max(view.bounds.width, 1)
    let moved = pan.translation(in: view).x
    switch pan.state {
    case .began:
      began(toward: pan.velocity(in: view).x, moved: moved, width: width)
    case .changed:
      if let pulled {
        pulled.transform = CGAffineTransform(translationX: Self.give(moved, width: width), y: 0)
      } else if let transition {
        transition.update(progress: moved * transition.direction / width)
      }
    case .ended:
      letGo()
      guard let transition else { return }
      let speed = pan.velocity(in: view).x * transition.direction
      let landing = moved * transition.direction + Self.glide(speed)
      transition.release(landing: landing > width / 2, speed: speed)
    case .cancelled, .failed:
      letGo()
      transition?.release(landing: false, speed: 0)
    default:
      break
    }
  }

  /// Starts sliding toward the neighbor the finger is heading for (the pan's translation starts
  /// over here, so its velocity says which way), or pulling on the page when there is none.
  private func began(toward: CGFloat, moved: CGFloat, width: CGFloat) {
    guard let target = neighbor(toward: toward) else {
      pulled = controller.selectedViewController?.view
      return
    }
    let slide = TabSlideTransition(direction: toward < 0 ? -1 : 1) { [weak self] in
      self?.ended()
    }
    transition = slide
    slide.update(progress: moved * slide.direction / width)
    controller.selectedTab = target
    // UIKit starts the slide as it selects; a selection made without one has already landed.
    if !slide.hasStarted, controller.transitionCoordinator == nil { ended() }
  }

  /// Springs a pulled page back into place.
  private func letGo() {
    guard let pulled else { return }
    self.pulled = nil
    UIView.animate(springDuration: 0.35, bounce: 0) { pulled.transform = .identity }
  }

  private func ended() {
    transition = nil
    // A cancelled slide puts the page and the bar back but leaves `selectedTab` on the tab the
    // slide was heading for, so the tab whose page shows is selected again.
    let shown = controller.pageTabs.first {
      $0.viewController === controller.selectedViewController
    }
    if let shown, shown !== controller.selectedTab { controller.selectedTab = shown }
    controller.reportSelection()
  }

  /// The tab whose page a finger moving by `dx` brings in: the next tab's page comes in from the
  /// right, or from the left in a right-to-left layout, where the bar runs the other way.
  private func neighbor(toward dx: CGFloat) -> UITab? {
    let tabs = controller.pageTabs
    guard dx != 0, let current = controller.selectedTab,
      let index = tabs.firstIndex(where: { $0 === current })
    else { return nil }
    let rightToLeft = controller.view.effectiveUserInterfaceLayoutDirection == .rightToLeft
    let target = index + ((dx < 0) != rightToLeft ? 1 : -1)
    return tabs.indices.contains(target) ? tabs[target] : nil
  }

  /// Whether the touched view, or a view it sits in inside the page, scrolls sideways.
  private func scrollsSideways(at touched: UIView?, within page: UIView?) -> Bool {
    var view = touched
    while let current = view, current !== page {
      if let scroller = current as? UIScrollView, scroller.scrollsSideways { return true }
      view = current.superview
    }
    return false
  }

  /// How much farther a release at `speed` points per second carries, decelerating as a scroll view
  /// does.
  private static func glide(_ speed: CGFloat) -> CGFloat {
    let rate = UIScrollView.DecelerationRate.normal.rawValue
    return speed / 1000 * rate / (1 - rate)
  }

  /// How far a page pulled `moved` points toward a side with no tab gives: less the farther it is
  /// pulled, never past `width`, as a scroll view stretches past its end.
  private static func give(_ moved: CGFloat, width: CGFloat) -> CGFloat {
    let stretch = (1 - 1 / (abs(moved) * 0.55 / width + 1)) * width
    return moved < 0 ? -stretch : stretch
  }
}

extension UIScrollView {
  /// Whether its content scrolls sideways. A point of slack absorbs rounding between the content
  /// and the view.
  fileprivate var scrollsSideways: Bool {
    let content = contentSize.width + adjustedContentInset.left + adjustedContentInset.right
    return isScrollEnabled && (alwaysBounceHorizontal || content > bounds.width + 1)
  }
}
