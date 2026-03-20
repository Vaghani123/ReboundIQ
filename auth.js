// auth.js
(function () {
  'use strict';

  let currentResetUsername = null;

  // DOM Elements
  const $wrapper = document.getElementById('auth-wrapper');
  const $app = document.getElementById('app');
  const $homeView = document.getElementById('home-view');
  
  const $authCloseBtn = document.getElementById('auth-close-btn');

  // Home Triggers
  const $homeLoginBtn = document.getElementById('home-login-btn');
  const $homeSignupBtn = document.getElementById('home-signup-btn');
  const $homeCtaBtn = document.getElementById('home-cta-btn');

  // Views
  const $viewLogin = document.getElementById('view-login');
  const $viewSignup = document.getElementById('view-signup');
  const $viewRecoveryCode = document.getElementById('view-recovery-code');
  const $viewForgot = document.getElementById('view-forgot');
  const $viewReset = document.getElementById('view-reset');

  // Login
  const $loginUser = document.getElementById('login-username');
  const $loginPass = document.getElementById('login-password');
  const $loginBtn = document.getElementById('login-btn');
  const $loginError = document.getElementById('login-error');

  // Signup
  const $signupFull = document.getElementById('signup-fullname');
  const $signupUser = document.getElementById('signup-username');
  const $signupPass = document.getElementById('signup-password');
  const $signupBtn = document.getElementById('signup-btn');
  const $signupError = document.getElementById('signup-error');

  // Recovery Code Display
  const $recoveryCodeDisplay = document.getElementById('display-recovery-code');
  const $recoveryContinueBtn = document.getElementById('recovery-continue-btn');

  // Forgot Password
  const $forgotUser = document.getElementById('forgot-username');
  const $forgotCode = document.getElementById('forgot-code');
  const $verifyBtn = document.getElementById('verify-recovery-btn');
  const $forgotError = document.getElementById('forgot-error');

  // Reset Password
  const $resetPass = document.getElementById('reset-new-password');
  const $resetBtn = document.getElementById('reset-btn');
  const $resetError = document.getElementById('reset-error');

  // Links
  document.getElementById('link-signup').onclick = (e) => { e.preventDefault(); switchView($viewSignup); };
  document.getElementById('link-forgot').onclick = (e) => { e.preventDefault(); switchView($viewForgot); };
  document.getElementById('link-back-login1').onclick = (e) => { e.preventDefault(); switchView($viewLogin); };
  document.getElementById('link-back-login2').onclick = (e) => { e.preventDefault(); switchView($viewLogin); };

  function db() {
    return JSON.parse(localStorage.getItem('reboIQ_users') || '{}');
  }

  function saveDb(data) {
    localStorage.setItem('reboIQ_users', JSON.stringify(data));
  }

  function generateCode() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  }

  function switchView(view) {
    [$viewLogin, $viewSignup, $viewRecoveryCode, $viewForgot, $viewReset].forEach(v => v.classList.add('hidden'));
    document.querySelectorAll('.auth-error').forEach(e => e.classList.add('hidden'));
    view.classList.remove('hidden');
  }

  function showError($el, msg) {
    $el.textContent = msg;
    $el.classList.remove('hidden');
  }

  function showHome() {
    if ($homeView) $homeView.classList.remove('hidden');
    $wrapper.classList.add('hidden');
    $app.classList.add('hidden');
  }

  function openAuth(viewNode) {
    if ($homeView) $homeView.classList.add('hidden');
    $wrapper.classList.remove('hidden');
    switchView(viewNode);
  }

  if ($authCloseBtn) $authCloseBtn.onclick = showHome;
  if ($homeLoginBtn) $homeLoginBtn.onclick = () => openAuth($viewLogin);
  if ($homeSignupBtn) $homeSignupBtn.onclick = () => openAuth($viewSignup);
  if ($homeCtaBtn) $homeCtaBtn.onclick = () => openAuth($viewSignup);

  // Scroll Reveal Logic
  const revealElements = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-zoom');
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: "0px 0px -50px 0px" });

  revealElements.forEach(el => revealObserver.observe(el));

  // Apple-style Scroll Parallax Zoom for Main Graph and Stats
  const $heroGraph = document.getElementById('hero-preview-graph');
  const $heroStats = document.getElementById('hero-stats-bar');

  window.addEventListener('scroll', () => {
    if ($homeView && $homeView.classList.contains('hidden')) return;
    
    const winHeight = window.innerHeight;
    const windowCenter = winHeight / 2;
    const maxDistance = winHeight;

    const applyZoom = (el) => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const elementCenter = rect.top + rect.height / 2;
      const distance = Math.abs(windowCenter - elementCenter);
      
      let visibilityPcnt = 1 - (distance / maxDistance);
      if (visibilityPcnt < 0) visibilityPcnt = 0;
      
      // Scale from 0.85 -> 1.10 dynamically as it approaches the middle of the screen
      const scale = 0.85 + (visibilityPcnt * 0.25); 
      el.style.transform = `scale(${scale})`;
    };

    applyZoom($heroGraph);
    applyZoom($heroStats);
  }, { passive: true });

  // Handle Login
  $loginBtn.onclick = () => {
    const u = $loginUser.value.trim();
    const p = $loginPass.value.trim();
    if (!u || !p) return showError($loginError, "Please fill all fields.");

    const users = db();
    if (users[u] && users[u].password === p) {
      // Success
      window.currentUser = u;
      $wrapper.classList.add('hidden');
      $app.classList.remove('hidden');
      if (window.initApp) window.initApp();
    } else {
      showError($loginError, "Invalid username or password.");
    }
  };

  // Handle Signup
  $signupBtn.onclick = () => {
    const f = $signupFull.value.trim();
    const u = $signupUser.value.trim();
    const p = $signupPass.value.trim();
    
    if (!f || !u || !p) return showError($signupError, "Please fill all fields.");

    const users = db();
    if (users[u]) return showError($signupError, "Username already exists.");

    const code = generateCode();
    users[u] = {
      fullName: f,
      password: p,
      recoveryCode: code
    };
    saveDb(users);

    $recoveryCodeDisplay.textContent = code;
    switchView($viewRecoveryCode);
  };

  $recoveryContinueBtn.onclick = () => {
    switchView($viewLogin);
    $loginUser.value = $signupUser.value;
    $loginPass.value = '';
    // clear signup
    $signupFull.value = '';
    $signupUser.value = '';
    $signupPass.value = '';
  };

  // Handle Forgot
  $verifyBtn.onclick = () => {
    const u = $forgotUser.value.trim();
    const c = $forgotCode.value.trim().toUpperCase();

    if (!u || !c) return showError($forgotError, "Please fill all fields.");

    const users = db();
    if (users[u] && users[u].recoveryCode === c) {
      currentResetUsername = u;
      switchView($viewReset);
    } else {
      showError($forgotError, "Invalid username or recovery code.");
    }
  };

  // Handle Reset
  $resetBtn.onclick = () => {
    const p = $resetPass.value.trim();
    if (!p) return showError($resetError, "Password cannot be empty.");

    if (currentResetUsername) {
      const users = db();
      if (users[currentResetUsername]) {
        users[currentResetUsername].password = p;
        saveDb(users);
        switchView($viewLogin);
        $loginUser.value = currentResetUsername;
        $loginPass.value = '';
        currentResetUsername = null;
        $resetPass.value = '';
        $forgotUser.value = '';
        $forgotCode.value = '';
      }
    }
  };

  // Allow enter key
  $loginPass.addEventListener('keypress', e => { if (e.key === 'Enter') $loginBtn.click(); });
  $signupPass.addEventListener('keypress', e => { if (e.key === 'Enter') $signupBtn.click(); });
  $forgotCode.addEventListener('keypress', e => { if (e.key === 'Enter') $verifyBtn.click(); });
  $resetPass.addEventListener('keypress', e => { if (e.key === 'Enter') $resetBtn.click(); });

})();
