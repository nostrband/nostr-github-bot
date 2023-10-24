require('websocket-polyfill');
const fs = require('fs');
const axios = require('axios').default;
const {
  default: NDK,
  NDKEvent,
  NDKRelaySet,
  NDKPrivateKeySigner,
} = require('@nostr-dev-kit/ndk');
const { generatePrivateKey, getPublicKey, nip19 } = require('nostr-tools');
const { decode } = require('punycode');
const { fetchAllEvents, getNDK, startFetch } = require('./common');

const PRIVATE_KEY_PATH = './privateKey.txt';

const axiosInstance = axios.create({
  baseURL: '',
  headers: {
    Authorization: `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`,
  },
});

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

let page = 1;
const baseURL =
  'https://api.github.com/search/repositories?q=nostr&per_page=100&page=';
const BOT_PUBKEY = getPublicKey(privateKey);
const KIND_TEST = 100030117;
const KIND_REAL = 30117;
const REGEX = /npub1[023456789acdefghjklmnpqrstuvwxyz]{6,}/g;

if (!privateKey) {
  privateKey = generateAndSavePrivateKey(PRIVATE_KEY_PATH);
}

const signer = new NDKPrivateKeySigner(privateKey);

function convertToTimestamp(dateString) {
  const dateObject = new Date(dateString);
  return Math.floor(dateObject.getTime() / 1000);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getContributorsForRepo(contributors_url) {
  try {
    const response = await axiosInstance.get(
      contributors_url + '?per_page=100'
    );
    return response.data.map((contributor) => ({
      login: contributor.login,
      contributions: contributor.contributions,
      url: contributor.url,
    }));
  } catch (error) {
    console.error('Error fetching contributors:', error);
    return [];
  }
}

async function getUserDetails(user_url) {
  try {
    const response = await axiosInstance.get(user_url);
    const { name, twitter_username, blog, bio } = response.data;

    let pubkeyMatch = null;

    const blogMatches = blog?.match(REGEX);
    if (blogMatches && blogMatches.length > 0) {
      pubkeyMatch = blogMatches[0];
    }

    if (!pubkeyMatch) {
      const bioMatches = bio?.match(REGEX);
      if (bioMatches && bioMatches.length > 0) {
        pubkeyMatch = bioMatches[0];
      }
    }

    if (pubkeyMatch) {
      const decoded = nip19.decode(pubkeyMatch);
      if (decoded && decoded.type === 'npub') {
        pubkeyMatch = decoded.data;
      } else {
        pubkeyMatch = null;
      }
    }
    return { name, twitter_username, blog, bio, pubkey: pubkeyMatch };
  } catch (error) {
    console.error('Error fetching user details:', error);
    return null;
  }
}

async function publishRepo(ndk, event) {
  const ndkEvent = new NDKEvent(ndk);
  ndkEvent.kind = KIND_TEST;
  ndkEvent.pubkey = BOT_PUBKEY;
  ndkEvent.created_at = event.created_at;
  ndkEvent.content = '';
  ndkEvent.tags = event.tags;
  console.log('publishing', JSON.stringify(ndkEvent.rawEvent()));
  const result = await ndkEvent.publish();
  console.log('result', JSON.stringify(result));
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

  await ndk.connect();

  while (true) {
    try {
      const response = await axiosInstance.get(baseURL + page);
      for (const repo of response.data.items) {
        const tags = [
          ['title', repo.name],
          ['description', repo.description],
          ['r', repo.html_url],
          ['d', repo.html_url],
          ['published_at', '' + convertToTimestamp(repo.created_at)],
          ['alt', `Code repository: ${repo.name}`],
          ['L', 'programming-languages'],
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

        const contributors = await getContributorsForRepo(
          repo.contributors_url
        );
        await delay(1000);
        for (const contributor of contributors) {
          const userDetails = await getUserDetails(contributor.url);
          await delay(1000);
        }

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
  for (const r of ndk.pool.relays.values()) r.disconnect();
}

(async () => {
  setInterval(scanGithub, 24 * 60 * 60 * 1000);
  scanGithub();
})();
