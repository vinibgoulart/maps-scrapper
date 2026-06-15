const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('./maps.html', 'utf-8');
const dom = new JSDOM(`<html><body>${html}</body></html>`);
const document = dom.window.document;

const SELECTORS = {
  resultItem: 'div[role="article"]',
  businessName: '.qBF1Pd.fontHeadlineSmall',
  ratingValue: 'span.MW4etd',
  reviewCount: 'span.UY7F9',
  phone: '.UsdlK',
  websiteLink: 'a.lcr4fd[data-value="Website"]',
  mapsLink: 'a.hfpxzc',
  highlightReview: '.ah5Ghc',
};

function parseTextContent(el) {
  return el ? el.textContent.trim().replace(/\s+/g, ' ') : '';
}

function extractLatLngFromUrl(url) {
  if (!url) return { latitude: '', longitude: '' };
  const match = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (match) return { latitude: match[1], longitude: match[2] };
  return { latitude: '', longitude: '' };
}

function extractPlaceId(url) {
  if (!url) return '';
  const match = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/);
  return match ? match[1] : '';
}

function extractBusinessData(article) {
  const name = parseTextContent(article.querySelector(SELECTORS.businessName));
  const ratingValue = parseTextContent(article.querySelector(SELECTORS.ratingValue));
  const reviewCountEl = article.querySelector(SELECTORS.reviewCount);
  const reviewCountText = parseTextContent(reviewCountEl);
  const reviewCount = reviewCountText.replace(/[^\d]/g, '');

  let category = '', address = '', hours = '', phone = '';
  const phoneEl = article.querySelector(SELECTORS.phone);
  if (phoneEl) phone = parseTextContent(phoneEl);

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
  const website = websiteEl?.getAttribute('href') || '';
  const mapsLinkEl = article.querySelector(SELECTORS.mapsLink);
  const mapsUrl = mapsLinkEl?.getAttribute('href') || '';
  const { latitude, longitude } = extractLatLngFromUrl(mapsUrl);
  const placeId = extractPlaceId(mapsUrl);
  const reviewEl = article.querySelector(SELECTORS.highlightReview);
  const highlightReview = parseTextContent(reviewEl);

  return {
    name, rating: ratingValue.replace(',', '.'),
    reviews: reviewCount, category, address, hours, phone,
    website, mapsUrl, latitude, longitude, placeId, highlightReview,
  };
}

const articles = document.querySelectorAll(SELECTORS.resultItem);
console.log(`Found ${articles.length} articles\n`);

const results = [];
articles.forEach((article, i) => {
  try {
    const data = extractBusinessData(article);
    if (data.name) results.push(data);
  } catch (e) {
    console.error(`Error on article ${i}:`, e.message);
  }
});

console.log(`Extracted ${results.length} businesses\n`);

// Validate known entries
const expected = [
  { name: 'Mecânica de Automóveis no Roçado', rating: '4.7', reviews: '59', phone: '(48) 99802-0954', category: 'Oficina mecânica', address: 'R. José João de Souza, 26' },
  { name: 'Alvorada mecânica', rating: '4.4', reviews: '183', phone: '(48) 3375-4743', category: 'Oficina mecânica', address: 'R. Jorn. Adolfo Zigueli, 79' },
  { name: 'MECÂNICA JB', rating: '4.8', reviews: '64', phone: '(48) 3259-6865', category: 'Mecânica para carros', address: 'R. José Airton de Castro, 101' },
  { name: 'Mecânica', rating: '5.0', reviews: '12', phone: '(48) 99128-5793', category: 'Mecânica para carros', address: 'R. João Grumiche, 1600' },
];

let passes = 0, fails = 0;
expected.forEach((exp, i) => {
  const actual = results[i];
  if (!actual) { console.log(`  FAIL: Missing result #${i}`); fails++; return; }
  for (const [key, val] of Object.entries(exp)) {
    if (actual[key] === val) {
      passes++;
    } else {
      console.log(`  FAIL #${i} "${exp.name}": ${key} expected "${val}" got "${actual[key]}"`);
      fails++;
    }
  }
});

console.log(`\nValidation: ${passes} passed, ${fails} failed\n`);

// Print first 5 results
console.log('--- First 5 results ---');
results.slice(0, 5).forEach((r, i) => {
  console.log(`\n${i+1}. ${r.name}`);
  console.log(`   Rating: ${r.rating} (${r.reviews} reviews)`);
  console.log(`   Category: ${r.category}`);
  console.log(`   Address: ${r.address}`);
  console.log(`   Phone: ${r.phone}`);
  console.log(`   Hours: ${r.hours}`);
  console.log(`   Website: ${r.website || '-'}`);
  console.log(`   Lat/Lng: ${r.latitude}, ${r.longitude}`);
  console.log(`   Review: ${r.highlightReview.substring(0, 60)}...`);
});

// Count stats
const withPhone = results.filter(r => r.phone).length;
const withWebsite = results.filter(r => r.website).length;
const withAddress = results.filter(r => r.address).length;
const withReview = results.filter(r => r.highlightReview).length;
const withCoords = results.filter(r => r.latitude).length;

console.log(`\n--- Stats ---`);
console.log(`Total: ${results.length}`);
console.log(`With phone: ${withPhone}`);
console.log(`With website: ${withWebsite}`);
console.log(`With address: ${withAddress}`);
console.log(`With review: ${withReview}`);
console.log(`With coordinates: ${withCoords}`);
