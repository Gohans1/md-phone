import { markId } from "./marks.js";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const idsOf = (marks) => new Set(marks.map(markId));

const MAX_REMOVED = 200;

function mergeMarks(seen, here, there, removedThere, removedHere) {
  const seenIds = idsOf(seen);
  const hereIds = idsOf(here);
  const goneHere = new Set([...seenIds].filter((id) => !hereIds.has(id)));
  // Only marks someone removed are remembered, because a device can come back later with an old copy that still has them.
  const removedMarks = [...new Set([...removedThere, ...removedHere])].slice(-MAX_REMOVED);
  const removed = new Set([...removedMarks, ...goneHere]);
  const hereById = new Map(here.map((mark) => [markId(mark), mark]));
  const thereIds = idsOf(there);
  const kept = there.filter((mark) => !removed.has(markId(mark))).map((mark) => hereById.get(markId(mark)) ?? mark);
  const added = here.filter((mark) => !seenIds.has(markId(mark)) && !thereIds.has(markId(mark)) && !removed.has(markId(mark)));
  return { marks: [...kept, ...added], removedMarks };
}

// `synced` is this device's copy and the server's copy as of the last time they agreed.
// Marks merge one by one. The review and undo steps belong to one version of the text, so they can't be mixed:
// this device's only win if nothing changed on the server, and never while its text is in conflict.
export function mergeState(synced, local, remote, textInConflict) {
  if (!remote) return local;
  const whole = (field) => {
    const changedHere = !same(local[field], synced?.local[field]);
    const changedThere = !same(remote[field], synced?.remote[field]);
    return changedHere && !changedThere && !textInConflict ? local[field] : remote[field];
  };
  return {
    ...mergeMarks(synced?.local.marks ?? [], local.marks, remote.marks, remote.removedMarks ?? [], local.removedMarks ?? []),
    reviewed: whole("reviewed"),
    reviewConfirmed: whole("reviewConfirmed"),
    history: whole("history"),
  };
}
