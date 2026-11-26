// Start-card sign-in: Google, Kakao, or email + password, or a one-time guest run.
// Calls onReady({ mode, name }) once the player is signed in (or chose guest) and their save is loaded.
import { supabase, SUPABASE_URL } from './supabase.js';
import { store } from './store.js';

const $ = (id) => document.getElementById(id);
const here = () => location.origin + location.pathname; // OAuth and email links come back to this page

/** plain-English versions of the errors people actually hit */
function explain(err) {
  const m = (err && err.message) || String(err);
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'Confirm your email first — check your inbox for the link.';
  if (/already registered|already been registered/i.test(m)) return 'That email already has an account. Sign in instead.';
  if (/password should be at least/i.test(m)) return 'Use a password of at least 6 characters.';
  if (/rate limit|too many/i.test(m)) return 'Too many tries just now. Wait a minute and try again.';
  if (/failed to fetch|network/i.test(m)) return "Can't reach the server. Check your connection.";
  return m;
}

function displayName(user) {
  const md = user.user_metadata || {};
  const name = md.full_name || md.name || md.nickname || md.preferred_username || user.email || 'Explorer';
  const via = { google: 'Google', kakao: 'Kakao', email: 'email' }[user.app_metadata?.provider] || '';
  return via ? `${name} (${via})` : name;
}

export function createAccount({ onReady }) {
  const loading = $('auLoading'), authBox = $('authBox'), playBox = $('playBox'), resetForm = $('auReset');
  const msg = (t) => { $('auMsg').textContent = t || ''; };
  // the first screen is just two choices; the sign-in methods open on demand
  const methods = (open) => { $('authChoice').hidden = open; $('authMethods').hidden = !open; msg(''); };
  $('auOpen').addEventListener('click', () => methods(true));
  $('auBack').addEventListener('click', () => methods(false));
  const show = (which) => {
    loading.hidden = which !== 'loading';
    authBox.hidden = which !== 'auth';
    playBox.hidden = which !== 'play';
    resetForm.hidden = which !== 'reset';
  };
  let readyFor = null; // the user id whose save is loaded (null = guest)

  async function enter(user) {
    if (user && readyFor === user.id) return;
    show('loading');
    if (!user) {
      store.useGuest(); readyFor = null;
      $('whoName').textContent = 'Guest · nothing is saved';
      $('auOut').textContent = 'Sign in instead';
      show('play'); onReady({ mode: 'guest' });
      return;
    }
    try {
      const imported = await store.useAccount(user);
      readyFor = user.id;
      $('whoName').textContent = displayName(user);
      $('auOut').textContent = 'Sign out';
      show('play');
      onReady({ mode: 'account', imported });
    } catch (e) {
      show('auth'); msg("Couldn't load your save: " + explain(e));
    }
  }

  // which sign-in methods are switched on in the Supabase dashboard
  fetch(SUPABASE_URL + '/auth/v1/settings', { headers: { apikey: supabase.supabaseKey } })
    .then((r) => r.json()).then((s) => {
      for (const [id, p, label] of [['auGoogle', 'google', 'Google'], ['auKakao', 'kakao', 'Kakao']]) {
        if (!s.external?.[p]) { $(id).disabled = true; $(id).textContent = `${label} sign-in · coming soon`; }
      }
    }).catch(() => { /* offline: the buttons will explain on tap */ });

  for (const [id, provider] of [['auGoogle', 'google'], ['auKakao', 'kakao']]) {
    $(id).addEventListener('click', async () => {
      msg('');
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: here() } });
      if (error) msg(explain(error));
    });
  }

  const creds = () => ({ email: $('auEmail').value.trim(), password: $('auPass').value });
  const busy = (on) => { for (const id of ['auIn', 'auUp']) $(id).disabled = on; };
  $('auForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const c = creds();
    if (!c.email || !c.password) { msg('Enter your email and password.'); return; }
    busy(true); msg('Signing in…');
    const { data, error } = await supabase.auth.signInWithPassword(c);
    busy(false);
    if (error) msg(explain(error)); else { msg(''); enter(data.user); }
  });
  $('auUp').addEventListener('click', async () => {
    const c = creds();
    if (!/^\S+@\S+\.\S+$/.test(c.email)) { msg('Enter a valid email address.'); return; }
    if (c.password.length < 6) { msg('Use a password of at least 6 characters.'); return; }
    busy(true); msg('Creating your account…');
    const { data, error } = await supabase.auth.signUp({ ...c, options: { emailRedirectTo: here() } });
    busy(false);
    if (error) msg(explain(error));
    else if (data.session) { msg(''); enter(data.user); }
    else if (data.user && !data.user.identities?.length) msg('That email already has an account. Sign in instead.');
    else msg(`Almost there — we sent a confirmation link to ${c.email}. Open it on this device to start.`);
  });
  $('auForgot').addEventListener('click', async () => {
    const email = $('auEmail').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { msg('Type your email above first, then tap “Forgot password?”.'); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: here() + '?reset=1' });
    msg(error ? explain(error) : `If ${email} has an account, a reset link is on its way.`);
  });
  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('auNewPass').value;
    if (password.length < 6) { $('auResetMsg').textContent = 'Use at least 6 characters.'; return; }
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) { $('auResetMsg').textContent = explain(error); return; }
    enter(data.user);
  });

  $('goGuest').addEventListener('click', () => enter(null));
  $('auOut').addEventListener('click', async () => {
    const fromGuest = store.mode === 'guest'; // "Sign in instead": straight to the sign-in methods
    if (!fromGuest) { await store.flush(); await supabase.auth.signOut(); }
    readyFor = null; store.useGuest();
    methods(fromGuest); show('auth');
  });

  // back from a password-reset email: ask for the new password before going in
  // back from Google / Kakao with an error (declined, missing email…): say so instead of a silent start card
  const q = new URLSearchParams(location.search), hq = new URLSearchParams(location.hash.slice(1));
  const oauthErr = q.get('error_description') || hq.get('error_description');
  if (oauthErr) history.replaceState(null, '', here());
  const recovering = q.has('reset');
  if (recovering) history.replaceState(null, '', here() + location.hash);
  supabase.auth.onAuthStateChange((event, session) => {
    // run outside the callback: supabase-js warns against awaiting its own calls in here
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') show('reset');
      else if (event === 'SIGNED_IN' && session && !recovering && !authBox.hidden) enter(session.user);
    }, 0);
  });

  // a returning player (or one coming back from Google / Kakao / an email link) goes straight in
  supabase.auth.getSession().then(({ data }) => {
    if (data.session && recovering) show('reset');
    else if (data.session) enter(data.session.user);
    else {
      show('auth');
      if (oauthErr) {
        methods(true);
        msg(/email/i.test(oauthErr) ? "Sign-in didn't finish: we couldn't get your email from the provider. Try again and allow email access."
          : /cancel|denied|access_denied/i.test(oauthErr) ? 'Sign-in was cancelled.' : "Sign-in didn't finish: " + oauthErr);
      }
    }
  }).catch(() => { show('auth'); msg("Can't reach the server — you can still play as a guest."); });

  return {};
}
