import jwt from 'jsonwebtoken';
import { getUserById } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

function extractToken(req) {
  const header = req.headers['authorization'] || req.headers['Authorization'];
  if (!header) return null;
  if (Array.isArray(header)) return null;
  const parts = header.split(' ');
  if (parts.length !== 2) return null;
  const [scheme, token] = parts;
  if (!/^Bearer$/i.test(scheme)) return null;
  return token;
}

export async function authRequired(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'authorization required' });
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'invalid token' });
    }
    const user = await getUserById(payload.sub);
    if (!user) return res.status(401).json({ error: 'user not found' });
    req.user = { id: user.id, email: user.email, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

export function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'admin access required' });
  }
  next();
}
