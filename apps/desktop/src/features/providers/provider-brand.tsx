import type { CSSProperties } from 'react';
import { Link } from 'lucide-react';
// `no-inline` keeps each mark a separate file: inlined base64 would load every brand with the shared chunk.
import openai from '@atd/ui/assets/brands/openai.svg?url&no-inline';
import providerBrands from '@atd/ui/assets/brands/providers.json';
const assets = import.meta.glob<string>(
  [
    '../../../../../packages/ui/src/assets/brands/lndev/*.svg',
    '../../../../../packages/ui/src/assets/brands/external/*.svg',
  ],
  { eager: true, query: '?url&no-inline', import: 'default' },
);
const brands: {
  providers: Record<string, string>;
  prefixes: Record<string, string>;
  inline: Record<string, string>;
  monochrome: string[];
} = providerBrands;
export function ProviderBrand({
  provider,
  variant = 'tile',
}: {
  provider: string;
  variant?: 'tile' | 'inline';
}) {
  const stem =
    (variant === 'inline' ? brands.inline[provider] : undefined) ??
    brands.providers[provider] ??
    Object.entries(brands.prefixes).find(([prefix]) => provider.startsWith(prefix))?.[1] ??
    provider;
  const asset =
    stem === 'openai'
      ? openai
      : Object.entries(assets).find(([path]) => path.endsWith(`/${stem}.svg`))?.[1];
  const masked = asset && brands.monochrome.includes(stem);
  return (
    <span aria-hidden="true" className="provider-brand-frame" data-variant={variant}>
      {masked ? (
        <span
          className="provider-brand provider-brand-mask"
          style={{ '--brand-mask-image': `url("${asset}")` } as CSSProperties}
        />
      ) : asset ? (
        <img src={asset} width={16} height={16} className="provider-brand" alt="" />
      ) : provider === 'openai-compatible' ? (
        <Link className="provider-brand provider-brand-ink" strokeWidth={2} />
      ) : (
        <span className="provider-brand" />
      )}
    </span>
  );
}
