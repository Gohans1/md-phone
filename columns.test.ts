import { describe, expect, it } from "bun:test";
import {
  buildTrail,
  canBeginSwipe,
  canScrollHorizontallyInDirection,
  cardOffsets,
  classifyTrailTransition,
  layoutColumns,
  rememberTrail,
  resolveRowTap,
  resolveSwipeLock,
  swipeTargets,
} from "./columns.js";

describe("building the folder trail from a URL", () => {
  it("starts with only the home column at /", () => {
    const trail = buildTrail("/", "");

    expect(trail).toEqual({
      kind: "home",
      columns: [
        {
          depth: 0,
          key: "/",
          href: "/",
          title: "MD Phone",
          root: null,
          parts: [],
          activeHref: null,
          activeLabel: null,
        },
      ],
      content: null,
    });
  });

  it("keeps every parent folder in order and marks which child each column opens into", () => {
    const trail = buildTrail("/desktop/md-phone/.claude/skills", "");

    expect(trail.kind).toBe("folder");
    expect(trail.content).toBeNull();
    expect(trail.columns).toEqual([
      {
        depth: 0,
        key: "/",
        href: "/",
        title: "MD Phone",
        root: null,
        parts: [],
        activeHref: "/desktop",
        activeLabel: "desktop",
      },
      {
        depth: 1,
        key: "/desktop",
        href: "/desktop",
        title: "desktop",
        root: "desktop",
        parts: [],
        activeHref: "/desktop/md-phone",
        activeLabel: "md-phone",
      },
      {
        depth: 2,
        key: "/desktop/md-phone",
        href: "/desktop/md-phone",
        title: "md-phone",
        root: "desktop",
        parts: ["md-phone"],
        activeHref: "/desktop/md-phone/.claude",
        activeLabel: ".claude",
      },
      {
        depth: 3,
        key: "/desktop/md-phone/.claude",
        href: "/desktop/md-phone/.claude",
        title: ".claude",
        root: "desktop",
        parts: ["md-phone", ".claude"],
        activeHref: "/desktop/md-phone/.claude/skills",
        activeLabel: "skills",
      },
      {
        depth: 4,
        key: "/desktop/md-phone/.claude/skills",
        href: "/desktop/md-phone/.claude/skills",
        title: "skills",
        root: "desktop",
        parts: ["md-phone", ".claude", "skills"],
        activeHref: null,
        activeLabel: null,
      },
    ]);
  });

  it("marks the open markdown note in its parent folder column and opens a note pane on the right", () => {
    const trail = buildTrail("/desktop/proj/README.md", "");

    expect(trail.kind).toBe("note");
    expect(trail.columns.map((col) => [col.title, col.activeHref])).toEqual([
      ["MD Phone", "/desktop"],
      ["desktop", "/desktop/proj"],
      ["proj", "/desktop/proj/README.md"],
    ]);
    expect(trail.content).toEqual({
      kind: "note",
      depth: 3,
      href: "/desktop/proj/README.md",
      title: "README.md",
      root: "desktop",
      parts: ["proj", "README.md"],
    });
  });

  it("marks a plain-text ?raw file with its ?raw href in the parent folder column", () => {
    const trail = buildTrail("/desktop/proj/server.ts", "?raw");

    expect(trail.kind).toBe("raw");
    expect(trail.columns.at(-1)).toEqual({
      depth: 2,
      key: "/desktop/proj",
      href: "/desktop/proj",
      title: "proj",
      root: "desktop",
      parts: ["proj"],
      activeHref: "/desktop/proj/server.ts?raw",
      activeLabel: "server.ts",
    });
    expect(trail.content).toEqual({
      kind: "raw",
      depth: 3,
      href: "/desktop/proj/server.ts?raw",
      title: "server.ts",
      root: "desktop",
      parts: ["proj", "server.ts"],
    });
  });

  it("decodes Vietnamese names for labels while keeping URL-encoded hrefs", () => {
    const encoded = "/desktop/T%C3%A0i%20li%E1%BB%87u/Ghi%20ch%C3%BA.md";
    const trail = buildTrail(encoded, "");

    expect(trail.columns[1]?.activeLabel).toBe("Tài liệu");
    expect(trail.columns[1]?.activeHref).toBe("/desktop/T%C3%A0i%20li%E1%BB%87u");
    expect(trail.columns[2]?.title).toBe("Tài liệu");
    expect(trail.columns[2]?.activeLabel).toBe("Ghi chú.md");
    expect(trail.columns[2]?.activeHref).toBe(encoded);
    expect(trail.content?.title).toBe("Ghi chú.md");
  });
});

