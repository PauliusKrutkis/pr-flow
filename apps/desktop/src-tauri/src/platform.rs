//! The platform seam: everything the app needs from a code host, expressed as
//! one dispatch surface over provider implementations. Data commands resolve
//! the active account to an `AnyPlatform` and never talk to a provider
//! directly — adding a host means adding a variant + impl, nothing else.

use crate::github::{
    FileBlob, GitHubPlatform, GitHubUser, InboxBucket, InboxData, PullRequestDetail,
    ReviewComment, ReviewCommentInput,
};
use crate::gitlab::GitLabPlatform;

pub enum AnyPlatform {
    GitHub(GitHubPlatform),
    GitLab(GitLabPlatform),
}

macro_rules! dispatch {
    ($self:ident, $p:ident => $body:expr) => {
        match $self {
            AnyPlatform::GitHub($p) => $body,
            AnyPlatform::GitLab($p) => $body,
        }
    };
}

impl AnyPlatform {
    pub async fn current_user(&self) -> Result<GitHubUser, String> {
        dispatch!(self, p => p.current_user().await)
    }

    pub async fn inbox(&self) -> Result<InboxData, String> {
        dispatch!(self, p => p.inbox().await)
    }

    pub async fn subscribed_prs(&self, repos: &[String]) -> Result<InboxBucket, String> {
        dispatch!(self, p => p.subscribed_prs(repos).await)
    }

    pub async fn pr_detail(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
    ) -> Result<PullRequestDetail, String> {
        dispatch!(self, p => p.pr_detail(owner, repo, number).await)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_review_comment(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        body: &str,
        commit_id: &str,
        path: &str,
        line: u64,
        side: &str,
    ) -> Result<ReviewComment, String> {
        dispatch!(self, p => {
            p.create_review_comment(owner, repo, number, body, commit_id, path, line, side)
                .await
        })
    }

    pub async fn reply_to_review_comment(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        body: &str,
        in_reply_to: u64,
    ) -> Result<ReviewComment, String> {
        dispatch!(self, p => p.reply_to_review_comment(owner, repo, number, body, in_reply_to).await)
    }

    pub async fn create_issue_comment(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        body: &str,
    ) -> Result<(), String> {
        dispatch!(self, p => p.create_issue_comment(owner, repo, number, body).await)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn submit_review(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        event: &str,
        body: &str,
        commit_id: &str,
        comments: &[ReviewCommentInput],
    ) -> Result<(), String> {
        dispatch!(self, p => {
            p.submit_review(owner, repo, number, event, body, commit_id, comments)
                .await
        })
    }

    pub async fn file_blob(
        &self,
        owner: &str,
        repo: &str,
        path: &str,
        r#ref: &str,
    ) -> Result<FileBlob, String> {
        dispatch!(self, p => p.file_blob(owner, repo, path, r#ref).await)
    }
}
