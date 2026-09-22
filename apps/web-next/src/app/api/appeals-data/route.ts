import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { requireReportAccess } from "@/lib/s3-proxy";
import { appealCampaign, DEFAULT_APPEAL_SLUG } from "@/lib/reports/appeals/config";

export const dynamic = "force-dynamic";
const region = process.env.AWS_REGION || "us-east-2";

async function readCache(key: string) {
  const bucket = process.env.DATA_BUCKET || "";
  if (!bucket) return null;
  try {
    const out = await new S3Client({ region }).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = await out.Body?.transformToString();
    return text ? JSON.parse(text) : null;
  } catch { return null; }
}

export async function GET(req: Request) {
  const denied = requireReportAccess(req, "advancement");
  if (denied) return denied;
  const slug = new URL(req.url).searchParams.get("campaign") || DEFAULT_APPEAL_SLUG;
  const campaign = appealCampaign(slug);
  if (!campaign) return NextResponse.json({ error: "Unknown appeal campaign" }, { status: 404 });
  const snapshot = await readCache(campaign.cacheKey) || (campaign.legacyCacheKey ? await readCache(campaign.legacyCacheKey) : null);
  if (snapshot?.summary) return NextResponse.json({ ...snapshot, campaignSlug: campaign.slug, campaign: snapshot.campaign || campaign.virtuousCampaign }, { headers: { "Cache-Control": "private, max-age=30" } });
  return NextResponse.json({
    error: "Appeal data has not been published yet.", campaignSlug: campaign.slug,
    campaign: campaign.virtuousCampaign, campaignStart: campaign.start, campaignEnd: campaign.end,
    asOf: new Date().toISOString().slice(0, 10), empty: true,
    summary: { totalRevenue: 0, totalGifts: 0, avgGift: 0, medianGift: 0, donors: 0 },
    yoy: null, giftBreakdown: [], segments: [], deferredSegments: [],
    geography: { topStates: [], donorsGeocoded: 0, donorsTotal: 0, partial: false },
    timeline: [], mailSegments: [], overlays: [],
    directMail: { status: "unavailable", audience: 0, responders: 0, responseRate: null, totalMailed: null, variants: [], mailings: [] },
    emailImport: { status: "unavailable", generatedAt: null, rows: [] },
    digitalPerformance: { status: "unavailable", generatedAt: null, rows: [] },
    emailPerformance: { status: "unavailable", generatedAt: null, sourceSyncedAt: null, segments: [] },
  }, { status: 503 });
}
