let scrapedData = [];

const $ = (sel) => document.querySelector(sel);
const show = (el) => { el.style.display = ''; };
const hide = (el) => { el.style.display = 'none'; };

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isGoogleMapsTab(tab) {
  return tab?.url?.includes('google.com/maps') || tab?.url?.includes('google.com.br/maps');
}

async function ensureContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    return response?.ok;
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      return true;
    } catch (e) {
      console.error('Failed to inject content script:', e);
      return false;
    }
  }
}

function setLoading(loading) {
  const btnScrape = $('#btn-scrape');
  const btnVisible = $('#btn-scrape-visible');
  btnScrape.disabled = loading;
  btnVisible.disabled = loading;
  if (loading) {
    btnScrape.classList.add('loading');
    show($('#progress'));
  } else {
    btnScrape.classList.remove('loading');
    hide($('#progress'));
  }
}

function showError(message) {
  const el = $('#error');
  $('#error-text').textContent = message;
  show(el);
  setTimeout(() => hide(el), 5000);
}

function renderTable(data) {
  const tbody = $('#table-body');
  tbody.innerHTML = '';

  data.forEach((item, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td class="name-cell" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</td>
      <td class="center">${item.rating || '-'}</td>
      <td class="center">${item.reviews || '-'}</td>
      <td title="${escapeHtml(item.category)}">${escapeHtml(item.category)}</td>
      <td title="${escapeHtml(item.address)}">${escapeHtml(item.address)}</td>
      <td class="nowrap">${escapeHtml(item.phone)}</td>
      <td title="${escapeHtml(item.hours)}">${escapeHtml(item.hours)}</td>
      <td>${item.website ? `<a href="${escapeHtml(item.website)}" target="_blank" title="${escapeHtml(item.website)}">Link</a>` : '-'}</td>
    `;
    tbody.appendChild(tr);
  });

  $('#result-count').textContent = data.length;
  show($('#results'));
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function dataToCSV(data) {
  const headers = [
    'Name', 'Rating', 'Reviews', 'Category', 'Address', 'Hours',
    'Phone', 'Website', 'Google Maps URL', 'Latitude', 'Longitude',
    'Place ID', 'Highlight Review'
  ];

  const csvEscape = (val) => {
    if (!val) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = data.map(item => [
    item.name, item.rating, item.reviews, item.category, item.address,
    item.hours, item.phone, item.website, item.mapsUrl, item.latitude,
    item.longitude, item.placeId, item.highlightReview,
  ].map(csvEscape).join(','));

  return '\uFEFF' + [headers.join(','), ...rows].join('\n');
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getTimestamp() {
  return new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
}

async function doScrape(autoScroll) {
  hide($('#error'));
  const tab = await getActiveTab();

  if (!isGoogleMapsTab(tab)) {
    show($('#not-maps'));
    return;
  }
  hide($('#not-maps'));

  const injected = await ensureContentScript(tab.id);
  if (!injected) {
    showError('Could not connect to the page. Try refreshing Google Maps.');
    return;
  }

  setLoading(true);
  $('#progress-text').textContent = autoScroll
    ? 'Scrolling to load all results...'
    : 'Scraping visible results...';

  try {
    const action = autoScroll ? 'scrape' : 'scrape_visible';
    const response = await chrome.tabs.sendMessage(tab.id, {
      action,
      autoScroll: autoScroll && $('#auto-scroll').checked,
    });

    if (response?.success) {
      scrapedData = response.data;
      renderTable(scrapedData);
      $('#progress-text').textContent = `Done! ${response.count} businesses extracted.`;
    } else {
      showError(response?.error || 'Unknown error during scraping.');
    }
  } catch (err) {
    showError(`Scraping failed: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'progress') {
    $('#progress-text').textContent = `Loading results... ${msg.loaded || 0} found so far`;
    const fill = $('#progress-fill');
    fill.style.width = `${Math.min((msg.loaded || 0) / 20 * 100, 95)}%`;
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  const tab = await getActiveTab();
  if (!isGoogleMapsTab(tab)) {
    show($('#not-maps'));
    $('#btn-scrape').disabled = true;
    $('#btn-scrape-visible').disabled = true;
  }

  $('#btn-scrape').addEventListener('click', () => doScrape(true));
  $('#btn-scrape-visible').addEventListener('click', () => doScrape(false));

  $('#btn-csv').addEventListener('click', () => {
    if (!scrapedData.length) return;
    const csv = dataToCSV(scrapedData);
    downloadFile(csv, `maps-scrapper-${getTimestamp()}.csv`, 'text/csv;charset=utf-8;');
  });

  $('#btn-json').addEventListener('click', () => {
    if (!scrapedData.length) return;
    const json = JSON.stringify(scrapedData, null, 2);
    downloadFile(json, `maps-scrapper-${getTimestamp()}.json`, 'application/json');
  });

  $('#btn-copy').addEventListener('click', async () => {
    if (!scrapedData.length) return;
    const text = dataToCSV(scrapedData);
    await navigator.clipboard.writeText(text);
    const btn = $('#btn-copy');
    const original = btn.innerHTML;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6 10.8l-3.4-3.4L1.2 8.8l4.8 4.8L16 3.6l-1.4-1.4z"/></svg> Copied!';
    setTimeout(() => { btn.innerHTML = original; }, 2000);
  });
});
