-- ============================================================================
-- SPARTA SIAGA: Targeted Production Data Remediation Script
-- Remediation Reference: INC-INVESTIGATION-20261029-BDG
-- Safety: Transactional with verification counts, schema alignment, and dry-run safety
-- ============================================================================

BEGIN;

-- 1. Verify before counts with strict assertions
DO $$
DECLARE
  v_incident_count INT;
  v_notif_count INT;
  v_push_count INT;
BEGIN
  -- Check incidents (exact columns: canonical_event_id, earthquake_event_id)
  SELECT COUNT(*) INTO v_incident_count
    FROM incidents
   WHERE (canonical_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')
      OR earthquake_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002'))
     AND report_origin = 'automatic_earthquake';

  -- Check notification logs (exact columns: disaster_id, canonical_event_id)
  SELECT COUNT(*) INTO v_notif_count
    FROM notification_logs
   WHERE disaster_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')
      OR canonical_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002');

  -- Check push event deliveries (exact column: event_id)
  SELECT COUNT(*) INTO v_push_count
    FROM push_event_deliveries
   WHERE event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002');

  RAISE NOTICE 'Targeted for deletion: % incidents, % notification logs, % push event deliveries', 
    v_incident_count, v_notif_count, v_push_count;

  IF v_incident_count != 2055 THEN
    RAISE EXCEPTION 'Safety check failed: Expected exactly 2055 incidents, found %', v_incident_count;
  END IF;

  IF v_notif_count != 6 THEN
    RAISE EXCEPTION 'Safety check failed: Expected exactly 6 notification logs, found %', v_notif_count;
  END IF;

  IF v_push_count != 6 THEN
    RAISE EXCEPTION 'Safety check failed: Expected exactly 6 push deliveries, found %', v_push_count;
  END IF;
END $$;

-- 2. Delete the 6 push event delivery records
DELETE FROM push_event_deliveries
 WHERE event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002');

-- 3. Delete the 6 contaminated notification log records
DELETE FROM notification_logs
 WHERE disaster_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')
    OR canonical_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002');

-- 4. Delete the 2,055 contaminated incident records
DELETE FROM incidents
 WHERE (canonical_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')
    OR earthquake_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002'))
   AND report_origin = 'automatic_earthquake';

-- 5. Verify post-deletion counts (must be 0 remaining)
DO $$
DECLARE
  v_remaining_incidents INT;
  v_remaining_notifs INT;
  v_remaining_push INT;
BEGIN
  SELECT COUNT(*) INTO v_remaining_incidents
    FROM incidents
   WHERE canonical_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')
      OR earthquake_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002');

  SELECT COUNT(*) INTO v_remaining_notifs
    FROM notification_logs
   WHERE disaster_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002')
      OR canonical_event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002');

  SELECT COUNT(*) INTO v_remaining_push
    FROM push_event_deliveries
   WHERE event_id IN ('bmkg_p2_test_main_001', 'bmkg_p2_test_after_002');

  IF v_remaining_incidents > 0 OR v_remaining_notifs > 0 OR v_remaining_push > 0 THEN
    RAISE EXCEPTION 'Remediation verification failed: % incidents, % notifs, % push remaining', 
      v_remaining_incidents, v_remaining_notifs, v_remaining_push;
  END IF;

  RAISE NOTICE 'Remediation successful: 2055 incidents, 6 notification logs, and 6 push deliveries cleanly removed.';
END $$;

-- Execution note: To execute, replace ROLLBACK with COMMIT upon user approval.
COMMIT;
