require('websocket-polyfill');
const fs = require('fs');
const axios = require('axios').default;
const {
  default: NDK,
  NDKEvent,
  NDKPrivateKeySigner,
} = require('@nostr-dev-kit/ndk');
const { generatePrivateKey, getPublicKey, nip19 } = require('nostr-tools');
const { fetchAllEvents, startFetch } = require('./common');

// constants
const PRIVATE_KEY_PATH = './privateKey.txt';
const GITHUB_TOKEN_PATH = './githubToken.txt';
const REGEX = /npub1[023456789acdefghjklmnpqrstuvwxyz]{6,}/g;
let privateKey = readFromFile(PRIVATE_KEY_PATH);
const githubToken = readFromFile(GITHUB_TOKEN_PATH);
const BOT_PUBKEY = getPublicKey(privateKey);
const baseURL =
  'https://api.github.com/search/repositories?q=nostr&per_page=100&page=';

let ndk = null;
let searchNdk = null;

const FORCE_UPDATE = false

const axiosInstance = axios.create({
  baseURL: '',
  headers: {
    Authorization: `Bearer ${githubToken}` //`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`,
  },
});

function readFromFile(filePath) {
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

if (!privateKey) {
  privateKey = generateAndSavePrivateKey(PRIVATE_KEY_PATH);
}

let page = 1;

const KIND_TEST = 9930117;
const KIND_REAL = 30117;
const KIND = KIND_REAL

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

    let npubMatch = null;

    const blogMatches = blog?.match(REGEX);
    if (blogMatches && blogMatches.length > 0) {
      npubMatch = blogMatches[0];
    }

    if (!npubMatch) {
      const bioMatches = bio?.match(REGEX);
      if (bioMatches && bioMatches.length > 0) {
        npubMatch = bioMatches[0];
      }
    }

    let pubkey = null
    if (npubMatch) {
      try {
        const decoded = nip19.decode(npubMatch);
        if (decoded && decoded.type === 'npub') {
          pubkey = decoded.data;
        }
      } catch (e) {
        console.log("bad npub", npubMatch)
      }
    }
    return { name, twitter_username, blog, bio, pubkey };
  } catch (error) {
    console.error('Error fetching user details:', error);
    return null;
  }
}

async function getPubkeyFromRelay(login, platform) {
  try {
    let query;
    if (platform === 'github') {
      query = { kinds: [0], '#i': [`github:${login}`] };
    } else if (platform === 'twitter') {
      query = { kinds: [0], '#i': [`twitter:${login}`] };
    } else {
      throw new Error('Unknown platform');
    }

    const relayResponse = await fetchAllEvents([startFetch(ndk, query)]);
    if (relayResponse.data && relayResponse.data.length > 0) {
      return relayResponse.data[0].pubkey;
    }
  } catch (error) {
    console.error(
      `Error fetching pubkey for ${platform} user ${login}:`,
      error
    );
  }
  return null;
}

async function getTwitterPubkeyFromNostrAPI(twitterUsername) {
  try {
    const response = await axiosInstance.get(
      `https://api.nostr.band/v0/twitter_pubkey/${twitterUsername}`
    );
    if (response.status === 200 && response.data && response.data.pubkey) {
      return response.data.pubkey;
    }
  } catch (error) {
    console.log(
      `Error fetching pubkey for Twitter user ${twitterUsername} from Nostr API:`+
      error
    );
  }
  return null;
}

async function searchUserOnNostrRelay(nameOrLogin) {
  try {
    const querySearch = { kinds: [0], search: `${nameOrLogin} sort:popular`, limit: 1 };
    const relayResponseSearch = await fetchAllEvents([
      startFetch(searchNdk, querySearch),
    ]);

    if (relayResponseSearch.length) {
      const event = relayResponseSearch[0]
      try {
        const profile = JSON.parse(event.content)
        if (profile.name?.toLowerCase() === nameOrLogin.toLowerCase()
          || profile.display_name?.toLowerCase() === nameOrLogin.toLowerCase())
          return event.pubkey;
      } catch {}
    }
  } catch (error) {
    console.error(`Error fetching pubkey for user ${nameOrLogin}:`, error);
  }

  return null;
}

async function getRepo(dtag) {
  try {
    const filter = { kinds: [KIND], '#d':[dtag], authors: [BOT_PUBKEY], limit: 1 };
    console.log(JSON.stringify(filter));
    const res = await fetchAllEvents([
      startFetch(ndk, filter),
    ]);

    if (res.length > 0)
      return res[0]
  } catch (error) {
    console.error(`Error fetching repo for ${drag}:`, error);
  }

  return null;
}

