// The draft-confirm screen's decision, as the flow reads it (cinatra#3564).
//
// The flow raises this screen as its `confirm_gate`, and the gate hands the
// flow ONE string: the `userResponse` the screen puts in its values. So each
// button hands the host the decision AND that string, the JSON text of the
// decision and the artifact reference it was made for. The orchestration step
// behind the gate posts only when that text confirms this exact reference.
//
// The gate hands the screen the pinned words (`postText`) and the artifact's
// record (`postArtifact`) rather than a title and an excerpt, so this module
// also derives those two by the same rule the orchestration step gives for
// the page's title. A PURE module: no imports, no side effects.

export type DraftConfirmDecision = {
  approved: boolean;
  postArtifactId: string;
  postRepresentationRevisionId: string;
  userResponse: string;
};

export function draftConfirmDecision(
  approved: boolean,
  postArtifactId: string,
  postRepresentationRevisionId: string,
): DraftConfirmDecision {
  return {
    approved,
    postArtifactId,
    postRepresentationRevisionId,
    userResponse: JSON.stringify({
      approved,
      postArtifactId,
      postRepresentationRevisionId,
    }),
  };
}

const EXCERPT_LENGTH = 400;

function text(v: Record<string, unknown>, key: string): string {
  return typeof v[key] === "string" ? (v[key] as string) : "";
}

/**
 * The first heading line of the pinned words, without its markers. A closing
 * run of `#` is a marker only after whitespace, so a title ending in a literal
 * `#` ("Learning C#") keeps it.
 */
function firstHeading(postText: string): string {
  for (const line of postText.split(/\r?\n/)) {
    const m = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (m && m[1].trim() !== "") return m[1].trim();
  }
  return "";
}

/**
 * The screen's title: the one it was given, else the first heading line of
 * `postText`, else `postArtifact.title`.
 */
export function screenTitle(v: Record<string, unknown>): string {
  const given = text(v, "title");
  if (given !== "") return given;
  const heading = firstHeading(text(v, "postText"));
  if (heading !== "") return heading;
  const record = v["postArtifact"];
  if (record && typeof record === "object" && !Array.isArray(record)) {
    return text(record as Record<string, unknown>, "title");
  }
  return "";
}

/** The screen's excerpt: the one it was given, else the first 400 characters of `postText`. */
export function screenExcerpt(v: Record<string, unknown>): string {
  const given = text(v, "excerpt");
  if (given !== "") return given;
  return Array.from(text(v, "postText")).slice(0, EXCERPT_LENGTH).join("");
}
