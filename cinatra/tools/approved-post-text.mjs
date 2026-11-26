/**
 * THE WORDS OF THE REVISION THE REVIEW APPROVED, as the tool this pack DECLARES.
 *
 * The run parks on the host's artifact review of the post before anything is
 * read for publishing. The person can approve the revision the run started
 * with, or choose Regenerate and then approve the successor revision that the
 * Regenerate made. The host resumes the review step with its answer as JSON
 * text. For an approval the answer is
 *
 *   { "approved": true,
 *     "review": { "envelopeVersion": 1, "decision": "approved",
 *                 "reviewTaskId": "...", "comment": null | "...",
 *                 "targets": [{ "artifactId": "...", "representationRevisionId": "..." }] } }
 *
 * and the targets are the revisions the person approved (cinatra-ai/cinatra,
 * src/lib/artifacts/artifact-review-rejection.ts, buildReviewApproveEnvelope).
 * A legacy rejection has no `approved` key and `review.decision` "rejected".
 *
 * So the revision this run publishes is the one the answer names, never the
 * revision the run started with. A flow cannot parse JSON text, so the read
 * step in front of the publishing step calls this module through the host's
 * generic dispatch. The module takes the approved target from the answer and
 * reads its words through the content read the host binds to this run
 * (`ports.artifacts.contentRead`), admitted by the artifact dependency this
 * pack declares.
 *
 * NOTHING WITHOUT AN APPROVAL, AND NOTHING READ BEFORE IT. The flow calls this
 * module twice. Its first step after the review (`checkOnly: true`) only checks
 * the answer and hands on the approved target; it reads nothing. Only behind
 * that step does the flow read the post's record, and only then does the read
 * step call this module again for the words. So a review that was not an
 * approval reads neither the record nor the words. Both calls stop the run
 * with one sentence a person can read, before any read, when the answer
 *   - is not JSON text of an object,
 *   - does not carry the approval (`approved: true` and `review.decision`
 *     "approved", envelope version 1),
 *   - does not name exactly one target with an artifact and a revision, or
 *   - names an artifact other than the one under review.
 * A stopped run never reaches the publish card and never writes to the site.
 *
 * THE PAGE'S TITLE. The draft writer files the post's title as the artifact's
 * own title and its body from the first `## ` section on, without the title
 * as a heading. So the module also takes the post's record, as the flow's
 * record read after the check hands it on (JSON text of the record
 * `artifacts_get` answered), and answers the title: the record's own title,
 * with the spaces around it removed, or, when the record has none (no title,
 * or one of spaces only), a leading `# ` heading of the approved words. A
 * record that is not the approved artifact's record (none, not an object,
 * another artifact) stops the run, before the content read, with a sentence
 * that says nothing is published. The record's title wins over a `# ` heading
 * of the words; the heading then stays in the words, which go out unchanged,
 * so the page shows it in its body under the title. The title is not cut to a
 * length. With no title, the title is empty and the publishing step publishes
 * nothing. The publish card shows the title and the words, so everything that
 * goes out is on the card.
 *
 * THE `# ` HEADING follows the CommonMark rule for an ATX heading of level one:
 * the first line that is not blank, indented by at most three spaces, is `#`
 * followed by a space, a tab or the end of the line (`#C` is not a heading).
 * An optional closing run of `#` is removed only when a space or a tab comes
 * before it and only spaces or tabs come after it, so `# C#` is "C#" and
 * `# C #` is "C". A backslash before an ASCII punctuation character makes it
 * plain (`# C \#` is "C #"), except inside a code span. A `## ` section
 * heading, or any other level, is never a title.
 *
 * A FAILURE IS NOT A REFUSAL. An error of the content read (an artifact this
 * run cannot see, a revision that does not resolve, a store fault) is thrown
 * on as it is, so the host answers it as the failure it is.
 *
 * THIS FILE IS THE SHIPPED ARTIFACT: `files` ships `cinatra/`. The same file is
 * shipped by blog-wordpress-publish-agent and blog-linkedin-publish-agent,
 * because the host resolves the tool against the pack whose run calls it.
 */

/** The one envelope version of the review's answer this module reads. */
const ENVELOPE_VERSION = 1;

/** The sentences a person reads. Each is one line, with no path and no id. */
const NOT_APPROVED_REASON = "The review of the post was not approved, so nothing is published.";
const NO_APPROVED_REVISION_REASON =
  "The review's answer names no approved revision of the post, so nothing is published.";
const OTHER_ARTIFACT_REASON =
  "The review approved an artifact other than the post under review, so nothing is published.";
const NO_ARTIFACT_REASON =
  "The post under review did not reach this step, so nothing is published; start the run again.";
const NO_RECORD_REASON =
  "The post's record could not be read after the review, so nothing is published; start the run again.";

/** Every sentence this module can stop a run with, for the checks that hold
 *  each one to the host's bounds. */
export const REFUSAL_SENTENCES = Object.freeze([
  NOT_APPROVED_REASON,
  NO_APPROVED_REVISION_REASON,
  OTHER_ARTIFACT_REASON,
  NO_ARTIFACT_REASON,
  NO_RECORD_REASON,
]);

/** The name the host's dispatch reads a module's refusal by: the run stops with
 *  the sentence, which the host repeats. */
const REFUSAL_NAME = "ExtensionToolCallRefusal";

