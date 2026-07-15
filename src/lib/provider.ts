export function isGitlabPrUrl(url: string): boolean {
  return url.includes("/-/merge_requests/");
}

export function openOnProviderLabel(url: string): string {
  return isGitlabPrUrl(url) ? "Open on GitLab" : "Open on GitHub";
}
