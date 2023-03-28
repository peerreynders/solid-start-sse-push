import { For, onCleanup } from 'solid-js';
import { Title } from 'solid-start';

import { formatTimestamp, SYMBOLS } from '~/lib/foreign-exchange';
import {
	disposePairData,
	usePairData,
	type PricesStore,
} from '~/components/pair-data-context';

// import { scheduleCompare } from '~/lib/row-monitor';

function latestBid(store: PricesStore) {
	const length = store.prices.length;
	return length > 1 ? store.prices[length - 1].bid : '';
}

function pricesRows(store: PricesStore) {
	// if (store.symbol === 'USD-JPY') scheduleCompare('USD-JPY');
	const prices = store.prices.slice();
	return prices.reverse();
}

export default function Home() {
	const priceStores = usePairData();

	const entries: { store: PricesStore; symbol: string; label: string }[] = [];
	for (const [symbol, label] of SYMBOLS) {
		const store = priceStores.get(symbol);
		if (!store) continue;

		entries.push({ store, symbol, label });
	}

	onCleanup(disposePairData);

	return (
		<>
			<Title>FX Client: latest prices</Title>
			<main>
				<table>
					<thead>
						<tr>
							<For each={entries}>
								{({ label }) => <th scope="col">{label}</th>}
							</For>
						</tr>
					</thead>
					<tbody>
						<tr>
							<For each={entries}>
								{({ store, symbol }) => <td id={symbol}>{latestBid(store)}</td>}
							</For>
						</tr>
					</tbody>
				</table>
				<For each={entries}>
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
								<For each={pricesRows(store)}>
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
		</>
	);
}
