const input = document.getElementById('api-key-input');
const btn = document.getElementById('btn-save');
const status = document.getElementById('status');

// Load existing key
try {
  if (!chrome || !chrome.storage) {
    showStatus('⚠️ ERROR: You opened this file directly. Please open it through the PRYZM extension popup (click the ⚙️ icon) or chrome://extensions options.', 'error');
  } else {
    chrome.storage.sync.get(['gemini_api_key'], (result) => {
      if (result.gemini_api_key) {
        input.value = result.gemini_api_key;
        showStatus('✅ API key is already configured. You\'re ready to go!', 'success');
      }
    });
  }
} catch (e) {
  console.error(e);
}

btn.addEventListener('click', async () => {
  const key = input.value.trim();
  if (!key) {
    showStatus('❌ Please paste your API key.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Testing...';

  // Test the key with a simple API call
  try {
    const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
    const resp = await fetch(testUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Say OK' }] }] })
    });

    if (resp.status === 429) {
      // Key works but rate limited — still valid
      chrome.storage.sync.set({ gemini_api_key: key });
      showStatus('✅ API key saved! (Rate limited right now — try again in a minute)', 'success');
    } else if (!resp.ok) {
      const err = await resp.text();
      showStatus(`❌ Invalid API key: ${err.substring(0, 100)}`, 'error');
    } else {
      chrome.storage.sync.set({ gemini_api_key: key });
      showStatus('✅ API key verified and saved! You can close this tab.', 'success');
    }
  } catch (err) {
    showStatus(`❌ Connection error: ${err.message}`, 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Save';
});

function showStatus(msg, type) {
  status.textContent = msg;
  status.className = `status ${type}`;
}
