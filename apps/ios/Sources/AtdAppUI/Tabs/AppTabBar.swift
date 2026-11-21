import AtdInk
import SwiftUI
import UIKit

/// The four tabs' pages under the system tab bar, with the round 问 Atd button at the bar's
/// trailing end. A `UITabBarController` draws the same Liquid Glass bar SwiftUI's `TabView` does and,
/// unlike `TabView`, lets a swipe move between neighboring pages (`TabSwipe`). Picking 问 Atd calls
/// `ask` and leaves the current page showing.
///
/// Each page is hosted on its own, so SwiftUI's environment stops at the bar: the page root
/// (`TabPageRoot`) brings what the pages read from the app (the store, the scene's phase) and the
/// ink tint.
struct AppTabBar<Page: View>: UIViewControllerRepresentable {
  @Binding var selection: AppTab
  let ask: () -> Void
  @ViewBuilder let page: (AppTab) -> Page
  @Environment(AppStore.self) private var store
  @Environment(\.scenePhase) private var scenePhase

  func makeCoordinator() -> TabPageEnvironment {
    TabPageEnvironment()
  }

  func makeUIViewController(context: Context) -> AppTabBarController {
    let environment = context.coordinator
    let pages = AppTab.allCases.map { tab in
      let root = TabPageRoot(store: store, environment: environment) { page(tab) }
      return (tab, UIHostingController(rootView: root) as UIViewController)
    }
    return AppTabBarController(pages: pages)
  }

  func updateUIViewController(_ controller: AppTabBarController, context: Context) {
    context.coordinator.scenePhase = scenePhase
    controller.onSelect = { selection = $0 }
    controller.onAsk = ask
    controller.show(selection)
  }
}

/// What the hosted pages see of the app's environment beyond the store, kept current by `AppTabBar`.
@Observable
final class TabPageEnvironment {
  var scenePhase = ScenePhase.active
}

/// A hosted page's root: the page with the store, the scene's phase and the ink tint it had under
/// SwiftUI's `TabView`.
private struct TabPageRoot<Content: View>: View {
  let store: AppStore
  let environment: TabPageEnvironment
  @ViewBuilder let content: Content

  var body: some View {
    content
      .environment(store)
      .environment(\.scenePhase, environment.scenePhase)
      .tint(.primary)
  }
}

/// The tab bar controller behind `AppTabBar`. Taps, links and swipes all select through it; it
/// reports each selection the person makes, by tap or by swipe, through `onSelect`.
final class AppTabBarController: UITabBarController, UITabBarControllerDelegate {
  var onSelect: (AppTab) -> Void = { _ in }
  var onAsk: () -> Void = {}
  /// The pages' tabs in bar order. 问 Atd, the search tab after them, opens the panel rather than
  /// showing a page.
  let pageTabs: [UITab]
  private lazy var swipe = TabSwipe(controller: self)

  init(pages: [(AppTab, UIViewController)]) {
    pageTabs = pages.map { tab, page in
      UITab(title: tab.title, image: Lucide.image(tab.glyph), identifier: tab.rawValue) { _ in
        page
      }
    }
    super.init(nibName: nil, bundle: nil)
    let ask = UISearchTab { _ in UIViewController() }
    ask.title = AppText.string("tab.ask")
    ask.image = InkArt.markImage(side: 24)
    tabs = pageTabs + [ask]
    delegate = self
    tabBar.tintColor = .label
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("AppTabBarController is created in code.")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    // The paper behind the pages, which shows where a swipe pulls a page past the last tab.
    view.backgroundColor = InkColor.paperUIColor
    swipe.attach(to: view)
  }

  /// Shows `tab`'s page, unless it already shows or a swipe is moving between pages.
  func show(_ tab: AppTab) {
    guard selectedTab?.identifier != tab.rawValue, transitionCoordinator == nil,
      !swipe.isSwiping
    else { return }
    selectedTab = self.tab(forIdentifier: tab.rawValue)
  }

  /// Tells `onSelect` which page shows now.
  func reportSelection() {
    if let id = selectedTab?.identifier, let tab = AppTab(rawValue: id) { onSelect(tab) }
  }

  func tabBarController(_ controller: UITabBarController, shouldSelectTab tab: UITab) -> Bool {
    if tab is UISearchTab {
      onAsk()
      return false
    }
    return !swipe.isSwiping
  }

  /// Picking the tab that already shows takes its page back to its first page, as `TabView` does.
  func tabBarController(
    _ controller: UITabBarController, didSelectTab selected: UITab, previousTab: UITab?
  ) {
    if selected === previousTab, let page = selectedViewController {
      for stack in page.navigationStacks { stack.popToRootViewController(animated: true) }
    }
    reportSelection()
  }

  func tabBarController(
    _ controller: UITabBarController, animationControllerForTransitionFrom from: UIViewController,
    to: UIViewController
  ) -> (any UIViewControllerAnimatedTransitioning)? {
    swipe.transition
  }

  func tabBarController(
    _ controller: UITabBarController,
    interactionControllerFor animation: any UIViewControllerAnimatedTransitioning
  ) -> (any UIViewControllerInteractiveTransitioning)? {
    animation as? TabSlideTransition
  }
}

extension AppTab {
  fileprivate var title: String {
    switch self {
    case .commands: AppText.string("tab.commands")
    case .miniApps: AppText.string("tab.miniApps")
    case .automations: AppText.string("tab.automations")
    case .me: AppText.string("tab.me")
    }
  }

  /// The tab's icon: the prototype's Lucide line glyph, a template image the bar tints. No SF
  /// Symbol has these shapes, and the bar draws symbols filled.
  fileprivate var glyph: String {
    switch self {
    case .commands: "wand-sparkles"
    case .miniApps: "shapes"
    case .automations: "workflow"
    case .me: "circle-user"
    }
  }
}

extension UIViewController {
  /// The navigation stacks this controller shows, itself included. A page's SwiftUI
  /// `NavigationStack` is one, a child of the page's hosting controller.
  var navigationStacks: [UINavigationController] {
    let own = (self as? UINavigationController).map { [$0] } ?? []
    return own + children.flatMap(\.navigationStacks)
  }

  /// Whether every navigation stack in this controller shows its first page.
  var showsFirstPage: Bool {
    navigationStacks.allSatisfy { $0.viewControllers.count <= 1 }
  }
}
