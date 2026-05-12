const express = require('express');
const { ExpressPeerServer } = require('peer');

const app = express();
const PORT = process.env.PORT || 9000;

app.get('/', (_req, res) => res.send('PeerJS signaling server OK'));
app.get('/health', (_req, res) => res.send('ok'));

const server = app.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});

const peerServer = ExpressPeerServer(server, { path: '/' });
app.use('/peerjs', peerServer);
