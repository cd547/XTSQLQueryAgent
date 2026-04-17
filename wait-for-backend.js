const http = require('http');

const waitForBackend = () => {
  return new Promise((resolve) => {
    const check = () => {
      const req = http.get('http://localhost:5002/api/config/db', (res) => {
        resolve();
      });
      req.on('error', () => {
        setTimeout(check, 500);
      });
    };
    check();
  });
};

waitForBackend().then(() => {
  console.log('Backend is ready!');
  process.exit(0);
});