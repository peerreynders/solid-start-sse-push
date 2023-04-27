# SolidStart SSE Push 

TL;DR: Wanting to understand [server-sent events (sse)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) in more detail; chose to scan though [Data Push Applications Using HTML5 SSE](https://play.google.com/store/books/details/Darren_Cook_Data_Push_Apps_with_HTML5_SSE?id=7gYiAwAAQBAJ) (2014) ([repo](https://github.com/DarrenCook/ssebook)) and then reinforce learning by implementing many of the concepts in a [SolidStart](https://start.solidjs.com/) demo.

## Background

The remix-run examples feature an [sse-counter](https://github.com/remix-run/examples/tree/main/sse-counter) which uses remix-utils' [`useEventSource`](https://github.com/sergiodxa/remix-utils/blob/main/src/react/use-event-source.tsx) hook to access server-sent events. Unfortunately each invocation of of `useEventSource` creates it's **own** instance of [`EventSource`](https://developer.mozilla.org/en-US/docs/Web/API/EventSource).

That approach may work over HTTP/2 and later but browser's enforce a browser-wide 6 connection per domain limit for HTTP/1.1 and each `EventSource` instance ties up a single connection for the domain (over the whole browser, not just the page). Because of this limitation the [HTML Living Standard](https://html.spec.whatwg.org/multipage/server-sent-events.html#authoring-notes) recommends:

> Clients that support HTTP's per-server connection limitation might run into trouble **when opening multiple pages from a site if each page has an `EventSource` to the same domain**. Authors can avoid this using the relatively complex mechanism of using unique domain names per connection, or by allowing the user to enable or disable the `EventSource` functionality on a per-page basis, or by sharing a single `EventSource` object using a [shared worker](https://html.spec.whatwg.org/multipage/workers.html#sharedworkerglobalscope). 

… i.e. one **single** `EventSource` instance should be serving the entire web application as some sort of server-client event bus. It's likely a mistake to create that `EventSource` inside an ordinary component. It more likely should be managed centrally by a provider that makes it possible for components to subscribe to relevant events.  

Websockets are frequently suggested as a better alternative as they support bi-directional communication but Websockets are a protocol separate from [HTTP](https://datatracker.ietf.org/doc/html/rfc8441) which needs to be brought forward separately after each HTTP revision.

There are scenarios where server-sent events can be more effective:
* [Using Server-Sent Events to Simplify Real-time Streaming at Scale](https://shopify.engineering/server-sent-events-data-streaming)
* [SSE vs WebSockets vs Long Polling. Martin Chaov. JS Fest 2018](https://youtu.be/n9mRjkQg3VE)

(Though in some instances [Fat Events](https://youtu.be/jdliXz70NtM?t=716) can become a problem)

This demonstration application outlines the solution approach envisioned by porting various aspects of the PHP sample application *FX Client* (Foreign eXchange) of [Data Push Applications Using HTML5 SSE](https://github.com/DarrenCook/ssebook) to [SolidStart](https://start.solidjs.com/getting-started/what-is-solidstart).

## Discussion

### Client Page (Component)

Here the client route (page) isn't even aware that an event source is being used as the page consumes a context provided store, obtained with `usePairData()`, that exposes the data that is aggregated from the realtime events.

```TypeScript
// file: src/routes/index.tsx
// …

// --- START server side ---
import {
  createServerData$,
  type ServerFunctionEvent,
} from 'solid-start/server';

import { getUserPairs } from '~/server/session';

function userFxPairs(this: ServerFunctionEvent) {
  return getUserPairs(this.request);
}

// --- END server side ---

export function routeData() {
  return createServerData$(userFxPairs);
}
```

The `routeData()` simply provides the page with the *foreign exchange pairs* (e.g. `USD/JPY`, `EUR/USD`, `AUD/GBP`) which the page (based on the logged-in user) will have access to.

```TypeScript
// file: src/routes/index.tsx
// …

const latestBid = (store: PairStore) =>
  store.prices.length > 1 ? store.prices[0].bid : '';

export default function Home() {
  const userPairs = useRouteData<typeof routeData>();
  const fxPairRecord = usePairData();
  const entries = createMemo(() => userPairs()?.map(fxPairRecord));
  onCleanup(disposePairData);

  return (
    /* lots of JSX */
  );
}
```

`fxPairRecord()` is simply a function that returns the appropriate "record" for the passed foreign exchange pair symbol. The record (an ES object) holds the `symbol` for the `fxPair`, its `label` and the reactive [`store`](https://www.solidjs.com/docs/latest/api#createstore) accessor that contains the most recent historical prices for that `fxPair`. 

So `entries` holds all the `fxPair` records the user has access to.

`disposePairData` is simply used to decrement the reference count on the central event source ([onCleanup](https://www.solidjs.com/docs/latest/api#oncleanup)) so it can disconnect when there are no more "subscribers".

```TSX
<table>
  <thead>
    <tr>
      <For each={entries()}>
        {({ label }) => <th scope="col">{label}</th>}
      </For>
    </tr>
  </thead>
  <tbody>
    <tr>
      <For each={entries()}>
        {({ store, symbol }) => <td id={symbol}>{latestBid(store)}</td>}
      </For>
    </tr>
  </tbody>
</table>
```
This creates a single table with a single column for each `fxPair` showing only the most recent bid. The row entries are reactive as they access the contents of the reactive store via the `latestBid()` function under the reactive root of the JSX.

```TSX
<For each={entries()}>
  {({ store, symbol, label }) => (
    <table class="price-table">
      <caption>{label}</caption>
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Bid</th>
          <th>Ask</th>
        </tr>
      </thead>
      <tbody id={`history--${symbol}`}>
        <For each={store.prices}>
          {(price) => (
            <tr>
              <th>{formatTimestamp(price.timestamp)}</th>
              <td>{price.bid}</td>
              <td>{price.ask}</td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  )}
</For>
```
This creates a single table for each `fxPair` to display a history of the most recent prices. The store maintains the referential stability of the exisiting `price` records making it possible for SolidJS to reuse the DOM fragments as new price records are added to the store.

```TSX
// file: src/routes/index.tsx
// …

<>
  <Title>FX Client: latest prices</Title>
  <main>
    { /* latest bid table */ }
    { /* history table per fxPair */ }
   <footer class="c-info">
      <p class="c-info__line">
        Visit{' '}
        <a href="https://start.solidjs.com" target="_blank">
          start.solidjs.com
        </a>{' '}
        to learn how to build SolidStart apps.
      </p>
      <div>
        <form method="post" action="/logout" class="c-info__logout">
          <button type="submit" class="c-info__pointer u-flat-button">
            Logout
          </button>
        </form>
      </div>
    </footer>
  </main>
</>;
```

The footer contains the logout action which redirects to the login page.

---

To be continued…




