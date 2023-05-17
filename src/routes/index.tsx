import { createMemo, For, onCleanup } from 'solid-js';
import { useRouteData, Title } from 'solid-start';

// import { scheduleCompare } from '~/lib/row-monitor';

import { formatTimestamp } from '~/lib/foreign-exchange';
import {
	disposePairData,
	usePairData,
	type PairStore,
} from '~/components/pair-data-context';

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

const latestBid = (store: PairStore) =>
	store.prices.length > 1 ? store.prices[0].bid : '';

export default function Home() {
	const userPairs = useRouteData<typeof routeData>();
	const fxPairRecord = usePairData();
	const entries = createMemo(() => userPairs()?.map(fxPairRecord));
	onCleanup(disposePairData);

	return (
		<>
			<Title>FX Client: latest prices</Title>
			<main class="prices-wrapper">
				<div class="last-bid-table">
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
									{({ store, symbol }) => (
										<td id={symbol}>{latestBid(store)}</td>
									)}
								</For>
							</tr>
						</tbody>
					</table>
				</div>
				<div class="price-group">
					<For each={entries()}>
						{({ store, symbol, label }) => (
							<div class="price-table">
								<table>
									<caption>{label}</caption>
									<thead>
										<tr>
											<th>Timestamp</th>
											<th>Bid</th>
											<th>Ask</th>
										</tr>
									</thead>
									<tbody id={`price-history__${symbol}`}>
										<For each={store.prices}>
											{(price) => (
												<tr>
													<td>{formatTimestamp(price.timestamp)}</td>
													<td>{price.bid}</td>
													<td>{price.ask}</td>
												</tr>
											)}
										</For>
									</tbody>
								</table>
							</div>
						)}
					</For>
				</div>
				<footer class="info">
					<p>
						Visit{' '}
						<a href="https://start.solidjs.com" target="_blank">
							start.solidjs.com
						</a>{' '}
						to learn how to build SolidStart apps.
					</p>
					<div>
						<form method="post" action="/logout">
							<button type="submit">Logout</button>
						</form>
					</div>
				</footer>
			</main>
		</>
	);
}
