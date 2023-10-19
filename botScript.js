const fs = require('fs');
const { ec } = require('elliptic');
const axios = require('axios').default;
const {
  default: NDK,
  default: NDKEvent,
  NDKRelaySet,
  NDKPrivateKeySigner,
} = require('@nostr-dev-kit/ndk');

const curve = new ec('secp256k1');
const PRIVATE_KEY_PATH = './privateKey.txt';

function generatePrivateKey() {
  const keyPair = curve.genKeyPair();
  return keyPair.getPrivate('hex');
}

function getPublicKeyFromPrivateKey(privateKey) {
  const keyPair = curve.keyFromPrivate(privateKey, 'hex');
  return keyPair.getPublic(true, 'hex');
}

function readPrivateKeyFromFile(filePath) {
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8');
  }
  return null;
}

function generateAndSavePrivateKey(filePath) {
  const newPrivateKey = generatePrivateKey();
  fs.writeFileSync(filePath, newPrivateKey, 'utf8');
  return newPrivateKey;
}

let privateKey = readPrivateKeyFromFile(PRIVATE_KEY_PATH);
if (!privateKey) {
  privateKey = generateAndSavePrivateKey(PRIVATE_KEY_PATH);
}

const BOT_PUBKEY = getPublicKeyFromPrivateKey(privateKey);
const KIND_TEST = 100030117;
const KIND_REAL = 30117;

if (!privateKey) {
  privateKey = generateAndSavePrivateKey(PRIVATE_KEY_PATH);
}

const signer = new NDKPrivateKeySigner(privateKey);

const ndk = new NDK({
  relays: [
    'wss://relay.nostr.band/all',
    'wss://nos.lol',
    'wss://relay.damus.io',
    'wss://nostr.mutinywallet.com',
  ],
  signer: signer,
});

function convertToTimestamp(dateString) {
  const dateObject = new Date(dateString);
  return Math.floor(dateObject.getTime() / 1000);
}

async function publishRepo(event) {
  const ndkEvent = new NDKEvent(ndk);
  ndkEvent.kind = KIND_TEST;
  ndkEvent.pubkey = BOT_PUBKEY;
  ndkEvent.created_at = event.created_at;
  ndkEvent.content = '';
  ndkEvent.tags = event.tags;

  const relaySet = NDKRelaySet.fromRelayUrls(
    [
      'wss://relay.nostr.band/all',
      'wss://nos.lol',
      'wss://relay.damus.io',
      'wss://nostr.mutinywallet.com',
    ],
    ndk
  );
  const result = await ndkEvent.publish(relaySet);
}

async function scanGithub() {
  let page = 1;
  const baseURL =
    'https://api.github.com/search/repositories?q=nostr&per_page=100&page=';
  while (true) {
    try {
      const response = await axios.get(baseURL + page);
      if (!response.data.items.length) break;

      for (const repo of response.data.items) {
        const tags = [
          ['title', repo.name],
          ['description', repo.description],
          ['r', repo.html_url],
          ['d', `${repo.owner.login}/${repo.name}`],
          ['published_at', convertToTimestamp(repo.created_at)],
          ['alt', `Code repository: ${repo.name}`],
        ];

        if (repo.license?.key) {
          tags.push(['license', repo.license.key]);
        }

        if (repo.language) {
          tags.push(['l', repo.language, 'programming-languages']);
        }

        const event = {
          created_at: convertToTimestamp(repo.created_at),
          tags,
        };
        await publishRepo(event);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      page++;
    } catch (error) {
      console.error('Error scanning GitHub:', error);
      break;
    }
  }
}

(async () => {
  setInterval(scanGithub, 24 * 60 * 60 * 1000);
  scanGithub();
})();
