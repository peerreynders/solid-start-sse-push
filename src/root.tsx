// @refresh reload
import { Suspense } from 'solid-js';
import {
	// A,
	Body,
	ErrorBoundary,
	FileRoutes,
	Head,
	Html,
	Meta,
	Routes,
	Scripts,
	Title,
} from 'solid-start';
import './root.css';

import { EventDataProvider } from './components/event-data-context';

export default function Root() {
	return (
		<Html lang="en">
			<Head>
				<Title>SolidStart - SSE Counter</Title>
				<Meta charset="utf-8" />
				<Meta name="viewport" content="width=device-width, initial-scale=1" />
			</Head>
			<Body>
				<Suspense>
					<ErrorBoundary>
						<EventDataProvider>
							<Routes>
								<FileRoutes />
							</Routes>
						</EventDataProvider>
					</ErrorBoundary>
				</Suspense>
				<Scripts />
			</Body>
		</Html>
	);
}
