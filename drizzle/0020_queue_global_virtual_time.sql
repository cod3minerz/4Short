ALTER TABLE queue_dispatch_states
  ADD COLUMN IF NOT EXISTS virtual_time numeric(20, 6) NOT NULL DEFAULT '0';
