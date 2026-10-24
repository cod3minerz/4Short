CREATE INDEX minute_reservations_failed_project_idx
  ON minute_reservations (project_id)
  WHERE status = 'active' AND project_id IS NOT NULL;
