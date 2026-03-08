const jwt = require('jsonwebtoken');

async function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const User = require('../models/User');
    const user = await User.findById(decoded.id).select('_id').lean();
    if (!user) {
      return res.status(401).json({ message: 'Session invalid: User no longer exists' });
    }

    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return [
    auth,
    (req, res, next) => {
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ message: 'Access denied' });
      }
      next();
    }
  ];
}

module.exports = { auth, requireRole };
