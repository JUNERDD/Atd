import Foundation
import Testing

@testable import AtdAI

@Suite struct ModelFailureTests {
  @Test(arguments: [
    (401, ModelFailure.invalidKey),
    (403, .invalidKey),
    (402, .rateLimited(retryAfter: nil)),
    (404, .notFound),
    (408, .timedOut),
    (413, .rejected(detail: nil)),
    (422, .rejected(detail: nil)),
    (500, .server(status: 500)),
    (529, .server(status: 529)),
  ])
  func statusesMap(status: Int, failure: ModelFailure) {
    #expect(ModelFailure.status(status) == failure)
  }

  @Test func rateLimitsKeepTheirWait() {
    #expect(
      ModelFailure.status(429, retryAfter: .seconds(2)) == .rateLimited(retryAfter: .seconds(2)))
  }

  @Test(arguments: [
    (URLError.Code.notConnectedToInternet, ModelFailure.offline),
    (.networkConnectionLost, .offline),
    (.cannotFindHost, .offline),
    (.secureConnectionFailed, .offline),
    (.timedOut, .timedOut),
  ])
  func networkErrorsMap(code: URLError.Code, failure: ModelFailure) {
    #expect(ModelFailure.from(URLError(code)) as? ModelFailure == failure)
  }

  @Test func cancellationIsNotAFailure() {
    #expect(ModelFailure.from(URLError(.cancelled)) is CancellationError)
    #expect(ModelFailure.from(CancellationError()) is CancellationError)
  }

  @Test func malformedResponsesAreUnreadable() {
    guard case .unreadable = ModelFailure.from(URLError(.badServerResponse)) as? ModelFailure else {
      Issue.record("expected unreadable")
      return
    }
  }

  @Test func everyFailureHasAMessage() {
    let failures: [ModelFailure] = [
      .noModel, .offline, .timedOut, .invalidKey, .rateLimited(retryAfter: nil),
      .rateLimited(retryAfter: .seconds(12)), .server(status: 500), .refused, .notFound,
      .rejected(detail: nil), .truncated, .unreadable(detail: nil),
    ]
    for failure in failures {
      #expect(!failure.message.isEmpty, "\(failure)")
      #expect(!failure.message.contains("failure."), "\(failure) has no translation")
    }
    #expect(ModelFailure.rateLimited(retryAfter: .seconds(12)).message.contains("12"))
    #expect(ModelFailure.offline.message == ModelFailure.timedOut.message)
  }

  @Test func onlyTransientFailuresOfferARetry() {
    #expect(ModelFailure.offline.canRetry && ModelFailure.server(status: 500).canRetry)
    #expect(!ModelFailure.invalidKey.canRetry && !ModelFailure.refused.canRetry)
  }
}
