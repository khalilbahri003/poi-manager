require('dotenv').config();
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const bcrypt = require('bcryptjs');
const db = require('../db');

(async () => {
  let rl;
  try {
    let username;
    let password;
    if (stdin.isTTY) {
      rl = readline.createInterface({ input: stdin, output: stdout });
      username = (await rl.question('Admin username (3–32 chars): ')).trim();
      password = await rl.question('Admin password (12+ chars): ');
    } else {
      const chunks = [];
      for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
      const [inputUsername = '', inputPassword = ''] = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
      username = inputUsername.trim();
      password = inputPassword;
    }
    if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username)) throw new Error('Username must use 3–32 letters, numbers, dot, dash or underscore.');
    if (password.length < 12 || password.length > 128) throw new Error('Password must be 12–128 characters.');
    const existing = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (existing > 0) throw new Error('An administrator already exists. Create additional users while signed in.');
    const hash = await bcrypt.hash(password, 12);
    db.prepare("INSERT INTO users(username,password_hash,role) VALUES (?, ?, 'admin')").run(username, hash);
    console.log('Administrator created. Sign in with that username and password.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (rl) rl.close();
    db.close();
  }
})();
