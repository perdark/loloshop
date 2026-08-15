-- 081 — signup at the shop counter: record WHO vouched for the account.
--
-- ~65% of August's signups have no rep (measured 2026-08-15: 189 of 288, up from 27.5% in
-- June), and the owner reports most of those are students standing at the counter with a
-- staff member. Those signups still pay a WhatsApp OTP, which is the same gateway that Meta
-- bans periodically — so the most-used path to an account is also the most fragile one.
--
-- The alternative the owner first proposed was "skip the OTP when the phone's GPS is near the
-- shop". That cannot work: the server never observes location, the client STATES it, and a
-- lat/lng pair in a JSON body is not a check — it is a claim anyone can type. The real trust
-- anchor in that situation is the staff member who can see the student, and unlike a
-- coordinate, a staff session is authenticated AND attributable.
--
-- Hence this column: every account created at the counter names the employee who created it.
-- GPS keeps a role in this design, but as EVIDENCE (where was the device when this account
-- was made) and never as PERMISSION.
--
-- ON DELETE SET NULL, not CASCADE: an employee leaving must never delete the customers they
-- signed up. Losing the attribution is acceptable; losing the students is not.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Partial: only counter-created rows carry a value, and they are a minority of `users`.
-- Supports "how many accounts did this employee create", which is the question an owner
-- actually asks of this column.
CREATE INDEX IF NOT EXISTS idx_users_created_by
  ON users(created_by_user_id) WHERE created_by_user_id IS NOT NULL;
