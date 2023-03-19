import { Title } from 'solid-start';
import { useEventData } from '~/components/event-data-context';
import { formatNumber } from '~/helpers';

export default function Home() {
	const eventData = useEventData();

	return (
	  <>
			<Title>FX Client: latest prices</Title>
			<main>
			  <table>
				  <thead>
        	  <tr>
				  	  <th scope="col">USD/JPY</th>
					  	<th scope="col">EUR/USD</th>
						  <th scope="col">AUD/GBP</th>
					  </tr>
					</thead>
					<tbody>
        	  <tr>
				  	  <td id="USD/JPY"></td>
					  	<td id="EUR/USD">{formatNumber(eventData().bid)}</td>
						  <td id="AUD/GBP"></td>
					  </tr>
					</tbody>
      	</table>	
				<p>
					Visit{' '}
					<a href="https://start.solidjs.com" target="_blank">
						start.solidjs.com
					</a>{' '}
					to learn how to build SolidStart apps.
				</p>
			</main>
		</>
	);
}
