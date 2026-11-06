'use strict';

// Inspect only Muse's answer, never the user's prompt. A mention of a limit
// without an explicit refusal is not enough to mark an account unavailable.
function isDailyVideoLimit(text) {
  const s = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
  const daily = /24\s*(?:-\s*)?(?:hour|hours|h\b|gio)|daily|per day|trong ngay|hang ngay|moi ngay|hom nay/;
  const video = /video|clip/;
  const refusal = /(?:cham|dat|vuot|het|dung het|khong con)[^.?!]{0,90}(?:gioi han|han muc|luot)|(?:gioi han|han muc)[^.?!]{0,90}(?:cham|dat|vuot|het)|(?:hit|reached|exceeded|exhausted)[^.?!]{0,90}(?:limit|quota|cap)|(?:limit|quota|cap)[^.?!]{0,90}(?:reached|exceeded|exhausted)/;
  const sentences = s.split(/[.!?\n]+/).filter(Boolean);
  return sentences.some((sentence, index) => {
    const negated = /(?:not|never)[^,;]{0,30}(?:reached|exceeded|exhausted|hit)|(?:chua|khong)[^,;]{0,20}(?:cham|dat|vuot|het)\s+(?:gioi han|han muc)/.test(sentence);
    const context = [sentences[index - 1] || '', sentence, sentences[index + 1] || ''].join(' ');
    return !negated && daily.test(sentence) && video.test(context) && refusal.test(sentence);
  });
}

function dailyVideoLimitError(text) {
  return Object.assign(new Error('Muse từ chối tạo video vì giới hạn ngày: ' + text), {
    code: 'MUSE_DAILY_VIDEO_LIMIT', museResult: true
  });
}

function isRunwayUnavailable(text) {
  const s = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  if (!/\brunway\b/.test(s)) return false;
  const sentences = s.split(/[.!?\n]+/).filter(Boolean);
  return sentences.some((sentence, i) => {
    const context = [sentences[i - 1] || '', sentence, sentences[i + 1] || ''].join(' ');
    const fail = /not connected|disconnected|unavailable|not available|connection (?:failed|error)|service (?:error|down)|internal server error|(?:http|status|error)\s*5\d\d|khong ket noi|chua ket noi|mat ket noi|khong kha dung|khong hoat dong|loi (?:ket noi|he thong|may chu)|dang (?:loi|bao tri)/;
    const negated = /(?:no|without)\s+(?:connection|service|server)\s+(?:error|failure)|(?:not|no longer)\s+(?:disconnected|unavailable)|khong (?:con )?(?:bi )?loi/.test(sentence);
    return /\brunway\b/.test(context) && fail.test(sentence) && !negated;
  });
}

function videoAvailabilityError(text) {
  if (isDailyVideoLimit(text)) return dailyVideoLimitError(text);
  if (isRunwayUnavailable(text)) return Object.assign(new Error('Muse báo Runway không khả dụng: ' + text), {
    code: 'MUSE_RUNWAY_UNAVAILABLE', museResult: true
  });
  return null;
}

module.exports = { isDailyVideoLimit, dailyVideoLimitError, isRunwayUnavailable, videoAvailabilityError };
