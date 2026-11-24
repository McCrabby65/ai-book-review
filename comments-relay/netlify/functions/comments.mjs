/**
 * AI Critic Forge — reader comments relay (Netlify Function)
 *
 * Readers post a comment to this function; it appends the comment to
 *   books/<bookId>/reader-comments.json
 * in your GitHub repo. Your GitHub token stays in Netlify as a secret and is never
 * sent to the browser. This function only ever writes reader-comments.json files.
 *
 * SETUP (one time, about 10 minutes): see comments-relay/README.md
 *
 * Settings read from comment-settings.json in the repo:
 *   requireApproval (true/false) — new comments start as "pending" until you approve them
 *   maxLength       (number)     — longest comment allowed, in characters
 */

import { randomUUID } from 'node:crypto';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,150}$/;
const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export async function handle(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const cors = {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : (allowed[0] || ''),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
  const reply = (status, body) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' }
  });

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });
  if (!allowed.includes(origin)) return reply(403, { error: 'This site is not allowed to post comments.' });
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return reply(500, { error: 'The comment relay is not configured yet.' });

  let input;
  try { input = await request.json(); } catch { return reply(400, { error: 'Invalid request.' }); }

  // Honeypot: a hidden field real readers never fill in.
  if (input.website) return reply(200, { ok: true, status: 'pending' });

  const bookId = String(input.bookId || '');
  const chapterId = String(input.chapterId || '');
  const text = String(input.text || '').replace(/\r\n/g, '\n').trim();
  const login = String(input.githubUser || '').trim().replace(/^@/, '');
  if (!ID_RE.test(bookId) || !ID_RE.test(chapterId)) return reply(400, { error: 'Unknown book or chapter.' });
  if (login && !GITHUB_LOGIN_RE.test(login)) return reply(400, { error: "That doesn't look like a GitHub username." });

  const gh = github(env);
  const settings = await gh.readJson('comment-settings.json').then(r => r.data || {}).catch(() => ({}));
  const maxLength = Number(settings.maxLength) > 0 ? Number(settings.maxLength) : 2000;
  if (!text) return reply(400, { error: 'Please write a comment first.' });
  if (text.length > maxLength) return reply(400, { error: `Comments can be up to ${maxLength} characters.` });

  // The book and chapter must really exist.
  const index = await gh.readJson('books.json').catch(() => null);
  const book = index && index.data && (index.data.books || []).find(b => b.id === bookId);
  if (!book || !(book.chapters || []).some(c => c.id === chapterId)) return reply(400, { error: 'Unknown book or chapter.' });

  const comment = {
    id: randomUUID(),
    chapterId,
    text,
    author: login ? { type: 'github', login, verified: false } : { type: 'anonymous' },
    createdAt: new Date().toISOString(),
    status: settings.requireApproval === false ? 'approved' : 'pending'
  };

  // Append and commit; retry if someone else changed the file at the same moment.
  const path = `books/${bookId}/reader-comments.json`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await gh.readJson(path).catch(() => ({ data: null, sha: null }));
    const data = current.data && Array.isArray(current.data.comments) ? current.data : { comments: [] };
    data.comments.push(comment);
    const res = await gh.writeJson(path, data, current.sha,
      `Reader comment on ${chapterId}${login ? ` by @${login}` : ' (anonymous)'}`);
    if (res.ok) return reply(200, { ok: true, status: comment.status, comment });
    if (res.status !== 409 && res.status !== 422) return reply(502, { error: "Couldn't save the comment. Please try again later." });
  }
  return reply(503, { error: 'The comments are busy right now. Please try again.' });
}

function github(env) {
  const base = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/`;
  const branch = env.GITHUB_BRANCH || 'main';
  const headers = {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'ai-critic-forge-comments'
  };
  return {
    async readJson(path) {
      const res = await fetch(`${base}${path}?ref=${encodeURIComponent(branch)}`, { headers });
      if (res.status === 404) return { data: null, sha: null };
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const file = await res.json();
      return { data: JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')), sha: file.sha };
    },
    async writeJson(path, data, sha, message) {
      return fetch(`${base}${path}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8').toString('base64'), branch, ...(sha ? { sha } : {}) })
      });
    }
  };
}


const ENV_KEYS = ['GITHUB_TOKEN', 'GITHUB_REPO', 'ALLOWED_ORIGINS', 'GITHUB_BRANCH'];
const readEnv = k => (globalThis.Netlify && globalThis.Netlify.env ? globalThis.Netlify.env.get(k) : undefined) ?? process.env[k];

export default async (request) => handle(request, Object.fromEntries(ENV_KEYS.map(k => [k, readEnv(k)])));

// The relay's address will be https://<your-site>.netlify.app/api/comments
export const config = { path: '/api/comments' };
