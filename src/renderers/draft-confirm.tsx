"use client";

import { useEffect, useMemo, useRef } from "react";

import type { FieldRendererProps } from "@cinatra-ai/sdk-ui/field-renderer-props";

import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";

// HITL renderer for @cinatra-ai/blog-wordpress-publish-agent, binding
// "@cinatra-ai/blog-wordpress-publish-agent:draft-confirm" (kind
// "wordpress-draft-confirm"). Relocated in-repo from the host
// (cinatra#1625, epic #1620 S8 — M3 companion wave): the host resolves it
// through the generated field-renderer component map + the extension-mount
// wrapper, which falls back to the schema-field floor on any load failure.
//
// THE CONFIRMATION COMES BEFORE THE SITE WRITE (cinatra#3035, plan section 6.1
// step 7: "a confirmation before the post goes to the site, then the page's
// address on the post"). So this screen names WHAT WILL BE PUBLISHED — the post
// artifact and the exact revision the person continued with — not a draft that
// already exists somewhere. A decline leaves nothing behind to remove.
//
// A PURE snapshot -> onChange renderer: it requests NO host action ports, and
// it does not edit the post. The words that go to the site are the pinned
// revision's, read by the step in front of the agent.

type DraftConfirmValue = {
  postArtifactId: string;
  postRepresentationRevisionId: string;
  wordpressInstanceId?: string;
  title?: string;
  excerpt?: string;
};

function str(v: Record<string, unknown>, key: string): string {
  return typeof v[key] === "string" ? (v[key] as string) : "";
}

function toDraftConfirmValue(value: unknown): DraftConfirmValue {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    return {
      postArtifactId: str(v, "postArtifactId"),
      postRepresentationRevisionId: str(v, "postRepresentationRevisionId"),
      wordpressInstanceId: str(v, "wordpressInstanceId") || undefined,
      title: str(v, "title") || undefined,
      excerpt: str(v, "excerpt") || undefined,
    };
  }
  return { postArtifactId: "", postRepresentationRevisionId: "" };
}

export default function BlogWordpressDraftConfirmRenderer({
  value,
  onChange,
  disabled,
}: FieldRendererProps) {
  const v = useMemo(() => toDraftConfirmValue(value), [value]);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Gate Publish/Decline on a complete artifact reference.
  // If the renderer mounts before the agent has wired the reference through
  // the field-snapshot, emitting `{ approved, postArtifactId: "" }` would
  // publish nothing while reading as a decision. Keep the buttons disabled
  // until BOTH the artifact and the revision the person continued with are
  // in hand — the revision is what is published, so a missing one is not a
  // detail that can be filled in later.
  const hasReference =
    v.postArtifactId.trim() !== "" &&
    v.postRepresentationRevisionId.trim() !== "";
  const buttonsDisabled = disabled === true || !hasReference;

  const decide = (approved: boolean) => () => {
    if (!hasReference) return;
    onChangeRef.current({
      approved,
      postArtifactId: v.postArtifactId,
      postRepresentationRevisionId: v.postRepresentationRevisionId,
    });
  };

  return (
    <Card className="border-line bg-surface backdrop-blur-none">
      <CardHeader>
        <CardTitle>Publish this post to WordPress?</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-foreground">
          The post goes to the site exactly as you continued with it. Nothing is
          created on the site until you publish here, so declining leaves the
          site untouched. The page&rsquo;s address comes back onto the post
          afterwards.
        </p>
        {v.title && (
          <p className="text-foreground">
            <span className="text-muted-foreground">Title:</span> {v.title}
          </p>
        )}
        {v.excerpt && (
          <p className="whitespace-pre-wrap text-muted-foreground">
            {v.excerpt}
          </p>
        )}
        {v.wordpressInstanceId && (
          <p className="text-muted-foreground">Site: {v.wordpressInstanceId}</p>
        )}
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={decide(false)}
          disabled={buttonsDisabled}
          type="button"
        >
          Do not publish
        </Button>
        <Button onClick={decide(true)} disabled={buttonsDisabled} type="button">
          Publish to WordPress
        </Button>
      </CardFooter>
    </Card>
  );
}
