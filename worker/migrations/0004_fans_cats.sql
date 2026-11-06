-- "Get notified" for the Cattery (src/fans.js + src/cats.js, Nick 2026-10-25): a browser signed up for "cats" is told
-- when one of its cats gets hungry or wants attention. cat_owner is the browser's owner key in the Cattery (the same
-- salted hash cats:room keeps in each cat's owners), so the visitor id itself is never stored.
ALTER TABLE fans ADD COLUMN cat_owner TEXT;
CREATE INDEX fans_cat_owner ON fans (cat_owner);
