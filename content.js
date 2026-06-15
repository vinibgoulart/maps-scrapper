(() => {
  const SELECTORS = {
    feedContainer: 'div[role="feed"]',
    resultItem: 'div[role="article"]',
    businessName: '.qBF1Pd.fontHeadlineSmall',
    ratingBlock: 'span.ZkP5Je',
    ratingValue: 'span.MW4etd',
    reviewCount: 'span.UY7F9',
    infoRows: '.W4Efsd',
    phone: '.UsdlK',
    websiteLink: 'a.lcr4fd[data-value="Website"]',
    directionsButton: 'button[aria-label^="Ver rotas para"], a[aria-label^="Ver rotas para"]',
    mapsLink: 'a.hfpxzc',
    highlightReview: '.ah5Ghc',
    endOfList: '.HlvSq',
  };

  function getScrollContainer() {
    const feed = document.querySelector(SELECTORS.feedContainer);
    if (!feed) return null;
    let el = feed;
    while (el) {
      if (el.scrollHeight > el.clientHeight && el.clientHeight > 0) return el;
      el = el.parentElement;
    }
    return feed;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function autoScroll(onProgress) {
    const container = getScrollContainer();
    if (!container) throw new Error('Could not find scrollable results container');

    let lastHeight = 0;
    let stableCount = 0;
    const MAX_STABLE = 5;

    while (stableCount < MAX_STABLE) {
      container.scrollTo(0, container.scrollHeight);
      await sleep(800);

      const endMarker = container.querySelector(SELECTORS.endOfList);
      if (endMarker) break;

      const currentHeight = container.scrollHeight;
      if (currentHeight === lastHeight) {
        stableCount++;
      } else {
        stableCount = 0;
      }
      lastHeight = currentHeight;

      const items = container.querySelectorAll(SELECTORS.resultItem);
      if (onProgress) onProgress({ loaded: items.length, scrolling: true });
    }

    container.scrollTo(0, 0);
    await sleep(300);
  }

  function extractLatLngFromUrl(url) {
    if (!url) return { latitude: '', longitude: '' };
    const match = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (match) return { latitude: match[1], longitude: match[2] };
    const match2 = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (match2) return { latitude: match2[1], longitude: match2[2] };
    return { latitude: '', longitude: '' };
  }

  function extractPlaceId(url) {
    if (!url) return '';
    const match = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/);
    return match ? match[1] : '';
  }

  function parseTextContent(el) {
    return el ? el.textContent.trim().replace(/\s+/g, ' ') : '';
  }

  function extractBusinessData(article) {
    const name = parseTextContent(article.querySelector(SELECTORS.businessName));

    const ratingBlock = article.querySelector(SELECTORS.ratingBlock);
    const ratingLabel = ratingBlock?.getAttribute('aria-label') || '';
    const ratingValue = parseTextContent(article.querySelector(SELECTORS.ratingValue));
    const reviewCountEl = article.querySelector(SELECTORS.reviewCount);
    const reviewCountText = parseTextContent(reviewCountEl);
    const reviewCount = reviewCountText.replace(/[^\d]/g, '');

    const infoRows = article.querySelectorAll(SELECTORS.infoRows);
    let category = '';
    let address = '';
    let hours = '';
    let phone = '';

    const phoneEl = article.querySelector(SELECTORS.phone);
    if (phoneEl) phone = parseTextContent(phoneEl);

    if (infoRows.length >= 1) {
      const firstRow = infoRows[0];
      if (firstRow.closest('.AJB7ye')) {
        // This is the rating row, skip
      }
    }

    const detailRows = article.querySelectorAll('.W4Efsd > .W4Efsd');
    if (detailRows.length >= 1) {
      const firstDetailRow = detailRows[0];
      const spans = firstDetailRow.querySelectorAll(':scope > span');
      const parts = [];
      spans.forEach(span => {
        const text = span.textContent.trim().replace(/\s+/g, ' ');
        if (text && text !== '·') {
          const cleaned = text.replace(/^·\s*/, '').trim();
          if (cleaned) parts.push(cleaned);
        }
      });

      if (parts.length > 0) category = parts[0];
      for (const part of parts) {
        if (/\d/.test(part) && /[Rr]\.|[Aa]v\.|[Tt]rav\.|[Ee]str\.|[Rr]od\.|,\s*\d/.test(part)) {
          address = part;
          break;
        }
        if (part !== category && !part.includes('acessível')) {
          address = part;
        }
      }
    }

    if (detailRows.length >= 2) {
      const secondDetailRow = detailRows[1];
      const fullText = secondDetailRow.textContent.trim().replace(/\s+/g, ' ');
      const phonePart = phone ? fullText.replace(phone, '').replace(/·\s*$/, '').trim() : fullText;
      hours = phonePart.replace(/·\s*$/, '').trim();
      if (!phone) {
        const phoneMatch = fullText.match(/\(\d{2}\)\s*[\d-]+/);
        if (phoneMatch) {
          phone = phoneMatch[0];
          hours = fullText.replace(phone, '').replace(/·\s*/g, '').trim();
        }
      }
    }

    const websiteEl = article.querySelector(SELECTORS.websiteLink);
    const website = websiteEl?.href || '';

    const mapsLinkEl = article.querySelector(SELECTORS.mapsLink);
    const mapsUrl = mapsLinkEl?.href || '';
    const { latitude, longitude } = extractLatLngFromUrl(mapsUrl);
    const placeId = extractPlaceId(mapsUrl);

    const reviewEl = article.querySelector(SELECTORS.highlightReview);
    const highlightReview = parseTextContent(reviewEl);

    return {
      name,
      rating: ratingValue.replace(',', '.'),
      reviews: reviewCount,
      category,
      address,
      hours,
      phone,
      website,
      mapsUrl: mapsUrl ? decodeURIComponent(mapsUrl.replace(/&amp;/g, '&')) : '',
      latitude,
      longitude,
      placeId,
      highlightReview,
    };
  }

  function scrapeAll() {
    const articles = document.querySelectorAll(SELECTORS.resultItem);
    const results = [];
    articles.forEach(article => {
      try {
        const data = extractBusinessData(article);
        if (data.name) results.push(data);
      } catch (e) {
        console.warn('[Maps Scrapper] Failed to parse article:', e);
      }
    });
    return results;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ ok: true });
      return true;
    }

    if (msg.action === 'scrape') {
      (async () => {
        try {
          const shouldScroll = msg.autoScroll !== false;
          if (shouldScroll) {
            await autoScroll((progress) => {
              chrome.runtime.sendMessage({ type: 'progress', ...progress });
            });
          }
          const data = scrapeAll();
          sendResponse({ success: true, data, count: data.length });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (msg.action === 'scrape_visible') {
      const data = scrapeAll();
      sendResponse({ success: true, data, count: data.length });
      return true;
    }
  });
})();
