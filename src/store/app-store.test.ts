import { beforeEach, describe, expect, it } from "vitest";
import { loadLastTab, useAppStore } from "./app-store.ts";

const KEY = "pr#1";

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    dismissed: {},
    inboxTab: "reviewRequested",
    lastDismissedKey: null,
    lastSeen: {},
    pendingComments: {},
    toast: null,
  });
});

describe("archive (dismiss until update)", () => {
  it("hides a PR at its dismissal timestamp and older", () => {
    const s = useAppStore.getState();
    s.dismiss(KEY, "2026-07-01T10:00:00Z");
    const g = useAppStore.getState();
    expect(g.isDismissed(KEY, "2026-07-01T10:00:00Z")).toBe(true);
    expect(g.isDismissed(KEY, "2026-06-30T00:00:00Z")).toBe(true);
  });

  it("resurfaces on newer activity", () => {
    useAppStore.getState().dismiss(KEY, "2026-07-01T10:00:00Z");
    expect(
      useAppStore.getState().isDismissed(KEY, "2026-07-01T10:00:01Z")
    ).toBe(false);
  });

  it("undo restores exactly the last archive", () => {
    const s = useAppStore.getState();
    s.dismiss("pr#1", "2026-07-01T10:00:00Z");
    s.dismiss("pr#2", "2026-07-01T11:00:00Z");
    useAppStore.getState().undoDismiss();
    const g = useAppStore.getState();
    expect(g.isDismissed("pr#2", "2026-07-01T11:00:00Z")).toBe(false);
    expect(g.isDismissed("pr#1", "2026-07-01T10:00:00Z")).toBe(true);
    useAppStore.getState().undoDismiss();
  });

  it("persists to localStorage", () => {
    useAppStore.getState().dismiss(KEY, "2026-07-01T10:00:00Z");
    expect(
      JSON.parse(localStorage.getItem("pr-flow:dismissed") ?? "{}")[KEY]
    ).toBe("2026-07-01T10:00:00Z");
  });

  it("clearDismissed un-archives permanently, even after older activity", () => {
    const s = useAppStore.getState();
    s.dismiss(KEY, "2026-07-01T10:00:00Z");
    s.clearDismissed(KEY);
    const g = useAppStore.getState();
    expect(g.isDismissed(KEY, "2026-07-01T10:00:00Z")).toBe(false);
    expect(
      JSON.parse(localStorage.getItem("pr-flow:dismissed") ?? "{}")[KEY]
    ).toBeUndefined();
  });
});

describe("unread tracking", () => {
  it("unseen PRs are unread; seeing clears until the PR updates", () => {
    const s = useAppStore.getState();
    expect(s.isUnread(KEY, "2026-07-01T10:00:00Z")).toBe(true);
    s.markSeen(KEY, "2026-07-01T10:00:00Z");
    const g = useAppStore.getState();
    expect(g.isUnread(KEY, "2026-07-01T10:00:00Z")).toBe(false);
    expect(g.isUnread(KEY, "2026-07-01T12:00:00Z")).toBe(true);
  });
});

describe("pending review comments", () => {
  it("adds with unique ids, removes by id, clears per PR", () => {
    const s = useAppStore.getState();
    s.addPendingComment(KEY, {
      body: "x",
      line: 1,
      path: "a.ts",
      side: "RIGHT",
    });
    s.addPendingComment(KEY, {
      body: "y",
      line: 2,
      path: "a.ts",
      side: "RIGHT",
    });
    let pending = useAppStore.getState().pendingComments[KEY];
    expect(pending).toHaveLength(2);
    expect(pending[0].id).not.toBe(pending[1].id);

    useAppStore.getState().removePendingComment(KEY, pending[0].id);
    pending = useAppStore.getState().pendingComments[KEY];
    expect(pending).toHaveLength(1);
    expect(pending[0].body).toBe("y");

    useAppStore.getState().clearPendingComments(KEY);
    expect(useAppStore.getState().pendingComments[KEY]).toBeUndefined();
  });

  it("persists drafts to localStorage", () => {
    useAppStore.getState().addPendingComment(KEY, {
      body: "x",
      line: 1,
      path: "a.ts",
      side: "RIGHT",
    });
    const stored = JSON.parse(
      localStorage.getItem("pr-flow:pendingComments") ?? "{}"
    );
    expect(stored[KEY]).toHaveLength(1);
  });
});

describe("inbox tab persistence", () => {
  it("setInboxTab persists to localStorage", () => {
    useAppStore.getState().setInboxTab("created");
    expect(localStorage.getItem("pr-flow:lastInboxTab")).toBe("created");
    expect(useAppStore.getState().inboxTab).toBe("created");
  });

  it("loadLastTab returns a previously saved valid tab", () => {
    localStorage.setItem("pr-flow:lastInboxTab", "subscribed");
    expect(loadLastTab()).toBe("subscribed");
  });

  it("loadLastTab ignores unknown or missing values", () => {
    expect(loadLastTab()).toBeNull();
    localStorage.setItem("pr-flow:lastInboxTab", "bogus");
    expect(loadLastTab()).toBeNull();
  });
});
