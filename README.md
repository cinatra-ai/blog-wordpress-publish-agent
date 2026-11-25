# Blog WordPress Publish Agent

Publish a blog post to your WordPress site from the post itself, in the exact version you continued with, and get the page's address back on the post. Nothing reaches the site until you choose Publish on Cinatra's publish card, so declining leaves the site untouched.

To use this agent, connect a WordPress site to your Cinatra workspace via the marketplace. Then trigger the agent with three required inputs: `postArtifactId` (the blog post), `postRepresentationRevisionId` (the version you continued with) and `instanceId` (the connected site).

The run stops twice. First, Cinatra reviews that version. Then the publish card waits for your decision. Only the version the review approved is published: your version, or the new one a Regenerate made and you approved. If the review approves no version, the run stops before anything is read and says why.

After Publish, the agent creates a public page and writes its address onto the post as `wordpressPublishedUrl`. It also writes the site's id for the page (`wordpressPublishedExternalId`) and the published version (`wordpressPublishedRevisionId`). It returns `publishedUrl`, `publishedExternalId` and `approved`, and creates no new document.

The page title is the version's first heading. Without a heading, or if the version comes back cut short, nothing is published. If you decline, the site is never reached. If the site call fails, the agent returns an empty `publishedUrl` with a one-line `summary`, and writes nothing onto the post.

Common failures: wrong `instanceId`, expired WordPress credentials (reconnect in marketplace settings), or a site that cannot create posts.

## Works with

- WordPress

## Capabilities

- Publish the exact version of a post you continued with
- Wait for your decision before anything is created on the site
- Write the page's address back onto the post
- Return the address, the site's id for the page, and a one-line summary
