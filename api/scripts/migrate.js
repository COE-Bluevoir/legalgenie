import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  let files = [];
  try {
    files = await fs.readdir(migrationsDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('No migrations directory found. Skipping.');
      return;
    }
    throw err;
  }
  const sqlFiles = files.filter((file) => file.endsWith('.sql')).sort();
  for (const file of sqlFiles) {
    const fullPath = path.join(migrationsDir, file);
    const sql = await fs.readFile(fullPath, 'utf8');
    console.log(`Running migration ${file}...`);
    await pool.query(sql);
  }
  console.log('Migrations complete.');
}

runMigrations()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
