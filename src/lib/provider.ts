const GITLAB_MR_MARKER = "/-/merge_requests/";

export function isGitlabPrUrl(url: string): boolean {
  return url.includes(GITLAB_MR_MARKER);
}

export function openOnProviderLabel(url: string): string {
  return isGitlabPrUrl(url) ? "Open on GitLab" : "Open on GitHub";
}

const UPLOAD_PATH_RE = /^\/uploads\/([^/]+)\/(.+)$/;

/**
 * GitLab's pasted-upload links are project-relative, e.g.
 * `/uploads/<secret>/<filename>`. The plain web route behind that path is
 * session-cookie-gated (no token auth), so a matching src is resolved
 * through the Uploads API instead of rendered as a bare `<img src>`.
 */
export function parseGitlabUploadPath(
  src: string | undefined
): { secret: string; filename: string } | undefined {
  const match = src ? UPLOAD_PATH_RE.exec(src) : null;
  return match ? { filename: match[2], secret: match[1] } : undefined;
}
