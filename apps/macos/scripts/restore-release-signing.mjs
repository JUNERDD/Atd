#!/usr/bin/env node
// The legacy self-signed certificate cannot be used for Apple notarization.
throw new Error(
  'Use pnpm --filter @atd/macos signing:setup --credentials --github OWNER/REPO --p12 <backup.p12> --apple-id <Apple-account> instead. Legacy release secrets are intentionally preserved.',
);
