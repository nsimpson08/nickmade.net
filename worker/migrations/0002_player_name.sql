-- A visitor's name for their scorecards (Nick, 2026-10-18: "if its the same visitor id we capture per person, make
-- sure to save it for future use"): kept with the player, so a cleared phone or another phone (by recovery code)
-- gets it back. Nick's is always "Nick".
ALTER TABLE players ADD COLUMN name TEXT;
