// 测试 appendFileSync 在 electron 沙箱中是否能正常工作
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '..', 'logs', 'appendFileSync-test.log');
console.log('test 1: writing...');
try {
  fs.appendFileSync(logFile, 'hello from test\n');
  console.log('test 1: write OK');
} catch (e) {
  console.error('test 1: write FAILED:', e.message);
}

console.log('test 2: readFileSync...');
try {
  const content = fs.readFileSync(logFile, 'utf8');
  console.log('test 2: read OK, content:', JSON.stringify(content));
} catch (e) {
  console.error('test 2: read FAILED:', e.message);
}

fs.unlinkSync(logFile);
console.log('done');
