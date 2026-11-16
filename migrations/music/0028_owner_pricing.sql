-- Apply before enabling the offer-board pricing page. Does not modify existing tables or KV.
CREATE TABLE owner_pricing (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL CHECK (version > 0),
  reference_json TEXT NOT NULL CHECK (json_valid(reference_json))
);
