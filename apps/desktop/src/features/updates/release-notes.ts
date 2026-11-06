/** Stable releases have localized articles; prereleases and unknown versions have no article. */
export function releaseNotesUrl(version: string, language: string): string | null {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) return null;
  const prefix = language === 'zh-CN' ? '/zh' : '';
  return `https://atd.best${prefix}/blog/atd-${version.replaceAll('.', '-')}`;
}

/** Only a successful external open consumes the native prompt for this installed version. */
export async function openReleaseNotes(version: string, url: string): Promise<void> {
  const desktop = window.desktop;
  if (!desktop) return;
  await desktop.agent.openLink(url);
  desktop.about?.dismissReleaseNotes(version);
}
