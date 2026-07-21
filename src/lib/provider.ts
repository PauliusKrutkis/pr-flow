const GITLAB_MR_MARKER = "/-/merge_requests/";

export function isGitlabPrUrl(url: string): boolean {
  return url.includes(GITLAB_MR_MARKER);
}

export function openOnProviderLabel(url: string): string {
  return isGitlabPrUrl(url) ? "Open on GitLab" : "Open on GitHub";
}

/**
 * GitLab embeds pasted-image links as paths relative to the project root
 * (e.g. `/uploads/<hash>/name.png`), so rendering them verbatim resolves
 * against the app's own origin instead of the GitLab instance. Given the
 * MR's web URL, returns the project's base URL to resolve those paths
 * against, or undefined for GitHub (whose upload URLs are already absolute).
 */
export function gitlabProjectBaseUrl(url: string): string | undefined {
  const i = url.indexOf(GITLAB_MR_MARKER);
  return i === -1 ? undefined : url.slice(0, i);
}
