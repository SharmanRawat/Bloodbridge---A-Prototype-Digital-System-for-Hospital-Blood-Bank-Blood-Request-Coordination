function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const userId = parseInt(req.get('x-user-id'));
    const role = req.get('x-user-role');
    if (!userId || !allowedRoles.includes(role)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.userId = userId;
    req.userRole = role;
    next();
  };
}
module.exports = { requireRole };
