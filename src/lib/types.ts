// Core data objects (PRD §4.4). Single source of truth for shapes used across
// the data layer and the surfaces.

export const CATEGORIES = ["Automotive", "Islamic", "History", "AI-Tech"] as const;
export type Category = (typeof CATEGORIES)[number];

export type ChannelConfig = {
  handle: string;
  channelId: string;
  /** Uploads playlist id. UULF (long-form only) preferred; UU (full) is the fallback. */
  uploadsPlaylistId: string;
  category: Category;
};

export type Video = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  channelAvatarUrl: string;
  title: string;
  thumbnailUrl: string;
  durationSec: number; // parsed from ISO 8601
  viewCount: number;
  likeCount: number;
  publishedAt: string; // ISO timestamp
  category: Category;
};

export type ChannelMeta = {
  channelId: string;
  title: string;
  handle: string;
  avatarUrl: string;
  bannerUrl: string | null;
  subscriberCount: number;
  hiddenSubscriberCount: boolean;
  description: string;
  category: Category;
};

export type WatchState = {
  videoId: string;
  visited: boolean;
  watchedSec: number;
  lastSeenAt: string;
};

export type SortMode = "latest" | "popular" | "oldest";
