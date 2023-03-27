import { For, onCleanup } from 'solid-js';
import { Title } from 'solid-start';

import { SYMBOLS } from '~/lib/foreign-exchange';
import {
	disposePairData,
	usePairData,
	type PricesStore,
} from '~/components/pair-data-context';

function latestBid(store: PricesStore) {
	const length = store.prices.length;
	return length > 1 ? store.prices[length - 1].bid : '';
}

export default function Home() {
	const pairPrices = usePairData();

	const entries: [PricesStore, string, string][] = [];
	for (const [symbol, label] of SYMBOLS) {
		const priceData = pairPrices.get(symbol);
		if (!priceData) continue;

		entries.push([priceData, symbol, label]);
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
								{([, , label]) => <th scope="col">{label}</th>}
							</For>
						</tr>
					</thead>
					<tbody>
						<tr>
							<For each={entries}>
								{([priceData, symbol]) => (
									<td id={symbol}>{latestBid(priceData)}</td>
								)}
							</For>
						</tr>
					</tbody>
				</table>
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
