require('websocket-polyfill')

const fs = require('fs');
const axios = require('axios').default;
const {
  default: NDK,
  NDKEvent,
  NDKRelaySet,
  NDKPrivateKeySigner,
} = require('@nostr-dev-kit/ndk');
const { generatePrivateKey, getPublicKey } = require('nostr-tools');

const PRIVATE_KEY_PATH = './privateKey.txt';

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

const BOT_PUBKEY = getPublicKey(privateKey);
const KIND_TEST = 100030117;
const KIND_REAL = 30117;

if (!privateKey) {
  privateKey = generateAndSavePrivateKey(PRIVATE_KEY_PATH);
}

const signer = new NDKPrivateKeySigner(privateKey);

function convertToTimestamp(dateString) {
  const dateObject = new Date(dateString);
  return Math.floor(dateObject.getTime() / 1000);
}

async function publishRepo(ndk, event) {
  const ndkEvent = new NDKEvent(ndk);
  ndkEvent.kind = KIND_TEST;
  ndkEvent.pubkey = BOT_PUBKEY;
  ndkEvent.created_at = event.created_at;
  ndkEvent.content = '';
  ndkEvent.tags = event.tags;
  console.log("publishing", JSON.stringify(ndkEvent.rawEvent()))
  const result = await ndkEvent.publish();
  console.log("result", JSON.stringify(result))
}

async function scanGithub() {
  const ndk = new NDK({
    explicitRelayUrls: [
      'wss://relay.nostr.band/all',
      'wss://nos.lol',
      'wss://relay.damus.io',
      'wss://nostr.mutinywallet.com',
    ],
    signer: signer,
  });
  
  await ndk.connect()

  let page = 1;
  const baseURL =
    'https://api.github.com/search/repositories?q=nostr&per_page=100&page=';
  while (true) {
    try {
      const response = await axios.get(baseURL + page);
      if (!response.data.items.length) break;

      for (const repo of response.data.items) {
        console.log("repo", JSON.stringify(repo))
        const tags = [
          ['title', repo.name],
          ['description', repo.description],
          ['r', repo.html_url],
          ['d', repo.html_url],
          ['published_at', ""+convertToTimestamp(repo.created_at)],
          ['alt', `Code repository: ${repo.name}`],
          ['L', 'programming-languages']
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
        await publishRepo(ndk, event);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      page++;
    } catch (error) {
      console.error('Error scanning GitHub:', error);
      break;
    }
  }

  // disconnect to release the relays etc
  for (const r of ndk.pool.relays.values())
    r.disconnect()
}

(async () => {
  setInterval(scanGithub, 24 * 60 * 60 * 1000);
  scanGithub();
})();
