# SolidStart SSE Push 

TL;DR: Wanting to understand [server-sent events (sse)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) in more detail; chose to scan though [Data Push Applications Using HTML5 SSE](https://play.google.com/store/books/details/Darren_Cook_Data_Push_Apps_with_HTML5_SSE?id=7gYiAwAAQBAJ) (2014) ([repo](https://github.com/DarrenCook/ssebook)) and then reinforce learning by implementing many of the concepts in a [SolidStart](https://start.solidjs.com/) demo.

## Background

The remix-run examples feature an [sse-counter](https://github.com/remix-run/examples/tree/main/sse-counter) which uses remix-utils' [`useEventSource`](https://github.com/sergiodxa/remix-utils/blob/main/src/react/use-event-source.tsx) hook to access server-sent events. Unfortunately each invocation of of `useEventSource` creates it's **own** instance of [`EventSource`](https://developer.mozilla.org/en-US/docs/Web/API/EventSource).

That approach may work over HTTP/2 and later but browser's enforce a browser-wide 6 connection per domain limit for HTTP/1.1 and each `EventSource` instance ties up a single connection for the domain (over the whole browser, not just the page). Because of this limitation the [HTML Living Standard](https://html.spec.whatwg.org/multipage/server-sent-events.html#authoring-notes) recommends:

> Clients that support HTTP's per-server connection limitation might run into trouble **when opening multiple pages from a site if each page has an `EventSource` to the same domain**. Authors can avoid this using the relatively complex mechanism of using unique domain names per connection, or by allowing the user to enable or disable the `EventSource` functionality on a per-page basis, or by sharing a single `EventSource` object using a [shared worker](https://html.spec.whatwg.org/multipage/workers.html#sharedworkerglobalscope). 

… i.e. one **single** `EventSource` instance should be serving the entire web application as some sort of server-client event bus. It's likely a mistake to create that `EventSource` inside an ordinary component. It more likely should be managed centrally by a provider that makes it possible for components to subscribe to relevant events.  

To be continued…

---

[SSE vs WebSockets vs Long Polling. Martin Chaov. JS Fest 2018](https://youtu.be/n9mRjkQg3VE)

[Fat Events](https://youtu.be/jdliXz70NtM?t=716)
