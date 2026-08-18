const PREFIX = "eduhub.paper.v1.";

function who(user) {
  return user?.id ? `u${user.id}` : "guest";
}

function storageKey(user, contestId) {
  return `${PREFIX}${who(user)}.${contestId}`;
}

export function readLocalPaper(user, contestId) {
  try {
    const raw = localStorage.getItem(storageKey(user, contestId));
    if (!raw) return { last_problem_id: null, drafts: {}, marks: {} };
    const data = JSON.parse(raw);
    return {
      last_problem_id: data.last_problem_id || null,
      drafts: data.drafts || {},
      marks: data.marks && typeof data.marks === "object" ? data.marks : {},
    };
  } catch {
    return { last_problem_id: null, drafts: {}, marks: {} };
  }
}

export function writeLocalProgress(user, contestId, problemId, language, code, keepDraft) {
  const cur = readLocalPaper(user, contestId);
  cur.last_problem_id = problemId;
  if (keepDraft) {
    cur.drafts[String(problemId)] = { language: language || "", code: String(code || "") };
  }
  localStorage.setItem(storageKey(user, contestId), JSON.stringify(cur));
  return cur;
}

export function localDraft(user, contestId, problemId) {
  return readLocalPaper(user, contestId).drafts[String(problemId)] || null;
}

export function isMarked(user, contestId, problemId) {
  return Boolean(readLocalPaper(user, contestId).marks[String(problemId)]);
}

export function setMarked(user, contestId, problemId, on) {
  const cur = readLocalPaper(user, contestId);
  const key = String(problemId);
  if (on) cur.marks[key] = 1;
  else delete cur.marks[key];
  localStorage.setItem(storageKey(user, contestId), JSON.stringify(cur));
  return cur;
}

export function toggleMarked(user, contestId, problemId) {
  return setMarked(user, contestId, problemId, !isMarked(user, contestId, problemId));
}
