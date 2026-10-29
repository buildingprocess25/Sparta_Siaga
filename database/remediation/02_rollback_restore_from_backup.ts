import { Pool } from "pg";
import fs from "fs";
import path from "path";

const PROD_URL = "postgresql://aku-sparta:0hhUTvTHKtgkN8TfLadC@103.127.99.241:5432/siaga";

export async function rollbackRestoreFromBackup(backupPath?: string, targetPool?: Pool) {
  const file = backupPath || path.resolve(process.cwd(), "database", "backups", "production_contaminated_data_backup_20261029.json");
  if (!fs.existsSync(file)) {
    throw new Error(`Backup file not found at: ${file}`);
  }

  const data = JSON.parse(fs.readFileSync(file, "utf-8"));
  console.log(`Loaded backup file from ${file}. Contains ${data.incidents.length} incidents and ${data.notificationLogs.length} notifs.`);

  const pool = targetPool || new Pool({ connectionString: PROD_URL, ssl: false });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    console.log("Restoring incidents...");
    for (const inc of data.incidents) {
      await client.query(
        `INSERT INTO incidents (
           id, date, disaster_type, report_origin, earthquake_event_id,
           canonical_event_id, earthquake_source, earthquake_provenance,
           tkp_type, store_id, store_name, branch, location_city,
           status, progress, disaster_metadata, affected_stores,
           affected_store_count, danger_store_count, field_photos,
           verification, maintenance_ticket, timeline, location_kind,
           location_id, location_code_snapshot, location_name_snapshot,
           location_type_snapshot, latitude_snapshot, longitude_snapshot,
           branch_snapshot, reporter, created_at, updated_at, closed_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8,
           $9, $10, $11, $12, $13,
           $14, $15, $16::jsonb, $17::jsonb,
           $18, $19, $20::jsonb,
           $21::jsonb, $22::jsonb, $23::jsonb, $24,
           $25, $26, $27,
           $28, $29, $30,
           $31, $32::jsonb, $33, $34, $35
         ) ON CONFLICT (id) DO NOTHING`,
        [
          inc.id, inc.date, inc.disaster_type, inc.report_origin, inc.earthquake_event_id,
          inc.canonical_event_id, inc.earthquake_source, inc.earthquake_provenance,
          inc.tkp_type, inc.store_id, inc.store_name, inc.branch, inc.location_city,
          inc.status, inc.progress, inc.disaster_metadata ? JSON.stringify(inc.disaster_metadata) : null,
          inc.affected_stores ? JSON.stringify(inc.affected_stores) : null, inc.affected_store_count,
          inc.danger_store_count, JSON.stringify(inc.field_photos || []),
          inc.verification ? JSON.stringify(inc.verification) : null,
          inc.maintenance_ticket ? JSON.stringify(inc.maintenance_ticket) : null,
          JSON.stringify(inc.timeline || []), inc.location_kind,
          inc.location_id, inc.location_code_snapshot, inc.location_name_snapshot,
          inc.location_type_snapshot, inc.latitude_snapshot, inc.longitude_snapshot,
          inc.branch_snapshot, inc.reporter ? JSON.stringify(inc.reporter) : null,
          inc.created_at, inc.updated_at, inc.closed_at,
        ]
      );
    }

    console.log("Restoring notification logs...");
    for (const n of data.notificationLogs) {
      await client.query(
        `INSERT INTO notification_logs (
           id, disaster_id, disaster_type, channel, branch,
           recipient_role, recipient_contact, title, message,
           affected_stores_count, affected_stores_sample, ticket_number,
           status, delivery_status, delivery_channel, delivery_attempted_at,
           delivery_error, sent_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9,
           $10, $11::jsonb, $12,
           $13, $14, $15, $16,
           $17, $18
         ) ON CONFLICT (id) DO NOTHING`,
        [
          n.id, n.disaster_id, n.disaster_type, n.channel, n.branch,
          n.recipient_role, n.recipient_contact, n.title, n.message,
          n.affected_stores_count, n.affected_stores_sample ? JSON.stringify(n.affected_stores_sample) : null,
          n.ticket_number, n.status, n.delivery_status, n.delivery_channel,
          n.delivery_attempted_at, n.delivery_error, n.sent_at,
        ]
      );
    }

    if (data.pushEventDeliveries && data.pushEventDeliveries.length > 0) {
      console.log("Restoring push event deliveries...");
      for (const p of data.pushEventDeliveries) {
        await client.query(
          `INSERT INTO push_event_deliveries (
             id, event_id, endpoint, user_id, branch,
             device_type, status, status_code, error_message, dispatched_at
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9, $10
           ) ON CONFLICT (id) DO NOTHING`,
          [
            p.id, p.event_id, p.endpoint, p.user_id, p.branch,
            p.device_type, p.status, p.status_code, p.error_message, p.dispatched_at,
          ]
        );
      }
    }

    await client.query("COMMIT");
    console.log("Rollback restore completed successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Rollback restore failed:", err);
    throw err;
  } finally {
    client.release();
    if (!targetPool) await pool.end();
  }
}