class ApprovedRevisionRefusal extends Error {
  constructor(sentence) {
    super(sentence);
    this.name = REFUSAL_NAME;
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlankString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** The review's answer as an object, or a refusal. */
function answerOf(raw) {
  if (!isNonBlankString(raw)) throw new ApprovedRevisionRefusal(NO_APPROVED_REVISION_REASON);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ApprovedRevisionRefusal(NO_APPROVED_REVISION_REASON);
  }
  if (!isPlainObject(value) || !isPlainObject(value.review)) {
    throw new ApprovedRevisionRefusal(NO_APPROVED_REVISION_REASON);
  }
  return value;
}

/** The one approved target of the answer, or a refusal. */
function approvedTargetOf(answer) {
  const review = answer.review;
  if (answer.approved !== true || review.decision !== "approved") {
    throw new ApprovedRevisionRefusal(NOT_APPROVED_REASON);
  }
  if (review.envelopeVersion !== ENVELOPE_VERSION) {
    throw new ApprovedRevisionRefusal(NO_APPROVED_REVISION_REASON);
  }
  const targets = review.targets;
  if (!Array.isArray(targets) || targets.length !== 1) {
    throw new ApprovedRevisionRefusal(NO_APPROVED_REVISION_REASON);
  }
  const target = targets[0];
  if (
    !isPlainObject(target) ||
    !isNonBlankString(target.artifactId) ||
    !isNonBlankString(target.representationRevisionId)
  ) {
    throw new ApprovedRevisionRefusal(NO_APPROVED_REVISION_REASON);
  }
  return { artifactId: target.artifactId, representationRevisionId: target.representationRevisionId };
}

/** The approved artifact's record, or a refusal: the run never goes on with
 *  a record it could not read or one of another artifact. */
function recordOf(raw, artifactId) {
  let record;
  try {
    record = typeof raw === "string" ? JSON.parse(raw) : undefined;
  } catch {
    record = undefined;
  }
  if (!isPlainObject(record) || record.artifactId !== artifactId) {
    throw new ApprovedRevisionRefusal(NO_RECORD_REASON);
  }
  return record;
}

/** The record's own title without the spaces around it; "" for none. */
function recordTitleOf(record) {
  return isNonBlankString(record.title) ? record.title.trim() : "";
}

/** ASCII punctuation, the characters a backslash makes plain (CommonMark 2.4). */
const ESCAPABLE = /[!-\/:-@[-`{-~]/;

/** The text with each backslash escape made plain, outside code spans. */
function withoutEscapes(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "`") {
      let run = 1;
      while (text[i + run] === "`") run += 1;
      const fence = "`".repeat(run);
      let close = text.indexOf(fence, i + run);
      while (close !== -1 && text[close + run] === "`") {
        let next = close;
        while (text[next] === "`") next += 1;
        close = text.indexOf(fence, next);
      }
      const end = close === -1 ? i + run : close + run;
      out += text.slice(i, end);
      i = end;
    } else if (text[i] === "\\" && i + 1 < text.length && ESCAPABLE.test(text[i + 1])) {
      out += text[i + 1];
      i += 2;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

/** A leading level-one ATX heading of the words (the first line that is not
 *  blank), by the CommonMark rule; "" when that line is no such heading. */
function leadingTitleHeadingOf(text) {
  const first = text.split(/\r\n|\r|\n/).find((line) => line.trim() !== "");
  const match = first === undefined ? null : /^ {0,3}#(?:[ \t](.*))?$/.exec(first);
  if (!match) return "";
  const content = (match[1] ?? "").replace(/(?:^|[ \t])#+[ \t]*$/, "");
  return withoutEscapes(content.replace(/^[ \t]+|[ \t]+$/g, ""));
}

/**
 * THE ONE CALLABLE EXPORT the declared-tools contract pins: one function of one
 * argument, `{ input, ports }`.
 * Input: `{ reviewDecision, artifactId, postRecord, checkOnly }`: the review's
 * answer as JSON text, the artifact the run put under review, the post's
 * record as JSON text, and `checkOnly: true` for the check that reads nothing.
 * Result of the check: `{ artifactId, representationRevisionId }`, the
 * approved revision. Result of the read: `{ artifactId,
 * representationRevisionId, text, truncated, title }`: the approved revision,
 * its words and the page's title.
 */
export async function extensionTool({ input, ports }) {
  const call = isPlainObject(input) ? input : {};
  if (!isNonBlankString(call.artifactId)) throw new ApprovedRevisionRefusal(NO_ARTIFACT_REASON);
  const approved = approvedTargetOf(answerOf(call.reviewDecision));
  if (approved.artifactId !== call.artifactId) throw new ApprovedRevisionRefusal(OTHER_ARTIFACT_REASON);
  if (call.checkOnly === true) return approved;

  const record = recordOf(call.postRecord, approved.artifactId);
  const read = await ports.artifacts.contentRead({
    artifactId: approved.artifactId,
    representationRevisionId: approved.representationRevisionId,
  });
  if (!isPlainObject(read) || typeof read.text !== "string") {
    throw new Error("approved_post_text: the content read did not answer the text it read");
  }
  if (
    read.representationRevisionId !== undefined &&
    read.representationRevisionId !== approved.representationRevisionId
  ) {
    throw new Error("approved_post_text: the content read answered another revision than the one it was asked for");
  }
  return {
    artifactId: approved.artifactId,
    representationRevisionId: approved.representationRevisionId,
    text: read.text,
    truncated: read.truncated === true,
    title: recordTitleOf(record) || leadingTitleHeadingOf(read.text),
  };
}