async function publishRepo(event) {
  const ndkEvent = new NDKEvent(ndk);
  ndkEvent.kind = KIND;
  ndkEvent.pubkey = BOT_PUBKEY;
  ndkEvent.created_at = event.created_at;
  ndkEvent.content = '';
  ndkEvent.tags = event.tags;
  console.log('publishing', JSON.stringify(await ndkEvent.toNostrEvent()));
  const result = await ndkEvent.publish();
  console.log('result', JSON.stringify(result));
}

async function scanGithub() {
  while (true) {
    searchNdk = new NDK({
      explicitRelayUrls: ['wss://relay.nostr.band/all'],
    });
    await searchNdk.connect();    

    ndk = new NDK({
      explicitRelayUrls: [
        'wss://nos.lol',
        'wss://relay.damus.io',
        'wss://nostr.mutinywallet.com'
      ],
      signer: signer,
    });
    
    await ndk.connect();
    
    try {
      const response = await axiosInstance.get(baseURL + page);
      for (const repo of response.data.items) {

        const id = repo.html_url.replace(/^https:\/\//i,'')
        const updated_at = convertToTimestamp(repo.created_at)
        //console.log("repo", JSON.stringify(repo))
        console.log("got repo", id, "updated", repo.updated_at, updated_at)

        const oldRepo = await getRepo(id)
        console.log("oldRepo", oldRepo?.id, oldRepo?.created_at)
        if (!FORCE_UPDATE && oldRepo && oldRepo.created_at >= updated_at) {
          console.log("skip, not updated")
          continue
        }

        const tags = [
          ['title', repo.name],
          ['description', repo.description],
          ['r', repo.html_url],
          ['d', id],
          ['published_at', '' + convertToTimestamp(repo.created_at)],
          ['alt', `Code repository: ${repo.name}`],
          ['L', 'programming-languages'],
        ];

        for (const t of repo.topics) {
          tags.push(['t', t])
        }

        if (repo.license?.key) {
          tags.push(['license', repo.license.key]);
        }

        if (repo.language) {
          tags.push(['l', repo.language, 'programming-languages']);
        }

        const event = {
          created_at: Math.ceil(Date.now() / 1000),
          tags,
        };

        const contributors = await getContributorsForRepo(
          repo.contributors_url
        );
        console.log("repo", repo.html_url, "contributors", contributors.length)
        for (const contributor of contributors) {
          const userDetails = await getUserDetails(contributor.url);
          console.log("user", contributor.login, "name", userDetails.name, "pubkey", userDetails.pubkey)
          let pubkey;
          if (userDetails.pubkey) {
            pubkey = userDetails.pubkey;
          }

          if (!pubkey) {
            pubkey = await getPubkeyFromRelay(contributor.login, 'github');
            console.log("github identity", pubkey)
          }
          if (!pubkey && userDetails.twitter_username) {
            pubkey = await getPubkeyFromRelay(
              userDetails.twitter_username,
              'twitter'
            );
            console.log("twitter identity", pubkey)
          }
          if (!pubkey && userDetails.twitter_username) {
            pubkey = await getTwitterPubkeyFromNostrAPI(
              userDetails.twitter_username
            );
            console.log("twitter nostr.directory", pubkey)
          }
          if (!pubkey) {
            pubkey = await searchUserOnNostrRelay(contributor.login);
            console.log("nip50 search login", pubkey)
          }
          if (!pubkey) {
            pubkey = await searchUserOnNostrRelay(userDetails.name);
            console.log("nip50 search name", pubkey)
          }
          console.log("contributor", contributor.login, userDetails.name, contributor.contributions, pubkey)
          if (pubkey) {
            event.tags.push(['p', pubkey, 'contributor']);
            event.tags.push(['zap', pubkey, "wss://relay.nostr.band", String(contributor.contributions)]);
          }
          await delay(1000);
        }
        await publishRepo(event);
        await delay(5000);
    }
      page++;
    } catch (error) {
      console.error('Error scanning GitHub:', error);
      break;
    }
  }
  // disconnect to release the relays etc
  for (const r of ndk.pool.relays.values()) r.disconnect();
  for (const r of searchNdk.pool.relays.values()) r.disconnect();
  ndk = null;
  searchNdk = null;
}

(async () => {
  setInterval(scanGithub, 24 * 60 * 60 * 1000);
  scanGithub();
})();
