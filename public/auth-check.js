(function() {
  const role = localStorage.getItem('role');
  const userId = localStorage.getItem('userId');
  if (!role || !userId) {
    window.location.href = 'login.html';
    return;
  }
  if (window.requiredRole && role !== window.requiredRole) {
    alert('You do not have access to this page.');
    window.location.href = 'login.html';
  }
})();
