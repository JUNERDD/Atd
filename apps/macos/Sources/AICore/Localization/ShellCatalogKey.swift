/// A key enum of the App target's String Catalog whose overloads need no line of their own in
/// `ShellStrings`: the long screenshot's key enums adopt it (each feature owns its enum's file).
/// Every key still has to be listed in `ShellLocalizationTests` with both languages translated.
public protocol ShellCatalogKey: RawRepresentable, Sendable where RawValue == String {}