describe("laying out stacked folder tabs across mobile and desktop", () => {
  it("keeps ancestor folder lists stacked on the left while browsing folders on mobile", () => {
    expect(layoutColumns(1, false, 390)).toEqual({
      mode: "mobile-stack",
      showAncestorStack: false,
      showListPane: true,
      stickyStepPx: 14,
      maxStickySteps: 3,
      topStepPx: 6,
      maxTopSteps: 4,
    });

    const deeper = layoutColumns(3, false, 390);
    expect(deeper.mode).toBe("mobile-stack");
    expect(deeper.showAncestorStack).toBe(true);
    expect(deeper.showListPane).toBe(true);
  });

  it("expands readable .md and ?raw files to full screen on mobile", () => {
    expect(layoutColumns(4, true, 390)).toEqual({
      mode: "mobile-file",
      showAncestorStack: false,
      showListPane: false,
      stickyStepPx: 0,
      maxStickySteps: 0,
      topStepPx: 0,
      maxTopSteps: 0,
    });
    expect(layoutColumns(2, true, 767).mode).toBe("mobile-file");
  });

  it("keeps all ancestor folder lists visible on the left on desktop even when a .md file is open", () => {
    const folderDesktop = layoutColumns(4, false, 1440);
    expect(folderDesktop.mode).toBe("desktop-stack");
    expect(folderDesktop.showAncestorStack).toBe(true);
    expect(folderDesktop.showListPane).toBe(true);

    const noteDesktop = layoutColumns(6, true, 1440);
    expect(noteDesktop.mode).toBe("desktop-stack");
    expect(noteDesktop.showAncestorStack).toBe(true);
    expect(noteDesktop.showListPane).toBe(true);
  });

  it("steps deeper stacked cards right and down up to safe caps", () => {
    const mobile = layoutColumns(6, false, 390);
    expect(cardOffsets(0, mobile)).toEqual({ stickyLeftPx: 0, stepTopPx: 0 });
    expect(cardOffsets(1, mobile)).toEqual({ stickyLeftPx: 14, stepTopPx: 6 });
    expect(cardOffsets(2, mobile)).toEqual({ stickyLeftPx: 28, stepTopPx: 12 });
    expect(cardOffsets(5, mobile)).toEqual({ stickyLeftPx: 42, stepTopPx: 24 });

    const desktop = layoutColumns(8, true, 1440);
    expect(cardOffsets(0, desktop)).toEqual({ stickyLeftPx: 0, stepTopPx: 0 });
    expect(cardOffsets(2, desktop)).toEqual({ stickyLeftPx: 68, stepTopPx: 12 });
    expect(cardOffsets(7, desktop)).toEqual({ stickyLeftPx: 170, stepTopPx: 24 });
  });

  it("closes everything to the right when tapping the already-open folder or file row in a column", () => {
    const shallow = buildTrail("/desktop/gohans-monorepo-3js-mc", "");
    expect(resolveRowTap(shallow, "/desktop", "/desktop/gohans-monorepo-3js-mc")).toBe("/desktop");
    expect(resolveRowTap(shallow, "/", "/desktop")).toBe("/");
    expect(resolveRowTap(shallow, "/desktop", "/desktop/live-studio-react")).toBe("/desktop/live-studio-react");

    const deep = buildTrail("/desktop/gohans-monorepo-3js-mc/.claude/skills/cinetic", "");
    expect(resolveRowTap(deep, "/desktop", "/desktop/gohans-monorepo-3js-mc")).toBe("/desktop");
    expect(resolveRowTap(deep, "/desktop/gohans-monorepo-3js-mc", "/desktop/gohans-monorepo-3js-mc/.claude")).toBe(
      "/desktop/gohans-monorepo-3js-mc",
    );

    const openNote = buildTrail("/desktop/gohans-monorepo-3js-mc/README.md", "");
    expect(
      resolveRowTap(openNote, "/desktop/gohans-monorepo-3js-mc", "/desktop/gohans-monorepo-3js-mc/README.md"),
    ).toBe("/desktop/gohans-monorepo-3js-mc");

    const openRaw = buildTrail("/desktop/proj/server.ts", "?raw");
    expect(resolveRowTap(openRaw, "/desktop/proj", "/desktop/proj/server.ts?raw")).toBe("/desktop/proj");
  });

  it("remembers the most recently opened right tab per folder for swipe-to-reopen and computes swipe-to-close", () => {
    const recent = new Map<string, string>();

    const home = buildTrail("/", "");
    rememberTrail(recent, home);
    expect(swipeTargets(home, recent)).toEqual({ closeRightHref: null, openRightHref: null });

    const gemini = buildTrail("/windows-gemini", "");
    rememberTrail(recent, gemini);
    expect(swipeTargets(gemini, recent)).toEqual({ closeRightHref: "/", openRightHref: null });

    const skills = buildTrail("/windows-gemini/skills", "");
    rememberTrail(recent, skills);

    const note = buildTrail("/windows-gemini/skills/SKILL.md", "");
    rememberTrail(recent, note);
    expect(swipeTargets(note, recent)).toEqual({
      closeRightHref: "/windows-gemini/skills",
      openRightHref: null,
    });

    // After closing all the way back to home, swiping left reopens the most recent chain step by step
    expect(swipeTargets(home, recent)).toEqual({
      closeRightHref: null,
      openRightHref: "/windows-gemini",
    });
    expect(swipeTargets(gemini, recent)).toEqual({
      closeRightHref: "/",
      openRightHref: "/windows-gemini/skills",
    });
    expect(swipeTargets(skills, recent)).toEqual({
      closeRightHref: "/windows-gemini",
      openRightHref: "/windows-gemini/skills/SKILL.md",
    });

    // Opening another root updates home's most recent child without losing windows-gemini's inner memory
    const desktop = buildTrail("/desktop", "");
    rememberTrail(recent, desktop);
    expect(swipeTargets(home, recent).openRightHref).toBe("/desktop");
    expect(swipeTargets(gemini, recent).openRightHref).toBe("/windows-gemini/skills");

    // Opening a pinned note directly from home on mobile remembers that note on home and closes back to /
    const pinnedNote = buildTrail("/windows-claude/CLAUDE.md", "");
    rememberTrail(recent, pinnedNote, { fromHome: true });
    expect(swipeTargets(pinnedNote, recent, { editBackHref: "/" })).toEqual({
      closeRightHref: "/",
      openRightHref: null,
    });
    expect(swipeTargets(home, recent).openRightHref).toBe("/windows-claude/CLAUDE.md");
  });

  it("classifies closing right-side tabs vs opening deeper tabs for directional animations", () => {
    const home = buildTrail("/", "");
    const gemini = buildTrail("/windows-gemini", "");
    const deep = buildTrail("/desktop/gohans-monorepo-3js-mc/.claude/skills", "");
    const desktop = buildTrail("/desktop", "");
    const proj = buildTrail("/desktop/proj", "");
    const projNote = buildTrail("/desktop/proj/README.md", "");

    expect(classifyTrailTransition(gemini, home)).toEqual({
      kind: "close-right",
      keepColumnCount: 1,
      closingContent: false,
    });
    expect(classifyTrailTransition(deep, desktop)).toEqual({
      kind: "close-right",
      keepColumnCount: 2,
      closingContent: false,
    });
    expect(classifyTrailTransition(projNote, proj)).toEqual({
      kind: "close-right",
      keepColumnCount: 3,
      closingContent: true,
    });
    expect(classifyTrailTransition(projNote, desktop)).toEqual({
      kind: "close-right",
      keepColumnCount: 2,
      closingContent: true,
    });
    expect(classifyTrailTransition(home, gemini)).toEqual({
      kind: "open-right",
      keepColumnCount: 1,
      closingContent: false,
    });
    expect(classifyTrailTransition(desktop, desktop)).toEqual({
      kind: "none",
      keepColumnCount: 2,
      closingContent: false,
    });
  });
});

