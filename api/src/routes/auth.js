import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getUserByEmail } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const TOKEN_TTL = process.env.JWT_TTL || '12h';

function normalizeEmail(email = '') {
  return email.trim().toLowerCase();
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function publicUser(user) {
  return { id: user.id, email: user.email, role: user.role };
}

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }
    const user = await getUserByEmail(normalizeEmail(email));
    if (!user) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    const token = issueToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'login failed' });
  }
});
