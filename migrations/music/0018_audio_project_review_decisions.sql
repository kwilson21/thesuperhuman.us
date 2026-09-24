-- A client's answer to a published review: approve the mix, request changes (while revision
-- rounds remain) or stop the project. Stored on the message that carries it, so the answer and
-- its notes stay one conversation entry. Additive: existing messages keep NULL.
ALTER TABLE audio_project_messages ADD COLUMN review_decision TEXT CHECK(review_decision IS NULL OR review_decision IN ('approved','changes','stopped'));
