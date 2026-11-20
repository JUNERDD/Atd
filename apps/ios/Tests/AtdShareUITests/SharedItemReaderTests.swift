import AtdAI
import Foundation
import ImageIO
import Testing
import UIKit
import UniformTypeIdentifiers

@testable import AtdShareUI

/// What the share sheet makes of the items other apps hand it, built the way those apps build
/// them (real `NSItemProvider`s).
@MainActor @Suite struct SharedItemReaderTests {
  private func read(_ items: [NSExtensionItem]) async -> SharedContent? {
    await SharedItemReader().content(of: items)
  }

  private func item(_ providers: [NSItemProvider], title: String? = nil, text: String? = nil)
    -> NSExtensionItem
  {
    let item = NSExtensionItem()
    item.attachments = providers
    item.attributedTitle = title.map { NSAttributedString(string: $0) }
    item.attributedContentText = text.map { NSAttributedString(string: $0) }
    return item
  }

  @Test func sharedTextIsText() async {
    let content = await read([item([NSItemProvider(object: "明天下午三点开会" as NSString)])])
    #expect(content == .text("明天下午三点开会"))
  }

  @Test func textThatIsOnlyALinkIsAPageToRead() async throws {
    let link = " https://dushu.example.cn/nov \n"
    let content = await read([item([NSItemProvider(object: link as NSString)])])
    let url = try #require(URL(string: "https://dushu.example.cn/nov"))
    #expect(content == .page(SharedPage(url: url, title: nil, text: nil)))
  }

  @Test func aLinkTakesItsTitleFromTheItem() async throws {
    let url = try #require(URL(string: "https://dushu.example.cn/nov"))
    let content = await read([
      item([NSItemProvider(object: url as NSURL)], text: "城市读书会 · 11 月共读")
    ])
    #expect(content == .page(SharedPage(url: url, title: "城市读书会 · 11 月共读", text: nil)))
  }

  @Test func aFileIsNoPage() async throws {
    let file = URL.temporaryDirectory.appending(path: "notes.txt")
    let content = await read([
      item([NSItemProvider(object: file as NSURL), NSItemProvider(object: "备忘" as NSString)])
    ])
    #expect(content == .text("备忘"))
  }

  /// Safari hands over what `SharePage.js` read; a selection stands for the whole page.
  @Test func safarisPageComesWithItsText() async throws {
    let url = "https://dushu.example.cn/nov"
    let page = await read([item([Self.preprocessed(["url": url, "title": "共读", "text": "正文"])])])
    #expect(page == .page(SharedPage(url: URL(string: url)!, title: "共读", text: "正文")))

    let selected = await read([
      item([Self.preprocessed(["url": url, "title": "共读", "text": "正文", "selection": "选中"])])
    ])
    #expect(selected == .page(SharedPage(url: URL(string: url)!, title: "共读", text: "选中")))
  }

  @Test func longTextIsCutOff() async {
    let long = String(repeating: "读", count: SharedContent.textLimit + 500)
    let content = await read([item([NSItemProvider(object: long as NSString)])])
    #expect(content?.text.count == SharedContent.textLimit)
  }

  /// A large photo arrives as a JPEG at most 1568 px long, with a small preview.
  @Test func anImageIsMadeSmallForTheModel() async throws {
    let file = try Self.jpeg(width: 4032, height: 3024)
    let provider = try #require(NSItemProvider(contentsOf: file))
    provider.suggestedName = "IMG_0042.JPG"
    guard case .image(let image) = await read([item([provider])]) else {
      Issue.record("not read as an image")
      return
    }
    #expect(image.name == "IMG_0042")
    #expect(image.image.mediaType == "image/jpeg")
    let size = try #require(Self.size(of: image.image.data))
    #expect(max(size.width, size.height) == 1568)
    #expect(max(image.preview?.size.width ?? 0, image.preview?.size.height ?? 0) <= 480)
  }

  @Test func nothingReadableIsNothing() async {
    #expect(await read([]) == nil)
    #expect(await read([item([])]) == nil)
  }

  // MARK: Fixtures

  /// An attachment like Safari's: the property list `SharePage.js` produced.
  private static func preprocessed(_ results: [String: String]) -> NSItemProvider {
    let plist = [NSExtensionJavaScriptPreprocessingResultsKey: results] as NSDictionary
    return NSItemProvider(item: plist, typeIdentifier: UTType.propertyList.identifier)
  }

  private static func jpeg(width: Int, height: Int) throws -> URL {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let image = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format)
      .image { context in
        UIColor.systemTeal.setFill()
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
      }
    let url = URL.temporaryDirectory.appending(path: "share-\(UUID().uuidString).jpg")
    try #require(image.jpegData(compressionQuality: 0.8)).write(to: url)
    return url
  }

  private static func size(of data: Data) -> CGSize? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int
    else { return nil }
    return CGSize(width: width, height: height)
  }
}
