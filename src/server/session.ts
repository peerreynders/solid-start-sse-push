import { createCookieSessionStorage } from 'solid-start';
import { redirect, type FetchEvent } from 'solid-start/server';
import { safeRedirect, userFromFetchEvent } from './shame';
import { loginHref } from '~/route-path';
import { selectUserById } from '~/server/repo';

import type { Session } from 'solid-start/session/sessions';
import type { User } from '~/types';

if (!process.env.SESSION_SECRET) throw Error('SESSION_SECRET must be set');

const storage = createCookieSessionStorage({
	cookie: {
		name: '__session',
		secure: process.env.NODE_ENV === 'production',
		secrets: [process.env.SESSION_SECRET],
		sameSite: 'lax',
		path: '/',
		maxAge: 0,
		httpOnly: true,
	},
});

const fromRequest = (request: Request): Promise<Session> =>
	storage.getSession(request.headers.get('Cookie'));

const KEY_USER_ID = 'userId';
const KEY_USER_PAIRS = 'fxPairs';
const USER_SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
// Cookies are session cookies if they do not
// specify the `Expires` or `Max-Age` attribute.

async function createUserSession({
	request,
	userId,
	userPairs,
	remember,
	redirectTo,
}: {
	request: Request;
	userId: User['id'];
	userPairs: string[];
	remember: boolean;
	redirectTo: string;
}): Promise<Response> {
	const session = await fromRequest(request);
	session.set(KEY_USER_ID, userId);
	session.set(KEY_USER_PAIRS, userPairs);

	const maxAge = remember ? USER_SESSION_MAX_AGE : undefined;
	const cookieContent = await storage.commitSession(session, { maxAge });

	return redirect(safeRedirect(redirectTo), {
		headers: {
			'Set-Cookie': cookieContent,
		},
	});
}

async function logout(request: Request, redirectTo = loginHref()) {
	const session = await fromRequest(request);
	const cookieContent = await storage.destroySession(session);

	return redirect(redirectTo, {
		headers: {
			'Set-Cookie': cookieContent,
		},
	});
}

const getUserId = async (request: Request) =>
	(await fromRequest(request)).get(KEY_USER_ID);

async function getUser(request: Request) {
	const userId = await getUserId(request);
	return typeof userId === 'string' ? selectUserById(userId) : undefined;
}

function requireUser(
	event: FetchEvent,
	redirectTo: string = new URL(event.request.url).pathname
) {
	const user = userFromFetchEvent(event);
	if (user) return user;

	throw redirect(loginHref(redirectTo));
}

async function getUserPairs(request: Request) {
	const userPairs = (await fromRequest(request)).get(KEY_USER_PAIRS);
	if (!(userPairs && Array.isArray(userPairs))) return undefined;

	return userPairs as string[];
}

export {
	createUserSession,
	getUser,
	getUserId,
	getUserPairs,
	logout,
	requireUser,
	userFromFetchEvent,
};
