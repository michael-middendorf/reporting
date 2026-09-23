"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { lifetimeThroughLabel } from "@/lib/pursuit-of-wisdom-youtube";
import styles from "../../home.module.css";

type Trailer = { title: string; views: number; watchHours: number | null };
type Dashboard = {
  generatedAt?: string;
  website?: {
    sessions: number;
    uniqueVisitors: number;
    returningVisits: number;
    activeSeconds: number;
    pageViews: number;
    topCountries?: Array<{ country: string; sessions: number }>;
  };
  courses?: Array<{
    title: string;
    starts: number;
    completions: number;
    completionRate: number;
    watchHours: number;
    videosWatched: number;
  }>;
  sharedCourses?: Array<{ title: string; shares: number }>;
  youtube?: {
    available: boolean;
    totalViews?: number;
    totalWatchHours?: number;
    asOf?: string;
    videos?: Trailer[];
  };
  notes?: string[];
  status?: string;
  message?: string;
};

const number = new Intl.NumberFormat("en-US");
const hours = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function Card({ label, value }: { label: string; value: string }) {
  return (
    <article className={styles.card}>
      <p>{label}</p>
      <h2>{value}</h2>
    </article>
  );
}

function trailerDetail(video: Trailer): string {
  const views = `${number.format(video.views)} views`;
  if (video.watchHours == null) return `${views}. Watch hours were blank in YouTube Studio.`;
  return `${views}, ${hours.format(video.watchHours)} watch hours`;
}

export default function PursuitOfWisdomPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  useEffect(() => {
    apiFetch("/api/marketing/pursuit-of-wisdom")
      .then(async (r) => setData(await r.json()))
      .catch(() => setData({ message: "Unable to load the dashboard." }));
  }, []);
  if (!data) return <main className={styles.hub}><p className={styles.sub}>Loading dashboard…</p></main>;
  if (data.status === "pending" || data.message) {
    return (
      <main className={styles.hub}>
        <h1>Pursuit of Wisdom</h1>
        <p className={styles.sub}>{data.message}</p>
      </main>
    );
  }
  const site = data.website;
  const youtube = data.youtube;
  const studioLabel = youtube?.asOf ? lifetimeThroughLabel(youtube.asOf) : null;
  return (
    <main className={styles.hub}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Marketing / All time</div>
          <h1>Pursuit of Wisdom</h1>
          <p className={styles.sub}>Refreshed {data.generatedAt ? new Date(data.generatedAt).toLocaleString() : "pending"}. Consent-based first-party analytics.</p>
        </div>
      </header>
      <section className={styles.grid}>
        {site && (
          <>
            <Card label="Website sessions" value={number.format(site.sessions)} />
            <Card label="Unique visitors" value={number.format(site.uniqueVisitors)} />
            <Card label="Returning visits" value={number.format(site.returningVisits)} />
            <Card label="Average session duration" value={site.sessions ? `${Math.round(site.activeSeconds / site.sessions / 60)} min` : "0 min"} />
            <Card label="Pages per session" value={site.sessions ? (site.pageViews / site.sessions).toFixed(1) : "0.0"} />
          </>
        )}
      </section>
      <h2>Course engagement</h2>
      <div className={styles.grid}>
        {(data.courses || []).map((course) => (
          <article className={styles.card} key={course.title}>
            <h2>{course.title}</h2>
            <p>{number.format(course.starts)} starts, {number.format(course.completions)} completions, {(course.completionRate * 100).toFixed(0)}% completion</p>
            <p>{course.watchHours.toFixed(1)} watch hours, {number.format(course.videosWatched)} videos watched</p>
          </article>
        ))}
      </div>
      <h2>Most shared courses</h2>
      <div className={styles.grid}>
        {(data.sharedCourses || []).map((course) => (
          <Card key={course.title} label={course.title} value={`${number.format(course.shares)} shares`} />
        ))}
      </div>
      <h2>Geographic reach</h2>
      <div className={styles.grid}>
        {(site?.topCountries || []).map((place) => (
          <Card key={place.country} label={place.country} value={`${number.format(place.sessions)} sessions`} />
        ))}
      </div>
      <h2>YouTube trailers</h2>
      {youtube?.available ? (
        <>
          {studioLabel && <p className={styles.sub}>{studioLabel}</p>}
          <div className={styles.grid}>
            <Card label="Trailer views" value={number.format(youtube.totalViews || 0)} />
            <Card label="Watch hours" value={hours.format(youtube.totalWatchHours || 0)} />
          </div>
          <div className={styles.grid}>
            {(youtube.videos || []).map((video) => (
              <article className={styles.card} key={video.title}>
                <h2>{video.title}</h2>
                <p>{trailerDetail(video)}</p>
              </article>
            ))}
          </div>
          <p className={styles.sub}>Most of these views are YouTube advertising, and the United States is not a top country for most trailers.</p>
        </>
      ) : (
        <p className={styles.sub}>YouTube Studio trailer counts are not on this refresh.</p>
      )}
      <h2>Reporting notes</h2>
      <ul>
        {[...(data.notes || []), "PR and media impact: awaiting quarterly impact summary from Carmel."].map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </main>
  );
}