describe("swiping back from inside a .md note without breaking editing or scrolling", () => {
  it("allows touch swipe start inside the .md note editor while blocking desktop mouse, inputs, dialogs, and active selections", () => {
    expect(canBeginSwipe({ pointerType: "touch", isDesktop: false })).toBe(true);
    expect(canBeginSwipe({ pointerType: "touch", isDesktop: true })).toBe(true);
    expect(canBeginSwipe({ pointerType: "mouse", isDesktop: false, button: 0 })).toBe(true);
    expect(canBeginSwipe({ pointerType: "mouse", isDesktop: true, button: 0 })).toBe(false);
    expect(canBeginSwipe({ pointerType: "mouse", isDesktop: false, button: 2 })).toBe(false);
    expect(canBeginSwipe({ pointerType: "touch", isDesktop: false, inFormControl: true })).toBe(false);
    expect(canBeginSwipe({ pointerType: "touch", isDesktop: false, dialogOpen: true })).toBe(false);
    expect(canBeginSwipe({ pointerType: "touch", isDesktop: false, hasSelection: true })).toBe(false);
  });

  it("yields to wide tables or code blocks only when they can actually scroll in the finger direction", () => {
    // Narrow table/code block that fits the screen never blocks swipe-back
    expect(canScrollHorizontallyInDirection({ scrollLeft: 0, clientWidth: 358, scrollWidth: 358 }, 40)).toBe(false);
    expect(canScrollHorizontallyInDirection({ scrollLeft: 0, clientWidth: 358, scrollWidth: 358 }, -40)).toBe(false);

    // Wide table at left edge (scrollLeft = 0): swiping right (dx > 0) goes back, swiping left (dx < 0) scrolls table
    expect(canScrollHorizontallyInDirection({ scrollLeft: 0, clientWidth: 358, scrollWidth: 720 }, 40)).toBe(false);
    expect(canScrollHorizontallyInDirection({ scrollLeft: 0, clientWidth: 358, scrollWidth: 720 }, -40)).toBe(true);

    // Wide table scrolled midway: both directions scroll the table instead of navigating
    expect(canScrollHorizontallyInDirection({ scrollLeft: 120, clientWidth: 358, scrollWidth: 720 }, 40)).toBe(true);
    expect(canScrollHorizontallyInDirection({ scrollLeft: 120, clientWidth: 358, scrollWidth: 720 }, -40)).toBe(true);
  });

  it("locks horizontal swipes while cancelling vertical pans, long-press text selection, and active horizontal scrollers", () => {
    expect(resolveSwipeLock({ dx: 4, dy: 2, pointerType: "touch", elapsedMs: 60 })).toBe("wait");
    expect(resolveSwipeLock({ dx: 4, dy: 2, pointerType: "touch", elapsedMs: 450 })).toBe("cancel");
    expect(resolveSwipeLock({ dx: 24, dy: 4, pointerType: "touch", elapsedMs: 80, hasSelection: true })).toBe("cancel");
    expect(resolveSwipeLock({ dx: 12, dy: 18, pointerType: "touch", elapsedMs: 80 })).toBe("cancel");
    expect(resolveSwipeLock({ dx: 28, dy: 6, pointerType: "touch", elapsedMs: 80, canScrollX: true })).toBe("cancel");
    expect(resolveSwipeLock({ dx: 28, dy: 6, pointerType: "touch", elapsedMs: 80, canScrollX: false })).toBe("lock");
  });
});
