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

const HEADING = /^\s{0,3}#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/;

// A block-quote marker, a list bullet or an ordered-list number at a line's start.
const BLOCK_PREFIX = /^\s{0,3}(?:>\s?|(?:[-*+]|\d{1,9}[.)])\s+)/;
// A link destination, allowing one level of balanced parentheses inside it.
const DESTINATION = "\\((?:[^()]|\\([^()]*\\))*\\)";
const IMAGE = new RegExp(`!\\[([^\\[\\]]*)\\]${DESTINATION}`, "g");
const LINK = new RegExp(`\\[([^\\[\\]]*)\\](?:${DESTINATION}|\\[[^\\[\\]]*\\])`, "g");
// The longest stretch of one line that is read for the excerpt: far more than
// 400 characters of words, and short enough that stripping stays quick.
const LINE_LIMIT = EXCERPT_LENGTH * 8;

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** One line of the pinned words with its Markdown markers stripped and its words kept. */
function plainLine(line: string): string {
  let s = line;
  for (;;) {
    if (/^\s{0,3}(?:`{3,}[^`]*|~{3,}.*)$/.test(s)) return "";
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(s)) return "";
    const inner = s.replace(BLOCK_PREFIX, "");
    if (inner === s) break;
    s = inner;
  }
  if (/^\s{0,3}(?:=+|-+)\s*$/.test(s)) return "";
  const heading = HEADING.exec(s);
  if (heading) s = heading[1] ?? "";
  s = s.replace(IMAGE, "$1");
  s = s.replace(LINK, "$1");
  s = s.replace(/`+/g, "");
  s = s.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "$1");
  s = s.replace(/(?<![\p{L}\p{N}_])__(?=\S)(.+?)(?<=\S)__(?![\p{L}\p{N}_])/gu, "$1");
  s = s.replace(/\*(?=\S)(.+?)(?<=\S)\*/g, "$1");
  s = s.replace(/(?<![\p{L}\p{N}_])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, "$1");
  return s;
}

/** A line cut to LINE_LIMIT code points, so a very long line never stalls the screen. */
function capped(line: string): string {
  return line.length > LINE_LIMIT ? Array.from(line).slice(0, LINE_LIMIT).join("") : line;
}

/** The screen's excerpt: the one it was given, else the pinned words as they will appear — the leading title line dropped when it repeats the screen's title, the Markdown markers stripped and the whitespace collapsed — cut to 400 characters. */
export function screenExcerpt(v: Record<string, unknown>): string {
  const given = text(v, "excerpt");
  if (given !== "") return given;
  const lines = text(v, "postText").split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first !== -1) {
    const line = capped(lines[first]);
    const heading = HEADING.exec(line);
    const title = collapse(heading ? (heading[1] ?? "") : line);
    if (title !== "" && title === collapse(screenTitle(v))) lines.splice(first, 1);
  }
  let words = "";
  for (const line of lines) {
    const plain = collapse(plainLine(capped(line)));
    if (plain === "") continue;
    words = words === "" ? plain : `${words} ${plain}`;
    if (Array.from(words).length >= EXCERPT_LENGTH) break;
  }
  return Array.from(words).slice(0, EXCERPT_LENGTH).join("");
}

/** The site named in words: `wordpressSiteName` trimmed, reduced to its host when it is an http or https address; never the connection id. */
export function screenSite(v: Record<string, unknown>): string {
  const name = text(v, "wordpressSiteName").trim();
  if (/^https?:\/\//i.test(name)) {
    try {
      const host = new URL(name).host;
      if (host !== "") return host;
    } catch {
      // Not a parsable address: the name is shown as given.
    }
  }
  return name;
}
