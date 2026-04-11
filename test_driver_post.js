const http = require('http');

const data = JSON.stringify({
  lastName: "Test",
  firstName: "Test",
  phone: "1234567890",
  login: "test123456",
  password: "password123",
  autoGenCreds: true
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/drivers',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log('STATUS:', res.statusCode, '\nBODY:', body.substring(0, 500)));
});
req.on('error', console.error);
req.write(data);
req.end();
