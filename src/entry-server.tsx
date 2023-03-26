import {
	createHandler,
	renderAsync,
	StartServer,
	type MiddlewareInput,
	type MiddlewareFn,
} from 'solid-start/entry-server';
import { redirect } from 'solid-start/server';
import { getUser, logout } from './server/session';
import { homeHref, loginHref, logoutHref } from './route-path';

// solid-start-sse-support
import { listen } from '~/server/solid-start-sse-support';
// in-memory-user
import { start as startRepo } from '~/server/repo';

// solid-start-sse-support
listen();
// in-memory-user
startRepo();

const protectedPaths = new Set([homeHref]);

function userMiddleware({ forward }: MiddlewareInput): MiddlewareFn {
	return async (event) => {
		const loginRoute = loginHref();
		const route = new URL(event.request.url).pathname;
		if (route === logoutHref) return logout(event.request, loginRoute);

		// Attach user to FetchEvent if available
		const user = await getUser(event.request);

		if (!user && protectedPaths.has(route)) return redirect(loginHref(route));

		event.locals['user'] = user;

		return forward(event);
	};
}

export default createHandler(
	userMiddleware,
	renderAsync((event) => <StartServer event={event} />)
);
