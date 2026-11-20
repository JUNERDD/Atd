import AtdAI
import Foundation
import ImageIO
import UIKit
import UniformTypeIdentifiers

/// Reads what the share sheet hands the extension (`NSExtensionContext.inputItems`) into one
/// `SharedContent`. The first usable item wins, in this order: a page Safari ran
/// `Share/SharePage.js` in, a web link (or text that is only a link), one image, text. It only
/// reads: nothing leaves the phone here.
///
/// `NSItemProvider` is not Sendable, so every load starts on the main actor and its callback hands
/// back only Sendable values. A shared file exists only during its callback, so an image is copied
/// out there and read from the copy.
struct SharedItemReader {
  /// The content, or nil when nothing shared is something Atd can read.
  func content(of items: [NSExtensionItem]) async -> SharedContent? {
    let providers = items.flatMap { $0.attachments ?? [] }
    for provider in providers {
      if let page = await safariPage(from: provider) { return .page(page) }
    }
    let texts = await self.texts(from: providers) + items.compactMap(Self.itemText)
    for provider in providers {
      if let url = await webLink(from: provider) {
        return .page(
          SharedPage(url: url, title: Self.title(of: items, texts: texts, url), text: nil))
      }
    }
    for provider in providers {
      if let image = await image(from: provider) { return .image(image) }
    }
    guard let text = texts.first else { return nil }
    if let url = Self.onlyLink(in: text) {
      return .page(SharedPage(url: url, title: Self.title(of: items, texts: [], url), text: nil))
    }
    return .text(text.capped)
  }

  // MARK: Safari pages

  private func safariPage(from provider: NSItemProvider) async -> SharedPage? {
    let type = UTType.propertyList.identifier
    guard provider.hasItemConformingToTypeIdentifier(type) else { return nil }
    let results = await withCheckedContinuation { continuation in
      provider.loadItem(forTypeIdentifier: type, options: nil) { item, _ in
        continuation.resume(returning: Self.preprocessingResults(item))
      }
    }
    return results.flatMap { Self.page(from: $0) }
  }

  /// What `SharePage.js` handed Safari's `completionFunction`, as strings.
  nonisolated static func preprocessingResults(_ item: (any NSSecureCoding)?) -> [String: String]? {
    guard let plist = (item as? NSDictionary) as? [String: Any],
      let results = plist[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any]
    else { return nil }
    return results.compactMapValues { $0 as? String }
  }

  /// The page those results describe, when it is a web page.
  nonisolated static func page(from results: [String: String]) -> SharedPage? {
    guard let url = results["url"].flatMap(URL.init(string:)), url.isWeb else { return nil }
    return SharedPage(url: url, preprocessed: results)
  }

  // MARK: Links and text

  private func webLink(from provider: NSItemProvider) async -> URL? {
    guard provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
      let url = await object(URL.self, from: provider), url.isWeb
    else { return nil }
    return url
  }

  /// The shared texts, leaving out a link's own address as text.
  private func texts(from providers: [NSItemProvider]) async -> [String] {
    var texts: [String] = []
    for provider in providers
    where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
      && !provider.hasItemConformingToTypeIdentifier(UTType.url.identifier)
    {
      if let text = await object(String.self, from: provider), !text.trimmed.isEmpty {
        texts.append(text)
      }
    }
    return texts
  }

  /// Text an app put in the item itself rather than in an attachment.
  private static func itemText(_ item: NSExtensionItem) -> String? {
    let text = item.attributedContentText?.string
    return text?.trimmed.isEmpty == false ? text : nil
  }

  /// A link's title: the item's own, or a line of shared text that is not the link itself.
  private static func title(of items: [NSExtensionItem], texts: [String], _ url: URL) -> String? {
    let candidates = items.compactMap { $0.attributedTitle?.string } + texts
    return candidates.lazy.compactMap(\.oneLine).first { onlyLink(in: $0) != url }
  }

  /// The web address `text` consists of, if it is nothing else.
  nonisolated static func onlyLink(in text: String) -> URL? {
    let text = text.trimmed
    guard !text.isEmpty, !text.contains(where: \.isWhitespace),
      let url = URL(string: text), url.isWeb, url.host() != nil
    else { return nil }
    return url
  }

  private func object<T: _ObjectiveCBridgeable & Sendable>(
    _ type: T.Type, from provider: NSItemProvider
  ) async -> T? where T._ObjectiveCType: NSItemProviderReading {
    guard provider.canLoadObject(ofClass: type) else { return nil }
    return await withCheckedContinuation { continuation in
      _ = provider.loadObject(ofClass: type) { object, _ in
        continuation.resume(returning: object)
      }
    }
  }

  // MARK: Images

  private func image(from provider: NSItemProvider) async -> SharedImage? {
    guard let type = provider.registeredContentTypes(conformingTo: .image).first else {
      return nil
    }
    let name = provider.suggestedName.map { ($0 as NSString).deletingPathExtension }
    let copy = await withCheckedContinuation { continuation in
      _ = provider.loadFileRepresentation(for: type, openInPlace: false) { url, _, _ in
        continuation.resume(returning: url.flatMap { Self.temporaryCopy(of: $0) })
      }
    }
    guard let copy else { return nil }
    defer { try? FileManager.default.removeItem(at: copy) }
    // Mapped rather than read, so a large photo is never held in memory twice.
    guard let data = try? Data(contentsOf: copy, options: .alwaysMapped),
      let image = await ImageEncoding.modelImage(from: data)
    else { return nil }
    return SharedImage(
      name: name?.oneLine, image: image, preview: await Self.preview(of: image.data))
  }

  nonisolated private static func temporaryCopy(of url: URL) -> URL? {
    let copy = URL.temporaryDirectory.appending(
      path: "shared-\(UUID().uuidString).\(url.pathExtension)", directoryHint: .notDirectory)
    return (try? FileManager.default.copyItem(at: url, to: copy)) != nil ? copy : nil
  }

  /// A copy small enough for the preview row's thumbnail at any screen scale.
  @concurrent
  nonisolated static func preview(of data: Data, maxPixels: Int = 480) async -> UIImage? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixels,
    ]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
      .map(UIImage.init(cgImage:))
  }
}

extension URL {
  /// An http or https address: what Atd opens as a page. Files and app links are not pages.
  nonisolated var isWeb: Bool {
    ["http", "https"].contains(scheme?.lowercased())
  }
}
