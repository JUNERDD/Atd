/** The CMS's blog posts, newest first, validated at build time by `blog-content.ts`. */
declare module 'virtual:atd-blog' {
  const posts: readonly import('./content/blog-schema.ts').BlogPost[];
  export default posts;
}
