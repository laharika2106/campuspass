// One atomic statement checks capacity and creates/reactivates the reservation.
// SQLite serializes writes; the unique pair makes duplicate requests idempotent.
export const RESERVE_SQL = `INSERT INTO bookings (id,event_id,user_id,code,status,created_at)
SELECT ?,e.id,?,?,'confirmed',? FROM events e
WHERE e.id=? AND e.starts_at>?
AND (SELECT COUNT(*) FROM bookings b WHERE b.event_id=e.id AND b.status!='cancelled')<e.capacity
ON CONFLICT(event_id,user_id) DO UPDATE SET status='confirmed',code=excluded.code,created_at=excluded.created_at,checked_in_at=NULL
WHERE bookings.status='cancelled'`;
