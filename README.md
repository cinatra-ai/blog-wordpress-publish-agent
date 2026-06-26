# Blog WordPress Publish Agent

Create a WordPress draft from a Cinatra blog post — body, hero image, and metadata — and pause for your confirmation before anything goes live. Approve the draft and it stays in WordPress ready for you to publish; reject it and the agent cleans the draft right back out of WordPress for you.

To use this agent, connect a WordPress site to your Cinatra workspace via the marketplace, then trigger the agent with three required inputs: a `projectId` (your Cinatra blog project), a `postId` (the specific post to publish), and a `wordpressInstanceId` (the connected WordPress site). The agent calls `blog_post_publish_wordpress_start`, polls `blog_project_get` every five seconds for up to 60 cycles (five minutes), then surfaces a confirmation gate so you can review the post in the WordPress admin before it goes live.

On confirmation the draft remains in WordPress for you to publish when ready, and the agent returns the WordPress admin URL. On rejection the agent calls `blog_post_publish_wordpress_delete` with `deleteInWordPress: true` and removes the draft automatically. Post body and hero image are resolved server-side from artifact references; no binary content passes through the agent flow.

If draft creation fails or times out, the agent returns `approved: false` with a one-line `summary` explaining the failure. Common failure modes: wrong `wordpressInstanceId` (instance not connected), WordPress credentials expired (reconnect via marketplace settings), or a background-job timeout after five minutes (retry the agent run).

## Works with

- WordPress

## Capabilities

- Push a Cinatra blog post into WordPress as a draft, ready for final review
- Carry the hero image and post metadata across with the body
- Pause for operator confirmation before anything is published
- Remove the draft from WordPress automatically if you reject it
- Return the WordPress admin URL so you can open the draft in one click
