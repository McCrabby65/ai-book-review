# Reader comments relay (Netlify)

Readers' comments go through this small Netlify Function, which saves them to
`books/<book>/reader-comments.json` in the repo. Your GitHub token lives only in
Netlify, never in the website.

## One-time setup (about 10 minutes)

1. **Make a GitHub token.** GitHub → Settings → Developer settings → Personal access
   tokens → Fine-grained tokens → Generate new token.
   - Repository access: *Only select repositories* → `ai-book-review`
   - Permissions → Repository permissions → **Contents: Read and write**
   - Copy the token.

2. **Create the Netlify site.** Sign in at https://app.netlify.com with GitHub →
   *Add new project* → *Import an existing project* → GitHub → `ai-book-review`.
   On the build settings screen:
   - **Base directory:** `comments-relay`
   - Build command: leave empty
   - Publish directory: `comments-relay/public` (filled in from netlify.toml)
   - Functions directory: `comments-relay/netlify/functions`

3. **Add the environment variables** (on the same screen under *Add environment
   variables*, or later in Project configuration → Environment variables):

   | Key | Value | |
   |---|---|---|
   | `GITHUB_TOKEN` | the token from step 1 | tick **Contains secret values** |
   | `GITHUB_REPO` | `buswain65/ai-book-review` | |
   | `ALLOWED_ORIGINS` | `https://buswain65.github.io` | |
   | `GITHUB_BRANCH` | `main` | optional |

   Then deploy. (If you add variables after the first deploy, redeploy once:
   Deploys → Trigger deploy → Deploy project.)

4. **Point the app at it.** Put the relay address in `comment-settings.json` at the top
   of the repo, then push:

   ```json
   { "relayUrl": "https://<your-site>.netlify.app/api/comments", "requireApproval": true, "maxLength": 2000 }
   ```

## Test it

Open your book site, go to a chapter, and post a comment. It shows up in Author mode
under 💬 Comments as Pending. If it fails, look at Netlify → Logs → Functions → comments.

## Notes

- Netlify only rebuilds when something in this folder changes, so new comments and
  book edits don't use build minutes.
- `requireApproval: false` in `comment-settings.json` makes comments appear immediately.
