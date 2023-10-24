const {
  default: NDK,
  NDKRelaySet,
  NDKNip07Signer,
} = require('@nostr-dev-kit/ndk');

const readRelays = [
  'wss://relay.nostr.band/all',
  'wss://nos.lol',
  'wss://relay.damus.io',
];
const writeRelays = [...readRelays, 'wss://nostr.mutinywallet.com']; // for broadcasting

async function createConnectNDK(custom_relays) {
  // FIXME the issue is that NDK would return EOSE even if some dumb relay
  // returns EOSE immediately w/o returning anything, while others are trying to stream the
  // data, which takes some time. And so instead of getting a merged result from
  // several relays, you get truncated result from just one of them

  const relays = [...new Set([...readRelays, ...writeRelays])];
  if (custom_relays) relays.push(...custom_relays);
  const nip07signer = nostrEnabled ? new NDKNip07Signer() : null;
  ndkObject = new NDK({ explicitRelayUrls: relays, signer: nip07signer });
  await ndkObject.connect();
}

export async function getNDK(relays) {
  if (ndkObject) {
    // FIXME add relays to the pool
    return ndkObject;
  }

  return new Promise(async function (ok) {
    await createConnectNDK(relays);
    ok(ndkObject);
  });
}

export function getTags(e, name) {
  return e.tags.filter((t) => t.length > 0 && t[0] === name);
}

export function getTag(e, name) {
  const tags = getTags(e, name);
  if (tags.length === 0) return null;
  return tags[0];
}

export function getTagValue(e, name, index, def) {
  const tag = getTag(e, name);
  if (tag === null || !tag.length || (index && index >= tag.length))
    return def !== undefined ? def : '';
  return tag[1 + (index || 0)];
}

export function getEventTagA(e) {
  let addr = e.kind + ':' + e.pubkey + ':';
  if (e.kind >= 30000 && e.kind < 40000) addr += getTagValue(e, 'd');
  return addr;
}

export function dedupEvents(events) {
  const map = {};
  for (const e of events) {
    let addr = e.id;
    if (
      e.kind === 0 ||
      e.kind === 3 ||
      (e.kind >= 10000 && e.kind < 20000) ||
      (e.kind >= 30000 && e.kind < 40000)
    ) {
      addr = getEventTagA(e);
    }
    if (!(addr in map) || map[addr].created_at < e.created_at) {
      map[addr] = e;
    }
  }
  return Object.values(map);
}

export async function fetchAllEvents(reqs) {
  const results = await Promise.allSettled(reqs);
  let events = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (r.value !== null) {
        if (typeof r.value[Symbol.iterator] === 'function')
          events.push(...r.value);
        else events.push(r.value);
      }
    }
  }
  return dedupEvents(events);
}

export function startFetch(ndk, filter) {
  const relaySet = NDKRelaySet.fromRelayUrls(readRelays, ndk);
  // have to reimplement the ndk's fetchEvents method to allow:
  // - relaySet - only read relays to exclude the mutiny relay that returns EOSE on everything which
  // breaks the NDK's internal EOSE handling (sends eose too early assuming this "fast" relay has sent all we need)
  // - turn of NDK's dedup logic bcs it is faulty (doesn't handle 0, 3, 10k)
  return new Promise((resolve) => {
    const events = [];
    const opts = {};
    const relaySetSubscription = ndk.subscribe(
      filter,
      { ...opts, closeOnEose: true },
      relaySet
    );
    relaySetSubscription.on('event', (event) => {
      event.ndk = this;
      events.push(event);
    });
    relaySetSubscription.on('eose', () => {
      resolve(events);
    });
  });
}
