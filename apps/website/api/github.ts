import { handleGitHubStarsRequest } from '../src/lib/github-stars.ts';

/** Vercel Node.js Function serving the CDN-cached repository star count at `/api/github`. */
export default {
  fetch(request: Request): Promise<Response> {
    return handleGitHubStarsRequest(request, process.env.GITHUB_TOKEN);
  },
};
