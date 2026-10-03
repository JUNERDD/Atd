import themeUrl from './onboarding-theme.mp3?url&no-inline';

/**
 * The welcome guide's music: an original 52 s track that `apps/desktop/scripts/compose-onboarding-
 * theme.py` composes and renders to `onboarding-theme.mp3`. These times, in seconds of the track,
 * are the contract between that script and the page; change one only together with the other and
 * a rerender of the mp3.
 *
 * - `revealAt`: the bloom on the downbeat, where the intro's card reveal lands.
 * - `loopStart`..`loopEnd`: the 40 s bed, which the script renders so the sample after `loopEnd`
 *   is the one at `loopStart`, so the page loops exactly this range. The rest of the file after
 *   `loopEnd` is the tail that only a non-looping player would reach.
 */
export const ONBOARDING_THEME = { revealAt: 3.5, loopStart: 8, loopEnd: 48 } as const;

/** The track's URL, fetched and decoded by `useOnboardingMusic`. */
export const ONBOARDING_THEME_URL: string = themeUrl;
