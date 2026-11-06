/**
 * FACEBOOK GRAPH API POSTER ENGINE
 * Hỗ trợ: Kiểm tra Page Token, Đăng Facebook Reels (9:16) & Video Fanpage
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

function httpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400 || parsed.error) {
            reject(new Error(parsed.error?.message || `HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve(parsed);
          }
        } catch {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve(data);
          }
        }
      });
    });

    req.on('error', reject);
    if (postData) {
      if (Buffer.isBuffer(postData)) {
        req.write(postData);
      } else {
        req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
      }
    }
    req.end();
  });
}

// 1. Quét toàn bộ danh sách Fanpage được cấp quyền từ Token (User Token hoặc Page Token)
async function fetchFacebookPages(token) {
  if (!token) throw new Error('Vui lòng cung cấp Access Token của Facebook');

  // Cách 1: Thử gọi /me/accounts để lấy toàn bộ Fanpages mà người dùng quản lý
  try {
    const url = new URL('https://graph.facebook.com/v20.0/me/accounts');
    url.searchParams.set('fields', 'id,name,access_token,picture,category,tasks');
    url.searchParams.set('limit', '100');
    url.searchParams.set('access_token', token);

    const res = await httpsRequest({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET'
    });

    if (res && Array.isArray(res.data) && res.data.length > 0) {
      return res.data.map(p => ({
        id: p.id,
        name: p.name,
        accessToken: p.access_token || token,
        category: p.category || '',
        avatarUrl: p.picture?.data?.url || ''
      }));
    }
  } catch (errAccounts) {
    console.log('[FB Poster] /me/accounts không trả về danh sách, thử fallback /me:', errAccounts.message);
  }

  // Cách 2: Fallback nếu token dán vào là trực tiếp Page Access Token của 1 trang
  try {
    const meUrl = new URL('https://graph.facebook.com/v20.0/me');
    meUrl.searchParams.set('fields', 'id,name,picture');
    meUrl.searchParams.set('access_token', token);

    const meRes = await httpsRequest({
      hostname: meUrl.hostname,
      path: meUrl.pathname + meUrl.search,
      method: 'GET'
    });

    if (meRes && meRes.id && meRes.name) {
      return [{
        id: meRes.id,
        name: meRes.name,
        accessToken: token,
        category: 'Fanpage',
        avatarUrl: meRes.picture?.data?.url || ''
      }];
    }
  } catch (errMe) {
    throw new Error('Token không hợp lệ hoặc đã hết hạn: ' + errMe.message);
  }

  throw new Error('Không tìm thấy Fanpage nào được cấp quyền với Token này. Hãy đảm bảo bạn đã cấp quyền pages_show_list và pages_manage_posts!');
}

// 2. Kiểm tra Token và lấy thông tin Fanpage
async function verifyFacebookPageToken(pageId, pageAccessToken) {
  const url = new URL(`https://graph.facebook.com/v20.0/${pageId}`);
  url.searchParams.set('fields', 'id,name,picture');
  url.searchParams.set('access_token', pageAccessToken);

  const res = await httpsRequest({
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'GET'
  });

  return {
    success: true,
    pageId: res.id,
    pageName: res.name,
    avatarUrl: res.picture?.data?.url || ''
  };
}

// 2. Đăng Facebook Reels (Chuẩn 9:16 Video)
async function publishFacebookReels(filePath, caption, pageId, pageAccessToken) {
  if (!fs.existsSync(filePath)) {
    throw new Error('Không tìm thấy file video: ' + filePath);
  }

  const fileStats = fs.statSync(filePath);
  const fileSize = fileStats.size;

  console.log(`[FB Poster] Bước 1: Khởi tạo phiên Reels cho Page ${pageId}...`);

  // Bước 1: Initialize
  const initUrl = new URL(`https://graph.facebook.com/v20.0/${pageId}/video_reels`);
  initUrl.searchParams.set('upload_phase', 'start');
  initUrl.searchParams.set('access_token', pageAccessToken);

  const initRes = await httpsRequest({
    hostname: initUrl.hostname,
    path: initUrl.pathname + initUrl.search,
    method: 'POST'
  });

  const videoId = initRes.video_id;
  const uploadUrl = new URL(initRes.upload_url);
  console.log(`[FB Poster] Phiên tạo thành công! Video ID: ${videoId}`);

  // Bước 2: Upload Binary
  console.log(`[FB Poster] Bước 2: Upload file video (${(fileSize / 1024 / 1024).toFixed(2)} MB)...`);
  const fileBuffer = fs.readFileSync(filePath);

  await httpsRequest({
    hostname: uploadUrl.hostname,
    path: uploadUrl.pathname + uploadUrl.search,
    method: 'POST',
    headers: {
      'Authorization': `OAuth ${pageAccessToken}`,
      'offset': '0',
      'file_size': fileSize.toString(),
      'Content-Type': 'application/octet-stream'
    }
  }, fileBuffer);

  console.log('[FB Poster] Upload binary hoàn tất!');

  // Bước 3: Publish
  console.log('[FB Poster] Bước 3: Xuất bản video Reels...');
  const finishUrl = new URL(`https://graph.facebook.com/v20.0/${pageId}/video_reels`);
  finishUrl.searchParams.set('upload_phase', 'finish');
  finishUrl.searchParams.set('video_state', 'PUBLISHED');
  finishUrl.searchParams.set('video_id', videoId);
  finishUrl.searchParams.set('description', caption || '');
  finishUrl.searchParams.set('access_token', pageAccessToken);

  const finishRes = await httpsRequest({
    hostname: finishUrl.hostname,
    path: finishUrl.pathname + finishUrl.search,
    method: 'POST'
  });

  console.log('[FB Poster] ✅ Xuất bản thành công trên Facebook!', finishRes);

  return {
    success: true,
    videoId: videoId,
    postUrl: `https://facebook.com/${pageId}/videos/${videoId}`
  };
}

module.exports = {
  fetchFacebookPages,
  verifyFacebookPageToken,
  publishFacebookReels
};
