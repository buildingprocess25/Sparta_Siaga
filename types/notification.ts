export type DisasterNotificationType = 'earthquake' | 'heavy_rain' | 'flood' | 'tsunami';

export type NotificationChannel = 'email_and_pwa' | 'pwa_only';

export interface AffectedStoreSummary {
  kode_toko: string;
  nama_toko: string;
  cabang: string;
  distance_km: number;
  status: 'PRIORITY_MONITOR' | 'MONITOR';
  alamat?: string;
  fr_type?: string;
  latitude?: number;
  longitude?: number;
}

export interface NotificationLog {
  id: string;
  disaster_id: string;
  disaster_type: DisasterNotificationType;
  channel: NotificationChannel;
  branch: string;
  recipient_role: string;
  recipient_contact: string;
  title: string;
  message: string;
  affected_stores_count: number;
  affected_stores_sample: AffectedStoreSummary[];
  ticket_number: string;
  status: 'not_configured' | 'pending' | 'queued' | 'sent' | 'failed' | 'delivered' | 'acknowledged' | 'resolved';
  delivery_status?: 'not_configured' | 'pending' | 'queued' | 'sent' | 'delivered' | 'failed' | 'suppressed_testing_mode';
  sent_at: string;
  updated_at?: string;
  acknowledged_at?: string;
  acknowledged_by?: string;
  acknowledgment_notes?: string;
  resolved_at?: string;
  resolved_by?: string;
  resolution_notes?: string;
  store_verifications?: Record<string, 'safe' | 'damaged' | 'unverified'>;
  email_html_preview?: string;
}

export interface WorkerRunResult {
  success: boolean;
  timestamp: string;
  dispatched_count: number;
  notifications: NotificationLog[];
  evaluated_disasters: number;
  message: string;
}
