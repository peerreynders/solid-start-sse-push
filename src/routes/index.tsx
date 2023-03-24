import { For, type Accessor } from 'solid-js';
import { Title } from 'solid-start';

import { SYMBOLS, type PairData } from '~/lib/foreign-exchange';
import { usePairData } from '~/components/pair-data-context';

export default function Home() {
	const pairs = usePairData();

	const entries: [Accessor<PairData>, string, string][] = [];
	for (const [symbol, label] of SYMBOLS) {
		const pairData = pairs.get(symbol);
		if (!pairData) continue;

		entries.push([pairData, symbol, label]);
	}

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
								{([pairData, symbol]) => <td id={symbol}>{pairData().bid}</td>}
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
