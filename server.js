const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.on('message', (msg) => {
    console.log('Received:', msg);
    ws.send(Echo: ${msg});
  });
});

const PORT = process.env.PORT || 1000;
server.listen(PORT, () => {
  console.log(Server running on port ${PORT});
})