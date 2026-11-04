import { useActiveSection } from '../../lib/use-active-section';

/** One of a post's sections, as its contents link to it. */
export interface PostSection {
  /** The section's `#id`. */
  href: string;
  label: string;
}

/**
 * A post's contents: its sections as plain links on one track, the section being read lit on it.
 * Under the post's header on narrow screens; from 1100px it stays beside the text as the reader
 * scrolls (blog.css).
 */
export function PostContents({ title, sections }: { title: string; sections: PostSection[] }) {
  const active = useActiveSection(sections.map((section) => section.href));
  return (
    <nav className="post__toc" aria-labelledby="post-toc-title" data-reveal="fade">
      <h2 id="post-toc-title" className="post__toc-title">
        {title}
      </h2>
      <ol className="post__toc-list">
        {sections.map((section) => (
          <li key={section.href}>
            <a
              className="post__toc-link"
              href={section.href}
              aria-current={active === section.href ? 'location' : undefined}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
