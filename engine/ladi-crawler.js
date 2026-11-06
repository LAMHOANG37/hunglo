/**
 * LADIPAGE CRAWLER & SCRAPER ENGINE
 * Tự động bóc tách: Ảnh gốc CDN, Bảng giá, Chính sách, USP từ link LadiPage
 */

const https = require('https');
const http = require('http');
const path = require('path');

async function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'vi,en;q=0.9'
      }
    }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          const origin = new URL(url).origin;
          redirectUrl = new URL(redirectUrl, origin).href;
        }
        return fetchHtml(redirectUrl).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP Error ${res.statusCode}`));
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ html: data, finalUrl: url }));
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Hết thời gian chờ kết nối (Timeout 15s)'));
    });
  });
}

function getEffectiveBaseUrl(url, html = '') {
  // 1. Kiểm tra thẻ <base href="..."> trong HTML
  const baseMatch = html.match(/<base[^>]+href=["']([^"']+)["']/i);
  if (baseMatch && baseMatch[1]) {
    try {
      return new URL(baseMatch[1], url).href;
    } catch {}
  }

  // 2. Chuẩn hóa URL: Nếu path không có đuôi file (.html, .php...) và chưa có '/', thêm '/'
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.endsWith('/')) {
      const ext = path.extname(parsed.pathname);
      if (!ext) {
        parsed.pathname += '/';
        return parsed.href;
      }
    }
    return parsed.href;
  } catch {
    return url.endsWith('/') ? url : url + '/';
  }
}

function extractImages(html, baseUrl) {
  const images = new Set();

  // 1. Tìm trong thẻ img src và data-src
  const imgSrcRegex = /<img[^>]+(?:src|data-src|data-original)=["']([^"']+)["']/gi;
  let match;
  while ((match = imgSrcRegex.exec(html)) !== null) {
    let img = match[1].trim();
    if (isValidProductImage(img)) images.add(normalizeUrl(img, baseUrl));
  }

  // 2. Tìm background-image trong style (LadiPage dùng rất nhiều div.ladi-image-background)
  const bgRegex = /background(?:-image)?:\s*url\(['"]?([^'"\)]+)['"]?\)/gi;
  while ((match = bgRegex.exec(html)) !== null) {
    let img = match[1].trim();
    if (isValidProductImage(img)) images.add(normalizeUrl(img, baseUrl));
  }

  // 3. Tìm data-background-image của LadiPage
  const ladiBgRegex = /data-background-image=["']([^"']+)["']/gi;
  while ((match = ladiBgRegex.exec(html)) !== null) {
    let img = match[1].trim();
    if (isValidProductImage(img)) images.add(normalizeUrl(img, baseUrl));
  }

  return Array.from(images);
}

function isValidProductImage(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('data:image')) return false;
  if (/icon|logo|badge|avatar|star|pixel|spacer|arrow|svg|loading/i.test(url)) return false;
  // Ưu tiên CDN của LadiPage hoặc ảnh dung lượng tốt
  return /\.(jpg|jpeg|png|webp|avif)/i.test(url) || url.includes('ladicdn.com') || url.includes('static.ladipage');
}

function normalizeUrl(url, baseUrl) {
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('http')) return url;
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

function extractTexts(html) {
  // Loại bỏ thẻ script, style, svg
  const cleanHtml = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');

  const textLines = [];
  const tagRegex = />([^<]+)</g;
  let match;
  while ((match = tagRegex.exec(cleanHtml)) !== null) {
    const text = match[1].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length > 2 && text.length < 500) {
      textLines.push(text);
    }
  }
  return textLines;
}

function extractPricing(textLines) {
  const prices = [];
  const priceRegex = /(\b\d{1,3}(?:[.,]\d{3})+(?:\s*(?:đ|vnđ|k|đồng))|\b\d{2,4}\s*(?:k|vnđ|đ)\b)/i;

  for (const line of textLines) {
    if (priceRegex.test(line) && line.length < 100) {
      prices.push(line);
    }
  }
  return Array.from(new Set(prices)).slice(0, 8);
}

function extractPolicies(textLines) {
  const policies = [];
  const policyKeywords = [
    /miễn\s*phí\s*vận\s*chuyển/i,
    /freeship/i,
    /kiểm\s*tra\s*hàng/i,
    /đồng\s*kiểm/i,
    /thanh\s*toán\s*khi\s*nhận/i,
    /đổi\s*trả/i,
    /bảo\s*hành/i,
    /cam\s*kết/i,
    /hoàn\s*tiền/i,
    /quà\s*tặng/i
  ];

  for (const line of textLines) {
    if (policyKeywords.some(kw => kw.test(line)) && line.length < 150) {
      policies.push(line);
    }
  }
  return Array.from(new Set(policies)).slice(0, 6);
}

async function scrapeLadiPage(url) {
  console.log('[Ladi Crawler] Bắt đầu cào URL:', url);
  const { html, finalUrl } = await fetchHtml(url);

  // Trích xuất title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : 'Sản phẩm LadiPage';

  const effectiveBaseUrl = getEffectiveBaseUrl(finalUrl || url, html);
  console.log('[Ladi Crawler] Effective Base URL:', effectiveBaseUrl);

  const images = extractImages(html, effectiveBaseUrl);
  const textLines = extractTexts(html);
  const prices = extractPricing(textLines);
  const policies = extractPolicies(textLines);

  console.log(`[Ladi Crawler] Xong! Tìm thấy ${images.length} ảnh, ${prices.length} mức giá, ${policies.length} chính sách.`);

  return {
    url,
    title,
    images: images.slice(0, 24), // Lấy tối đa 24 ảnh nét nhất
    prices,
    policies,
    textSnippet: textLines.slice(0, 100).join('\n')
  };
}

module.exports = {
  scrapeLadiPage
};
