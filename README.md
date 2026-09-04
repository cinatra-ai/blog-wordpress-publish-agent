# Blog WordPress Publish Agent

Publish a blog post to your WordPress site from the post itself — the exact version you continued with — and get the page's address back on the post. You confirm before anything reaches the site, so declining leaves the site untouched.

To use this agent, connect a WordPress site to your Cinatra workspace via the marketplace, then trigger the agent with three required inputs: a `postArtifactId` (the blog post), a `postRepresentationRevisionId` (the version of it you continued with), and a `wordpressInstanceId` (the connected WordPress site). The agent reads that pinned version's words through Cinatra's own artifact reads, shows you what will go out, and only then creates the page through the WordPress connector's site catalogue.

On confirmation the page is created and the agent writes the address back onto the post itself, under `wordpressPublishedUrl`, beside the site's own id for the page (`wordpressPublishedExternalId`) and the version that was published (`wordpressPublishedRevisionId`). The agent returns those as `publishedUrl`, `publishedExternalId` and `approved`; it creates no new document of its own — a publish returns a receipt.

The page's title comes from the pinned version's own first heading, so the title and the words go out together; the post's current title is used only when the pinned words carry no heading, and the summary says so when that happens. The agent asks the site for a page that is publicly visible — a draft has no public address, so nothing is written back for one. If the pinned version comes back cut short, the agent publishes nothing rather than put out part of it.

If you decline, or the site call fails, the agent returns `approved: false` (or an empty `publishedUrl`) with a one-line `summary`, and nothing is written onto the post — never a half address, never an empty one. Common failure modes: wrong `wordpressInstanceId` (site not connected), WordPress credentials expired (reconnect via marketplace settings), or a site whose catalogue offers no ability to create a post.

## Works with

- WordPress

## Capabilities

- Publish the exact version of a post you continued with, straight from the post
- Ask you once, before anything is created on the site
- Write the page's address back onto the post, where the rest of the product can read it
- Return the address, the site's own id for the page, and a one-line summary
