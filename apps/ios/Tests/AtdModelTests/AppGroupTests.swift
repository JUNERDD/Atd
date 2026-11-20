import Foundation
import Testing

@testable import AtdModel

@Suite struct AppGroupTests {
  @Test func notificationNameFollowsTheGroup() {
    #expect(
      AppGroup(identifier: "group.com.junerdd.atd").changeNotificationName
        == "com.junerdd.atd.library.changed")
    #expect(
      AppGroup(identifier: "group.com.junerdd.atd.dev").changeNotificationName
        == "com.junerdd.atd.dev.library.changed")
  }

  @Test func bundlesWithoutAGroupHaveNone() {
    // The test bundle's Info.plist names no App Group.
    #expect(AppGroup.current(bundle: Bundle(for: Marker.self)) == nil)
  }

  private final class Marker {}
}
