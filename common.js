const {
  default: NDK,
  NDKRelaySet,
  NDKNip07Signer,
} = require('@nostr-dev-kit/ndk');

function getTags(e, name) {
  return e.tags.filter((t) => t.length > 0 && t[0] === name);
}

function getTag(e, name) {
  const tags = getTags(e, name);
  if (tags.length === 0) return null;
  return tags[0];
}

function getTagValue(e, name, index, def) {
  const tag = getTag(e, name);
  if (tag === null || !tag.length || (index && index >= tag.length))
    return def !== undefined ? def : '';
  return tag[1 + (index || 0)];
}

function getEventTagA(e) {
  let addr = e.kind + ':' + e.pubkey + ':';
  if (e.kind >= 30000 && e.kind < 40000) addr += getTagValue(e, 'd');
  return addr;
}

function dedupEvents(events) {
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

async function fetchAllEvents(reqs) {
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

function startFetch(ndk, filter) {
//  const relaySet = NDKRelaySet.fromRelayUrls(readRelays, ndk);
  // have to reimplement the ndk's fetchEvents method to allow:
  // - relaySet - only read relays to exclude the mutiny relay that returns EOSE on everything which
  // breaks the NDK's internal EOSE handling (sends eose too early assuming this "fast" relay has sent all we need)
  // - turn of NDK's dedup logic bcs it is faulty (doesn't handle 0, 3, 10k)
  return new Promise((resolve) => {
    const events = [];
    const opts = {};
    let timeout = null
    const relaySetSubscription = ndk.subscribe(
      filter,
      { ...opts, closeOnEose: true },
//      relaySet
    );
    relaySetSubscription.on('event', (event) => {
      clearTimeout(timeout)
      event.ndk = this;
      events.push(event);
    });
    relaySetSubscription.on('eose', () => {
      clearTimeout(timeout)
      resolve(events);
    });
    timeout = setTimeout(() => {
      relaySetSubscription.stop();
      console.log("relay timeout")
      resolve(events)
    }, 30000)
  });
}

module.exports = {
  getTags,
  getTag,
  getTagValue,
  getEventTagA,
  dedupEvents,
  fetchAllEvents,
  startFetch,
};
