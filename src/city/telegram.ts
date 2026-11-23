import type { CityListItem, Env } from "../types";
import { fetchText } from "../lib/http";
import { decodeEntities, stripTags, stripTagsOneLine } from "../lib/html";
import { parseUkrainianDate } from "../lib/date";

export const TELEGRAM_CHANNEL = "ChernivtsiCityCouncil";
export const TELEGRAM_URL = `https://t.me/s/${TELEGRAM_CHANNEL}`;

export interface TelegramPost {
  id: string;
  title: string;
  text: string;
  url: string;
  publishedAt?: string;
  image?: string;
}

function findElementInner(html: string, className: string): string | undefined {
  const classIndex = html.indexOf(className);
  if (classIndex < 0) return undefined;
  const tagStart = html.lastIndexOf("<div", classIndex);
  if (tagStart < 0) return undefined;
  const openEnd = html.indexOf(">", tagStart);
  if (openEnd < 0) return undefined;
  let depth = 1;
  const tagRe = /<div\b[^>]*>|<\/div>/gi;
  tagRe.lastIndex = openEnd + 1;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    if (match[0].startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) {
      return html.slice(openEnd + 1, match.index);
    }
  }
  return undefined;
}

export function parseTelegramPosts(html: string): TelegramPost[] {
  const positions = [...html.matchAll(/data-post="([^"]+)"/g)];
  const posts: TelegramPost[] = [];
  for (let index = 0; index < positions.length; index += 1) {
    const match = positions[index]!;
    const start = match.index ?? 0;
    const end = positions[index + 1]?.index ?? html.length;
    const block = html.slice(start, end);
    const dataPost = match[1]!;
    const textHtml = findElementInner(block, "tgme_widget_message_text");
    if (!textHtml) continue;
    const text = stripTags(textHtml).replace(/\n{3,}/g, "\n\n").trim();
    if (!text) continue;
    const publishedAt = /<time[^>]+datetime="([^"]+)"/i.exec(block)?.[1];
    const image = /background-image:url\('([^']+)'\)/i.exec(block)?.[1];
    const firstLine = text.split("\n").find((line) => line.trim().length > 0) ?? text;
    posts.push({
      id: dataPost,
      title: stripTagsOneLine(firstLine).slice(0, 180),
      text,
      url: `https://t.me/${dataPost}`,
      publishedAt,
      image,
    });
  }
  return posts;
}

export async function fetchTelegramPosts(env: Env): Promise<TelegramPost[]> {
  const html = await fetchText(TELEGRAM_URL, {
    ttlSeconds: 300,
    userAgent: env.UPSTREAM_USER_AGENT,
    cacheKey: "telegram:chernivtsi-city-council",
  });
  return parseTelegramPosts(html);
}

export function telegramToItems(posts: TelegramPost[]): CityListItem[] {
  return posts.map((post) => ({
    id: post.id,
    title: post.title,
    url: post.url,
    publishedAt: post.publishedAt,
    image: post.image,
    section: "announcements",
  }));
}

export async function fetchTelegramPost(env: Env, urlOrId: string): Promise<TelegramPost> {
  const url = /^https?:\/\//i.test(urlOrId)
    ? urlOrId
    : urlOrId.startsWith("t.me/")
      ? `https://${urlOrId}`
      : urlOrId.includes("/")
        ? `https://t.me/${urlOrId}`
        : `https://t.me/${TELEGRAM_CHANNEL}/${urlOrId}`;
  if (!/^https:\/\/t\.me\//i.test(url)) {
    throw new Error("Only Telegram post URLs are supported for this fallback.");
  }
  const html = await fetchText(url, {
    ttlSeconds: 900,
    userAgent: env.UPSTREAM_USER_AGENT,
    cacheKey: `telegram-post:${url}`,
  });
  const posts = parseTelegramPosts(html);
  if (posts.length > 0) return posts[0]!;
  const textHtml = findElementInner(html, "tgme_widget_message_text");
  const ogDescription = decodeEntities(
    /<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i.exec(html)?.[1] ?? "",
  ).trim();
  const text = textHtml ? stripTags(textHtml) : ogDescription;
  if (!text) throw new Error(`Could not parse Telegram post ${url}`);
  const firstLine = text.split("\n").find((line) => line.trim().length > 0) ?? text;
  const ogTitle = decodeEntities(
    /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i.exec(html)?.[1] ?? "",
  ).trim();
  return {
    id: url.split("/").slice(-2).join("/"),
    title: stripTagsOneLine(firstLine || ogTitle).slice(0, 180),
    text,
    url,
    publishedAt: /<time[^>]+datetime="([^"]+)"/i.exec(html)?.[1],
  };
}

export function telegramEvents(posts: TelegramPost[]) {
  const events = [];
  for (const post of posts) {
    const start = parseUkrainianDate(post.text, new Date(), true);
    if (!start) continue;
    const venue =
      /(?:📍|місце|локація|адреса)\s*:?\s*([^\n]{3,160})/i.exec(post.text)?.[1]?.trim();
    events.push({
      id: post.url,
      title: post.title,
      description: post.text.slice(0, 900),
      start,
      venue: venue ?? undefined,
      address: venue ?? undefined,
      url: post.url,
      source: "t.me/ChernivtsiCityCouncil",
      category: "official",
    });
  }
  return events;
}
