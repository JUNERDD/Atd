import type { ReactNode } from 'react';
import { agentApi } from '../use-agent';
import { showErrorToast } from '../../../components/toast-store';

/**
 * The transcript's one path to the outside web: the click never navigates the renderer; main
 * opens the URL in the system browser after accepting only http(s) links, and a refusal
 * surfaces as a toast. Markdown links and tool-result links share it.
 */
export function ExternalLink({
  href,
  children,
  className,
  title,
}: {
  href: string | undefined;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <a
      href={href}
      className={className}
      title={title}
      onClick={(event) => {
        event.preventDefault();
        if (href)
          void agentApi()
            .openLink(href)
            .catch((error) => showErrorToast(error));
      }}
    >
      {children}
    </a>
  );
}
