import { getProductionDbPool } from "./db";
import { Earthquake } from "@/types/disaster";

export interface EarthquakeEventRecord {
  id: string; // canonical_event_key
  provider_event_id?: string;
  source_primary: "BMKG" | "USGS" | string;
  magnitude: number;
  depth_km: number;
  latitude: number;
  longitude: number;
  occurred_at: string;
  title: string;
  potensi_tsunami: boolean;
  potensi_text?: string;
  felt_area?: string;
  shakemap_url?: string;
  priority_radius_km: number;
  monitoring_radius_km: number;
  first_seen_at: string;
  last_seen_at: string;
  raw_metadata?: Record<string, unknown>;
}

/**
 * Upsert an earthquake into the persistent history table.
 * Idempotent: If event already exists, updates last_seen_at and metadata.
 */
export async function dbUpsertEarthquakeEvent(eq: Earthquake): Promise<void> {
  try {
    const pool = getProductionDbPool();
    const occurredAt = new Date(eq.timestamp).toISOString();
    const validatedSource = (eq.source === "BMKG" || eq.source === "USGS") ? eq.source : (eq.source || "UNVERIFIED");

    await pool.query(
      `INSERT INTO earthquake_events (
        id, provider_event_id, source_primary, magnitude, depth_km,
        latitude, longitude, occurred_at, title, potensi_tsunami,
        potensi_text, felt_area, shakemap_url, priority_radius_km,
        monitoring_radius_km, first_seen_at, last_seen_at, raw_metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW(), $16)
      ON CONFLICT (id) DO UPDATE SET
        last_seen_at = NOW(),
        shakemap_url = COALESCE(EXCLUDED.shakemap_url, earthquake_events.shakemap_url),
        felt_area = COALESCE(EXCLUDED.felt_area, earthquake_events.felt_area),
        potensi_text = COALESCE(EXCLUDED.potensi_text, earthquake_events.potensi_text),
        raw_metadata = EXCLUDED.raw_metadata;`,
      [
        eq.id,
        eq.id,
        validatedSource,
        eq.magnitude,
        eq.depthKm || 10,
        eq.latitude,
        eq.longitude,
        occurredAt,
        eq.title,
        eq.potensiTsunami ?? false,
        eq.potensiText || null,
        eq.feltArea || null,
        eq.shakemapUrl || null,
        eq.priorityRadiusKm || 50,
        eq.monitoringRadiusKm || 110,
        JSON.stringify({
          time: eq.time,
          informationType: eq.informationType,
          verificationStatus: eq.verificationStatus,
        }),
      ]
    );
  } catch (err) {
    console.warn("[Earthquake DB] Warning upserting earthquake event:", err);
  }
}

/**
 * Get earthquake event by canonical ID
 */
export async function dbGetEarthquakeEventById(id: string): Promise<EarthquakeEventRecord | null> {
  try {
    const pool = getProductionDbPool();
    const { rows } = await pool.query(
      `SELECT * FROM earthquake_events WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      provider_event_id: r.provider_event_id,
      source_primary: r.source_primary,
      magnitude: parseFloat(r.magnitude),
      depth_km: r.depth_km,
      latitude: parseFloat(r.latitude),
      longitude: parseFloat(r.longitude),
      occurred_at: r.occurred_at instanceof Date ? r.occurred_at.toISOString() : r.occurred_at,
      title: r.title,
      potensi_tsunami: r.potensi_tsunami,
      potensi_text: r.potensi_text,
      felt_area: r.felt_area,
      shakemap_url: r.shakemap_url,
      priority_radius_km: r.priority_radius_km,
      monitoring_radius_km: r.monitoring_radius_km,
      first_seen_at: r.first_seen_at instanceof Date ? r.first_seen_at.toISOString() : r.first_seen_at,
      last_seen_at: r.last_seen_at instanceof Date ? r.last_seen_at.toISOString() : r.last_seen_at,
      raw_metadata: r.raw_metadata,
    };
  } catch (err) {
    console.error("[Earthquake DB] Error fetching earthquake event:", err);
    return null;
  }
}

/**
 * Retrieve recent earthquakes from persistent database within the specified hours window (default 72h / 3 days).
 */
export async function dbGetRecentEarthquakeEvents(hours: number = 72): Promise<Earthquake[]> {
  try {
    const pool = getProductionDbPool();
    const { rows } = await pool.query(
      `SELECT * FROM earthquake_events 
       WHERE occurred_at >= NOW() - ($1 || ' hours')::interval
       ORDER BY occurred_at DESC`,
      [hours]
    );
    return rows.map((r) => {
      const timestamp = new Date(r.occurred_at).getTime();
      const sourceLabel = r.source_primary || "UNVERIFIED";
      const verificationStatus = (r.source_primary === "BMKG" ? "official" : r.source_primary === "USGS" ? "official_external" : "unverified") as any;
      return {
        id: r.id,
        source: sourceLabel,
        sourcePrimary: sourceLabel,
        canonicalEventKey: r.id,
        informationType: "official_event",
        verificationStatus,
        title: r.title,
        magnitude: parseFloat(r.magnitude),
        depth: `${r.depth_km} km`,
        depthKm: r.depth_km,
        latitude: parseFloat(r.latitude),
        longitude: parseFloat(r.longitude),
        time: new Date(r.occurred_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB",
        timestamp,
        potensiTsunami: Boolean(r.potensi_tsunami),
        potensiText: r.potensi_text || undefined,
        feltArea: r.felt_area || undefined,
        shakemapUrl: r.shakemap_url || undefined,
        isSignificant: parseFloat(r.magnitude) >= 5.5,
        priorityRadiusKm: r.priority_radius_km || 50,
        monitoringRadiusKm: r.monitoring_radius_km || 110,
      };
    });
  } catch (err) {
    console.warn("[Earthquake DB] Warning fetching recent earthquake events from DB:", err);
    return [];
  }
}
