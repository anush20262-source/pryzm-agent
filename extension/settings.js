/**
 * PRYZM Settings Page (v3 — Hardened)
 * Fixes: Uses chrome.storage.local (not sync), API key in header (not URL)
 */

const input = document.getElementById('api-key-input');
const btn = document.getElementById('btn-save');
const status = document.getElementById('status');

// Load existing key
try {
  chrome.storage.local.get(['gemini_api_key'], (result) => {
    if (result.gemini_api_key) {
      // Show masked preview, not the full key
      input.placeholder = 'API key is saved (enter new key to replace)';
      showStatus('✅ API key is already configured. You\'re ready to go!', 'success');
    }
  });
} catch (e) {
  showStatus('⚠️ Please open this page through the PRYZM extension, not directly.', 'error');
}

btn.addEventListener('click', async () => {
  const key = input.value.trim();
  if (!key) {
    showStatus('❌ Please paste your API key.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Testing...';

  try {
    const testUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
    const resp = await fetch(testUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Say OK' }] }] }),
    });

    if (resp.status === 429) {
      // Key works but rate limited — still valid, save it
      chrome.storage.local.set({ gemini_api_key: key });
      showStatus('✅ API key saved! (Rate limited right now — try again in a minute)', 'success');
    } else if (!resp.ok) {
      const err = await resp.text();
      showStatus('❌ Invalid API key. Please check and try again.', 'error');
    } else {
      chrome.storage.local.set({ gemini_api_key: key });
      showStatus('✅ API key verified and saved! You can close this tab and start using PRYZM.', 'success');
    }
  } catch (err) {
    showStatus('❌ Connection error: ' + err.message, 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Save';
});

function showStatus(msg, type) {
  status.textContent = msg;
  status.className = 'status ' + type;
}
