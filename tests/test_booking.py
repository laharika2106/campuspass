"""Run: python tests/test_booking.py. Uses the application's actual reservation SQL."""
import concurrent.futures
import pathlib
import re
import sqlite3
import tempfile
import unittest
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
SQL = re.search(r'RESERVE_SQL = `([\s\S]*?)`', (ROOT / 'lib/booking-sql.ts').read_text()).group(1)
NOW = '2026-09-29T12:00:00.000Z'

class BookingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(pathlib.Path(self.tmp.name) / 'campus.db')
        with self.connect() as db:
            for migration in sorted((ROOT / 'drizzle').glob('*.sql')):
                db.executescript(migration.read_text())
            db.executemany('INSERT INTO users VALUES(?,?,?,?,?)', [(str(i), 'Student '+str(i),str(i)+'@example.test','organizer' if i==0 else 'student',NOW) for i in range(30)])
            db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', ('event','Test event','Test description','Technology','Test club','Test venue','2027-01-01T10:00:00.000Z','2027-01-01T12:00:00.000Z',1,'0',0,NOW))
    def tearDown(self): self.tmp.cleanup()
    def connect(self):
        db=sqlite3.connect(self.path,timeout=20)
        db.execute('PRAGMA foreign_keys=ON')
        return db
    def reserve(self,user):
        with self.connect() as db:
            db.execute(SQL,(str(uuid.uuid4()),str(user),str(uuid.uuid4()),NOW,'event',NOW))
    def test_twenty_requests_for_last_seat(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
            list(pool.map(self.reserve,range(1,21)))
        with self.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM bookings WHERE status!='cancelled'").fetchone()[0],1)
    def test_duplicate_booking_is_one_ticket(self):
        with self.connect() as db: db.execute('UPDATE events SET capacity=20')
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            list(pool.map(self.reserve,[1]*10))
        with self.connect() as db: self.assertEqual(db.execute('SELECT COUNT(*) FROM bookings').fetchone()[0],1)
    def test_cancellation_releases_seat_and_rebooking_rotates_code(self):
        self.reserve(1)
        with self.connect() as db:
            old=db.execute('SELECT code FROM bookings').fetchone()[0]
            db.execute("UPDATE bookings SET status='cancelled'")
        self.reserve(2)
        with self.connect() as db:
            self.assertEqual(db.execute("SELECT user_id FROM bookings WHERE status='confirmed'").fetchone()[0],'2')
            db.execute("UPDATE bookings SET status='cancelled' WHERE user_id='2'")
        self.reserve(1)
        with self.connect() as db:
            self.assertNotEqual(old,db.execute("SELECT code FROM bookings WHERE user_id='1'").fetchone()[0])
    def test_checkin_is_single_use_and_keeps_capacity(self):
        self.reserve(1)
        with self.connect() as db:
            self.assertEqual(db.execute("UPDATE bookings SET status='checked_in' WHERE user_id='1' AND status='confirmed'").rowcount,1)
            self.assertEqual(db.execute("UPDATE bookings SET status='checked_in' WHERE user_id='1' AND status='confirmed'").rowcount,0)
        self.reserve(2)
        with self.connect() as db: self.assertEqual(db.execute('SELECT COUNT(*) FROM bookings').fetchone()[0],1)
    def test_past_event_cannot_be_reserved(self):
        with self.connect() as db: db.execute("UPDATE events SET starts_at='2020-01-01T10:00:00.000Z'")
        self.reserve(1)
        with self.connect() as db: self.assertEqual(db.execute('SELECT COUNT(*) FROM bookings').fetchone()[0],0)
    def test_count_query_uses_index(self):
        with self.connect() as db:
            plan=db.execute("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM bookings WHERE event_id=? AND status!='cancelled'",('event',)).fetchall()
            self.assertTrue(any('idx_bookings_event_status' in str(row) for row in plan))

if __name__=='__main__': unittest.main(verbosity=2)
