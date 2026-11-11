export const DESKTOP_MIN_W = 768;

const encodePath = (root, parts) => "/" + [root, ...parts].map(encodeURIComponent).join("/");

function decodePart(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export function buildTrail(pathname, search = "") {
  const segments = pathname.split("/").filter(Boolean).map(decodePart);
  if (segments.length === 0) {
    return {
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
    };
  }

  const [root, ...rest] = segments;
  const isRaw = rest.length > 0 && new URLSearchParams(search).has("raw");
  const isNote = !isRaw && rest.length > 0 && /\.md$/i.test(rest.at(-1));
  const hasFile = isRaw || isNote;
  const folderParts = hasFile ? rest.slice(0, -1) : rest;
  const fileName = hasFile ? rest.at(-1) : null;
  const fileHref = hasFile ? `${encodePath(root, rest)}${isRaw ? "?raw" : ""}` : null;

  const columns = [
    {
      depth: 0,
      key: "/",
      href: "/",
      title: "MD Phone",
      root: null,
      parts: [],
      activeHref: encodePath(root, []),
      activeLabel: root,
    },
    {
      depth: 1,
      key: encodePath(root, []),
      href: encodePath(root, []),
      title: root,
      root,
      parts: [],
      activeHref: folderParts.length > 0 ? encodePath(root, [folderParts[0]]) : fileHref,
      activeLabel: folderParts.length > 0 ? folderParts[0] : fileName,
    },
  ];

  for (let i = 0; i < folderParts.length; i++) {
    const parts = folderParts.slice(0, i + 1);
    const href = encodePath(root, parts);
    const nextFolder = folderParts[i + 1];
    columns.push({
      depth: i + 2,
      key: href,
      href,
      title: folderParts[i],
      root,
      parts,
      activeHref: nextFolder !== undefined ? encodePath(root, folderParts.slice(0, i + 2)) : fileHref,
      activeLabel: nextFolder !== undefined ? nextFolder : fileName,
    });
  }

  return {
    kind: isRaw ? "raw" : isNote ? "note" : "folder",
    columns,
    content: hasFile
      ? {
          kind: isRaw ? "raw" : "note",
          depth: folderParts.length + 2,
          href: fileHref,
          title: fileName,
          root,
          parts: rest,
        }
      : null,
  };
}

export function layoutColumns(columnCount, hasContentPane, viewportWidth) {
  if (viewportWidth < DESKTOP_MIN_W) {
    if (hasContentPane) {
      return {
        mode: "mobile-file",
        showAncestorStack: false,
        showListPane: false,
        stickyStepPx: 0,
        maxStickySteps: 0,
        topStepPx: 0,
        maxTopSteps: 0,
      };
    }
    return {
      mode: "mobile-stack",
      showAncestorStack: columnCount > 1,
      showListPane: true,
      stickyStepPx: 14,
      maxStickySteps: 3,
      topStepPx: 6,
      maxTopSteps: 4,
    };
  }
  return {
    mode: "desktop-stack",
    showAncestorStack: columnCount > 1,
    showListPane: true,
    stickyStepPx: 34,
    maxStickySteps: 5,
    topStepPx: 6,
    maxTopSteps: 4,
  };
}

export function cardOffsets(depth, layout) {
  return {
    stickyLeftPx: Math.min(Math.max(0, depth), layout.maxStickySteps) * layout.stickyStepPx,
    stepTopPx: Math.min(Math.max(0, depth), layout.maxTopSteps) * layout.topStepPx,
  };
}

export function resolveRowTap(trail, columnKey, rowHref) {
  const col = trail.columns.find((item) => item.key === columnKey);
  if (col && col.activeHref !== null && col.activeHref === rowHref) {
    return col.href;
  }
  return rowHref;
}

export function rememberTrail(recentMap, trail, { fromHome = false } = {}) {
  if (fromHome && trail.content) {
    recentMap.set("/", trail.content.href);
    return;
  }
  for (const col of trail.columns) {
    if (col.activeHref !== null) {
      recentMap.set(col.key, col.activeHref);
    }
  }
}

export function swipeTargets(trail, recentMap, { editBackHref = null } = {}) {
  if (trail.content) {
    return {
      closeRightHref: editBackHref || trail.columns.at(-1)?.href || "/",
      openRightHref: null,
    };
  }
  const currentCol = trail.columns.at(-1);
  const closeRightHref = trail.columns.length > 1 ? trail.columns.at(-2).href : null;
  const candidate = currentCol ? (recentMap.get(currentCol.key) ?? null) : null;
  return {
    closeRightHref,
    openRightHref: candidate && candidate !== currentCol?.href ? candidate : null,
  };
}

export function classifyTrailTransition(prevTrail, nextTrail) {
  const prevContent = prevTrail.content?.href ?? null;
  const nextContent = nextTrail.content?.href ?? null;
  let shared = 0;
  while (
    shared < prevTrail.columns.length &&
    shared < nextTrail.columns.length &&
    prevTrail.columns[shared].key === nextTrail.columns[shared].key
  ) {
    shared++;
  }

  if (
    shared === prevTrail.columns.length &&
    shared === nextTrail.columns.length &&
    prevContent === nextContent
  ) {
    return { kind: "none", keepColumnCount: shared, closingContent: false };
  }

  if (
    !nextTrail.content &&
    shared === nextTrail.columns.length &&
    (nextTrail.columns.length < prevTrail.columns.length || Boolean(prevTrail.content))
  ) {
    return {
      kind: "close-right",
      keepColumnCount: nextTrail.columns.length,
      closingContent: Boolean(prevTrail.content),
    };
  }

  return {
    kind: "open-right",
    keepColumnCount: shared,
    closingContent: Boolean(prevTrail.content && !nextTrail.content),
  };
}

export function canBeginSwipe({
  pointerType,
  isDesktop,
  button = 0,
  inFormControl = false,
  dialogOpen = false,
  hasSelection = false,
}) {
  if (pointerType === "mouse" && (isDesktop || button !== 0)) return false;
  return !(inFormControl || dialogOpen || hasSelection);
}

export function canScrollHorizontallyInDirection({ scrollLeft, clientWidth, scrollWidth }, dx) {
  if (dx === 0 || scrollWidth <= clientWidth + 1) return false;
  return dx > 0 ? scrollLeft > 0 : scrollLeft + clientWidth < scrollWidth - 1;
}

export function resolveSwipeLock({
  dx,
  dy,
  pointerType = "touch",
  elapsedMs = 0,
  hasSelection = false,
  canScrollX = false,
}) {
  if (hasSelection) return "cancel";
  const slop = pointerType === "touch" ? 10 : 6;
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) {
    return elapsedMs > 400 ? "cancel" : "wait";
  }
  if (Math.abs(dy) >= Math.abs(dx) || canScrollX) return "cancel";
  return "lock";
}
