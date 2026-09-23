import studio from "../data/pursuit-of-wisdom-youtube.json";

export type StudioTrailer = {
  title: string;
  views: number;
  watchHours: number | null;
};

export type StudioYoutube = {
  available: true;
  totalViews: number;
  totalWatchHours: number;
  asOf: string;
  videos: StudioTrailer[];
};

const STALE_YOUTUBE_NOTE = /youtube/i;
const STALE_YOUTUBE_UNAVAILABLE = /unavailable|not been configured|analytics api|require a restricted/i;

export function lifetimeThroughLabel(asOf: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf);
  if (!match) return null;
  const formatted = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
  return `Lifetime through ${formatted}, from YouTube Studio.`;
}

export function studioYoutube(): StudioYoutube {
  const videos: StudioTrailer[] = studio.videos.map((video) => ({
    title: video.title,
    views: video.views,
    watchHours: video.watchHours,
  }));
  const totalViews = videos.reduce((sum, video) => sum + video.views, 0);
  const watchTenths = videos.reduce((sum, video) => {
    if (video.watchHours == null) return sum;
    return sum + Math.round(video.watchHours * 10);
  }, 0);
  return {
    available: true,
    totalViews,
    totalWatchHours: watchTenths / 10,
    asOf: studio.asOf,
    videos,
  };
}

function withoutStaleYoutubeNotes(notes: unknown[]): unknown[] {
  return notes.filter((note) => {
    if (typeof note !== "string") return true;
    return !(STALE_YOUTUBE_NOTE.test(note) && STALE_YOUTUBE_UNAVAILABLE.test(note));
  });
}

export function overlayPursuitOfWisdomYoutube<T extends Record<string, unknown>>(snapshot: T): T & { youtube: StudioYoutube } {
  const youtube = studioYoutube();
  if (!Array.isArray(snapshot.notes)) return { ...snapshot, youtube };
  return { ...snapshot, notes: withoutStaleYoutubeNotes(snapshot.notes), youtube };
}
