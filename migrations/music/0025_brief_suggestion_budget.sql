CREATE TABLE brief_suggestion_budget (
  day TEXT NOT NULL,
  scope TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, scope)
);
