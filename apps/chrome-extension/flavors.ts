/**
 * The extension's two flavors (one source, two builds). Each pairs with one Atd build: the Debug
 * app installs the `dev` native host and accepts only the dev extension ID, the Release app the
 * `release` ones. The manifest `key` (public half, base64 DER) fixes the extension ID, so an
 * unpacked load keeps it; the private halves were discarded and are never in the repository.
 */
export type Flavor = 'release' | 'dev';

export interface FlavorIdentity {
  /** `_locales` message holding the extension's name. */
  nameMessage: 'extName' | 'extNameDev';
  nativeHost: string;
  extensionId: string;
  key: string;
}

export const FLAVORS: Record<Flavor, FlavorIdentity> = {
  release: {
    nameMessage: 'extName',
    nativeHost: 'com.junerdd.atd.chrome',
    extensionId: 'lcjihbdaipfphmofnhlocknjpnocbjbf',
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnEdT+TWyAuvEMuzQBOpSW49gct2nc5TYHeh+XSWEpWr8k0VmKGUV/Iq9N5EJwyz2os572PvC7DCeZvUZBOPLKtIrD09lQBdm+3mYHcLgdQzZJctcOc6FTCEA0pbO+MkLUwvq91LN+fPCU6HuzgRWHVEJolRS/HbZpXZ5lihM5lCgqLy0FgjDwAZ8J3DaibcS9e/X1XGzRBgnbXIyUNhgEMpkvtSKHbDKdn0KaYt82Unje1D6Kt+w3w27TIPyKOxUIq9eM4y/jAuNdRFas7fWj4nT90osZHppOrSdElmc0GtoCzl2PK1hVKj/CjIYawZJuSzuWgciMW5HfRT4REdf9wIDAQAB',
  },
  dev: {
    nameMessage: 'extNameDev',
    nativeHost: 'com.junerdd.atd.chrome.dev',
    extensionId: 'eolengaocpdgjapbjdfpfcokjpgjaedi',
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtnewbxVt9//uJJS1ycfn18irS4/gj9/16LcDDtkQ+7plU1jL8LmkegII6U0Yeufx3v+JT0f74wbgO7ZB2PMWCuweiq57Vnk6LyLod/AVod1WcN1Zgbyymr7XfGgs0EzS66fSpV5WANC0g0ODBXXZrxjPAzrot/JEv4BrNKTyqmr1OEGO1Y2dWz1jGIc67UucOz0eWW1J6MOb3bwg30R7uwasZCFRbRJmbtK2H0/sQ8Uj/PF9v5nmbAroVgA8pwu7qVQzUz5bsfYAIlYP0BkaFLaiPTSVyjE3rQSuF0jwXDRyS9zqFGxSWeMyxFm6ADFo4bPdLRs/x8Tnlr62TOLJJQIDAQAB',
  },
};

/**
 * The flavor a Vite mode builds (`vite build --mode release|dev`, also `import.meta.env.MODE` at
 * runtime), refusing any other mode.
 */
export function flavorFromMode(mode: string): Flavor {
  if (mode === 'release' || mode === 'dev') return mode;
  throw new Error(`Unknown extension flavor "${mode}": build with --mode release or --mode dev.`);
}
