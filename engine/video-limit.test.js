'use strict';
const assert = require('node:assert/strict');
const { isDailyVideoLimit } = require('./video-limit');

for (const answer of [
  'Clip 200 chưa tạo được. Tài khoản vẫn đang chạm giới hạn tạo video trong 24 giờ qua, nên thử lại ngay cũng sẽ không giúp.',
  'You have reached the daily video generation limit.',
  'The 24-hour video quota has been exhausted.',
  'Bạn đã dùng hết hạn mức video trong ngày.'
  , 'Bạn không còn hạn mức tạo video trong ngày.'
  , 'Tài khoản đã hết lượt tạo video hôm nay.'
  , 'You have reached the daily limit. Video generation is unavailable.'
]) assert.equal(isDailyVideoLimit(answer), true, answer);
for (const answer of [
  'Video generation failed due to a network timeout.',
  'Bạn còn hạn mức tạo video trong 24 giờ.',
  'The daily video limit has not been reached.',
  'The weekly video quota has been exhausted.',
  'Image generation daily limit reached.',
  'Đã tạo xong video dài 24 giờ.',
  'Không tạo được video do nội dung không phù hợp.'
]) assert.equal(isDailyVideoLimit(answer), false, answer);
console.log('Daily video refusal classifier: passed');
