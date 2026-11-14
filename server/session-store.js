const session = require('express-session');
const db = require('./db');

class SQLiteSessionStore extends session.Store {
  constructor() {
    super();
    this.getStatement = db.prepare('SELECT sess, expired FROM sessions WHERE sid = ?');
    this.setStatement = db.prepare(`INSERT INTO sessions(sid, sess, expired) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired = excluded.expired`);
    this.destroyStatement = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.cleanupStatement = db.prepare('DELETE FROM sessions WHERE expired <= ?');
    this.cleanupTimer = setInterval(() => {
      try { this.cleanupStatement.run(Date.now()); } catch (error) { console.error('Session cleanup failed:', error.message); }
    }, 15 * 60 * 1000);
    this.cleanupTimer.unref();
  }
  get(sid, callback) {
    try {
      const row = this.getStatement.get(sid);
      if (!row) return callback(null, null);
      if (row.expired <= Date.now()) {
        this.destroyStatement.run(sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.sess));
    } catch (error) { callback(error); }
  }
  set(sid, sess, callback = () => {}) {
    try {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 8 * 60 * 60 * 1000;
      this.setStatement.run(sid, JSON.stringify(sess), expires);
      callback(null);
    } catch (error) { callback(error); }
  }
  destroy(sid, callback = () => {}) {
    try { this.destroyStatement.run(sid); callback(null); } catch (error) { callback(error); }
  }
  touch(sid, sess, callback = () => {}) { this.set(sid, sess, callback); }
}

module.exports = SQLiteSessionStore;
